import { useMemo, useState } from 'react'
import {
  formatPoint,
  gridToPoint,
  isNestLabel,
  parseGrid,
  parseRoster,
  type Point,
} from '../lib/grid'
import { parseBearing, parseDistance, type Measurement } from '../lib/targets'
import {
  SHALLOW_CROSSING_DEG,
  firingSolutionFrom,
  triangulate,
  type Observation,
} from '../lib/triangulate'

export interface Spotter {
  id: string
  label: string
  gridInput: string
  bearingInput: string
  rangeInput: string
}

export interface SurveyState {
  open: boolean
  nestGrid: string
  spotters: Spotter[]
}

interface Props {
  state: SurveyState
  onChange: (next: SurveyState) => void
  onAdd: (measurement: Measurement) => void
}

export function newSpotter(index: number): Spotter {
  return {
    id: `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: `観測員 ${index + 1}`,
    gridInput: '',
    bearingInput: '',
    rangeInput: '',
  }
}

export const emptySurvey = (): SurveyState => ({
  open: false,
  nestGrid: '',
  spotters: [newSpotter(0), newSpotter(1)],
})

/**
 * 目標の推定。
 *
 * 観測員は自分の位置をグリッドで報告し、そこから見た目標の方位や距離を
 * 個別に寄こす。ゲーム側でも想定された三角測量の手順で、方位どうし・
 * 距離どうし・方位と距離のどの組み合わせでも位置が出る。
 */
export function Survey({ state, onChange, onAdd }: Props) {
  const [pasteError, setPasteError] = useState<string[]>([])

  const patch = (change: Partial<SurveyState>) => onChange({ ...state, ...change })
  const patchSpotter = (id: string, change: Partial<Spotter>) =>
    patch({ spotters: state.spotters.map((s) => (s.id === id ? { ...s, ...change } : s)) })

  const nestPoint = useMemo<Point | null>(() => {
    const ref = parseGrid(state.nestGrid)
    return ref === null ? null : gridToPoint(ref)
  }, [state.nestGrid])

  const observations = useMemo<Observation[]>(
    () =>
      state.spotters.flatMap((s) => {
        const ref = parseGrid(s.gridInput)
        if (ref === null) return []
        return [
          {
            id: s.id,
            label: s.label,
            position: gridToPoint(ref),
            bearingDeg: parseBearing(s.bearingInput),
            rangeKm: parseDistance(s.rangeInput),
          },
        ]
      }),
    [state.spotters],
  )

  const result = useMemo(() => triangulate(observations), [observations])

  /** 名簿をまとめて貼ると、自機の行と観測員の行に振り分ける。 */
  const handlePaste = (event: React.ClipboardEvent) => {
    const { entries, bad } = parseRoster(event.clipboardData.getData('text'))
    if (entries.length === 0) return
    event.preventDefault()

    const nest = entries.find((e) => isNestLabel(e.label))
    const others = entries.filter((e) => e !== nest)

    patch({
      nestGrid: nest ? formatGridInput(nest.grid) : state.nestGrid,
      spotters:
        others.length > 0
          ? others.map((entry, i) => ({
              ...newSpotter(i),
              label: entry.label || `観測員 ${i + 1}`,
              gridInput: formatGridInput(entry.grid),
            }))
          : state.spotters,
    })
    setPasteError(bad)
  }

  const solution =
    result.kind === 'solved' && nestPoint !== null
      ? firingSolutionFrom(nestPoint, result.estimate.position)
      : null

  const alternativeSolution =
    result.kind === 'solved' && result.estimate.alternative !== null && nestPoint !== null
      ? firingSolutionFrom(nestPoint, result.estimate.alternative)
      : null

  return (
    <section className={`survey${state.open ? ' is-open' : ''}`}>
      <button
        className="survey__toggle"
        onClick={() => patch({ open: !state.open })}
        aria-expanded={state.open}
      >
        <span className="survey__caret" aria-hidden>
          {state.open ? '▾' : '▸'}
        </span>
        目標の推定（三角測量）
        <span className="survey__summary">
          {result.kind === 'solved'
            ? `${formatPoint(result.estimate.position) ?? 'マップ外'}${
                solution
                  ? ` · ${solution.bearingDeg.toFixed(1)}° / ${solution.distanceKm.toFixed(2)}km`
                  : ''
              }`
            : '観測員の報告から位置を割り出す'}
        </span>
      </button>

      {state.open && (
        <div className="survey__body">
          <p className="survey__hint">
            クリップボードの名簿（<code>Spotter1 - I9 9:1</code>）をどこかの欄に貼ると、
            自機と観測員に振り分けます。1 タイル 1km、サブ座標は 100m 刻みです。
          </p>

          <label className="survey__nest">
            <span className="survey__k">砲座の位置</span>
            <input
              value={state.nestGrid}
              onChange={(e) => patch({ nestGrid: e.target.value })}
              onPaste={handlePaste}
              placeholder="I6 5:3"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={state.nestGrid !== '' && nestPoint === null}
              className={state.nestGrid !== '' && nestPoint === null ? 'is-invalid' : ''}
            />
          </label>

          <ol className="survey__list">
            <li className="spotter spotter--header" aria-hidden>
              <span>観測員</span>
              <span>位置</span>
              <span>目標の方位</span>
              <span>目標までの距離</span>
              <span />
            </li>

            {state.spotters.map((spotter) => {
              const badGrid = spotter.gridInput !== '' && parseGrid(spotter.gridInput) === null
              const badBearing =
                spotter.bearingInput !== '' && parseBearing(spotter.bearingInput) === null
              const badRange = spotter.rangeInput !== '' && parseDistance(spotter.rangeInput) === null
              return (
                <li key={spotter.id} className="spotter">
                  <input
                    className="spotter__label"
                    value={spotter.label}
                    onChange={(e) => patchSpotter(spotter.id, { label: e.target.value })}
                    spellCheck={false}
                    aria-label="観測員の名前"
                  />
                  <input
                    className={`spotter__grid${badGrid ? ' is-invalid' : ''}`}
                    value={spotter.gridInput}
                    onChange={(e) => patchSpotter(spotter.id, { gridInput: e.target.value })}
                    onPaste={handlePaste}
                    placeholder="I9 9:1"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="観測員の位置"
                    aria-invalid={badGrid}
                  />
                  <input
                    className={`spotter__num${badBearing ? ' is-invalid' : ''}`}
                    value={spotter.bearingInput}
                    onChange={(e) => patchSpotter(spotter.id, { bearingInput: e.target.value })}
                    placeholder="方位"
                    inputMode="decimal"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="観測員から見た目標の方位"
                    aria-invalid={badBearing}
                  />
                  <input
                    className={`spotter__num${badRange ? ' is-invalid' : ''}`}
                    value={spotter.rangeInput}
                    onChange={(e) => patchSpotter(spotter.id, { rangeInput: e.target.value })}
                    placeholder="距離"
                    inputMode="decimal"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="観測員から目標までの距離"
                    aria-invalid={badRange}
                  />
                  <button
                    className="spotter__remove"
                    onClick={() =>
                      patch({ spotters: state.spotters.filter((s) => s.id !== spotter.id) })
                    }
                    disabled={state.spotters.length <= 1}
                    aria-label={`${spotter.label} を削除`}
                  >
                    ✕
                  </button>
                </li>
              )
            })}
          </ol>

          <button
            className="survey__add"
            onClick={() =>
              patch({ spotters: [...state.spotters, newSpotter(state.spotters.length)] })
            }
          >
            ＋ 観測員を追加
          </button>

          {pasteError.length > 0 && (
            <p className="survey__error">
              読めなかった行: {pasteError.map((l) => `「${l}」`).join(' ')}
            </p>
          )}

          <SurveyResult
            result={result}
            solution={solution}
            alternativeSolution={alternativeSolution}
            hasNest={nestPoint !== null}
            onAdd={onAdd}
          />
        </div>
      )}
    </section>
  )
}

function formatGridInput(grid: { col: number; row: number; subX: number | null; subY: number | null }) {
  const tile = `${'ABCDEFGHIJKLMNOPQRST'[grid.col]}${grid.row + 1}`
  return grid.subX === null || grid.subY === null ? tile : `${tile} ${grid.subX}:${grid.subY}`
}

interface ResultProps {
  result: ReturnType<typeof triangulate>
  solution: { bearingDeg: number; distanceKm: number } | null
  alternativeSolution: { bearingDeg: number; distanceKm: number } | null
  hasNest: boolean
  onAdd: (measurement: Measurement) => void
}

function SurveyResult({ result, solution, alternativeSolution, hasNest, onAdd }: ResultProps) {
  if (result.kind === 'insufficient') {
    return (
      <p className="survey__status">
        方位や距離をあと {2 - result.have} 件入れると位置が出ます
        （方位どうし・距離どうし・方位と距離、どの組み合わせでも構いません）
      </p>
    )
  }

  if (result.kind === 'contradictory') {
    return (
      <p className="survey__status is-bad">
        報告どうしが交わりません。方位の向きや距離を確かめてください
      </p>
    )
  }

  const { estimate } = result
  const grid = formatPoint(estimate.position)
  const shallow =
    estimate.crossingAngleDeg !== null && estimate.crossingAngleDeg < SHALLOW_CROSSING_DEG

  return (
    <div className="survey__result">
      <div className="survey__found">
        <span className="survey__k">推定位置</span>
        <strong className="survey__grid">{grid ?? 'マップ外'}</strong>
        {solution && (
          <span className="survey__solution">
            砲座から {solution.bearingDeg.toFixed(1)}° / {solution.distanceKm.toFixed(2)} km
          </span>
        )}
        {solution && (
          <button
            className="survey__use"
            onClick={() =>
              onAdd({ bearingDeg: solution.bearingDeg, distanceKm: solution.distanceKm })
            }
          >
            射撃順に追加
          </button>
        )}
      </div>

      {!hasNest && <p className="survey__status">砲座の位置を入れると方位と距離が出ます</p>}

      <p className="survey__quality">
        報告の食い違い ±{(estimate.residualKm * 1000).toFixed(0)} m
        {estimate.crossingAngleDeg !== null && ` · 交差角 ${estimate.crossingAngleDeg.toFixed(0)}°`}
      </p>

      {shallow && (
        <p className="survey__status is-warn">
          方位 2 本が平行に近いので、位置の誤差が大きく開きます。
          別の方角の観測員か、距離の報告を足してください
        </p>
      )}

      {estimate.alternative !== null && (
        <div className="survey__ambiguous">
          <p className="survey__status is-warn">
            候補が 2 つあります。地形や報告の文面で絞るか、観測をもう 1 つ足してください
          </p>
          <div className="survey__found">
            <span className="survey__k">もう一方</span>
            <strong className="survey__grid">
              {formatPoint(estimate.alternative) ?? 'マップ外'}
            </strong>
            {alternativeSolution && (
              <span className="survey__solution">
                砲座から {alternativeSolution.bearingDeg.toFixed(1)}° /{' '}
                {alternativeSolution.distanceKm.toFixed(2)} km
              </span>
            )}
            {alternativeSolution && (
              <button
                className="survey__use"
                onClick={() =>
                  onAdd({
                    bearingDeg: alternativeSolution.bearingDeg,
                    distanceKm: alternativeSolution.distanceKm,
                  })
                }
              >
                こちらを追加
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
