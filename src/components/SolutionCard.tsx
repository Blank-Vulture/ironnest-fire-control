import { CHARGES, type Charge } from '../lib/ballistics'
import { SIDE_LABEL, SIDE_MARK, SIDES, type Side } from '../lib/guns'
import { SHELLS, shellByCode } from '../lib/shells'
import { PRIORITIES, type PlanStep } from '../lib/targets'
import type { ChargeSetting, GunSetting } from '../lib/targets'
import { formatFlight, formatTimeDigits, formatTimeOfDay, toTimeDigits } from '../lib/time'

interface Props {
  step: PlanStep
  onShell: (code: string) => void
  onPriority: (value: string) => void
  onCharge: (charge: ChargeSetting) => void
  onGun: (gun: GunSetting) => void
  onImpact: (digits: string) => void
  onImpactRange: (value: string) => void
  onImpactGrid: (value: string) => void
  onToggleDone: () => void
  onReportOutcome: (outcome: 'hit' | 'miss') => void
  onReportMiss: () => void
  onRecordImpact: () => void
  /** 観測基準点への射撃か。普通の攻撃と確認射撃を見分けるため。 */
  verifying: boolean
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
  onPriority,
  onCharge,
  onGun,
  onImpact,
  onImpactRange,
  onImpactGrid,
  onToggleDone,
  onReportOutcome,
  onReportMiss,
  onRecordImpact,
  verifying,
  onRemove,
}: Props) {
  const { solution, order, gun } = step
  const { target } = solution
  const shell = shellByCode(target.shell)

  const unreachable = solution.charge === null

  return (
    <article
      className={`card card--${gun}${unreachable ? ' is-unreachable' : ''}${
        verifying ? ' is-verifying' : ''
      }${target.done ? ' is-fired' : ''}`}
    >
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

        <button
          className={`card__done${target.done ? ' is-on' : ''}`}
          onClick={onToggleDone}
          aria-label="撃ち終えた"
          aria-pressed={target.done}
          title={
            target.done
              ? '撃ち終えた印が付いています。押すと戻します'
              : '撃ち終えたら押す。左右そろったらこの行が畳まれます'
          }
        >
          {target.done ? '✓ 撃った' : '撃った'}
        </button>

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

        <label className={`card__select card__prio is-${target.priority ?? 'normal'}`}>
          <span className="card__k">優先度</span>
          <select
            value={target.priority ?? 'normal'}
            onChange={(e) => onPriority(e.target.value)}
            aria-label="撃破の優先度"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value} title={p.note}>
                {p.label}
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
        <label className="card__field card__field--impact">
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

      </div>

      {/*
        候補が 2 つあるうちの片方を撃つカード。当たったか外れたかが分かれば、
        標定の候補はそこで 1 つに決まる。
      */}
      {verifying && (
        <div className="card__probe">
          {/* 候補は確定すると入れ替わるので、番号で呼ばない。
              「撃った結果どうだったか」だけを聞く。 */}
          <span className="card__k">確認射撃 · 観測基準点</span>
          <div className="card__outcome" role="group" aria-label="射撃の結果">
            <button
              className={`card__hit${target.outcome === 'hit' ? ' is-on' : ''}`}
              onClick={() => onReportOutcome('hit')}
              aria-pressed={target.outcome === 'hit'}
            >
              命中
            </button>
            <button
              className={`card__miss${target.outcome === 'miss' ? ' is-on' : ''}`}
              onClick={() => onReportOutcome('miss')}
              aria-pressed={target.outcome === 'miss'}
            >
              不発
            </button>
          </div>
          {target.outcome !== undefined && (
            <span className="card__verdict">
              {target.outcome === 'hit'
                ? 'この位置を実測座標として確定しました'
                : '外れ — 標定側で座標を入れ直してください'}
            </span>
          )}
        </div>
      )}

      {/*
        外れ弾も情報になる。着弾点は自分が撃った座標そのものなので位置が正確で、
        そこから目標までの距離が報告される。方角も来るが曖昧なので使わない。
      */}
      {!verifying && (
        <div className="card__probe">
          <span className="card__k">射撃の結果</span>
          <div className="card__outcome" role="group" aria-label="射撃の結果">
            <button
              className={`card__miss${target.outcome === 'miss' ? ' is-on' : ''}`}
              onClick={onReportMiss}
              aria-pressed={target.outcome === 'miss'}
            >
              不発
            </button>
          </div>

          {target.outcome === 'miss' && (
            <div className="card__impact">
              <label className="card__impactfield">
                <span className="card__k">着弾点</span>
                <input
                  value={target.impactGrid ?? ''}
                  onChange={(e) => onImpactGrid(e.target.value)}
                  placeholder="J3 0:0"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="砲弾が落ちた座標"
                />
              </label>
              <label className="card__impactfield">
                <span className="card__k">そこから目標まで</span>
                <input
                  value={target.impactRangeInput ?? ''}
                  onChange={(e) => onImpactRange(e.target.value)}
                  placeholder="km"
                  inputMode="decimal"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="着弾点から目標までの距離"
                />
              </label>
              <button
                className="card__record"
                onClick={onRecordImpact}
                disabled={(target.impactRangeInput ?? '').trim() === ''}
              >
                {target.impactPointId !== undefined ? '記録し直す' : '観測に加える'}
              </button>
              {target.impactPointId !== undefined && (
                <span className="card__verdict">
                  着弾点を観測元として記録しました。地図に距離の円が出ます
                </span>
              )}
            </div>
          )}
        </div>
      )}

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
