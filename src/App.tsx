import { useCallback, useEffect, useMemo, useState } from 'react'
import { ROUTES, ROUTE_TITLE, useHashRoute } from './lib/route'
import { emptySurveyDoc, Plotting } from './pages/Plotting'
import { FireControl } from './pages/FireControl'
import type { SurveyDoc } from './lib/survey'
import { buildPlan, newTarget, type Measurement, type Target } from './lib/targets'

const TARGETS_KEY = 'iron-nest-timing/v4'
const SURVEY_KEY = 'iron-nest-timing/survey/v2'

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
    return { known: parsed.known, fixes: parsed.fixes }
  } catch {
    return emptySurveyDoc()
  }
}

export function App() {
  const [route, go] = useHashRoute()
  const [targets, setTargets] = useState<Target[]>(loadTargets)
  const [survey, setSurvey] = useState<SurveyDoc>(loadSurvey)

  useEffect(() => {
    try {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(targets))
    } catch {
      // プライベートモード等で書けなくても動作自体は続ける
    }
  }, [targets])

  useEffect(() => {
    try {
      localStorage.setItem(SURVEY_KEY, JSON.stringify(survey))
    } catch {
      // 同上
    }
  }, [survey])

  const plan = useMemo(() => buildPlan(targets), [targets])

  const add = useCallback(
    (measurements: Measurement[]) =>
      setTargets((prev) => [
        ...prev,
        ...measurements.map((m) => newTarget(m.bearingDeg, m.distanceKm)),
      ]),
    [],
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

  /** 標定した点を射撃順へ送る。送ったら射撃管制の画面に切り替える。 */
  const sendToFireControl = useCallback(
    (measurement: Measurement) => {
      add([measurement])
      go('fire')
    },
    [add, go],
  )

  const title = ROUTE_TITLE[route]

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
      </nav>

      {route === 'plotting' ? (
        <Plotting doc={survey} onChange={setSurvey} onAddTarget={sendToFireControl} />
      ) : (
        <FireControl
          plan={plan}
          targetCount={targets.length}
          onAdd={add}
          onPatch={patch}
          onToggleDone={toggleDone}
          onRemove={(id) => setTargets((prev) => prev.filter((t) => t.id !== id))}
          onClear={() => setTargets([])}
        />
      )}
    </div>
  )
}
