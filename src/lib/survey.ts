/**
 * 標定。観測点の網から、目標や基準点の位置を順に確定させる。
 *
 * 任務によっては 1 段では終わらない。たとえば
 *   観測員 3 人の距離が重なる地点を出す → その地点から方位 130 度、
 *   観測員 3 から方位 230 度、で目標を出す
 * のように、いま出したばかりの点を次の観測元に使うことがある。
 *
 * そこで点を「既知点」と「標定点」に分け、標定点はどちらの種類でも
 * 観測元にできるようにしてある。参照が解ける順に確定させていく。
 *
 * ただし Iron Nest Wiki / Map Measurements が警告しているとおり、
 * 不確かな点から次を測ると誤差はそのまま持ち越されて大きくなる。
 * 累積ぶんを別に持って、呼び出し側が出せるようにしている。
 */

import { gridToPoint, parseGrid, type Point } from './grid'
import { parseBearing, parseDistance } from './targets'
import { triangulate, type Observation, type Triangulation } from './triangulate'

export type PointId = string

/** 位置がグリッドで分かっている点。観測員や砲座。 */
export interface KnownPoint {
  id: PointId
  label: string
  gridInput: string
  /** 砲座。射撃諸元の基準になるので 1 つだけ。 */
  isNest: boolean
  /** 別の点にぶら下げて見せるとき、その親。補給隊を IRON NEST の下に置く。 */
  parentId?: PointId
}

/** ある点から見た報告。方位だけ・距離だけ・両方のどれでもよい。 */
export interface Sighting {
  id: string
  /** 観測元の点。既知点でも標定点でもよい。 */
  fromId: PointId
  bearingInput: string
  rangeInput: string
}

/** 観測から位置を割り出す点。目標にも中間の基準点にもなる。 */
export interface Fix {
  id: PointId
  label: string
  sightings: Sighting[]
}

export interface SurveyDoc {
  known: KnownPoint[]
  fixes: Fix[]
}

export type FixStatus =
  | { kind: 'solved'; position: Point; residualKm: number }
  /** 観測元がまだ解けていない。参照が循環している場合もここに来る。 */
  | { kind: 'pending'; missing: string[] }
  | { kind: 'insufficient'; have: number }
  | { kind: 'contradictory'; have: number }

export interface ResolvedFix {
  fix: Fix
  status: FixStatus
  /** この点自身の推定に伴う食い違い（km）。 */
  residualKm: number
  /**
   * 観測元から受け継いだぶんを含めた不確かさ（km）。
   * 標定済みの点を観測元にすると、その誤差はここに乗ってくる。
   */
  accumulatedKm: number
  /** 観測元に標定点が混ざっているか。混ざっていれば誤差が積み上がる。 */
  chained: boolean
  /** 曖昧さや浅い交差の注意。triangulate から引き継ぐ。 */
  alternative: Point | null
  crossingAngleDeg: number | null
}

export interface SurveyResult {
  /** 位置が確定した点。id で引ける。既知点と標定点の両方が入る。 */
  positions: Map<PointId, Point>
  /** 点ごとの累積の不確かさ（km）。既知点は 0。 */
  uncertainty: Map<PointId, number>
  fixes: ResolvedFix[]
  /** 砲座の位置。未設定・不正なら null。 */
  nest: Point | null
}

export function labelOf(doc: SurveyDoc, id: PointId): string {
  return (
    doc.known.find((k) => k.id === id)?.label ??
    doc.fixes.find((f) => f.id === id)?.label ??
    '不明な点'
  )
}

/** その標定点が観測元にできる点の一覧。自分自身と、自分に依存する点は除く。 */
export function availableSources(doc: SurveyDoc, fixId: PointId): (KnownPoint | Fix)[] {
  const dependents = new Set<PointId>([fixId])
  // 自分を辿ってくる点を集める。これらを観測元にすると輪になる。
  let grew = true
  while (grew) {
    grew = false
    for (const fix of doc.fixes) {
      if (dependents.has(fix.id)) continue
      if (fix.sightings.some((s) => dependents.has(s.fromId))) {
        dependents.add(fix.id)
        grew = true
      }
    }
  }
  return [...doc.known, ...doc.fixes.filter((f) => !dependents.has(f.id))]
}

function knownPositions(known: readonly KnownPoint[]): Map<PointId, Point> {
  const positions = new Map<PointId, Point>()
  for (const point of known) {
    const ref = parseGrid(point.gridInput)
    if (ref !== null) positions.set(point.id, gridToPoint(ref))
  }
  return positions
}

function toObservations(
  sightings: readonly Sighting[],
  positions: ReadonlyMap<PointId, Point>,
): { observations: Observation[]; missing: PointId[] } {
  const observations: Observation[] = []
  const missing: PointId[] = []

  for (const sighting of sightings) {
    const bearingDeg = parseBearing(sighting.bearingInput)
    const rangeKm = parseDistance(sighting.rangeInput)
    if (bearingDeg === null && rangeKm === null) continue

    const position = positions.get(sighting.fromId)
    if (position === undefined) {
      missing.push(sighting.fromId)
      continue
    }
    observations.push({ id: sighting.id, label: sighting.fromId, position, bearingDeg, rangeKm })
  }

  return { observations, missing }
}

function fromTriangulation(
  fix: Fix,
  result: Triangulation,
  sourceUncertainty: number,
  chained: boolean,
): ResolvedFix {
  if (result.kind !== 'solved') {
    return {
      fix,
      status: result,
      residualKm: 0,
      accumulatedKm: 0,
      chained,
      alternative: null,
      crossingAngleDeg: null,
    }
  }

  const { estimate } = result
  return {
    fix,
    status: { kind: 'solved', position: estimate.position, residualKm: estimate.residualKm },
    residualKm: estimate.residualKm,
    // 観測元がすでに推定値なら、その不確かさはそのまま持ち越される
    accumulatedKm: estimate.residualKm + sourceUncertainty,
    chained,
    alternative: estimate.alternative,
    crossingAngleDeg: estimate.crossingAngleDeg,
  }
}

/**
 * 網全体を解く。
 *
 * 観測元が解けた点から順に確定させ、それ以上進まなくなったら止める。
 * 残ったものは観測元が未確定か、参照が輪になっている。
 * 定義の順番に縛られないので、後から足した点を先に参照していても通る。
 */
export function solveSurvey(doc: SurveyDoc): SurveyResult {
  const positions = knownPositions(doc.known)
  const uncertainty = new Map<PointId, number>()
  for (const id of positions.keys()) uncertainty.set(id, 0)

  const resolved = new Map<PointId, ResolvedFix>()
  let progressed = true

  while (progressed) {
    progressed = false

    for (const fix of doc.fixes) {
      if (resolved.has(fix.id)) continue

      const { observations, missing } = toObservations(fix.sightings, positions)
      if (missing.length > 0) continue // まだ観測元が揃っていない。次の周回で拾う

      const chained = fix.sightings.some(
        (s) => doc.fixes.some((f) => f.id === s.fromId) && positions.has(s.fromId),
      )
      const sourceUncertainty = observations.reduce(
        (worst, o) => Math.max(worst, uncertainty.get(o.label) ?? 0),
        0,
      )

      const entry = fromTriangulation(fix, triangulate(observations), sourceUncertainty, chained)
      resolved.set(fix.id, entry)
      progressed = true

      if (entry.status.kind === 'solved') {
        positions.set(fix.id, entry.status.position)
        uncertainty.set(fix.id, entry.accumulatedKm)
      }
    }
  }

  // 観測元が最後まで揃わなかったものを、その旨で埋める
  for (const fix of doc.fixes) {
    if (resolved.has(fix.id)) continue
    const missing = [
      ...new Set(
        fix.sightings
          .filter((s) => !positions.has(s.fromId))
          .filter((s) => parseBearing(s.bearingInput) !== null || parseDistance(s.rangeInput) !== null)
          .map((s) => labelOf(doc, s.fromId)),
      ),
    ]
    resolved.set(fix.id, {
      fix,
      status: { kind: 'pending', missing },
      residualKm: 0,
      accumulatedKm: 0,
      chained: true,
      alternative: null,
      crossingAngleDeg: null,
    })
  }

  const nestId = doc.known.find((k) => k.isNest)?.id
  return {
    positions,
    uncertainty,
    fixes: doc.fixes.map((f) => resolved.get(f.id)!),
    nest: nestId === undefined ? null : (positions.get(nestId) ?? null),
  }
}
