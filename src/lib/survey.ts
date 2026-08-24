/**
 * 標定。観測点の網から、目標や基準点の位置を順に確定させる。
 *
 * 任務によっては 1 段では終わらない。たとえば
 *   偵察兵 3 人の距離が重なる地点を出す → その地点から方位 130 度、
 *   偵察兵 3 から方位 230 度、で目標を出す
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
import { DEFAULT_SHELL, type ShellCode } from './shells'
import {
  bearingSigmaFor,
  distanceSigmaFor,
  parseBearing,
  parseDistance,
} from './targets'
import { estimateAccuracy, POSITION_SIGMA_KM } from './accuracy'
import { triangulate, type Observation, type Triangulation } from './triangulate'

export type PointId = string

/**
 * 自機の現在地を割り出すための標定に振る id。
 *
 * 押し直しても増えないよう固定してある。この点だけは敵ではなく自機なので、
 * 地図でも自機の色で描く。
 */
export const NEST_FIX_ID = 'nest-position'

/**
 * 位置がグリッドで分かっている点。
 *
 * 報告を寄こす偵察兵と、位置だけが分かっている基準点は役割が違う。
 * 基準点は High Command から座標をそのまま渡されることがあるので、
 * 三角測量を経ずに置ける。
 */
export type KnownKind = 'spotter' | 'reference' | 'impact'

export interface KnownPoint {
  id: PointId
  label: string
  gridInput: string
  /**
   * 偵察兵か、基準点か、着弾点か。砲座と補給隊はこの区別を持たない。
   *
   * 着弾点は外れ弾が落ちた場所。撃った座標そのものなので位置が正確に分かる。
   * そこから目標までの距離が報告されるので、距離だけの観測元として働く。
   */
  kind?: KnownKind
  /** 砲座。射撃諸元の基準になるので 1 つだけ。 */
  isNest: boolean
  /** 別の点にぶら下げて見せるとき、その親。補給隊を IRON NEST の下に置く。 */
  parentId?: PointId
  /**
   * 撃破された。これから新しい報告はもらえないので観測元の選択肢から外す。
   * すでに受け取っている報告は、撃破される前のものなのでそのまま使える。
   */
  lost?: boolean
}

/** ある点から見た報告。方位だけ・距離だけ・両方のどれでもよい。 */
export interface Sighting {
  id: string
  /** 観測元の点。既知点でも標定点でもよい。 */
  fromId: PointId
  bearingInput: string
  rangeInput: string
}

/**
 * 観測から位置を割り出す点。
 *
 * 目標として撃つのか、他の点を測るための基準として使うのかは別の話で、
 * 同じ点が両方を兼ねることもある。だから 2 つの役割は独立に持たせる。
 */
export interface Fix {
  id: PointId
  label: string
  sightings: Sighting[]
  /** 他の標定の観測元に使う。オフなら観測元の選択肢に出ない。 */
  isReference: boolean
  /** 撃つ相手。オフなら射撃順に送れない（誤って基準点を撃たないための歯止め）。 */
  isTarget: boolean
  /**
   * 候補が 2 つ出たとき、どちらを本命とするか。
   * 片方へ撃った結果（命中・不発）が分かれば確定できる。
   */
  chosen?: 1 | 2
  /**
   * 実測で確かめた座標。
   *
   * 観測基準点は撃って確かめられる。当たればそこにいると分かるので、
   * 推定値ではなく実測値になる。ずれていたと分かったときも、ここを
   * 書き換えれば直せる。入っている間は三角測量より優先し、誤差は 0 として扱う。
   */
  pinnedGrid?: string
  /**
   * この標定で撃つ弾種。
   *
   * 「射撃順に追加」で新しいカードを作るときの初期値になり、以降は
   * カード側とここを双方向に同期する。未設定なら既定弾（HE）として扱う。
   */
  shell?: ShellCode
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
  /**
   * 実際に使った観測。位置が解けた観測元だけが入る。
   * 見込み誤差を測るのに、報告そのものが要る。
   */
  observations: Observation[]
  /** 実測座標で確定しているか。三角測量の結果ではない。 */
  pinned: boolean
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

/**
 * その標定点が観測元にできる点の一覧。
 *
 * 自分自身と、自分を辿ってくる点は輪になるので外す。
 * 撃破された偵察兵は、これから新しい報告をくれないので外す。
 * 他の標定点も観測元にできる。
 * 補給隊は自機の位置を割り出すためだけの臨時の点なので、目標の観測元には出さない。
 * 自機の現在地を割り出している点も、砲座そのものと同じなので重複させない。
 */
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
  return [
    ...doc.known.filter((k) => k.parentId === undefined && k.lost !== true),
    ...doc.fixes.filter(
      (f) => !dependents.has(f.id) && f.id !== NEST_FIX_ID,
    ),
  ]
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
  nameOf: (id: PointId) => string,
  uncertainty: ReadonlyMap<PointId, number>,
  gridEntered: ReadonlySet<PointId>,
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
    // label は画面に出す名前。観測元をたどるのは fromId 側の仕事にする
    observations.push({
      id: sighting.id,
      label: nameOf(sighting.fromId),
      position,
      bearingDeg,
      rangeKm,
      // 入れた桁数がそのまま精度。小数まで読めているなら幅はその分せまい
      bearingSigmaDeg: bearingSigmaFor(sighting.bearingInput),
      rangeSigmaKm: distanceSigmaFor(sighting.rangeInput),
      // 観測元の座標の幅。
      //
      // マスで入れた点は、どう頑張っても 100m の幅がある。報告に載る座標が
      // そこまでしか無いため。
      //
      // 一方、測って割り出した点はマスの幅に縛られない。地図で直接測った線から
      // 割り出したなら、その線の精度がそのまま効く。ここに 100m の下限を
      // かけると、丁寧に測っても報いが無くなる。
      positionSigmaKm: gridEntered.has(sighting.fromId)
        ? Math.max(POSITION_SIGMA_KM, uncertainty.get(sighting.fromId) ?? 0)
        : (uncertainty.get(sighting.fromId) ?? POSITION_SIGMA_KM),
    })
  }

  return { observations, missing }
}

function fromTriangulation(
  fix: Fix,
  result: Triangulation,
  chained: boolean,
  observations: Observation[],
): ResolvedFix {
  if (result.kind !== 'solved') {
    return {
      fix,
      status: result,
      observations,
      pinned: false,
      residualKm: 0,
      accumulatedKm: 0,
      chained,
      alternative: null,
      crossingAngleDeg: null,
    }
  }

  const { estimate } = result

  // 撃った結果でどちらの候補か決まっているなら、入れ替えて本命にする。
  // 決まった時点で曖昧さは解けているので、もう一方は候補として残さない。
  const decided = fix.chosen !== undefined && estimate.alternative !== null
  const swap = fix.chosen === 2 && estimate.alternative !== null
  const position = swap ? estimate.alternative! : estimate.position
  const alternative = decided ? null : estimate.alternative

  return {
    fix,
    status: { kind: 'solved', position, residualKm: estimate.residualKm },
    observations,
    pinned: false,
    residualKm: estimate.residualKm,
    // 実際の見込み誤差。食い違いだけで測ってはいけない。方位 2 本は必ず
    // ぴったり交わるので食い違いは 0 になり、浅く交わって数百 m ぶれている
    // 点まで「誤差 0 の点」として次の標定に渡してしまう。
    // 観測元のぶんは observations の positionSigmaKm に入っているので、
    // ここで足し直すと二重になる。
    accumulatedKm: estimateAccuracy(observations, position).radiusKm,
    chained,
    alternative,
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
  // マスで座標を入れた点。100m の幅が必ず付いて回る
  const gridEntered = new Set<PointId>()
  for (const id of positions.keys()) {
    uncertainty.set(id, 0)
    gridEntered.add(id)
  }

  const resolved = new Map<PointId, ResolvedFix>()
  let progressed = true

  while (progressed) {
    progressed = false

    for (const fix of doc.fixes) {
      if (resolved.has(fix.id)) continue

      // 実測で確かめた座標があるなら、観測を待たずにそこで確定する
      const measured = fix.pinnedGrid === undefined ? null : parseGrid(fix.pinnedGrid)
      if (measured !== null) {
        const position = gridToPoint(measured)
        resolved.set(fix.id, {
          fix,
          status: { kind: 'solved', position, residualKm: 0 },
          observations: [],
          pinned: true,
          residualKm: 0,
          accumulatedKm: 0,
          chained: false,
          alternative: null,
          crossingAngleDeg: null,
        })
        positions.set(fix.id, position)
        uncertainty.set(fix.id, 0)
        gridEntered.add(fix.id) // 実測もマスで入れる以上、同じ幅を持つ
        progressed = true
        continue
      }

      const { observations, missing } = toObservations(
        fix.sightings,
        positions,
        (id) => labelOf(doc, id),
        uncertainty,
        gridEntered,
      )
      if (missing.length > 0) continue // まだ観測元が揃っていない。次の周回で拾う

      const chained = fix.sightings.some(
        (s) => doc.fixes.some((f) => f.id === s.fromId) && positions.has(s.fromId),
      )

      const entry = fromTriangulation(
        fix,
        triangulate(observations),
        chained,
        observations,
      )
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
      observations: [],
      pinned: false,
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

/**
 * その射撃順のカードが追いかけるべき点。
 *
 * 候補が 2 つあるうちは、カードが指している方を追う。確定したり実測座標が
 * 入ったりして候補が 1 つになったら、番号で分ける意味が無くなるので
 * すべて本命を追う。ここを分けておかないと、外れた確認射撃のカードが
 * 参照先を失って、座標を直しても古い値のまま取り残される。
 */
export function trackedPoint(resolved: ResolvedFix, candidate: 1 | 2 | undefined): Point | null {
  if (resolved.status.kind !== 'solved') return null
  if (resolved.alternative === null) return resolved.status.position
  return candidate === 2 ? resolved.alternative : resolved.status.position
}

/**
 * その標定を、片づけに巻き込んで消してよいか。
 *
 * 実測で確かめた座標は、偵察兵を失えばもう作り直せない。観測が再現できる
 * うちは消しても取り戻せるが、確定した座標だけは別で、消えたら終わり。
 * 他の標定の観測元になっているものも、消すと連鎖が切れる。
 */
export function isFixDurable(doc: SurveyDoc, fixId: PointId): boolean {
  const fix = doc.fixes.find((f) => f.id === fixId)
  if (fix === undefined) return false

  const measured = fix.pinnedGrid !== undefined && parseGrid(fix.pinnedGrid) !== null
  const usedAsSource = doc.fixes.some(
    (other) => other.id !== fixId && other.sightings.some((s) => s.fromId === fixId),
  )
  return measured || usedAsSource
}

/**
 * 標定を削除する。
 *
 * 片づけに巻き込んでよい（isFixDurable が false の）標定だけを消す。
 * 実測座標を持つ標定は基準点として残る情報なので、✕ を押しても消えない
 * ようにする。他の標定の観測元になっている標定も同様で、消すと連鎖が切れる。
 * 呼び出し側は、この標定から出した射撃順のカードだけ別に消す。
 */
export function removeFixIfRemovable(doc: SurveyDoc, fixId: PointId): SurveyDoc {
  if (isFixDurable(doc, fixId)) return doc
  return { ...doc, fixes: doc.fixes.filter((f) => f.id !== fixId) }
}

/** 座標が定まっていて、これ以上の観測を要しない標定。既知点として扱える。 */
export function settledFixes(doc: SurveyDoc): Fix[] {
  return doc.fixes.filter(
    (f) => f.id !== NEST_FIX_ID && f.pinnedGrid !== undefined && parseGrid(f.pinnedGrid) !== null,
  )
}

/* ---------- 名前の自動付与 ---------- */

const AUTO_TARGET = /^目標\s*(\d+)$/
const AUTO_REFERENCE = /^基準点\s*([A-Z]|\d+)$/

/**
 * 自動で付けた名前か。
 *
 * 役割を切り替えたときに名前も付け替えるが、手で付けた名前まで
 * 書き換えてしまうと、呼び慣れた名前が消えて困る。自動で付けたものだけを
 * 対象にする。
 */
export function isAutoLabel(label: string): boolean {
  const trimmed = label.trim()
  return AUTO_TARGET.test(trimmed) || AUTO_REFERENCE.test(trimmed)
}

/** いま使われている名前。直接置いた基準点と標定の両方から集める。 */
function usedLabels(doc: SurveyDoc, exceptId?: PointId): Set<string> {
  const labels = new Set<string>()
  for (const point of doc.known) {
    if (point.id !== exceptId) labels.add(point.label.trim())
  }
  for (const fix of doc.fixes) {
    if (fix.id !== exceptId) labels.add(fix.label.trim())
  }
  return labels
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * まだ使われていない基準点の名前。
 *
 * ゲーム内の基準点トークンが A〜E なので、こちらも英字で振る。
 * 直接置いた基準点と、観測基準点に印を付けた標定は同じ並びを共有するので、
 * 番号が重ならないよう両方を見る。
 */
export function nextReferenceLabel(doc: SurveyDoc, exceptId?: PointId): string {
  const used = usedLabels(doc, exceptId)
  for (const letter of LETTERS) {
    const candidate = `基準点 ${letter}`
    if (!used.has(candidate)) return candidate
  }
  for (let n = 1; ; n++) {
    const candidate = `基準点 ${LETTERS.length + n}`
    if (!used.has(candidate)) return candidate
  }
}

/** まだ使われていない目標の名前。 */
export function nextTargetLabel(doc: SurveyDoc, exceptId?: PointId): string {
  const used = usedLabels(doc, exceptId)
  for (let n = 1; ; n++) {
    const candidate = `目標 ${n}`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * 役割を切り替えたときの名前。
 * 自動で付けた名前のときだけ、新しい役割に合った名前へ振り直す。
 */
export function labelForRole(
  doc: SurveyDoc,
  fix: Fix,
  becomingReference: boolean,
): string {
  if (!isAutoLabel(fix.label)) return fix.label
  return becomingReference
    ? nextReferenceLabel(doc, fix.id)
    : nextTargetLabel(doc, fix.id)
}

/* ---------- 弾種 ---------- */

/** その標定で撃つ弾種。未設定なら既定弾（HE）。 */
export function defaultShellFor(fix: Fix | undefined): ShellCode {
  return fix?.shell ?? DEFAULT_SHELL
}

/**
 * 標定の弾種を書き換える。
 *
 * 標定カードで選んだ弾種と、そこから出た射撃順のカードの弾種は同じものを
 * 指すべきだが、勝手に追いかけ合う仕組みにすると無限ループになりやすい。
 * そこで片方向ずつ、呼ばれたときだけ書き換える。ここは標定側の書き換えで、
 * カード側からの書き換えを標定に映すときにも使う（App.tsx を参照）。
 */
export function applyFixShell(doc: SurveyDoc, fixId: PointId, shell: ShellCode): SurveyDoc {
  return { ...doc, fixes: doc.fixes.map((f) => (f.id === fixId ? { ...f, shell } : f)) }
}
