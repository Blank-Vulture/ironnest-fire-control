/**
 * 目標と射撃計画。
 *
 * ゲーム内の流れは目標 1 体ごとに
 *   地図に赤線を引く → クリップボードに「方位角 / 射程」が記録される
 *   → 弾道計算機でカードを出す
 * となっている。方位と距離さえ取れれば残りは全部計算できるので、
 * このツールもその 2 つを入口にする。
 *
 * 砲塔の旋回は左右の砲で共通なので、連続射撃の律速は方位の修正になる。
 * したがって射撃順は方位順に組み、左右の砲を交互に割り当てて
 * 「撃つ → わずかに旋回 → もう片方を撃つ」が続くようにする。
 */

import {
  bearingDelta,
  elevationDeg,
  flightSeconds,
  requiredCharge,
  wrapBearing,
  type Charge,
} from './ballistics'
import type { Side } from './guns'
import { DEFAULT_SHELL, type ShellCode } from './shells'
import { crossesMidnight, launchSod, parseDuration, parseTimeOfDay } from './time'

export type ChargeSetting = 'auto' | Charge
export type GunSetting = 'auto' | Side

export interface Target {
  id: string
  /** 方位角（度、0 以上 360 未満）。 */
  bearingDeg: number
  /** 射程（km）。 */
  distanceKm: number
  shell: ShellCode
  /** 'auto' なら届く最小の装薬。 */
  charge: ChargeSetting
  /** 'auto' なら射撃順から交互に割り当てる。 */
  gun: GunSetting
  /** 着弾時刻（数字だけ）。空なら発射時刻は出さない。 */
  impactDigits: string
  /** 飛翔時間の手動上書き。空なら計算値を使う。 */
  flightOverride: string
}

export interface TargetSolution {
  target: Target
  /** 実際に使う装薬。射程外なら null。 */
  charge: Charge | null
  elevationDeg: number | null
  flightSeconds: number | null
  /** 飛翔時間が手入力で上書きされているか。 */
  flightOverridden: boolean
  impact: number | null
  launch: number | null
  prevDay: boolean
  /** どの装薬でも届かない。 */
  outOfRange: boolean
}

export interface PlanStep {
  solution: TargetSolution
  /** 射撃順（1 始まり）。 */
  order: number
  gun: Side
  /** ひとつ前の目標からの旋回量（度、符号付き）。先頭は null。 */
  turnFromPrev: number | null
  /** 直前と同じ砲を使う＝装填を待つことになる。 */
  reloadStall: boolean
}

export interface FiringPlan {
  steps: PlanStep[]
  /** 全目標を撃ち終えるまでの旋回量の合計（度）。 */
  totalTurnDeg: number
  /** 射程外などで計画に載せられなかったもの。 */
  unplaced: TargetSolution[]
}

export function newTarget(bearingDeg: number, distanceKm: number): Target {
  return {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    bearingDeg: wrapBearing(bearingDeg),
    distanceKm,
    shell: DEFAULT_SHELL,
    charge: 'auto',
    gun: 'auto',
    impactDigits: '',
    flightOverride: '',
  }
}

/* ---------- 入力の取り込み ---------- */

export interface Measurement {
  bearingDeg: number
  distanceKm: number
}

/** 全角・単位・記号を落として数値だけにする。 */
function numeric(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, '.')
    .replace(/[°ﾟ度]/g, '')
    .replace(/[kK][mM]|ｋｍ|ＫＭ/g, '')
    .trim()
}

/**
 * 方位角。単位を打たずに数字だけで済むよう、° が付いていても落とす。
 * 0 以上 360 未満のみ有効。
 */
export function parseBearing(input: string): number | null {
  const s = numeric(input)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const value = Number(s)
  if (!Number.isFinite(value) || value < 0 || value >= 360) return null
  return value
}

/**
 * 射程（km）。km が付いていても落とす。正の値のみ有効。
 * 30 km を超えていても読む（射程外として一覧に出したいため）。
 */
export function parseDistance(input: string): number | null {
  const s = numeric(input)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const value = Number(s)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

/**
 * クリップボードの下線部の書式 `273.9° / 6.16km` を読む。
 * 度記号・単位・全角・区切り記号のゆれは吸収する。
 * 2 つの数値が「方位 / 距離」の順に並んでいれば拾う。
 */
export function parseMeasurement(line: string): Measurement | null {
  const s = line
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, '.')
    .replace(/[／]/g, '/')
    .trim()
  if (s === '') return null

  // 符号も拾う。拾わないと "-5°" が 5 として通ってしまう。
  const numbers = s.match(/-?\d+(?:\.\d+)?/g)
  if (!numbers || numbers.length < 2) return null

  const bearingDeg = Number(numbers[0])
  const distanceKm = Number(numbers[1])
  if (!Number.isFinite(bearingDeg) || !Number.isFinite(distanceKm)) return null
  if (bearingDeg < 0 || bearingDeg >= 360) return null
  if (distanceKm <= 0) return null

  return { bearingDeg, distanceKm }
}

/** 複数行の貼り付けをまとめて読む。読めた行と読めなかった行を分けて返す。 */
export function parseMeasurements(text: string): { ok: Measurement[]; bad: string[] } {
  const ok: Measurement[] = []
  const bad: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const parsed = parseMeasurement(raw)
    if (parsed) ok.push(parsed)
    else bad.push(raw.trim())
  }
  return { ok, bad }
}

/* ---------- 解 ---------- */

export function solveTarget(target: Target): TargetSolution {
  const charge = target.charge === 'auto' ? requiredCharge(target.distanceKm) : target.charge
  const reachable = charge !== null && elevationDeg(target.distanceKm, charge) !== null

  const computed = charge !== null ? flightSeconds(target.distanceKm, charge) : null
  const override = parseDuration(target.flightOverride)
  const flight = override ?? computed

  const impact = parseTimeOfDay(target.impactDigits)
  const solved = impact !== null && flight !== null

  return {
    target,
    charge: reachable ? charge : null,
    elevationDeg: reachable ? elevationDeg(target.distanceKm, charge!) : null,
    flightSeconds: reachable || override !== null ? flight : null,
    flightOverridden: override !== null,
    impact,
    launch: solved ? launchSod(impact, flight) : null,
    prevDay: solved ? crossesMidnight(impact, flight) : false,
    outOfRange: requiredCharge(target.distanceKm) === null,
  }
}

/* ---------- 射撃計画 ---------- */

/**
 * 方位順に並べ替える。
 *
 * 目標は円周上に散らばっているので、全部を回るのに必要な旋回量は
 * 「一周 − いちばん広く空いている隙間」で最小になる。その隙間の直後から
 * 一方向に回れば、余計な往復が一切なくなる。
 */
function orderByBearing(solutions: readonly TargetSolution[]): TargetSolution[] {
  if (solutions.length <= 1) return [...solutions]

  const sorted = [...solutions].sort(
    (a, b) => a.target.bearingDeg - b.target.bearingDeg,
  )

  let gapIndex = 0
  let widest = -1
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]!.target.bearingDeg
    const to = sorted[(i + 1) % sorted.length]!.target.bearingDeg
    const gap = wrapBearing(to - from)
    if (gap > widest) {
      widest = gap
      gapIndex = (i + 1) % sorted.length
    }
  }

  return [...sorted.slice(gapIndex), ...sorted.slice(0, gapIndex)]
}

/**
 * 射撃計画を組む。
 *
 * 砲の割り当ては、指定があればそれを使い、無ければ直前と反対の砲にする。
 * こうすると片方が飛んでいる間にもう片方を装填でき、旋回もわずかで済む。
 */
export function buildPlan(targets: readonly Target[]): FiringPlan {
  const solutions = targets.map(solveTarget)
  const placeable = solutions.filter((s) => !s.outOfRange)
  const unplaced = solutions.filter((s) => s.outOfRange)

  const ordered = orderByBearing(placeable)

  let lastGun: Side | null = null
  let totalTurnDeg = 0

  const steps: PlanStep[] = ordered.map((solution, i) => {
    const gun: Side =
      solution.target.gun !== 'auto'
        ? solution.target.gun
        : lastGun === 'left'
          ? 'right'
          : 'left'

    const prev = ordered[i - 1]
    const turnFromPrev =
      prev === undefined
        ? null
        : bearingDelta(prev.target.bearingDeg, solution.target.bearingDeg)
    if (turnFromPrev !== null) totalTurnDeg += Math.abs(turnFromPrev)

    const reloadStall = lastGun !== null && lastGun === gun
    lastGun = gun

    return { solution, order: i + 1, gun, turnFromPrev, reloadStall }
  })

  return { steps, totalTurnDeg, unplaced }
}

/* ---------- 行への組み分け ---------- */

export interface PlanRow {
  left: PlanStep | null
  right: PlanStep | null
  /** この行の 1 発目に入るまでの旋回（前の行の最後から）。先頭の行は null。 */
  leadTurn: number | null
  /** 行内の 2 発の間の旋回。1 発だけの行なら null。 */
  midTurn: number | null
  /** 行内で先に撃つ側。空の行は null。 */
  firstSide: Side | null
}

/**
 * 射撃順を「左右 1 発ずつ」の行にまとめる。
 *
 * 砲は交互に割り当ててあるので、隣り合う 2 発はふつう左右に分かれる。
 * それを 1 行に並べると「左を撃つ → わずかに旋回 → 右を撃つ」の 1 組が
 * 一目に収まり、縦のスクロールも半分で済む。
 * 砲を手で固定して同じ砲が続いた場合だけ、その行は 1 発になる。
 */
export function pairSteps(steps: readonly PlanStep[]): PlanRow[] {
  const rows: PlanRow[] = []

  for (let i = 0; i < steps.length; ) {
    const first = steps[i]!
    const next = steps[i + 1]
    const pairable = next !== undefined && next.gun !== first.gun
    const second = pairable ? next : null

    rows.push({
      left: first.gun === 'left' ? first : (second?.gun === 'left' ? second : null),
      right: first.gun === 'right' ? first : (second?.gun === 'right' ? second : null),
      leadTurn: first.turnFromPrev,
      midTurn: second?.turnFromPrev ?? null,
      firstSide: first.gun,
    })

    i += second ? 2 : 1
  }

  return rows
}
