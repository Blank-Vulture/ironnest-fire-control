import { READY_ROUNDS_PER_GUN, SIDE_LABEL, SIDES } from '../lib/guns'
import {
  pairSteps,
  resupplyQueue,
  type ChargeSetting,
  type FiringPlan as Plan,
  type GunSetting,
  type PlanStep,
} from '../lib/targets'
import { Loadout } from './Loadout'
import { Resupply } from './Resupply'
import type { Target } from '../lib/targets'
import { SolutionCard } from './SolutionCard'
import { TurnIcon } from './TurnIcon'
import { Turret } from './Turret'

interface Props {
  plan: Plan
  onShell: (id: string, code: string) => void
  onPriority: (id: string, value: string) => void
  onCharge: (id: string, charge: ChargeSetting) => void
  onGun: (id: string, gun: GunSetting) => void
  onImpact: (id: string, digits: string) => void
  onPatchTarget: (id: string, change: Partial<Target>) => void
  onToggleDone: (id: string) => void
  onReportOutcome: (id: string, outcome: 'hit' | 'miss') => void
  onReportMiss: (id: string) => void
  onRecordImpact: (id: string) => void
  /** 観測基準点になっている標定の id。そこへの射撃だけ確認射撃として扱う。 */
  verifyFixIds: ReadonlySet<string>
  candidateFixIds: ReadonlySet<string>
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
  onPriority,
  onCharge,
  onGun,
  onImpact,
  onPatchTarget,
  onToggleDone,
  onReportOutcome,
  onReportMiss,
  onRecordImpact,
  verifyFixIds,
  candidateFixIds,
  onRemove,
}: Props) {
  const { steps, totalTurnDeg, unplaced, done } = plan

  /**
   * 撃ち終えたカードも、その場に残して印だけ付ける。
   *
   * 撃つたびに列から抜けると、残りが繰り上がって「次はどれだったか」が
   * 分からなくなる。左右そろって撃ち終えた行だけを畳む。
   */
  const firedSteps: PlanStep[] = [...done]
    .sort((a, b) => (a.target.firedAt ?? 0) - (b.target.firedAt ?? 0))
    .map((solution, i) => ({
      solution,
      // 撃った順の通し番号。これから撃つぶんはその続きから振られるので、
      // 撃っても番号が動かず、重複も欠番も出ない。
      order: i + 1,
      gun: solution.target.firedGun ?? 'left',
      magIndex: 0,
      needsResupply: false,
      turnFromPrev: null,
      reloadStall: false,
    }))

  const shown = [...firedSteps, ...steps].sort((a, b) => a.order - b.order)
  const rows = pairSteps(shown)

  const rowIsCleared = (row: (typeof rows)[number]) =>
    [row.left, row.right].every((step) => step === null || step.solution.target.done)

  // 行ごと畳んだものだけを下の一覧に回す。その場に残っているぶんと重ねない
  const clearedIds = new Set(
    rows
      .filter(rowIsCleared)
      .flatMap((row) => [row.left, row.right])
      .filter((step) => step !== null)
      .map((step) => step!.solution.target.id),
  )
  const cleared = done.filter((solution) => clearedIds.has(solution.target.id))

  /**
   * 行の片側 1 マス。
   *
   * 必ず 1 つの要素で返すこと。フラグメントで複数返すと、それぞれが
   * 別のグリッドセルに入って列が崩れる。
   */
  const cell = (step: PlanStep | null) => (
    <div className="pair__cell">
      {step && (
        <>
          {/* 即応弾を撃ち切る 1 発の手前に、補給の指示を挟む */}
          {step.magIndex === READY_ROUNDS_PER_GUN && (
            <Resupply side={step.gun} queue={resupplyQueue(steps, step.gun)} />
          )}
          <SolutionCard
            step={step}
            onShell={(code) => onShell(step.solution.target.id, code)}
            onPriority={(value) => onPriority(step.solution.target.id, value)}
            onCharge={(charge) => onCharge(step.solution.target.id, charge)}
            onGun={(gun) => onGun(step.solution.target.id, gun)}
            onImpact={(digits) => onImpact(step.solution.target.id, digits)}
            onImpactRange={(value) =>
              onPatchTarget(step.solution.target.id, { impactRangeInput: value })
            }
            onImpactGrid={(value) =>
              onPatchTarget(step.solution.target.id, { impactGrid: value })
            }
            onToggleDone={() => onToggleDone(step.solution.target.id)}
            onReportOutcome={(outcome) => onReportOutcome(step.solution.target.id, outcome)}
            onReportMiss={() => onReportMiss(step.solution.target.id)}
            onRecordImpact={() => onRecordImpact(step.solution.target.id)}
            verifying={
              step.solution.target.originFixId === undefined
                ? null
                : candidateFixIds.has(step.solution.target.originFixId)
                  ? 'candidate'
                  : verifyFixIds.has(step.solution.target.originFixId)
                    ? 'reference'
                    : null
            }
            onRemove={() => onRemove(step.solution.target.id)}
          />
        </>
      )}
    </div>
  )

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

      {rows.filter((row) => !rowIsCleared(row)).map((row, i) => (
        <div key={row.left?.solution.target.id ?? row.right?.solution.target.id ?? i}>
          {row.leadTurn !== null && <Turn deg={row.leadTurn} className="turn--lead" />}

          {(row.left?.reloadStall || row.right?.reloadStall) && (
            <p className="stall" title="直前と同じ砲なので、装填が終わるまで撃てません">
              同じ砲が続きます — 装填待ち
            </p>
          )}

          <div className="pair">
            {cell(row.left)}
            <div className="pair__gutter">
              {row.midTurn !== null && <Turn deg={row.midTurn} className="turn--mid" />}
            </div>
            {cell(row.right)}
          </div>
        </div>
      ))}

      {steps.length === 0 && (
        <p className="plan__cleared">
          残りの目標はありません{done.length > 0 ? ` — ${done.length} 発を撃ち終えました` : ''}
        </p>
      )}

      {cleared.length > 0 && (
        <div className="plan__done">
          <h3>撃った — {cleared.length}</h3>
          <ul>
            {cleared.map((s) => (
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
