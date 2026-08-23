import { formatPoint } from '../lib/grid'
import { SHALLOW_CROSSING_DEG, firingSolutionFrom } from '../lib/triangulate'
import type { Point } from '../lib/grid'
import type { Fix, KnownPoint, ResolvedFix, Sighting } from '../lib/survey'
import type { Measurement } from '../lib/targets'

interface Props {
  resolved: ResolvedFix
  /** 観測元に選べる点。輪ができる組み合わせは呼び出し側で除いてある。 */
  sources: (KnownPoint | Fix)[]
  nest: Point | null
  onLabel: (label: string) => void
  onSighting: (sightingId: string, change: Partial<Sighting>) => void
  onAddSighting: () => void
  onRemoveSighting: (sightingId: string) => void
  onRemove: () => void
  onAddTarget: (measurement: Measurement) => void
  /** この点を IRON NEST の現在地として採用する。 */
  onAdoptAsNest: () => void
}

/** m 単位に丸めて出す。km で出すと桁が読みづらい。 */
const metres = (km: number) => `${(km * 1000).toFixed(0)} m`

export function FixCard({
  resolved,
  sources,
  nest,
  onLabel,
  onSighting,
  onAddSighting,
  onRemoveSighting,
  onRemove,
  onAddTarget,
  onAdoptAsNest,
}: Props) {
  const { fix, status } = resolved
  const position = status.kind === 'solved' ? status.position : null
  const solution = position !== null && nest !== null ? firingSolutionFrom(nest, position) : null
  const altSolution =
    resolved.alternative !== null && nest !== null
      ? firingSolutionFrom(nest, resolved.alternative)
      : null
  const shallow =
    resolved.crossingAngleDeg !== null && resolved.crossingAngleDeg < SHALLOW_CROSSING_DEG

  return (
    <article className={`fix${position !== null ? ' is-solved' : ''}`}>
      <header className="fix__head">
        <input
          className="fix__label"
          value={fix.label}
          onChange={(e) => onLabel(e.target.value)}
          spellCheck={false}
          aria-label="標定点の名前"
        />

        <span className="fix__position">
          {position !== null ? (formatPoint(position) ?? 'マップ外') : '—'}
        </span>

        <button className="fix__remove" onClick={onRemove} aria-label={`${fix.label} を削除`}>
          ✕
        </button>
      </header>

      <ol className="fix__sightings">
        <li className="sight sight--header" aria-hidden>
          <span>観測元</span>
          <span>方位</span>
          <span>距離</span>
          <span />
        </li>

        {fix.sightings.map((sighting) => (
          <li key={sighting.id} className="sight">
            <select
              className="sight__from"
              value={sighting.fromId}
              onChange={(e) => onSighting(sighting.id, { fromId: e.target.value })}
              aria-label="観測元"
            >
              <option value="">— 観測元 —</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>

            <input
              className="sight__num"
              value={sighting.bearingInput}
              onChange={(e) => onSighting(sighting.id, { bearingInput: e.target.value })}
              placeholder="方位"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              aria-label="方位"
            />

            <input
              className="sight__num"
              value={sighting.rangeInput}
              onChange={(e) => onSighting(sighting.id, { rangeInput: e.target.value })}
              placeholder="距離"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              aria-label="距離"
            />

            <button
              className="sight__remove"
              onClick={() => onRemoveSighting(sighting.id)}
              disabled={fix.sightings.length <= 1}
              aria-label="この観測を削除"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <button className="fix__add" onClick={onAddSighting}>
        ＋ 観測を追加
      </button>

      <FixStatusLine resolved={resolved} shallow={shallow} />

      {resolved.alternative !== null && (
        <div className="fix__alt">
          <span className="fix__k">もう一方</span>
          <strong className="fix__altgrid">
            {formatPoint(resolved.alternative) ?? 'マップ外'}
          </strong>
          {altSolution !== null && (
            <>
              <span className="fix__altsolution">
                {altSolution.bearingDeg.toFixed(1)}° / {altSolution.distanceKm.toFixed(2)} km
              </span>
              <button
                className="fix__try"
                title="こちらへ 1 発撃って、当たるかどうかで候補を絞る"
                onClick={() =>
                  onAddTarget({
                    bearingDeg: altSolution.bearingDeg,
                    distanceKm: altSolution.distanceKm,
                  })
                }
              >
                撃って確かめる
              </button>
            </>
          )}
        </div>
      )}

      {position !== null && (
        <footer className="fix__solution">
          {solution !== null ? (
            <>
              <span className="fix__k">IRON NEST から</span>
              <strong>
                {solution.bearingDeg.toFixed(1)}° / {solution.distanceKm.toFixed(2)} km
              </strong>
            </>
          ) : (
            <span className="fix__k">IRON NEST の位置を入れると射撃諸元が出ます</span>
          )}

          <button
            className="fix__adopt"
            onClick={onAdoptAsNest}
            title="緊急移動のあとなど、この点を自機の現在地として採用する"
          >
            現在地にする
          </button>
          {solution !== null && (
            <button
              className="fix__use"
              onClick={() =>
                onAddTarget({ bearingDeg: solution.bearingDeg, distanceKm: solution.distanceKm })
              }
            >
              射撃順に追加
            </button>
          )}
        </footer>
      )}
    </article>
  )
}

function FixStatusLine({ resolved, shallow }: { resolved: ResolvedFix; shallow: boolean }) {
  const { status } = resolved

  if (status.kind === 'pending') {
    return (
      <p className="fix__status">
        {status.missing.length > 0
          ? `${status.missing.join('・')} の位置が決まると解けます`
          : '観測元を選んでください'}
      </p>
    )
  }

  if (status.kind === 'insufficient') {
    return (
      <p className="fix__status">
        方位や距離をあと {2 - status.have} 件入れると位置が出ます
      </p>
    )
  }

  if (status.kind === 'contradictory') {
    return (
      <p className="fix__status is-bad">
        報告どうしが交わりません。方位の向きや距離を確かめてください
      </p>
    )
  }

  return (
    <div className="fix__quality">
      <p className="fix__numbers">
        報告の食い違い ±{metres(resolved.residualKm)}
        {resolved.chained && ` · 観測元のぶんを含めて ±${metres(resolved.accumulatedKm)}`}
        {resolved.crossingAngleDeg !== null &&
          ` · 交差角 ${resolved.crossingAngleDeg.toFixed(0)}°`}
      </p>

      {resolved.chained && (
        <p className="fix__status is-warn">
          推定した点を観測元にしています。元の誤差はそのまま持ち越されます
        </p>
      )}

      {shallow && (
        <p className="fix__status is-warn">
          方位 2 本が平行に近く、位置の誤差が大きく開きます
        </p>
      )}

      {resolved.alternative !== null && (
        <p className="fix__status is-warn">
          候補が 2 つあります。観測をもう 1 つ足すか、地形で絞るか、
          片方へ 1 発撃って当たりで確かめてください
        </p>
      )}
    </div>
  )
}
