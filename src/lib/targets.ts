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
  bearingBetween,
  distanceBetween,
  pointFrom,
  type Point,
} from './grid'
import {
  bearingDelta,
  elevationDeg,
  flightSeconds,
  requiredCharge,
  wrapBearing,
  type Charge,
} from './ballistics'
import { READY_ROUNDS_PER_GUN, type Side } from './guns'
import { DEFAULT_SHELL, type ShellCode } from './shells'
import { crossesMidnight, launchSod, parseTimeOfDay } from './time'

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
  /** 撃ち終えたか。射撃計画からは外れ、完了一覧に移る。 */
  done: boolean
  /** どの標定点から来たか。標定と射撃順を連動させるための紐づけ。 */
  originFixId?: string
  /** 候補が 2 つあるとき、どちらを撃つか。1 が本命、2 がもう一方。 */
  candidate?: 1 | 2
  /** 撃った結果。これが分かれば標定の候補が 1 つに決まる。 */
  outcome?: 'hit' | 'miss'
  /**
   * 外れたとき、砲弾が実際に落ちた座標。
   *
   * 不発を押した時点で控える。カードの方位と距離は標定に追従して動くので、
   * あとから読むと撃った場所とは別の位置になってしまう。
   */
  impactGrid?: string
  /** 着弾点から目標までの距離の報告。 */
  impactRangeInput?: string
  /** 記録した着弾点。二重に作らないよう覚えておく。 */
  impactPointId?: string
  /** 撃ったときに使った砲。次の割り当てを続きから振るために残す。 */
  firedGun?: Side
  /** 撃った順を知るための時刻。いちばん新しいものが砲塔の現在位置になる。 */
  firedAt?: number
}

export interface TargetSolution {
  target: Target
  /** 実際に使う装薬。射程外なら null。 */
  charge: Charge | null
  elevationDeg: number | null
  flightSeconds: number | null
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
  /** その砲にとって何発目か（0 始まり）。弾倉の位置でもある。 */
  magIndex: number
  /** 即応弾を撃ち切った後の 1 発か。補給が要る。 */
  needsResupply: boolean
  /** ひとつ前の目標からの旋回量（度、符号付き）。先頭は null。 */
  turnFromPrev: number | null
  /** 直前と同じ砲を使う＝装填を待つことになる。 */
  reloadStall: boolean
}

export interface FiringPlan {
  steps: PlanStep[]
  /** 残りを撃ち終えるまでの旋回量の合計（度）。 */
  totalTurnDeg: number
  /** 射程外などで計画に載せられなかったもの。 */
  unplaced: TargetSolution[]
  /** 撃ち終えたもの。順序は入力順のまま。 */
  done: TargetSolution[]
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
    done: false,
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

  const flight = charge !== null ? flightSeconds(target.distanceKm, charge) : null
  const impact = parseTimeOfDay(target.impactDigits)
  const solved = impact !== null && flight !== null

  return {
    target,
    charge: reachable ? charge : null,
    elevationDeg: reachable ? elevationDeg(target.distanceKm, charge!) : null,
    flightSeconds: reachable ? flight : null,
    impact,
    launch: solved ? launchSod(impact, flight) : null,
    prevDay: solved ? crossesMidnight(impact, flight) : false,
    outOfRange: requiredCharge(target.distanceKm) === null,
  }
}

/* ---------- 射撃計画 ---------- */

/** 円周上に散らばった目標を覆う弧を求める。いちばん広い隙間の外側が弧になる。 */
function coveringArc(sorted: readonly TargetSolution[]): {
  first: number
  arcLength: number
} {
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
  return { first: gapIndex, arcLength: 360 - widest }
}

/**
 * 射撃順に並べ替える。
 *
 * 目標は円周上に散らばっているので、全部を回るのに必要な旋回量は
 * 「一周 − いちばん広く空いている隙間」で最小になる。その隙間を跨がずに
 * 一方向へ回れば、余計な往復が一切なくなる。
 *
 * すでに撃った弾があるときは、砲塔はその目標の方位を向いたままなので、
 * そこから弧の手前端へ寄って時計回りに舐めるか、奥端へ寄って反時計回りに
 * 舐めるかの安い方を選ぶ。後者では左回りが出る。
 */
function orderByBearing(
  solutions: readonly TargetSolution[],
  fromBearing: number | null,
): TargetSolution[] {
  if (solutions.length <= 1) return [...solutions]

  const sorted = [...solutions].sort((a, b) => a.target.bearingDeg - b.target.bearingDeg)
  const { first, arcLength } = coveringArc(sorted)

  const clockwise = [...sorted.slice(first), ...sorted.slice(0, first)]
  if (fromBearing === null) return clockwise

  const counter = [...clockwise].reverse()
  const approachCw = Math.abs(bearingDelta(fromBearing, clockwise[0]!.target.bearingDeg))
  const approachCcw = Math.abs(bearingDelta(fromBearing, counter[0]!.target.bearingDeg))

  // 弧を舐める距離はどちら回りでも同じなので、寄せる距離だけで決まる
  return approachCcw + arcLength < approachCw + arcLength ? counter : clockwise
}

/**
 * 射撃計画を組む。
 *
 * 砲の割り当ては、指定があればそれを使い、無ければ直前と反対の砲にする。
 * こうすると片方が飛んでいる間にもう片方を装填でき、旋回もわずかで済む。
 */
export function buildPlan(targets: readonly Target[]): FiringPlan {
  const solutions = targets.map(solveTarget)
  // 撃ち終えた目標は旋回にも射撃順にも関わらないので、まず外す
  const done = solutions.filter((s) => s.target.done)
  const remaining = solutions.filter((s) => !s.target.done)
  const placeable = remaining.filter((s) => !s.outOfRange)
  const unplaced = remaining.filter((s) => s.outOfRange)

  // 最後に撃った 1 発が、砲塔の現在の方位と直前に使った砲を教えてくれる。
  // これを引き継がないと、1 発撃つたびに左右の割り当てが入れ替わって、
  // 先に装填しておいた弾が無駄になる。
  const lastFired = done.reduce<TargetSolution | null>(
    (latest, s) =>
      s.target.firedAt !== undefined &&
      (latest === null || s.target.firedAt > latest.target.firedAt!)
        ? s
        : latest,
    null,
  )

  const ordered = orderByBearing(placeable, lastFired?.target.bearingDeg ?? null)

  let lastGun: Side | null = lastFired?.target.firedGun ?? null
  let totalTurnDeg = 0
  const fireCount: Record<Side, number> = { left: 0, right: 0 }

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
        ? lastFired === null
          ? null
          : bearingDelta(lastFired.target.bearingDeg, solution.target.bearingDeg)
        : bearingDelta(prev.target.bearingDeg, solution.target.bearingDeg)
    if (turnFromPrev !== null) totalTurnDeg += Math.abs(turnFromPrev)

    const reloadStall = lastGun !== null && lastGun === gun
    lastGun = gun

    const magIndex = fireCount[gun]
    fireCount[gun] += 1

    return {
      solution,
      order: i + 1,
      gun,
      magIndex,
      needsResupply: magIndex >= READY_ROUNDS_PER_GUN,
      turnFromPrev,
      reloadStall,
    }
  })

  return { steps, totalTurnDeg, unplaced, done }
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

/**
 * その砲で、即応弾を撃ち切った後に撃つぶん。補給する順に並ぶ。
 *
 * 弾倉に入るのは 6 発までなので、それを超える目標を抱えている砲は
 * 途中で揚弾が要る。何を何発目に上げればよいかはこの並びがそのまま答えになる。
 */
export function resupplyQueue(steps: readonly PlanStep[], side: Side): PlanStep[] {
  return steps.filter((step) => step.gun === side && step.needsResupply)
}

/* ---------- 砲座が動いたとき ---------- */

/**
 * 砲座が動いたぶん、目標の方位と距離を測り直す。
 *
 * 目標は「砲座から見た方位と距離」でしか持っていないので、砲座が動くと
 * その値は古い位置を基準にしたままずれる。いったん盤面の座標に戻してから、
 * 新しい位置で測り直す。目標そのものは動いていないので、盤面の座標は変わらない。
 */
export function reprojectTarget(target: Target, from: Point, to: Point): Target {
  const absolute = pointFrom(from, target.bearingDeg, target.distanceKm)
  return {
    ...target,
    bearingDeg: bearingBetween(to, absolute),
    distanceKm: distanceBetween(to, absolute),
  }
}
