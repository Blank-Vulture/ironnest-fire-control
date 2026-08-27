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

/**
 * 撃破の優先度。
 *
 * 旋回が忙しいゲームなので射撃順は方位で組んであるが、それは「どれを先に
 * 潰しても構わない」ときの話。高価値目標は旋回を余分に払ってでも先に潰したい。
 */
export type Priority = 'high' | 'raised' | 'normal'

export const PRIORITIES: { value: Priority; label: string; note: string }[] = [
  { value: 'high', label: '高価値', note: '旋回を余分に払ってでも真っ先に潰す' },
  { value: 'raised', label: '優先', note: '通常の目標より先に撃つ' },
  { value: 'normal', label: '通常', note: '旋回がいちばん少ない順に撃つ' },
]

/**
 * 撃つ順に並べた段。既定の「通常」がいちばん下にある。
 *
 * 下に「後回し」を置くと、急がない目標をわざわざ指定して回ることになる。
 * 何も付けなければ後ろへ下がるほうが、手が要らない。
 */
const PRIORITY_ORDER: Priority[] = ['high', 'raised', 'normal']

export function isPriority(value: string): value is Priority {
  return PRIORITY_ORDER.includes(value as Priority)
}

/**
 * 読めない値を通常として扱う。
 *
 * 段が変わる前に付けた「後回し」がそのまま残っていることがある。いまは通常が
 * いちばん下なので、そこへ寄せれば意味も変わらない。読めない値を素通しすると
 * どの段にも入らず、射撃順から静かに消える。
 */
export function normalizePriority(value: string | undefined): Priority {
  return value !== undefined && isPriority(value) ? value : 'normal'
}

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
  /** 撃破の優先度。無ければ標準。 */
  priority?: Priority
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
  /** これから撃つぶん。番号は撃ち終えたぶんの続きから振る。 */
  steps: PlanStep[]
  /** 残りを撃ち終えるまでの旋回量の合計（度）。 */
  totalTurnDeg: number
  /** 射程外などで計画に載せられなかったもの。 */
  unplaced: TargetSolution[]
  /** 撃ち終えたもの。順序は入力順のまま。 */
  done: TargetSolution[]
  /** 撃ち終えたぶんの手順。番号は撃つ前と同じものを持つ。 */
  doneSteps: PlanStep[]
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
 * 入れた方位の読み取り幅（度）。
 *
 * 「300」なら丸めだけで ±0.5 度の幅があるが、「300.4」と小数まで読めているなら
 * 幅は ±0.05 度しかない。入れた桁数がそのまま精度なので、そう受け取る。
 * 浅く交わる標定では、この差がそのまま数百 m の差になる。
 */
function decimalSigma(input: string): number {
  const decimals = /\.(\d+)$/.exec(numeric(input))?.[1] ?? ''
  return 0.5 * Math.pow(10, -decimals.length)
}

export function bearingSigmaFor(input: string): number {
  // 報告の方位は必ず小数第 1 位まで来る。その桁がたいてい 0 なので、点を
  // 打たずに「300」と入れることになるが、それは 300.0 のことであって
  // 「300 度前後」ではない。桁を書かなかったぶんまで幅を広げると、
  // 浅く交わる標定で誤差を実際の 10 倍に見積もる。
  return Math.min(decimalSigma(input), 0.05)
}

/** 入れた距離の読み取り幅（km）。理屈は方位と同じ。 */
export function distanceSigmaFor(input: string): number {
  return decimalSigma(input)
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
 * 段の中で最初に撃った 1 発より前は、どこを向いていたか。
 *
 * 「今の lastFired」をそのまま向く先に使うと、段の中の 2 発目以降を
 * 撃つたびに、その撃った目標自身が新しい基準点になってしまう。基準点が
 * 段の中の目標そのものだと、外れ値どうしの距離がほぼ 0 になって毎回
 * 逆回りが選ばれやすくなる。1 発目より前という固定点を使えば、その段を
 * 何発飛ばして撃っても基準点が動かない。
 */
function bearingBeforeFire(
  done: readonly TargetSolution[],
  firedAt: number,
): number | null {
  const prior = done.filter(
    (s) => s.target.firedAt !== undefined && s.target.firedAt < firedAt,
  )
  if (prior.length === 0) return null
  return prior.reduce((latest, s) =>
    s.target.firedAt! > latest.target.firedAt! ? s : latest,
  ).target.bearingDeg
}

/**
 * 優先度の段ごとに並べ、段の中は方位で最適化する。
 *
 * 高価値目標を先に潰したいが、段の中まで方位を無視すると旋回だけで時間を
 * 食い潰す。段を跨ぐときは、直前の段を撃ち終えた方位から続けて寄せるので、
 * 戻りの旋回も最小になる。
 *
 * 段そのものは跨いで混ぜない。「高価値なのに旋回が近いから後回し」を許すと、
 * なぜその順なのかが画面から読み取れなくなる。
 *
 * `full` には撃ち終えた分も混ぜて渡す。除いてしまうと、抜けた 1 発ぶんだけ
 * 隙間の形が変わり、残り全体の回る向きを毎回選び直すことになる。撃った分は
 * 向きを決めるためだけに使い、実際の計画（呼び出し側）には残さない。
 */
function orderByPriorityThenBearing(
  full: readonly TargetSolution[],
  done: readonly TargetSolution[],
  fromBearing: number | null,
): TargetSolution[] {
  const ordered: TargetSolution[] = []
  let from = fromBearing

  for (const priority of PRIORITY_ORDER) {
    const tier = full.filter((s) => normalizePriority(s.target.priority) === priority)
    if (tier.length === 0) continue

    const firedInTier = tier.filter(
      (s) => s.target.done && s.target.firedAt !== undefined,
    )

    // 段の中でまだ何も撃っていなければ、これまでどおり直前の段から続けて
    // 寄せる。すでに撃った分があれば、その段の向きはもう決まっているので、
    // 1 発目より前の基準点で組み直すだけにして、以後は選び直さない。
    const effectiveFrom =
      firedInTier.length > 0
        ? bearingBeforeFire(
            done,
            Math.min(...firedInTier.map((s) => s.target.firedAt!)),
          )
        : from

    const sequence = orderByBearing(tier, effectiveFrom)
    // 撃った分も残したまま返す。番号を振るのに使う（buildPlan を参照）
    ordered.push(...sequence)
    from = sequence[sequence.length - 1]?.target.bearingDeg ?? from
  }

  return ordered
}

/**
 * 射撃計画を組む。
 *
 * 砲の割り当ては、指定があればそれを使い、無ければ直前と反対の砲にする。
 * こうすると片方が飛んでいる間にもう片方を装填でき、旋回もわずかで済む。
 */
export function buildPlan(targets: readonly Target[]): FiringPlan {
  const solutions = targets.map(solveTarget)
  const done = solutions.filter((s) => s.target.done)
  const remaining = solutions.filter((s) => !s.target.done)
  // 射撃順に載せるのは撃ち終えていない分だけだが、並びを決めるときは
  // 撃った分も混ぜたまま渡す（orderByPriorityThenBearing 側で外す）。
  const full = solutions.filter((s) => !s.outOfRange)
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

  const ordered = orderByPriorityThenBearing(
    full,
    done,
    lastFired?.target.bearingDeg ?? null,
  )

  let lastGun: Side | null = lastFired?.target.firedGun ?? null
  let totalTurnDeg = 0
  const fireCount: Record<Side, number> = { left: 0, right: 0 }

  /*
   * 番号は撃った分も含めた並びの位置で振る。
   *
   * 撃った順に 1 から振り直すと、順番を飛ばして撃つたびに全員の番号が動く。
   * 番号が動くと左右の砲の割り当ても動き、カードが列をまたいで飛ぶ。
   * 並びが安定していても、見た目には入れ替わったようにしか見えない。
   */
  const orderOf = new Map(ordered.map((s, i) => [s.target.id, i + 1]))
  const doneSteps: PlanStep[] = ordered
    .filter((s) => s.target.done)
    .map((solution) => ({
      solution,
      order: orderOf.get(solution.target.id)!,
      gun: solution.target.firedGun ?? 'left',
      magIndex: 0,
      needsResupply: false,
      turnFromPrev: null,
      reloadStall: false,
    }))

  // 旋回量はこれから撃つ分どうしで測る。撃った分を挟むと、
  // すでに済んだ動きをもう一度数えてしまう
  const pending = ordered.filter((s) => !s.target.done)

  const steps: PlanStep[] = pending.map((solution, i) => {
    const gun: Side =
      solution.target.gun !== 'auto'
        ? solution.target.gun
        : lastGun === 'left'
          ? 'right'
          : 'left'

    const prev = pending[i - 1]
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
      // 撃ち終えたぶんを数に含めて続きから振る。ここで詰め直すと、
      // 1 発撃つたびに残りの番号がずれて、どれを撃つ順番だったか分からなくなる。
      order: orderOf.get(solution.target.id)!,
      gun,
      magIndex,
      needsResupply: magIndex >= READY_ROUNDS_PER_GUN,
      turnFromPrev,
      reloadStall,
    }
  })

  return { steps, totalTurnDeg, unplaced, done, doneSteps }
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

/* ---------- 優先度の同期 ---------- */

/** 1 枚のカードの優先度を書き換える。 */
export function applyTargetPriority(
  targets: readonly Target[],
  targetId: string,
  priority: Priority,
): Target[] {
  return targets.map((t) => (t.id === targetId ? { ...t, priority } : t))
}

/** ある標定から出したカードすべての優先度を書き換える。弾種と同じ考え方。 */
export function applyOriginPriority(
  targets: readonly Target[],
  fixId: string,
  priority: Priority,
): Target[] {
  return targets.map((t) => (t.originFixId === fixId ? { ...t, priority } : t))
}

/* ---------- 弾種の同期 ---------- */

/** 1 枚のカードの弾種を書き換える。 */
export function applyTargetShell(
  targets: readonly Target[],
  targetId: string,
  shell: ShellCode,
): Target[] {
  return targets.map((t) => (t.id === targetId ? { ...t, shell } : t))
}

/**
 * ある標定から出したカードすべての弾種を書き換える。
 * 標定側で弾種を変えたとき、そこから送った射撃順のカードを追従させるために使う。
 */
export function applyOriginShell(
  targets: readonly Target[],
  fixId: string,
  shell: ShellCode,
): Target[] {
  return targets.map((t) => (t.originFixId === fixId ? { ...t, shell } : t))
}
