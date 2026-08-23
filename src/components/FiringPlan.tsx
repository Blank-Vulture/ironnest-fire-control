import { SIDE_LABEL, SIDES } from '../lib/guns'
import {
  pairSteps,
  type ChargeSetting,
  type FiringPlan as Plan,
  type GunSetting,
  type PlanStep,
} from '../lib/targets'
import { Loadout } from './Loadout'
import { SolutionCard } from './SolutionCard'
import { TurnIcon } from './TurnIcon'
import { Turret } from './Turret'

interface Props {
  plan: Plan
  onShell: (id: string, code: string) => void
  onCharge: (id: string, charge: ChargeSetting) => void
  onGun: (id: string, gun: GunSetting) => void
  onImpact: (id: string, digits: string) => void
  onToggleDone: (id: string) => void
  onRemove: (id: string) => void
}

/** 旋回量の表示。0.05° 未満は実質そのままなので旋回不要と言い切る。 */
function Turn({ deg, className }: { deg: number; className: string }) {
  const none = Math.abs(deg) < 0.05
  return (
    <p
      className={`turn ${className}${none ? ' is-none' : ''}`}
      title="砲塔の旋回量。左右の砲で共通なので、ここが連続射撃の律速になる"
    >
      {none ? <span className="turn__icon" aria-hidden>·</span> : <TurnIcon deg={deg} />}
      {none ? '旋回不要' : `${Math.abs(deg).toFixed(1)}° ${deg >= 0 ? '右' : '左'}`}
    </p>
  )
}

/**
 * 射撃計画。
 *
 * 左右の砲を列にして、砲塔の図の砲身がそのまま各列に降りてくる形にする。
 * 隣り合う 2 発は左右に分かれるので 1 行に並べ、その間に行内の旋回を挟む。
 * 行と行の間には、次の組に入るまでの旋回を置く。
 */
export function FiringPlan({
  plan,
  onShell,
  onCharge,
  onGun,
  onImpact,
  onToggleDone,
  onRemove,
}: Props) {
  const { steps, totalTurnDeg, unplaced, done } = plan
  const rows = pairSteps(steps)

  const card = (step: PlanStep | null) => {
    if (!step) return <div className="plan__blank" aria-hidden />
    return (
      <SolutionCard
        step={step}
        onShell={(code) => onShell(step.solution.target.id, code)}
        onCharge={(charge) => onCharge(step.solution.target.id, charge)}
        onGun={(gun) => onGun(step.solution.target.id, gun)}
        onImpact={(digits) => onImpact(step.solution.target.id, digits)}
        onToggleDone={() => onToggleDone(step.solution.target.id)}
        onRemove={() => onRemove(step.solution.target.id)}
      />
    )
  }

  if (steps.length === 0 && unplaced.length === 0 && done.length === 0) {
    return (
      <section className="plan plan--empty">
        <Turret firstSide={null} />
        <p className="plan__placeholder">
          方位角と射程を入れると、仰角・装薬・飛翔時間を出して
          砲塔の旋回が最小になる順に左右の砲へ振り分けます
        </p>
      </section>
    )
  }

  return (
    <section className="plan">
      <header className="plan__head">
        <h2 className="plan__title">射撃順</h2>
        <div className="plan__stats">
          <span>
            目標 <strong>{steps.length}</strong>
          </span>
          <span>
            総旋回 <strong>{totalTurnDeg.toFixed(1)}°</strong>
          </span>
        </div>
      </header>

      <Loadout steps={steps} />

      {steps.length > 0 && (
        <div className="plan__cols">
          {SIDES.map((side) => (
            <h3 key={side} className="plan__column">
              {SIDE_LABEL[side]}
            </h3>
          ))}
        </div>
      )}

      {rows.map((row, i) => (
        <div key={row.left?.solution.target.id ?? row.right?.solution.target.id ?? i}>
          {row.leadTurn !== null && <Turn deg={row.leadTurn} className="turn--lead" />}

          {(row.left?.reloadStall || row.right?.reloadStall) && (
            <p className="stall" title="直前と同じ砲なので、装填が終わるまで撃てません">
              同じ砲が続きます — 装填待ち
            </p>
          )}

          <div className="pair">
            {card(row.left)}
            <div className="pair__gutter">
              {row.midTurn !== null && <Turn deg={row.midTurn} className="turn--mid" />}
            </div>
            {card(row.right)}
          </div>
        </div>
      ))}

      {steps.length === 0 && (
        <p className="plan__cleared">
          残りの目標はありません{done.length > 0 ? ` — ${done.length} 発を撃ち終えました` : ''}
        </p>
      )}

      {done.length > 0 && (
        <div className="plan__done">
          <h3>撃った — {done.length}</h3>
          <ul>
            {done.map((s) => (
              <li key={s.target.id}>
                <span className="plan__doneshell">{s.target.shell}</span>
                {s.target.bearingDeg.toFixed(1)}° / {s.target.distanceKm.toFixed(2)} km
                <button onClick={() => onToggleDone(s.target.id)} title="射撃順に戻す">
                  戻す
                </button>
                <button onClick={() => onRemove(s.target.id)} aria-label="削除">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unplaced.length > 0 && (
        <div className="plan__unplaced">
          <h3>射程外</h3>
          <ul>
            {unplaced.map((s) => (
              <li key={s.target.id}>
                {s.target.bearingDeg.toFixed(1)}° / {s.target.distanceKm.toFixed(2)} km — 30 km を超えています
                <button onClick={() => onRemove(s.target.id)} aria-label="削除">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
