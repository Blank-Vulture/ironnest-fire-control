import { useState } from 'react'
import { formatPoint, parseGrid } from '../lib/grid'
import { SHALLOW_CROSSING_DEG, firingSolutionFrom } from '../lib/triangulate'
import { estimateAccuracy, hitChance } from '../lib/accuracy'
import { FixAdvice } from './FixAdvice'
import { compareCandidates } from '../lib/advice'
import { PRIORITIES, normalizePriority } from '../lib/targets'
import { DEFAULT_SHELL, SHELLS, shellByCode } from '../lib/shells'
import type { Point } from '../lib/grid'
import type { Fix, KnownPoint, ResolvedFix, Sighting } from '../lib/survey'
import type { Measurement, Target } from '../lib/targets'
import type { TargetOrigin } from '../App'

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
  /** 片づけに巻き込めない標定か（isFixDurable）。✕ を押しても消えないことを伝える。 */
  durable: boolean
  onAddTarget: (measurement: Measurement, origin?: TargetOrigin) => void
  onToggleReference: () => void
  onToggleTarget: () => void
  onPinnedGrid: (gridInput: string) => void
  /** 弾種の変更。紐づく射撃順のカードがあれば、そちらの弾種も合わせて変わる。 */
  onShell: (code: string) => void
  onPriority: (value: string) => void
  /** この標定から出した射撃順のカード。状態をここに映す。 */
  linked: readonly Target[]
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
  durable,
  onAddTarget,
  onToggleReference,
  onToggleTarget,
  onPinnedGrid,
  onShell,
  onPriority,
  linked,
}: Props) {
  const { fix, status } = resolved
  /**
   * その候補に紐づくカード。追いかける点の決め方（trackedPoint）と揃える。
   *
   * 候補が 1 つしか無いときは番号で分ける意味が無いので、紐づいたカードは
   * すべて本命側にまとめる。外れた確認射撃のカードは候補 2 を指したまま
   * 残るので、そうしないと拾えなくなる。
   */
  const cardFor = (candidate: 1 | 2) =>
    resolved.alternative === null
      ? candidate === 1
        ? linked[0]
        : undefined
      : linked.find((t) => (t.candidate ?? 1) === candidate)
  /**
   * 射撃順での様子。撃ち終えたかどうかと、当たったかどうかは別の話なので
   * 両方を並べる。
   */
  const stateOf = (candidate: 1 | 2) => {
    const card = cardFor(candidate)
    if (card === undefined) return []
    const badges: { label: string; tone: string }[] = [
      card.done ? { label: '完了', tone: 'done' } : { label: '射撃順', tone: 'queued' },
    ]
    if (card.outcome === 'hit') badges.push({ label: '命中', tone: 'hit' })
    if (card.outcome === 'miss') badges.push({ label: '不発', tone: 'miss' })
    return badges
  }
  const primary = status.kind === 'solved' ? status.position : null
  const shell = fix.shell ?? DEFAULT_SHELL

  /**
   * 候補の一覧。候補が 1 つなら 1 件だけ。
   *
   * 見込み誤差は候補ごとに測る。同じ報告でも、どちらの点を追うかで
   * 振れ方が変わるため。
   */
  const candidates: {
    index: 1 | 2
    point: Point
    residualKm: number
    accuracy: ReturnType<typeof estimateAccuracy> | null
  }[] = []
  if (primary !== null) {
    const measure = (point: Point) =>
      resolved.observations.length > 0 ? estimateAccuracy(resolved.observations, point) : null
    candidates.push({
      index: 1,
      point: primary,
      residualKm: resolved.residualKm,
      accuracy: measure(primary),
    })
    if (resolved.alternative !== null) {
      candidates.push({
        index: 2,
        point: resolved.alternative,
        residualKm: resolved.alternativeResidualKm ?? 0,
        accuracy: measure(resolved.alternative),
      })
    }
  }

  /**
   * 先に撃つ候補。当たりやすいほうを既定で開く。
   *
   * 並び替えではなく既定の選択だけを変える。番号ごと入れ替えると、
   * 「候補地 2 へ撃った」という射撃順のカードの指す先が変わってしまう。
   */
  const suggested =
    candidates.length < 2
      ? 1
      : [...candidates].sort((a, b) =>
          compareCandidates(
            { radiusKm: a.accuracy?.radiusKm ?? 0, residualKm: a.residualKm },
            { radiusKm: b.accuracy?.radiusKm ?? 0, residualKm: b.residualKm },
            shellByCode(shell).radiusKm,
          ),
        )[0]!.index

  const [picked, setPicked] = useState<1 | 2 | null>(null)
  const viewing = candidates.find((c) => c.index === (picked ?? suggested)) ?? candidates[0]
  const position = viewing?.point ?? null
  const solution = position !== null && nest !== null ? firingSolutionFrom(nest, position) : null
  const shallow =
    resolved.crossingAngleDeg !== null && resolved.crossingAngleDeg < SHALLOW_CROSSING_DEG
  const badPin =
    (fix.pinnedGrid ?? '') !== '' && parseGrid(fix.pinnedGrid ?? '') === null
  // 外れた確認射撃があり、まだ実測座標が入っていない＝推定がずれたまま
  const missedShot =
    fix.isReference &&
    !resolved.pinned &&
    linked.some((t) => t.outcome === 'miss') &&
    resolved.alternative === null
  /**
   * ✕ を押しても消えないなら、その理由を title で伝える。
   * 実測座標を持つ場合と、他の標定の観測元になっている場合とで直し方が違うので分けて出す。
   */
  const removeTitle = !durable
    ? `${fix.label} を削除`
    : resolved.pinned
      ? '基準点として残ります。消すには基準点の欄で ↺ を押して実測を取り消してください'
      : '他の標定の観測元になっているため残ります。射撃順のカードだけ削除します'

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

        <select
          className={`fix__priority is-${normalizePriority(fix.priority)}`}
          value={normalizePriority(fix.priority)}
          onChange={(e) => onPriority(e.target.value)}
          aria-label="撃破の優先度"
          title="撃破の優先度。高いものから撃つ"
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value} title={p.note}>
              {p.label}
            </option>
          ))}
        </select>

        <span className="fix__position">
          {position !== null ? (formatPoint(position) ?? 'マップ外') : '—'}
          {resolved.alternative === null && <Badges states={stateOf(1)} />}
        </span>

        <button
          className="fix__remove"
          onClick={onRemove}
          title={removeTitle}
          aria-label={`${fix.label} を削除`}
        >
          ✕
        </button>
      </header>

      <label className="fix__shell">
        <span className="fix__k">弾種</span>
        <select
          value={fix.shell ?? DEFAULT_SHELL}
          onChange={(e) => onShell(e.target.value)}
          aria-label="弾種"
        >
          {SHELLS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.jp}
            </option>
          ))}
        </select>
      </label>


      {/*
        観測基準点は撃って確かめられる。当たればそこにいると分かるので、
        推定値ではなく実測値になる。外れたと分かったときもここを書き換えて直せる。
      */}
      {fix.isReference && (
        <label className={`fix__measured${resolved.pinned ? ' is-pinned' : ''}`}>
          <span className="fix__k">実測座標</span>
          <input
            value={fix.pinnedGrid ?? ''}
            onChange={(e) => onPinnedGrid(e.target.value)}
            placeholder="未確認（推定で運用）"
            spellCheck={false}
            autoComplete="off"
            aria-label="実測で確かめた座標"
            aria-invalid={badPin}
            className={badPin ? 'is-invalid' : ''}
          />
          {resolved.pinned && <span className="fix__badge is-measured">実測</span>}
        </label>
      )}

      {missedShot && (
        <p className="fix__status is-warn">
          確認射撃が外れました。推定がずれています。実測座標を入れ直すか、観測を足してください
        </p>
      )}

      {/* 撃つ相手なのか、他を測るための基準なのか。同じ点が両方を兼ねることもある */}
      <div className="fix__roles">
        <label className="role">
          <input type="checkbox" checked={fix.isReference} onChange={onToggleReference} />
          観測基準点
        </label>
        <label className="role">
          <input type="checkbox" checked={fix.isTarget} onChange={onToggleTarget} />
          攻撃対象
        </label>
      </div>

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
              <option value="">— 偵察兵 —</option>
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

      {candidates.length > 1 && (
        <div className="cand" role="tablist" aria-label="候補地">
          {candidates.map((c) => (
            <button
              key={c.index}
              role="tab"
              className={`cand__tab${c.index === viewing?.index ? ' is-on' : ''}`}
              aria-selected={c.index === viewing?.index}
              onClick={() => setPicked(c.index)}
            >
              <span className="cand__name">候補地 {c.index}</span>
              <span className="cand__grid">{formatPoint(c.point) ?? 'マップ外'}</span>
              {c.accuracy !== null && (
                <span className="cand__chance">
                  命中 {Math.round(hitChance(c.accuracy.radiusKm, shellByCode(shell).radiusKm) * 100)}%
                </span>
              )}
              {c.index === suggested && <span className="cand__pick">先に撃つ</span>}
              <Badges states={stateOf(c.index)} />
            </button>
          ))}
        </div>
      )}

      <FixStatusLine
        resolved={resolved}
        shallow={shallow}
        radiusKm={viewing?.accuracy?.radiusKm ?? resolved.accumulatedKm}
      />

      {/*
        報告の幅が位置の誤差にどれだけ化けるかと、それを縮めるための次の一手。
        実測で確定している点は幅が無いので出さない。
      */}
      {position !== null && !resolved.pinned && resolved.observations.length > 0 && (
        <FixAdvice
          position={position}
          // 見ている候補から見た「もう一方」。本命固定で渡すと、候補 2 を
          // 見ているときに自分自身との距離（0m）を出してしまう
          alternative={
            candidates.find((c) => c.index !== viewing?.index)?.point ?? null
          }
          accuracy={viewing?.accuracy ?? estimateAccuracy(resolved.observations, position)}
          observations={resolved.observations}
          shell={shell}
        />
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

          {solution !== null && viewing !== undefined && (
            <button
              className="fix__use"
              disabled={!fix.isTarget || cardFor(viewing.index) !== undefined}
              title={
                fix.isTarget
                  ? candidates.length > 1
                    ? 'この候補へ 1 発撃って、当たるかどうかで候補を絞る'
                    : undefined
                  : '攻撃対象に印を付けると射撃順に送れます'
              }
              onClick={() =>
                onAddTarget(
                  { bearingDeg: solution.bearingDeg, distanceKm: solution.distanceKm },
                  { fixId: fix.id, candidate: viewing.index },
                )
              }
            >
              {cardFor(viewing.index) !== undefined
                ? '追加済み'
                : candidates.length > 1
                  ? '撃って確かめる'
                  : '射撃順に追加'}
            </button>
          )}
        </footer>
      )}
    </article>
  )
}

function FixStatusLine({
  resolved,
  shallow,
  radiusKm,
}: {
  resolved: ResolvedFix
  shallow: boolean
  /** いま見ている候補の見込み誤差（km）。候補ごとに違うので外から渡す。 */
  radiusKm: number
}) {
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
        {' · '}見込み誤差 ±{metres(radiusKm)}
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

function Badges({ states }: { states: { label: string; tone: string }[] }) {
  return (
    <>
      {states.map((state) => (
        <span key={state.label} className={`fix__badge is-${state.tone}`}>
          {state.label}
        </span>
      ))}
    </>
  )
}
