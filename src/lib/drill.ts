/**
 * 演習モード。
 *
 * 標定は空の状態からだと、偵察兵の座標や方位角を全部手で打たないと
 * 何も動かせない。人に見せるときや一人で試すときのために、解ける状況を
 * まるごと組み立てて `SurveyDoc` として返す。
 *
 * 盤面は A1〜T10（東西 20km × 南北 10km、src/lib/grid.ts を参照）。
 * 三角測量そのものは src/lib/survey.ts / src/lib/triangulate.ts にそのまま
 * 乗せる。ここが引き受けるのは「その仕組みで実際に解ける状況」を
 * 組み立てることだけ。
 */

import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  bearingBetween,
  distanceBetween,
  formatPoint,
  gridToPoint,
  parseGrid,
  type Point,
} from './grid'
import { solveSurvey, type Fix, type KnownPoint, type Sighting, type SurveyDoc } from './survey'
import type { Priority } from './targets'
import type { ShellCode } from './shells'

/* ---------- 乱数 ---------- */

type Rng = () => number

/**
 * mulberry32。32bit の状態ひとつだけを持つ、依存の要らない疑似乱数。
 *
 * Math.random は呼ぶたびに違う結果を返すので、同じ seed から同じ盤面を
 * 再現するテストが書けない。ここでは seed だけから決まる列が要る。
 */
function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randRange = (rng: Rng, min: number, max: number) => min + rng() * (max - min)
const randInt = (rng: Rng, min: number, maxInclusive: number) =>
  min + Math.floor(rng() * (maxInclusive - min + 1))

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

/* ---------- 盤面の座標 ---------- */

/** 端すれすれに置くと、後段の処理で盤面の外にはみ出しかねないので余白を取る。 */
const MARGIN_KM = 0.6

function randPoint(rng: Rng): Point {
  return {
    x: randRange(rng, MARGIN_KM, MAP_WIDTH_KM - MARGIN_KM),
    y: randRange(rng, MARGIN_KM, MAP_HEIGHT_KM - MARGIN_KM),
  }
}

/**
 * 他の点から一定以上離れた点を探す。
 *
 * 見つからなければ諦めて最後の候補をそのまま返す。呼び出し側は
 * solveSurvey で検算してから使うので、多少狭くても盤面全体が壊れることはない。
 */
function sampleAway(rng: Rng, avoid: readonly Point[], minSepKm: number): Point {
  let candidate = randPoint(rng)
  let tries = 0
  while (
    !avoid.every((q) => distanceBetween(candidate, q) >= minSepKm) &&
    tries < 200
  ) {
    candidate = randPoint(rng)
    tries++
  }
  return candidate
}

/**
 * 既知点は gridInput の文字列でしか持てない。丸める前の座標のまま方位を
 * 計算すると、solveSurvey が実際に使う座標（マスの中心）とわずかにずれて、
 * 観測どうしがぴったり交わらなくなる。先に丸めてから以降の計算に使う。
 */
function snapToGrid(point: Point): { gridInput: string; pos: Point } {
  const gridInput = formatPoint(point)!
  return { gridInput, pos: gridToPoint(parseGrid(gridInput)!) }
}

/* ---------- 観測元の選び方 ---------- */

interface Source {
  id: string
  pos: Point
}

/**
 * 方位 0.1 度単位に丸め、360 度ちょうどにはみ出したら 0 度側へ畳む。
 * 丸めてから wrap しないと、359.96° のような値が「360.0」になって
 * parseBearing（0 以上 360 未満のみ有効）に弾かれる。
 */
function bearingInput(deg: number): string {
  const rounded = Math.round(deg * 10) / 10
  return (rounded >= 360 ? rounded - 360 : rounded).toFixed(1)
}

function sightingsFor(fixId: string, pair: readonly [Source, Source], target: Point): Sighting[] {
  return pair.map((source, i) => ({
    id: `${fixId}-s${i + 1}`,
    fromId: source.id,
    bearingInput: bearingInput(bearingBetween(source.pos, target)),
    rangeInput: '',
  }))
}

/** 方位 2 本の交差角（度）。triangulate.ts の crossingAngle と同じ理屈。 */
function crossingAngle(bearingA: number, bearingB: number): number {
  const diff = Math.abs((((bearingA - bearingB) % 180) + 180) % 180)
  return Math.min(diff, 180 - diff)
}

/**
 * 目標を見る観測元を 2 つ選ぶ。
 *
 * いちばん直角に近く交わる組を選ぶ。浅く交わる組を選んでしまうと、
 * 報告の丸め（0.1 度単位）がそのまま現地では数百 m の食い違いに化ける
 * （triangulate.ts の SHALLOW_CROSSING_DEG が警告する現象そのもの）。
 */
function bestPair(pool: readonly Source[], target: Point): [Source, Source] {
  let best: [Source, Source] = [pool[0]!, pool[1]!]
  let bestAngle = -1
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!
      const b = pool[j]!
      const angle = crossingAngle(bearingBetween(a.pos, target), bearingBetween(b.pos, target))
      if (angle > bestAngle) {
        bestAngle = angle
        best = [a, b]
      }
    }
  }
  return best
}

/* ---------- 目標の内訳 ---------- */

type TargetKind = 'armored' | 'underground' | 'cluster' | 'normal'

interface TargetPlan {
  kind: TargetKind
  /** 優先度とは別軸。装甲や地下と重なっても構わない。 */
  valuable: boolean
}

/**
 * 目標の内訳を決める。
 *
 * 弾種の使い分けを見せるのが目的なので、装甲・地下・集結（2 体）を
 * 必ず 1 組ずつ入れる。確率任せにすると、見せたい弾種の使い分けが
 * 出ない盤面がそのまま生まれてしまう。残りは通常の目標で埋める。
 */
function planKinds(rng: Rng, count: number): TargetPlan[] {
  const kinds: TargetKind[] = new Array(count).fill('normal')
  kinds[0] = 'armored'
  kinds[1] = 'underground'
  kinds[2] = 'cluster'
  kinds[3] = 'cluster'
  const shuffled = shuffle(rng, kinds)

  // 高価値は種類と独立の軸。1〜2 体に立てる
  const valuableCount = randInt(rng, 1, 2)
  const order = shuffle(rng, [...Array(count).keys()])
  const valuableIdx = new Set(order.slice(0, valuableCount))

  return shuffled.map((kind, i) => ({ kind, valuable: valuableIdx.has(i) }))
}

const AP_LIKE: readonly ShellCode[] = ['AP', 'APHE']
const AREA_LIKE: readonly ShellCode[] = ['HCHE', 'CLMN']

/** 固まった目標をまとめて処理できる範囲弾の効果半径に収める間隔。 */
const CLUSTER_RADIUS_KM = 0.35
const MIN_TARGET_SEP_KM = 1.2
const MIN_SPOTTER_SEP_KM = 4
/** これより浅い交差角は誤差が跳ね上がるので、その盤面ごと作り直す。 */
const MIN_CROSSING_DEG = 25

/**
 * 弾種の割り当て。
 *
 * 装甲は徹甲系（AP/APHE）でなければ弾かれる設定にする。地下は
 * EQKE（"地中貫通"）が名前どおりの適性を持つので固定で選ぶ。固まっている
 * 目標は 1 発の効果半径でまとめて処理できるので範囲弾（HCHE/CLMN）にする。
 * それ以外は既定弾の HE のままにする。
 */
function shellFor(rng: Rng, kind: TargetKind): ShellCode {
  switch (kind) {
    case 'armored':
      return pick(rng, AP_LIKE)
    case 'underground':
      return 'EQKE'
    case 'cluster':
      return pick(rng, AREA_LIKE)
    case 'normal':
      return 'HE'
  }
}

/**
 * 優先度の割り当て。
 *
 * 高価値はそれだけで真っ先に潰したい対象なので 'high'。装甲・地下は
 * 特別な弾を選ばせる手間がかかる分だけ後回しにされやすいので、
 * 通常より 1 段上げて 'raised' にしておく。どちらでもなければ既定のまま
 * 方位順（'normal'）に任せる。
 */
function priorityFor(plan: TargetPlan): Priority {
  if (plan.valuable) return 'high'
  if (plan.kind === 'armored' || plan.kind === 'underground') return 'raised'
  return 'normal'
}

const KIND_TAG: Record<TargetKind, string | null> = {
  armored: '装甲',
  underground: '地下',
  cluster: '集結',
  normal: null,
}

/**
 * 標定の名前に種類を出す。
 *
 * SurveyDoc の型（Fix）は弾種と優先度しか持たず、目標の「種類」という
 * 概念そのものはこのファイルの中だけのものなので、他に伝える手段が
 * 名前しかない。何を根拠に弾種を選んだかが画面からも読めるようにする。
 */
function labelFor(n: number, plan: TargetPlan): string {
  const tags = [KIND_TAG[plan.kind], plan.valuable ? '高価値' : null].filter(
    (t): t is string => t !== null,
  )
  return tags.length === 0 ? `目標#${n}` : `目標#${n}（${tags.join('・')}）`
}

function withinCluster(rng: Rng, center: Point): Point {
  const angle = rng() * Math.PI * 2
  const radius = rng() * (CLUSTER_RADIUS_KM / 2)
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
}

/* ---------- 盤面の組み立て ---------- */

function buildWorld(rng: Rng): SurveyDoc {
  const nestRaw = randPoint(rng)
  const nestSnap = snapToGrid(nestRaw)
  const nest: KnownPoint = {
    id: 'k-nest',
    label: 'IRON NEST',
    gridInput: nestSnap.gridInput,
    isNest: true,
  }

  // 偵察兵は 3 人。近いと交差角が浅くなって、解けたことになっているだけの
  // 当てにならない点になるので、互いに十分離す。
  const spotterPositions: Point[] = []
  const avoidSpotters: Point[] = [nestSnap.pos]
  for (let i = 0; i < 3; i++) {
    const snap = snapToGrid(sampleAway(rng, avoidSpotters, MIN_SPOTTER_SEP_KM))
    spotterPositions.push(snap.pos)
    avoidSpotters.push(snap.pos)
  }
  const spotters: KnownPoint[] = spotterPositions.map((pos, i) => ({
    id: `k-spotter-${i + 1}`,
    label: `偵察兵#${i + 1}`,
    gridInput: formatPoint(pos)!,
    isNest: false,
    kind: 'spotter',
  }))
  const spotterSources: Source[] = spotters.map((k, i) => ({ id: k.id, pos: spotterPositions[i]! }))

  // 基準点。座標を直接置かず、偵察兵 2 人からの方位で解ける形にする
  // （High Command から直接もらう基準点とは違う、という survey.ts の区別に合わせる）。
  const referenceNames = ['Alpha', 'Bravo']
  const referenceCount = randInt(rng, 1, 2)
  const references: Fix[] = []
  const referenceSources: Source[] = []
  const avoidReferences: Point[] = [...avoidSpotters]
  for (let i = 0; i < referenceCount; i++) {
    const point = sampleAway(rng, avoidReferences, MIN_TARGET_SEP_KM)
    avoidReferences.push(point)
    const fixId = `f-ref-${i + 1}`
    const pair = bestPair(spotterSources, point)
    references.push({
      id: fixId,
      label: referenceNames[i]!,
      sightings: sightingsFor(fixId, pair, point),
      isReference: true,
      isTarget: false,
    })
    referenceSources.push({ id: fixId, pos: point })
  }

  // 目標。観測元は偵察兵と、いま解いた基準点の両方から選べるようにする。
  // そうしないと基準点をわざわざ作った意味がない。
  const pool: Source[] = [...spotterSources, ...referenceSources]
  const count = randInt(rng, 5, 8)
  const plans = planKinds(rng, count)

  const avoidTargets: Point[] = [...avoidReferences]
  let clusterCenter: Point | null = null
  const targets: Fix[] = plans.map((plan, i) => {
    let point: Point
    if (plan.kind === 'cluster') {
      if (clusterCenter === null) {
        clusterCenter = sampleAway(rng, avoidTargets, MIN_TARGET_SEP_KM)
        avoidTargets.push(clusterCenter)
      }
      point = withinCluster(rng, clusterCenter)
    } else {
      point = sampleAway(rng, avoidTargets, MIN_TARGET_SEP_KM)
      avoidTargets.push(point)
    }

    const fixId = `f-target-${i + 1}`
    const pair = bestPair(pool, point)
    return {
      id: fixId,
      label: labelFor(i + 1, plan),
      sightings: sightingsFor(fixId, pair, point),
      isReference: false,
      isTarget: true,
      priority: priorityFor(plan),
      shell: shellFor(rng, plan.kind),
    }
  })

  return { known: [nest, ...spotters], fixes: [...references, ...targets] }
}

/**
 * 生成した盤面が、実際に使う solveSurvey で本当に解けるか。
 *
 * ここで確かめずに出すと、交差角が浅いだけの目標が「見た目は解けているが
 * 実は数百 m ぶれている点」のまま画面に出てしまう。crossingAngleDeg は
 * 方位 2 本だけで解いた標定にだけ付くので、それ以外（今回は無いはずだが
 * 将来増えても安全なように）は null を素通しする。
 */
function isWellFormed(doc: SurveyDoc): boolean {
  const result = solveSurvey(doc)
  return result.fixes.every((f) => {
    if (f.status.kind !== 'solved') return false
    return f.crossingAngleDeg === null || f.crossingAngleDeg >= MIN_CROSSING_DEG
  })
}

const MAX_WORLD_ATTEMPTS = 80

/**
 * 演習用の盤面を組み立てる。
 *
 * seed だけから決まる乱数で作り、solveSurvey に通して検算する。解けなかったり
 * 交差角が浅すぎたりしたら、同じ乱数の続きから作り直す。何度やっても
 * 外れ続けることは実質無いが、上限を切らないと理論上は終わらない。
 */
export function generateDrill(seed: number): SurveyDoc {
  const rng = mulberry32(seed)
  for (let attempt = 0; attempt < MAX_WORLD_ATTEMPTS; attempt++) {
    const candidate = buildWorld(rng)
    if (isWellFormed(candidate)) return candidate
  }
  // ここに来るのは乱数が外れ続けた場合。buildWorld 自体は常に解ける形を
  // 目指して組んでいるので、最後の候補をそのまま返しても実害はない。
  return buildWorld(rng)
}
