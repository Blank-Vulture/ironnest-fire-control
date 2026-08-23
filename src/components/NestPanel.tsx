import { formatPoint, parseGrid } from '../lib/grid'
import { SHALLOW_CROSSING_DEG } from '../lib/triangulate'
import type { KnownPoint, ResolvedFix, Sighting } from '../lib/survey'

interface Props {
  /** 開いているか。現在地を確定させたら畳んで、地図と画面から退く。 */
  open: boolean
  onToggle: () => void
  nest: KnownPoint
  /** 位置報告を頼んだ補給隊。要請していなければ空。 */
  convoys: KnownPoint[]
  /** 自機の現在地を割り出す標定。要請していなければ undefined。 */
  selfFix: ResolvedFix | undefined
  onNestGrid: (gridInput: string) => void
  onConvoyGrid: (id: string, gridInput: string) => void
  onSighting: (sightingId: string, change: Partial<Sighting>) => void
  onRequest: () => void
  onCancel: () => void
  onAdopt: () => void
  onHighlight: (id: string | null) => void
}

const metres = (km: number) => `${(km * 1000).toFixed(0)} m`

/**
 * IRON NEST の区画。
 *
 * 自機は観測員でも目標でもなく、射撃諸元の基準そのもの。既知点の一覧に
 * 混ぜると役割が読み取りにくくなるので、現在座標と、緊急移動のあとの
 * 位置の割り出しをここにまとめている。
 */
export function NestPanel({
  open,
  onToggle,
  nest,
  convoys,
  selfFix,
  onNestGrid,
  onConvoyGrid,
  onSighting,
  onRequest,
  onCancel,
  onAdopt,
  onHighlight,
}: Props) {
  const badGrid = nest.gridInput !== '' && parseGrid(nest.gridInput) === null
  const requesting = convoys.length > 0 && selfFix !== undefined
  const solved = selfFix?.status.kind === 'solved' ? selfFix.status : null
  const shallow =
    selfFix?.crossingAngleDeg != null && selfFix.crossingAngleDeg < SHALLOW_CROSSING_DEG

  return (
    <section className={`nest${open ? ' is-open' : ''}`}>
      <button className="nest__toggle" onClick={onToggle} aria-expanded={open}>
        <span className="nest__caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="section__title">IRON NEST</span>
        {open ? (
          <span className="section__hint">射撃諸元はこの位置から計算されます</span>
        ) : (
          <span className="nest__folded">{nest.gridInput || '座標未設定'}</span>
        )}
      </button>

      {!open ? null : (
      <>
      <div className="nest__current">
        {/* 地図を暗転させる範囲は座標欄だけに絞る。
            ボタンに手を伸ばしただけで地図が沈むと目障りになる。 */}
        <div
          className="nest__coord"
          onMouseEnter={() => onHighlight(nest.id)}
          onMouseLeave={() => onHighlight(null)}
        >
          <span className="nest__k">現在座標</span>
          <input
            className={`nest__grid${badGrid ? ' is-invalid' : ''}`}
            value={nest.gridInput}
            onChange={(e) => onNestGrid(e.target.value)}
            placeholder="I6 5:3"
            spellCheck={false}
            autoComplete="off"
            aria-label="IRON NEST の現在座標"
            aria-invalid={badGrid}
          />
        </div>

        <button
          className="nest__request"
          onClick={onRequest}
          title="緊急移動のあと。移動前の座標を手がかりに、補給隊へ位置報告を要請する先を決めます"
        >
          {requesting ? '要請先を引き直す' : '座標を更新'}
        </button>
      </div>

      {requesting && (
        <div className="nest__survey">
          <div className="nest__surveyhead">
            <h3 className="nest__surveytitle">補給隊からの位置報告</h3>
            <button className="nest__cancel" onClick={onCancel}>
              片付ける
            </button>
          </div>

          <p className="nest__note">
            下のタイルへ位置報告を要請してください。2 隊からの視線が直角に近く交わるよう
            選んであります。戻ってきた<strong>方位</strong>を入れれば現在地が出ます
            （補給隊自身の細かい座標が分かるなら、タイルの欄に足しても構いません）。
          </p>

          <ol className="nest__convoys">
            <li className="convoy convoy--header" aria-hidden>
              <span>補給隊</span>
              <span>要請先</span>
              <span>方位</span>
              <span>距離</span>
            </li>

            {convoys.map((convoy, i) => {
              const sighting = selfFix!.fix.sightings.find((s) => s.fromId === convoy.id)
              const bad = convoy.gridInput !== '' && parseGrid(convoy.gridInput) === null
              return (
                <li
                  key={convoy.id}
                  className="convoy"
                  onMouseEnter={() => onHighlight(convoy.id)}
                  onMouseLeave={() => onHighlight(null)}
                >
                  <span className="convoy__label">{convoy.label}</span>
                  <input
                    className={`convoy__grid${bad ? ' is-invalid' : ''}`}
                    value={convoy.gridInput}
                    onChange={(e) => onConvoyGrid(convoy.id, e.target.value)}
                    placeholder="M2"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${convoy.label} の位置`}
                    aria-invalid={bad}
                  />
                  <input
                    className="convoy__num"
                    value={sighting?.bearingInput ?? ''}
                    onChange={(e) =>
                      sighting && onSighting(sighting.id, { bearingInput: e.target.value })
                    }
                    placeholder="方位"
                    inputMode="decimal"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${convoy.label} から見た方位`}
                  />
                  <input
                    className="convoy__num"
                    value={sighting?.rangeInput ?? ''}
                    onChange={(e) =>
                      sighting && onSighting(sighting.id, { rangeInput: e.target.value })
                    }
                    placeholder="距離"
                    inputMode="decimal"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${convoy.label} からの距離`}
                  />
                  {i === 0 && <span className="convoy__spacer" aria-hidden />}
                </li>
              )
            })}
          </ol>

          <div className="nest__result">
            {solved !== null ? (
              <>
                <span className="nest__k">割り出した現在地</span>
                <strong className="nest__found">
                  {formatPoint(solved.position) ?? 'マップ外'}
                </strong>
                <span className="nest__quality">
                  食い違い ±{metres(selfFix!.residualKm)}
                  {selfFix!.crossingAngleDeg !== null &&
                    ` · 交差角 ${selfFix!.crossingAngleDeg.toFixed(0)}°`}
                </span>
                <button className="nest__adopt" onClick={onAdopt}>
                  現在地にする
                </button>
              </>
            ) : (
              <span className="nest__pending">
                {selfFix?.status.kind === 'contradictory'
                  ? '報告どうしが交わりません。方位の向きを確かめてください'
                  : '両隊の報告を入れると現在地が出ます'}
              </span>
            )}
          </div>

          {shallow && (
            <p className="nest__warn">
              2 隊の視線が平行に近く、位置の誤差が大きく開きます。
              要請先を引き直すか、もう 1 隊足してください
            </p>
          )}
        </div>
      )}
      </>
      )}
    </section>
  )
}
