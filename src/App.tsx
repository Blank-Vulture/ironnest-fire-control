import { useCallback, useEffect, useMemo, useState } from 'react'
import { HardReset } from './components/HardReset'
import { StickyNav } from './components/StickyNav'
import { ROUTES, ROUTE_TITLE, useHashRoute } from './lib/route'
import { emptySurveyDoc, Plotting } from './pages/Plotting'
import { FireControl } from './pages/FireControl'
import {
  applyFixPriority,
  applyFixShell,
  defaultShellFor,
  isFixDurable,
  removeFixIfRemovable,
  solveSurvey,
  trackedPoint,
  type Fix,
  type SurveyDoc,
} from './lib/survey'
import { firingSolutionFrom } from './lib/triangulate'
import { formatPoint, parseGrid, pointFrom, type Point } from './lib/grid'
import {
  applyOriginPriority,
  applyOriginShell,
  applyTargetPriority,
  applyTargetShell,
  buildPlan,
  newTarget,
  parseDistance,
  reprojectTarget,
  type Measurement,
  type Target,
} from './lib/targets'
import { nextTargetLabel } from './lib/survey'
import type { ShellCode } from './lib/shells'
import type { Priority } from './lib/targets'

const TARGETS_KEY = 'iron-nest-timing/v4'
const SURVEY_KEY = 'iron-nest-timing/survey/v2'

/** 標定から射撃順へ送るときの出どころ。 */
export interface TargetOrigin {
  fixId: string
  candidate: 1 | 2
}

function loadTargets(): Target[] {
  try {
    const raw = localStorage.getItem(TARGETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // 形が違うものは黙って捨てる。壊れた保存で起動できなくなる方が困る。
    return parsed
      .filter(
        (t): t is Target =>
          typeof t?.id === 'string' &&
          Number.isFinite(t?.bearingDeg) &&
          Number.isFinite(t?.distanceKm) &&
          typeof t?.shell === 'string' &&
          typeof t?.impactDigits === 'string',
      )
      .map((t) => ({ ...t, done: t.done === true }))
  } catch {
    return []
  }
}

function loadSurvey(): SurveyDoc {
  try {
    const raw = localStorage.getItem(SURVEY_KEY)
    if (!raw) return emptySurveyDoc()
    const parsed = JSON.parse(raw) as Partial<SurveyDoc>
    if (!Array.isArray(parsed.known) || !Array.isArray(parsed.fixes)) return emptySurveyDoc()
    if (parsed.known.length === 0) return emptySurveyDoc()

    // 役割の印は後から足したものなので、古い保存には無い。
    // 誰かの観測元になっている点は基準点として使われていたとみなす。
    const fixes: Fix[] = parsed.fixes.map((fix) => ({
      ...fix,
      isTarget: fix.isTarget ?? true,
      isReference:
        fix.isReference ??
        parsed.fixes!.some(
          (other) => other.id !== fix.id && other.sightings.some((s) => s.fromId === fix.id),
        ),
    }))
    // 種別は後から足したので、古い保存には無い。砲座と補給隊以外は偵察兵だった。
    const known = parsed.known.map((point) => ({
      ...point,
      kind:
        point.kind ??
        (point.isNest || point.parentId !== undefined
          ? undefined
          : ('spotter' as const)),
    }))
    return { known, fixes }
  } catch {
    return emptySurveyDoc()
  }
}

/** 元に戻せる 1 手。消す操作は連鎖するので、両方まとめて覚えておく。 */
interface Snapshot {
  label: string
  targets: Target[]
  doc: SurveyDoc
}

const UNDO_DEPTH = 20

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function App() {
  const [route, go] = useHashRoute()
  const [targets, setTargets] = useState<Target[]>(loadTargets)
  const [doc, setDoc] = useState<SurveyDoc>(loadSurvey)
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])

  /**
   * 取り返しのつく形にしておく。
   *
   * 標定とカードは互いに消し合うので、1 回の誤操作で両方まとめて消える。
   * 文字の打ち直しは入力欄が面倒を見るので、ここで覚えるのは
   * 消す・畳む・座標を書き換えるといった構造を動かす操作だけにする。
   */
  const remember = useCallback(
    (label: string) =>
      setUndoStack((stack) => [...stack.slice(-(UNDO_DEPTH - 1)), { label, targets, doc }]),
    [targets, doc],
  )

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const last = stack[stack.length - 1]
      if (last === undefined) return stack
      setTargets(last.targets)
      setDoc(last.doc)
      return stack.slice(0, -1)
    })
  }, [])

  // 入力欄の中では素の取り消しに任せる。こちらが横取りすると打ち直せない
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'z') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  useEffect(() => {
    try {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(targets))
    } catch {
      // プライベートモード等で書けなくても動作自体は続ける
    }
  }, [targets])

  useEffect(() => {
    try {
      localStorage.setItem(SURVEY_KEY, JSON.stringify(doc))
    } catch {
      // 同上
    }
  }, [doc])

  // 標定は両方の画面が要るので、ここで一度だけ解く
  const survey = useMemo(() => solveSurvey(doc), [doc])
  const plan = useMemo(() => buildPlan(targets), [targets])

  /**
   * 標定が動いたら、そこから来た目標も追従させる。
   *
   * 観測を足しても砲座が動いても、射撃順のカードは黙って古い値のまま残る。
   * 仰角も装薬も飛翔時間もこの方位と距離から出しているので、ここがずれると
   * カード上のすべてがずれる。
   */
  useEffect(() => {
    setTargets((previous) => {
      let changed = false
      const next = previous.map((target) => {
        if (target.originFixId === undefined || survey.nest === null) return target
        const resolved = survey.fixes.find((f) => f.fix.id === target.originFixId)
        if (resolved === undefined) return target

        const point = trackedPoint(resolved, target.candidate)
        if (point === null) return target

        const solution = firingSolutionFrom(survey.nest, point)
        if (
          Math.abs(solution.bearingDeg - target.bearingDeg) < 1e-6 &&
          Math.abs(solution.distanceKm - target.distanceKm) < 1e-9
        ) {
          return target
        }
        changed = true
        return { ...target, bearingDeg: solution.bearingDeg, distanceKm: solution.distanceKm }
      })
      return changed ? next : previous
    })
  }, [survey])

  /**
   * 標定から射撃順へ送る。
   * 標定側で弾種を選んでいれば、それをそのまま新しいカードに引き継ぐ。
   */
  const sendToFireControl = useCallback(
    (measurement: Measurement, origin?: TargetOrigin) => {
      const originFix = doc.fixes.find((f) => f.id === origin?.fixId)
      setTargets((prev) => [
        ...prev,
        {
          ...newTarget(measurement.bearingDeg, measurement.distanceKm),
          shell: defaultShellFor(originFix),
          // 優先度も標定から引き継ぐ。送ってから付け直すのでは、
          // 送った直後の並びだけが優先度を無視した順になる
          priority: originFix?.priority ?? 'normal',
          originFixId: origin?.fixId,
          candidate: origin?.candidate,
        },
      ])
    },
    [doc],
  )

  const patch = useCallback(
    (id: string, change: Partial<Target>) =>
      setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t))),
    [],
  )

  const toggleDone = useCallback(
    (id: string) => {
      // 撃った時点の砲と時刻を残す。次の割り当てをその続きから振るため。
      const step = plan.steps.find((s) => s.solution.target.id === id)
      setTargets((prev) =>
        prev.map((t) =>
          t.id !== id
            ? t
            : t.done
              ? {
                  ...t,
                  done: false,
                  firedGun: undefined,
                  firedAt: undefined,
                }
              : { ...t, done: true, firedGun: step?.gun, firedAt: Date.now() },
        ),
      )
    },
    [plan],
  )

  /**
   * 候補地を撃った結果を記録する。
   * 命中したならその候補が本命、外れたならもう一方が本命だと分かる。
   */
  const reportOutcome = useCallback(
    (targetId: string, outcome: 'hit' | 'miss') => {
      const target = targets.find((t) => t.id === targetId)
      setTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, outcome } : t)))
      if (target?.originFixId === undefined || target.candidate === undefined) return

      // 当たったなら、そこにいると分かった。推定値ではなく実測値になる。
      const hitGrid =
        outcome === 'hit' && survey.nest !== null
          ? formatPoint(pointFrom(survey.nest, target.bearingDeg, target.distanceKm))
          : null

      const chosen: 1 | 2 =
        outcome === 'hit' ? target.candidate : target.candidate === 1 ? 2 : 1
      setDoc((prev) => ({
        ...prev,
        fixes: prev.fixes.map((f) =>
          f.id !== target.originFixId
            ? f
            : { ...f, chosen, ...(hitGrid !== null ? { pinnedGrid: hitGrid } : {}) },
        ),
      }))

      // 確定させると本命ともう一方が入れ替わる。カードの参照先もそれに合わせないと、
      // 撃った場所ではなく反対側を指したまま方位と距離が書き換わってしまう。
      setTargets((prev) =>
        prev.map((t) =>
          t.id === targetId ? { ...t, candidate: outcome === 'hit' ? 1 : 2 } : t,
        ),
      )
    },
    [targets, survey],
  )

  /**
   * 通常射撃が外れたことを記録する。
   *
   * 確認射撃と違って候補の確定には使わない。撃った先が目標でなかった、
   * というだけの話なので、砲弾が落ちた座標だけを控える。カードの方位と距離は
   * 標定に追従して動くため、あとから読むと撃った場所とは別の位置になる。
   */
  const reportMiss = useCallback(
    (targetId: string) => {
      const target = targets.find((t) => t.id === targetId)
      if (target === undefined) return
      if (target.outcome === 'miss') {
        setTargets((prev) =>
          prev.map((t) => (t.id === targetId ? { ...t, outcome: undefined } : t)),
        )
        return
      }
      const grid =
        survey.nest === null
          ? undefined
          : (formatPoint(pointFrom(survey.nest, target.bearingDeg, target.distanceKm)) ??
            undefined)
      setTargets((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, outcome: 'miss', impactGrid: grid } : t)),
      )
    },
    [targets, survey],
  )

  /**
   * 外れ弾を観測に変える。
   *
   * 着弾点は自分が撃った座標そのものなので、位置は正確に分かっている。
   * そこから目標までの距離が報告されるなら、着弾点を中心とした距離円が
   * そのまま新しい観測になる。方角もついてくるが曖昧なので使わない。
   */
  const recordImpact = useCallback(
    (targetId: string) => {
      const target = targets.find((t) => t.id === targetId)
      if (target === undefined) return
      const rangeKm = parseDistance(target.impactRangeInput ?? '')
      const grid = target.impactGrid ?? ''
      if (rangeKm === null || parseGrid(grid) === null) return

      remember('着弾からの距離を記録')

      const pointId = target.impactPointId ?? makeId('k')
      const impactCount = doc.known.filter((k) => k.kind === 'impact').length
      const point = {
        id: pointId,
        label: `着弾 ${target.impactPointId === undefined ? impactCount + 1 : impactCount}`,
        gridInput: grid,
        isNest: false,
        kind: 'impact' as const,
      }

      setDoc((prev) => {
        const known = prev.known.some((k) => k.id === pointId)
          ? prev.known.map((k) => (k.id === pointId ? { ...k, gridInput: grid } : k))
          : [...prev.known, point]

        // 報告は「この目標までの距離」なので、その目標の標定に足す。
        // 手で入れたカードには標定が無いので、そのぶんを起こす。
        const fixId = target.originFixId
        const sighting = {
          id: makeId('s'),
          fromId: pointId,
          bearingInput: '',
          rangeInput: String(rangeKm),
        }

        if (fixId !== undefined && prev.fixes.some((f) => f.id === fixId)) {
          return {
            known,
            fixes: prev.fixes.map((f) =>
              f.id !== fixId
                ? f
                : {
                    ...f,
                    sightings: [
                      ...f.sightings.filter((s) => s.fromId !== pointId),
                      sighting,
                    ],
                  },
            ),
          }
        }

        const next = { known, fixes: prev.fixes }
        return {
          known,
          fixes: [
            ...prev.fixes,
            {
              id: makeId('f'),
              label: nextTargetLabel(next),
              sightings: [sighting],
              isReference: false,
              isTarget: true,
            },
          ],
        }
      })

      setTargets((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, impactPointId: pointId } : t)),
      )
    },
    [targets, survey, doc, remember],
  )

  /**
   * 射撃順からカードを消したら、その元になった標定も畳む。
   * ただし他の標定の観測元になっているなら残す。消すと連鎖が切れてしまう。
   */
  const removeTarget = useCallback(
    (id: string) => {
      remember('カードを削除')
      const target = targets.find((t) => t.id === id)
      setTargets((prev) => prev.filter((t) => t.id !== id))

      const fixId = target?.originFixId
      if (fixId === undefined) return
      // 実測で確定した座標や、他の標定が頼っている点は道連れにしない
      if (isFixDurable(doc, fixId)) return
      if (targets.some((t) => t.id !== id && t.originFixId === fixId)) return
      setDoc((prev) => ({ ...prev, fixes: prev.fixes.filter((f) => f.id !== fixId) }))
    },
    [targets, doc, remember],
  )

  /**
   * 標定を消したら、そこから出した射撃順のカードも消す。
   *
   * ただし実測座標を持つ標定や、他の標定の観測元になっている標定は
   * 片づけに巻き込めない（isFixDurable）。基準点の情報が消えてしまうので、
   * その場合は標定自体は残し、そこから出したカードだけを消す。
   */
  const removeFix = useCallback(
    (fixId: string) => {
      remember(isFixDurable(doc, fixId) ? '標定から出したカードを削除' : '標定を削除')
      setDoc((prev) => removeFixIfRemovable(prev, fixId))
      setTargets((prev) => prev.filter((t) => t.originFixId !== fixId))
    },
    [doc, remember],
  )

  /**
   * 標定側で弾種を変えたら、そこから出した射撃順のカードにも映す。
   * カード側からの書き換え（setTargetShell）と合わせて双方向の同期になる。
   */
  const setFixShell = useCallback((fixId: string, shell: ShellCode) => {
    setDoc((prev) => applyFixShell(prev, fixId, shell))
    setTargets((prev) => applyOriginShell(prev, fixId, shell))
  }, [])

  /** 標定側で優先度を変えたら、そこから出した射撃順のカードにも映す。 */
  const setFixPriority = useCallback((fixId: string, priority: Priority) => {
    setDoc((prev) => applyFixPriority(prev, fixId, priority))
    setTargets((prev) => applyOriginPriority(prev, fixId, priority))
  }, [])

  /** 射撃順のカード側で優先度を変えたら、紐づく標定にも映す。 */
  const setTargetPriority = useCallback(
    (targetId: string, priority: Priority) => {
      const target = targets.find((t) => t.id === targetId)
      setTargets((prev) => applyTargetPriority(prev, targetId, priority))
      if (target?.originFixId === undefined) return
      setDoc((prev) => applyFixPriority(prev, target.originFixId!, priority))
    },
    [targets],
  )

  /** 射撃順のカード側で弾種を変えたら、紐づく標定にも映す。 */
  const setTargetShell = useCallback(
    (targetId: string, shell: ShellCode) => {
      const target = targets.find((t) => t.id === targetId)
      setTargets((prev) => applyTargetShell(prev, targetId, shell))
      if (target?.originFixId === undefined) return
      setDoc((prev) => applyFixShell(prev, target.originFixId!, shell))
    },
    [targets],
  )

  /**
   * 砲座が動いたら、標定と紐づいていない目標を測り直す。
   * 紐づいているものは上の追従で面倒を見る。
   */
  const reprojectLoose = useCallback(
    (from: Point, to: Point) =>
      setTargets((prev) =>
        prev.map((t) => (t.originFixId === undefined ? reprojectTarget(t, from, to) : t)),
      ),
    [],
  )

  /** 観測基準点になっている標定。そこへの射撃だけ確認射撃として扱う。 */
  /**
   * 撃った結果を報告できる標定。
   *
   * 観測基準点は、当たれば座標が実測値に変わるので常に対象。
   * それとは別に、候補が 2 つ残っている標定も対象にする。片方へ撃って
   * 当たり外れが分かれば、そこで候補は 1 つに決まる。撃つ手立てが無いと
   * 「どちらかへ撃って確かめてください」と勧めておきながら、
   * 結果を受け取る欄がどこにも無い、ということになる。
   */
  const verifyFixIds = useMemo(() => {
    const ids = new Set(doc.fixes.filter((f) => f.isReference).map((f) => f.id))
    for (const entry of survey.fixes) {
      if (entry.alternative !== null) ids.add(entry.fix.id)
    }
    return ids
  }, [doc, survey])

  /** 観測基準点ではなく、候補の絞り込みのために撃つ標定。文言を変える。 */
  const candidateFixIds = useMemo(
    () =>
      new Set(
        survey.fixes
          .filter((f) => f.alternative !== null && !f.fix.isReference)
          .map((f) => f.fix.id),
      ),
    [survey],
  )

  const title = ROUTE_TITLE[route]
  const undoable = undoStack[undoStack.length - 1]

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          IRON NEST <span className="topbar__accent">{title.name}</span>
        </h1>
        <p className="topbar__sub">{title.note}</p>
      </header>

      <nav className="tabs" aria-label="画面">
        {ROUTES.map((value) => (
          <button
            key={value}
            className={`tabs__tab${route === value ? ' is-on' : ''}`}
            onClick={() => go(value)}
            aria-current={route === value ? 'page' : undefined}
          >
            <span className="tabs__name">{ROUTE_TITLE[value].name}</span>
            <span className="tabs__jp">{ROUTE_TITLE[value].jp}</span>
            {value === 'fire' && plan.steps.length > 0 && (
              <span className="tabs__count">{plan.steps.length}</span>
            )}
          </button>
        ))}

        {undoable !== undefined && (
          <button className="tabs__undo" onClick={undo} title="⌘Z / Ctrl+Z">
            ↩ {undoable.label}
          </button>
        )}
      </nav>

      {route === 'plotting' ? (
        <Plotting
          doc={doc}
          survey={survey}
          targets={targets}
          onChange={setDoc}
          onAddTarget={sendToFireControl}
          onRemoveFix={removeFix}
          onNestMoved={reprojectLoose}
          onRemember={remember}
          onFixShell={setFixShell}
          onFixPriority={setFixPriority}
        />
      ) : (
        <FireControl
          plan={plan}
          targetCount={targets.length}
          onAdd={(measurements) => measurements.forEach((m) => sendToFireControl(m))}
          onPatch={patch}
          onShell={setTargetShell}
          onPriority={setTargetPriority}
          onToggleDone={toggleDone}
          onReportOutcome={reportOutcome}
          onReportMiss={reportMiss}
          onRecordImpact={recordImpact}
          verifyFixIds={verifyFixIds}
          candidateFixIds={candidateFixIds}
          onRemove={removeTarget}
          onClear={() => {
            remember('目標をすべて削除')
            setTargets([])
          }}
        />
      )}

      <footer className="appfoot">
        <HardReset />
      </footer>

      <StickyNav route={route} go={go} fireCount={plan.steps.length} />
    </div>
  )
}
