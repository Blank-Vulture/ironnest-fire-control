import { CHARGES, type Charge } from '../lib/ballistics'
import { SIDE_LABEL, SIDE_MARK, SIDES, type Side } from '../lib/guns'
import { SHELLS, shellByCode } from '../lib/shells'
import type { PlanStep } from '../lib/targets'
import type { ChargeSetting, GunSetting } from '../lib/targets'
import { formatFlight, formatTimeDigits, formatTimeOfDay, toTimeDigits } from '../lib/time'

interface Props {
  step: PlanStep
  onShell: (code: string) => void
  onCharge: (charge: ChargeSetting) => void
  onGun: (gun: GunSetting) => void
  onImpact: (digits: string) => void
  onFlightOverride: (value: string) => void
  onRemove: () => void
}

/**
 * 射撃解のカード。ゲーム内で弾道計算機が刷る紙に対応させてある。
 * 紙に載る値（弾種・装薬・仰角・方位）に、このツールの担当ぶんとして
 * 距離・飛翔時間・着弾時刻・発射時刻を足している。
 */
export function SolutionCard({
  step,
  onShell,
  onCharge,
  onGun,
  onImpact,
  onFlightOverride,
  onRemove,
}: Props) {
  const { solution, order, gun } = step
  const { target } = solution
  const shell = shellByCode(target.shell)

  const unreachable = solution.charge === null

  return (
    <article className={`card card--${gun}${unreachable ? ' is-unreachable' : ''}`}>
      <header className="card__head">
        <span className="card__order" title="射撃順">
          {order}
        </span>

        <div className="card__gun" role="group" aria-label="使用する砲">
          {SIDES.map((side: Side) => (
            <button
              key={side}
              className={`card__gunbtn${gun === side ? ' is-on' : ''}`}
              onClick={() => onGun(target.gun === side ? 'auto' : side)}
              title={
                target.gun === side
                  ? `${SIDE_LABEL[side]}に固定中 · もう一度押すと自動`
                  : `${SIDE_LABEL[side]}に固定`
              }
              aria-pressed={gun === side}
            >
              {SIDE_MARK[side]}
            </button>
          ))}
          {target.gun !== 'auto' && (
            <span className="card__pin" title="砲を手で固定している">
              固定
            </span>
          )}
        </div>

        <button className="card__remove" onClick={onRemove} aria-label="この目標を削除">
          ✕
        </button>
      </header>

      <div className="card__selects">
        <label className="card__select">
          <span className="card__k">弾種</span>
          <select value={target.shell} onChange={(e) => onShell(e.target.value)}>
            {SHELLS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.jp}
              </option>
            ))}
          </select>
        </label>

        <label className="card__select card__select--charge">
          <span className="card__k">装薬</span>
          <select
            value={target.charge}
            onChange={(e) =>
              onCharge(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as Charge))
            }
          >
            <option value="auto">
              自動{solution.charge !== null ? `（${solution.charge}）` : ''}
            </option>
            {CHARGES.map((c) => (
              <option key={c} value={c} disabled={target.distanceKm > c * 5}>
                {c}
                {target.distanceKm > c * 5 ? ' — 届かない' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card__solution">
        <div className="card__elev">
          <span className="card__k">仰角</span>
          <strong className="card__elevvalue">
            {solution.elevationDeg !== null ? `${solution.elevationDeg.toFixed(2)}°` : '--.--°'}
          </strong>
        </div>
        <div className="card__bearing">
          <span className="card__k">方位</span>
          <strong className="card__bearingvalue">{target.bearingDeg.toFixed(1)}°</strong>
        </div>
      </div>

      <dl className="card__meta">
        <div>
          <dt>距離</dt>
          <dd>{target.distanceKm.toFixed(2)} km</dd>
        </div>
        <div>
          <dt>飛翔</dt>
          <dd>
            {solution.flightSeconds !== null ? formatFlight(solution.flightSeconds) : '—'}
            {solution.flightOverridden && <span className="card__tag">手入力</span>}
          </dd>
        </div>
        <div>
          <dt>効果半径</dt>
          <dd>{shell.radiusKm.toFixed(2)} km</dd>
        </div>
      </dl>

      {unreachable && (
        <p className="card__warn">
          {solution.outOfRange
            ? '30 km を超えているため届きません'
            : 'この装薬では届きません。装薬を上げてください'}
        </p>
      )}

      <div className="card__timing">
        <label className="card__field">
          <span className="card__k">着弾時刻</span>
          <input
            value={formatTimeDigits(target.impactDigits)}
            onChange={(e) => onImpact(toTimeDigits(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onImpact('')
            }}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="--:--:--"
            aria-invalid={target.impactDigits !== '' && solution.impact === null}
          />
        </label>

        <label className="card__field card__field--override">
          <span className="card__k">飛翔上書き</span>
          <input
            value={target.flightOverride}
            onChange={(e) => onFlightOverride(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="計算値"
            aria-invalid={target.flightOverride.trim() !== '' && !solution.flightOverridden}
          />
        </label>
      </div>

      <footer className={`card__launch${solution.launch === null ? ' is-empty' : ''}`}>
        <span className="card__k">発射時刻</span>
        <strong>
          {solution.launch !== null ? formatTimeOfDay(solution.launch) : '--:--:--'}
        </strong>
        {solution.prevDay && <span className="card__tag card__tag--warn">前日</span>}
      </footer>
    </article>
  )
}
