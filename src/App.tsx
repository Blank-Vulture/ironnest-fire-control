import { useCallback, useEffect, useMemo, useState } from 'react'
import { ROUTES, ROUTE_TITLE, useHashRoute } from './lib/route'
import { emptySurveyDoc, Plotting } from './pages/Plotting'
import { FireControl } from './pages/FireControl'
import {
  isFixDurable,
  solveSurvey,
  trackedPoint,
  type Fix,
  type SurveyDoc,
} from './lib/survey'
import { firingSolutionFrom } from './lib/triangulate'
import { formatPoint, pointFrom, type Point } from './lib/grid'
import {
  buildPlan,
  newTarget,
  reprojectTarget,
  type Measurement,
  type Target,
} from './lib/targets'

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
    return { known: parsed.known, fixes }
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

  /** 標定から射撃順へ送る。送ったら射撃管制の画面に切り替える。 */
  const sendToFireControl = useCallback(
    (measurement: Measurement, origin?: TargetOrigin) => {
      setTargets((prev) => [
        ...prev,
        {
          ...newTarget(measurement.bearingDeg, measurement.distanceKm),
          originFixId: origin?.fixId,
          candidate: origin?.candidate,
        },
      ])
      go('fire')
    },
    [go],
  )

  const patch = useCallback(
    (id: string, change: Partial<Target>) =>
      setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t))),
    [],
  )

  const toggleDone = useCallback(
    (id: string) => {
      // 撃った時点の砲と時刻を残す。次の割り当てをその続きから振るため。
      const gun = plan.steps.find((step) => step.solution.target.id === id)?.gun
      setTargets((prev) =>
        prev.map((t) =>
          t.id !== id
            ? t
            : t.done
              ? { ...t, done: false, firedGun: undefined, firedAt: undefined }
              : { ...t, done: true, firedGun: gun, firedAt: Date.now() },
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

  /** 標定を消したら、そこから出した射撃順のカードも消す。 */
  const removeFix = useCallback(
    (fixId: string) => {
      remember('標定を削除')
      setDoc((prev) => ({ ...prev, fixes: prev.fixes.filter((f) => f.id !== fixId) }))
      setTargets((prev) => prev.filter((t) => t.originFixId !== fixId))
    },
    [remember],
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
  const verifyFixIds = useMemo(
    () => new Set(doc.fixes.filter((f) => f.isReference).map((f) => f.id)),
    [doc],
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
        />
      ) : (
        <FireControl
          plan={plan}
          targetCount={targets.length}
          onAdd={(measurements) => measurements.forEach((m) => sendToFireControl(m))}
          onPatch={patch}
          onToggleDone={toggleDone}
          onReportOutcome={reportOutcome}
          verifyFixIds={verifyFixIds}
          onRemove={removeTarget}
          onClear={() => {
            remember('目標をすべて削除')
            setTargets([])
          }}
        />
      )}
    </div>
  )
}
