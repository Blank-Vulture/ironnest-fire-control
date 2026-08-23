/**
 * 三角測量。観測員の報告から目標の位置を割り出す。
 *
 * ゲーム側でも想定された手順で、方位どうし・距離どうし・方位と距離の
 * どの組み合わせでも成立する（Iron Nest Wiki / Map Measurements）。
 *
 * 注意点も同じ資料に書かれている:
 *   - 距離 2 つの交点は 2 箇所に出る。文脈で潰すか、もう 1 つ観測を足す。
 *   - 方位 2 本が平行に近いと、位置の誤差が大きく開く。
 * どちらもこのモジュールが検出して呼び出し側に伝える。
 */

import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  bearingBetween,
  distanceBetween,
  pointFrom,
  type Point,
} from './grid'

export interface Observation {
  id: string
  label: string
  /** 観測員の位置。 */
  position: Point
  /** 観測員から見た目標の方位（度）。無ければ null。 */
  bearingDeg: number | null
  /** 観測員から目標までの距離（km）。無ければ null。 */
  rangeKm: number | null
}

export interface Estimate {
  position: Point
  /**
   * 各観測との食い違いの二乗平均平方根（km）。
   * 0 に近いほど、すべての報告が同じ 1 点を指している。
   */
  residualKm: number
  /** 使った拘束の数。方位 1 つ・距離 1 つでそれぞれ 1。 */
  constraintCount: number
  /**
   * ほぼ同じくらい辻褄が合う別の候補。距離 2 つだけのときなどに出る。
   * 出ている間は、どちらが本物か地形や報告の文面で決める必要がある。
   */
  alternative: Point | null
  /**
   * 方位 2 本だけで解いたときの交差角（度）。
   * 浅いほど誤差が開くので、呼び出し側で注意を促す。
   */
  crossingAngleDeg: number | null
}

export type Triangulation =
  | { kind: 'solved'; estimate: Estimate }
  /** 拘束が足りない。位置を決めるには最低 2 つ要る。 */
  | { kind: 'insufficient'; have: number }
  /**
   * 数はそろっているのに交わらない。互いに背を向けた方位や、
   * 重ならない距離円など、報告そのものが食い違っている場合。
   */
  | { kind: 'contradictory'; have: number }

/** 位置を決めるのに要る拘束の数。 */
export const REQUIRED_CONSTRAINTS = 2

/** 交差角がこれより浅いと、位置の誤差が大きく開く。 */
export const SHALLOW_CROSSING_DEG = 20

/** 別候補がこの距離より離れていて、かつ同程度に整合していれば曖昧とみなす。 */
const AMBIGUITY_SEPARATION_KM = 0.3

/**
 * 盤面の中にあるか。
 *
 * 交点が 2 つ出ても、片方が地図の外なら目標ではありえない。
 * 盤面に入っている候補があるなら、そちらだけを相手にする。
 */
function onMap(point: Point): boolean {
  return point.x >= 0 && point.x < MAP_WIDTH_KM && point.y >= 0 && point.y < MAP_HEIGHT_KM
}

function countConstraints(observations: readonly Observation[]): number {
  return observations.reduce(
    (n, o) => n + (o.bearingDeg !== null ? 1 : 0) + (o.rangeKm !== null ? 1 : 0),
    0,
  )
}

/**
 * ある点が、その観測とどれだけ食い違っているか（km）。
 *
 * 方位は「その方位線からどれだけ横にずれているか」で測る。距離と同じ km で
 * 揃えておくと、方位と距離が混ざっていても素直に足し合わせられる。
 * 観測員の背後にある点は、方位線上に乗っていても誤りなので大きく罰する。
 */
function residual(observation: Observation, point: Point): number {
  const { position, bearingDeg, rangeKm } = observation
  let sum = 0

  if (bearingDeg !== null) {
    const rad = (bearingDeg * Math.PI) / 180
    const dirX = Math.sin(rad)
    const dirY = Math.cos(rad)
    const dx = point.x - position.x
    const dy = point.y - position.y
    const along = dx * dirX + dy * dirY
    const across = Math.abs(dx * dirY - dy * dirX)
    sum += along >= 0 ? across * across : (across * across + along * along)
  }

  if (rangeKm !== null) {
    const diff = distanceBetween(position, point) - rangeKm
    sum += diff * diff
  }

  return sum
}

function totalResidual(observations: readonly Observation[], point: Point): number {
  return observations.reduce((sum, o) => sum + residual(o, point), 0)
}

/* ---------- 候補の洗い出し ---------- */

function raySegmentPoint(o: Observation, t: number): Point {
  return pointFrom(o.position, o.bearingDeg!, t)
}

/** 方位線どうしの交点。ほぼ平行なら出さない。 */
function rayRay(a: Observation, b: Observation): Point[] {
  const ra = (a.bearingDeg! * Math.PI) / 180
  const rb = (b.bearingDeg! * Math.PI) / 180
  const ax = Math.sin(ra)
  const ay = Math.cos(ra)
  const bx = Math.sin(rb)
  const by = Math.cos(rb)

  const denominator = ax * by - ay * bx
  if (Math.abs(denominator) < 1e-9) return []

  const dx = b.position.x - a.position.x
  const dy = b.position.y - a.position.y
  const t = (dx * by - dy * bx) / denominator
  // 方位は向きを持つので、観測員の背後に出た交点は捨てる
  if (t < 0) return []

  const point = raySegmentPoint(a, t)
  const u = (point.x - b.position.x) * bx + (point.y - b.position.y) * by
  return u < 0 ? [] : [point]
}

/** 方位線と距離円の交点。最大 2 つ。 */
function rayCircle(ray: Observation, circle: Observation): Point[] {
  const rad = (ray.bearingDeg! * Math.PI) / 180
  const dirX = Math.sin(rad)
  const dirY = Math.cos(rad)
  const fx = ray.position.x - circle.position.x
  const fy = ray.position.y - circle.position.y

  const b = 2 * (fx * dirX + fy * dirY)
  const c = fx * fx + fy * fy - circle.rangeKm! * circle.rangeKm!
  const discriminant = b * b - 4 * c
  if (discriminant < 0) return []

  const root = Math.sqrt(discriminant)
  return [(-b - root) / 2, (-b + root) / 2]
    .filter((t) => t >= 0)
    .map((t) => raySegmentPoint(ray, t))
}

/** 距離円どうしの交点。最大 2 つ。離れすぎ・包含なら出さない。 */
function circleCircle(a: Observation, b: Observation): Point[] {
  const dx = b.position.x - a.position.x
  const dy = b.position.y - a.position.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return []

  const ra = a.rangeKm!
  const rb = b.rangeKm!
  if (d > ra + rb || d < Math.abs(ra - rb)) return []

  const mid = (d * d - rb * rb + ra * ra) / (2 * d)
  const heightSquared = ra * ra - mid * mid
  const height = heightSquared > 0 ? Math.sqrt(heightSquared) : 0

  const baseX = a.position.x + (mid * dx) / d
  const baseY = a.position.y + (mid * dy) / d
  const offsetX = (height * dy) / d
  const offsetY = (height * dx) / d

  return height === 0
    ? [{ x: baseX, y: baseY }]
    : [
        { x: baseX + offsetX, y: baseY - offsetY },
        { x: baseX - offsetX, y: baseY + offsetY },
      ]
}

function candidates(observations: readonly Observation[]): Point[] {
  const points: Point[] = []

  // 方位と距離が両方そろった観測員は、それだけで 1 点に決まる
  for (const o of observations) {
    if (o.bearingDeg !== null && o.rangeKm !== null) {
      points.push(pointFrom(o.position, o.bearingDeg, o.rangeKm))
    }
  }

  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const a = observations[i]!
      const b = observations[j]!
      if (a.bearingDeg !== null && b.bearingDeg !== null) points.push(...rayRay(a, b))
      if (a.bearingDeg !== null && b.rangeKm !== null) points.push(...rayCircle(a, b))
      if (b.bearingDeg !== null && a.rangeKm !== null) points.push(...rayCircle(b, a))
      if (a.rangeKm !== null && b.rangeKm !== null) points.push(...circleCircle(a, b))
    }
  }

  return points
}

/**
 * 候補から出発して、食い違いがいちばん小さい点まで詰める。
 *
 * 未知数は 2 つしかないので、行列を持ち出さずに歩幅を半分にしていく
 * 素朴な探索で十分に収束する。式が単純なぶん、挙動が読めて落ちない。
 */
function refine(observations: readonly Observation[], start: Point): Point {
  let best = start
  let bestScore = totalResidual(observations, best)
  let step = 0.5

  for (let i = 0; i < 60 && step > 1e-6; i++) {
    let moved = false
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
      [step, step],
      [step, -step],
      [-step, step],
      [-step, -step],
    ] as const) {
      const trial = { x: best.x + dx, y: best.y + dy }
      const score = totalResidual(observations, trial)
      if (score < bestScore) {
        best = trial
        bestScore = score
        moved = true
      }
    }
    if (!moved) step /= 2
  }

  return best
}

/** 方位 2 本だけで解いているときの交差角（度）。それ以外は null。 */
function crossingAngle(observations: readonly Observation[]): number | null {
  const bearings = observations
    .filter((o) => o.bearingDeg !== null && o.rangeKm === null)
    .map((o) => o.bearingDeg!)
  if (bearings.length !== 2 || countConstraints(observations) !== 2) return null

  const diff = Math.abs(((bearings[0]! - bearings[1]!) % 180 + 180) % 180)
  return Math.min(diff, 180 - diff)
}

export function triangulate(observations: readonly Observation[]): Triangulation {
  const usable = observations.filter((o) => o.bearingDeg !== null || o.rangeKm !== null)
  const constraintCount = countConstraints(usable)
  if (constraintCount < REQUIRED_CONSTRAINTS) {
    return { kind: 'insufficient', have: constraintCount }
  }

  const seeds = candidates(usable)
  if (seeds.length === 0) return { kind: 'contradictory', have: constraintCount }

  const refined = seeds.map((seed) => {
    const point = refine(usable, seed)
    return { point, score: totalResidual(usable, point) }
  })
  refined.sort((a, b) => a.score - b.score)

  // 盤面に入っている候補があるなら、外の候補は初めから捨てる。
  // これだけで、交点が 2 つ出ても片方が地図の外なら曖昧さが消える。
  const inside = refined.filter((r) => onMap(r.point))
  const pool = inside.length > 0 ? inside : refined

  const best = pool[0]!
  const rms = Math.sqrt(best.score / constraintCount)

  // 同じくらい辻褄が合うのに離れている点があれば、決め手が足りていない
  const alternative =
    pool.find(
      (r) =>
        distanceBetween(r.point, best.point) > AMBIGUITY_SEPARATION_KM &&
        Math.sqrt(r.score / constraintCount) <= Math.max(rms * 1.5, rms + 0.15),
    )?.point ?? null

  return {
    kind: 'solved',
    estimate: {
      position: best.point,
      residualKm: rms,
      constraintCount,
      alternative,
      crossingAngleDeg: crossingAngle(usable),
    },
  }
}

/** 推定位置を、砲座から見た方位と距離に直す。 */
export function firingSolutionFrom(nest: Point, target: Point) {
  return {
    bearingDeg: bearingBetween(nest, target),
    distanceKm: distanceBetween(nest, target),
  }
}
