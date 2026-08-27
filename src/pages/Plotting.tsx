import { useState } from 'react'
import { FixCard } from '../components/FixCard'
import { GridMap } from '../components/GridMap'
import { NestPanel } from '../components/NestPanel'
import { generateDrill } from '../lib/drill'
import { formatPoint } from '../lib/grid'
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  formatGrid,
  gridToPoint,
  isNestLabel,
  parseGrid,
  parseRoster,
  type Point,
} from '../lib/grid'
import { planConvoyRequest } from '../lib/convoy'
import {
  NEST_FIX_ID,
  availableSources,
  isFixDurable,
  labelForRole,
  nextReferenceLabel,
  nextTargetLabel,
  settledFixes,
  type SurveyResult,
  type Fix,
  type KnownPoint,
  type Sighting,
  type SurveyDoc,
  type ResolvedFix,
} from '../lib/survey'
import { isShellCode, type ShellCode } from '../lib/shells'
import { isPriority, type Measurement, type Priority, type Target } from '../lib/targets'
import type { TargetOrigin } from '../App'

interface Props {
  doc: SurveyDoc
  /** 解は両方の画面で使うので、外で一度だけ解いたものを受け取る。 */
  survey: SurveyResult
  /** 射撃順の中身。標定が今どうなっているかを出すために見る。 */
  targets: readonly Target[]
  onChange: (doc: SurveyDoc) => void
  onAddTarget: (measurement: Measurement, origin?: TargetOrigin) => void
  onRemoveFix: (fixId: string) => void
  /** 砲座が動いたことを伝える。射撃順の目標を新しい位置から測り直すため。 */
  onNestMoved: (from: Point, to: Point) => void
  /** 元に戻せるよう、構造を動かす操作の前に呼ぶ。 */
  onRemember: (label: string) => void
  /** 弾種の変更。紐づく射撃順のカードがあれば、そちらの弾種も合わせて変わる。 */
  onFixPriority: (fixId: string, priority: Priority) => void
  onFixShell: (fixId: string, shell: ShellCode) => void
}

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function newKnownPoint(index: number): KnownPoint {
  return { id: id('k'), label: `偵察兵#${index}`, gridInput: '', isNest: false, kind: 'spotter' }
}

export function newReferencePoint(doc: SurveyDoc): KnownPoint {
  return {
    id: id('k'),
    label: nextReferenceLabel(doc),
    gridInput: '',
    isNest: false,
    kind: 'reference',
  }
}

/** 報告を寄こすのはたいてい偵察兵なので、健在な偵察兵を順に既定にする。 */
function defaultSources(doc: SurveyDoc): string[] {
  return doc.known
    .filter((k) => !k.isNest && k.parentId === undefined && k.kind !== 'reference' && k.lost !== true)
    .map((k) => k.id)
}

export function newSighting(fromId = ''): Sighting {
  return { id: id('s'), fromId, bearingInput: '', rangeInput: '' }
}

export function newFix(doc: SurveyDoc): Fix {
  const [first, second] = defaultSources(doc)
  return {
    id: id('f'),
    label: nextTargetLabel(doc),
    // 位置を決めるには 2 つ要るので、別々の偵察兵を初めから当てておく
    sightings: [newSighting(first), newSighting(second ?? first)],
    isReference: false,
    // 撃つために作ることがほとんどなので、攻撃対象は既定でオン
    isTarget: true,
  }
}

export const NEST_LABEL = 'IRON NEST'

export function emptySurveyDoc(): SurveyDoc {
  const doc: SurveyDoc = {
    known: [
      { id: id('k'), label: NEST_LABEL, gridInput: '', isNest: true },
      // 偵察兵は基本 3 人つく
      newKnownPoint(1),
      newKnownPoint(2),
      newKnownPoint(3),
    ],
    fixes: [],
  }
  return { ...doc, fixes: [newFix(doc)] }
}

/**
 * 標定の画面。
 *
 * 既知点（偵察兵と砲座）と、そこから割り出す標定点を分けて置く。
 * 標定点は既知点だけでなく、先に解けた標定点も観測元にできるので、
 * 「距離が重なる地点をまず出し、そこからの方位で目標を出す」という
 * 段を重ねた任務がそのまま組める。
 */
export function Plotting({
  doc,
  survey,
  targets,
  onChange,
  onAddTarget,
  onRemoveFix,
  onNestMoved,
  onRemember,
  onFixShell,
  onFixPriority,
}: Props) {
  const [pasteError, setPasteError] = useState<string[]>([])
  const [highlight, setHighlight] = useState<string | null>(null)
  const [nestOpen, setNestOpen] = useState(true)
  // 演習モードは今の標定をまるごと上書きする。押し間違いで手入力の分を
  // 消してしまわないよう、HardReset と同じ二段階の確認を挟む。
  const [drillArmed, setDrillArmed] = useState(false)

  const patchKnown = (pointId: string, change: Partial<KnownPoint>) =>
    onChange({ ...doc, known: doc.known.map((k) => (k.id === pointId ? { ...k, ...change } : k)) })

  const patchFix = (fixId: string, change: Partial<Fix>) =>
    onChange({ ...doc, fixes: doc.fixes.map((f) => (f.id === fixId ? { ...f, ...change } : f)) })

  /** 名簿をまとめて貼ると、砲座の行と偵察兵の行に振り分ける。 */
  const handlePaste = (event: React.ClipboardEvent) => {
    const { entries, bad } = parseRoster(event.clipboardData.getData('text'))
    if (entries.length === 0) return
    event.preventDefault()

    const nest = doc.known.find((k) => k.isNest)
    const nestEntry = entries.find((e) => isNestLabel(e.label))
    const others = entries.filter((e) => e !== nestEntry)

    onChange({
      ...doc,
      known: [
        {
          id: nest?.id ?? id('k'),
          label: nest?.label ?? NEST_LABEL,
          gridInput: nestEntry ? formatEntryGrid(nestEntry.grid) : (nest?.gridInput ?? ''),
          isNest: true,
        },
        ...others.map((entry, i) => ({
          id: id('k'),
          label: entry.label || `偵察兵#${i + 1}`,
          gridInput: formatEntryGrid(entry.grid),
          isNest: false,
          kind: 'spotter' as const,
        })),
        // 基準点と補給隊は名簿に載らないので、貼り付けで消さない
        ...doc.known.filter((k) => k.kind === 'reference' || k.parentId !== undefined),
      ],
    })
    setPasteError(bad)
  }

  /**
   * 標定できた点を IRON NEST の現在地として書き込む。緊急移動のあとに使う。
   *
   * 射撃順の目標は「砲座から見た方位と距離」でしか持っていないので、
   * 砲座が動いたぶんを測り直さないと古い位置を基準にしたままずれる。
   * 書き込みと同時に振り直したうえで、役目を終えた区画を畳む。
   */
  const adoptAsNest = (fixId: string) => {
    const resolved = survey.fixes.find((f) => f.fix.id === fixId)
    if (resolved?.status.kind !== 'solved') return
    const grid = formatPoint(resolved.status.position)
    if (grid === null) return

    onRemember('IRON NEST の座標を更新')
    const before = survey.nest
    const after = resolved.status.position
    if (before !== null) onNestMoved(before, after)

    onChange({
      ...doc,
      known: doc.known.map((k) => (k.isNest ? { ...k, gridInput: grid } : k)),
    })
    setNestOpen(false)
  }

  /**
   * 補給隊への位置報告要請を組み立てる。
   *
   * 緊急移動は発動地点のまわりに散るだけなので、移動前の座標が手がかりになる。
   * そこから 2 隊の視線が直角に近く交わるタイルを選んで要請先にしておく。
   * あとは戻ってきた報告（サブ座標か方位）を入れるだけで自機の位置が出る。
   */
  const requestConvoys = () => {
    const nest = doc.known.find((k) => k.isNest)
    if (nest === undefined) return
    onRemember('補給隊への要請')

    const ref = parseGrid(nest.gridInput)
    const lastKnown = ref !== null
      ? gridToPoint(ref)
      : { x: MAP_WIDTH_KM / 2, y: MAP_HEIGHT_KM / 2 }
    const plan = planConvoyRequest(lastKnown)
    if (plan === null) return

    const existing = doc.known.filter((k) => k.parentId === nest.id)
    const convoys = plan.tiles.map((tile, i) => ({
      id: existing[i]?.id ?? id('k'),
      label: existing[i]?.label ?? `補給隊 ${i + 1}`,
      gridInput: formatGrid(tile),
      isNest: false,
      parentId: nest.id,
    }))

    const previous = doc.fixes.find((f) => f.id === NEST_FIX_ID)
    const nestFix: Fix = {
      id: NEST_FIX_ID,
      label: previous?.label ?? 'IRON NEST 現在地',
      // 自機の位置そのものなので、撃つ相手にも観測元にもしない
      isReference: false,
      isTarget: false,
      // 要請を出し直したら報告も取り直しになるので、値は空にしておく
      sightings: convoys.map((convoy, i) => ({
        id: previous?.sightings[i]?.id ?? id('s'),
        fromId: convoy.id,
        bearingInput: '',
        rangeInput: '',
      })),
    }

    onChange({
      known: [
        ...doc.known.filter((k) => k.parentId !== nest.id),
        ...convoys,
      ],
      fixes: [nestFix, ...doc.fixes.filter((f) => f.id !== NEST_FIX_ID)],
    })
  }

  // 自機は偵察兵でも目標でもないので、専用の区画に出す。
  // 補給隊もその流れの一部なので、既知点の一覧には並べない。
  const nest = doc.known.find((k) => k.isNest)
  const convoys = doc.known.filter((k) => nest !== undefined && k.parentId === nest.id)
  const loose = doc.known.filter((k) => !k.isNest && k.parentId === undefined)
  const spotters = loose.filter((k) => k.kind !== 'reference' && k.kind !== 'impact')
  const references = loose.filter((k) => k.kind === 'reference')
  // 着弾点も位置が分かっている点なので、基準点と同じ列に並べる
  const impacts = loose.filter((k) => k.kind === 'impact')
  const selfFix = survey.fixes.find((f) => f.fix.id === NEST_FIX_ID)
  // 実測で座標が定まった標定は、もう推定ではなく既知点として扱える
  const settled = settledFixes(doc)
  const targetFixes = survey.fixes.filter((f) => f.fix.id !== NEST_FIX_ID)

  /*
   * 撃ち終えた標定を畳む。
   *
   * 標定は撃ったあとも消えない。基準点として使われることがあるし、外れたときに
   * 座標を入れ直す先でもある。ただし片づかないまま縦に積み上がるので、任務が
   * 進むほど「まだ撃っていない目標」を探すのに画面を延々と繰ることになる。
   *
   * 紐づく射撃順のカードが 1 枚もないうちは畳まない。まだ送っていないだけの
   * 標定と、撃ち終えた標定を同じ扱いにすると、送り忘れが見えなくなる。
   */
  const isCleared = (resolved: ResolvedFix) => {
    const cards = targets.filter((t) => t.originFixId === resolved.fix.id)
    return cards.length > 0 && cards.every((t) => t.done)
  }
  const active = targetFixes.filter((f) => !isCleared(f))
  const cleared = targetFixes.filter(isCleared)

  const renderFixCard = (resolved: ResolvedFix) => (
            <FixCard
              key={resolved.fix.id}
              resolved={resolved}
              sources={availableSources(doc, resolved.fix.id)}
              nest={survey.nest}
              onLabel={(label) => patchFix(resolved.fix.id, { label })}
              onSighting={(sightingId, change) =>
                patchFix(resolved.fix.id, {
                  sightings: resolved.fix.sightings.map((s) =>
                    s.id === sightingId ? { ...s, ...change } : s,
                  ),
                })
              }
              onAddSighting={() =>
                patchFix(resolved.fix.id, {
                  sightings: [
                    ...resolved.fix.sightings,
                    // まだ使っていない偵察兵がいれば、それを既定にする
                    newSighting(
                      defaultSources(doc).find(
                        (candidate) =>
                          !resolved.fix.sightings.some((s) => s.fromId === candidate),
                      ),
                    ),
                  ],
                })
              }
              onRemoveSighting={(sightingId) =>
                patchFix(resolved.fix.id, {
                  sightings: resolved.fix.sightings.filter((s) => s.id !== sightingId),
                })
              }
              onRemove={() => onRemoveFix(resolved.fix.id)}
              durable={isFixDurable(doc, resolved.fix.id)}
              onAddTarget={onAddTarget}
              onShell={(code) => isShellCode(code) && onFixShell(resolved.fix.id, code)}
              onPriority={(value) =>
                isPriority(value) && onFixPriority(resolved.fix.id, value)
              }
              onToggleReference={() => {
                // 役割が変われば呼び名も変わる。手で付けた名前はそのまま残す
                const becoming = !resolved.fix.isReference
                patchFix(resolved.fix.id, {
                  isReference: becoming,
                  label: labelForRole(doc, resolved.fix, becoming),
                })
              }}
              onToggleTarget={() =>
                patchFix(resolved.fix.id, { isTarget: !resolved.fix.isTarget })
              }
              onPinnedGrid={(pinnedGrid) => patchFix(resolved.fix.id, { pinnedGrid })}
              linked={targets.filter((t) => t.originFixId === resolved.fix.id)}
            />
  )


  /** 位置報告の要請を片付ける。補給隊とその標定を消す。 */
  const cancelConvoys = () => {
    if (nest === undefined) return
    onRemember('補給隊の要請を片付け')
    onChange({
      known: doc.known.filter((k) => k.parentId !== nest.id),
      fixes: doc.fixes.filter((f) => f.id !== NEST_FIX_ID),
    })
  }

  return (
    <>
      {nest !== undefined && (
        <NestPanel
          open={nestOpen}
          onToggle={() => setNestOpen((o) => !o)}
          nest={nest}
          convoys={convoys}
          selfFix={selfFix}
          onNestGrid={(gridInput) => patchKnown(nest.id, { gridInput })}
          onConvoyGrid={(convoyId, gridInput) => patchKnown(convoyId, { gridInput })}
          onSighting={(sightingId, change) => {
            const fix = doc.fixes.find((f) => f.id === NEST_FIX_ID)
            if (fix === undefined) return
            patchFix(NEST_FIX_ID, {
              sightings: fix.sightings.map((s) =>
                s.id === sightingId ? { ...s, ...change } : s,
              ),
            })
          }}
          onRequest={requestConvoys}
          onCancel={cancelConvoys}
          onAdopt={() => adoptAsNest(NEST_FIX_ID)}
          onHighlight={setHighlight}
        />
      )}

      <section className="known">
        <div className="known__head">
          <h2 className="section__title">既知点</h2>
          <span className="section__hint">
            クリップボードの名簿（<code>Spotter1 - I9 9:1</code>）をどこかの欄に貼ると振り分けます
          </span>
        </div>

        {/* 報告を寄こす側と、位置だけが分かっている側。役割が違うので列を分ける */}
        <div className="known__columns">
          <div className="known__col">
            <h3 className="known__group">偵察兵</h3>

            <ol className="known__list">
              {spotters.map((point) => {
                const bad = point.gridInput !== '' && parseGrid(point.gridInput) === null
                return (
                  <li
                    key={point.id}
                    className={`known__row${point.lost === true ? ' is-lost' : ''}`}
                    onMouseEnter={() => setHighlight(point.id)}
                    onMouseLeave={() => setHighlight((h) => (h === point.id ? null : h))}
                  >
                    <button
                      className={`known__alive${point.lost === true ? ' is-lost' : ''}`}
                      onClick={() => patchKnown(point.id, { lost: point.lost !== true })}
                      title={
                        point.lost === true
                          ? '撃破された扱い。押すと健在に戻します'
                          : '健在。押すと撃破された扱いにします'
                      }
                      aria-pressed={point.lost === true}
                    >
                      {point.lost === true ? '✕' : '○'}
                    </button>
                    <input
                      className="known__label"
                      value={point.label}
                      onChange={(e) => patchKnown(point.id, { label: e.target.value })}
                      spellCheck={false}
                      aria-label="偵察兵の名前"
                    />
                    <input
                      className={`known__grid${bad ? ' is-invalid' : ''}`}
                      value={point.gridInput}
                      onChange={(e) => patchKnown(point.id, { gridInput: e.target.value })}
                      onPaste={handlePaste}
                      placeholder="I9 9:1"
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="グリッド座標"
                      aria-invalid={bad}
                    />
                    <button
                      className="known__remove"
                      onClick={() => {
                        onRemember('偵察兵を削除')
                        onChange({ ...doc, known: doc.known.filter((k) => k.id !== point.id) })
                      }}
                      title="削除"
                      aria-label={`${point.label} を削除`}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ol>

            <button
              className="section__add"
              onClick={() =>
                onChange({ ...doc, known: [...doc.known, newKnownPoint(spotters.length + 1)] })
              }
            >
              ＋ 偵察兵
            </button>
          </div>

          <div className="known__col">
            <h3 className="known__group">
              基準点
              <span className="known__grouphint">座標が分かっている点。観測元にも使えます</span>
            </h3>

            <ol className="known__list">
              {references.map((point) => {
                const bad = point.gridInput !== '' && parseGrid(point.gridInput) === null
                return (
                  <li
                    key={point.id}
                    className="known__row"
                    onMouseEnter={() => setHighlight(point.id)}
                    onMouseLeave={() => setHighlight((h) => (h === point.id ? null : h))}
                  >
                    <span className="known__mark" aria-hidden>
                      ◈
                    </span>
                    <input
                      className="known__label"
                      value={point.label}
                      onChange={(e) => patchKnown(point.id, { label: e.target.value })}
                      spellCheck={false}
                      aria-label="基準点の名前"
                    />
                    <input
                      className={`known__grid${bad ? ' is-invalid' : ''}`}
                      value={point.gridInput}
                      onChange={(e) => patchKnown(point.id, { gridInput: e.target.value })}
                      placeholder="F4 2:3"
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="グリッド座標"
                      aria-invalid={bad}
                    />
                    <button
                      className="known__remove"
                      onClick={() => {
                        onRemember('基準点を削除')
                        onChange({ ...doc, known: doc.known.filter((k) => k.id !== point.id) })
                      }}
                      title="削除"
                      aria-label={`${point.label} を削除`}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}

              {/* 外れ弾が落ちた場所。撃った座標そのものなので位置が分かっている */}
              {impacts.map((point) => (
                <li
                  key={point.id}
                  className="known__row is-impact"
                  onMouseEnter={() => setHighlight(point.id)}
                  onMouseLeave={() => setHighlight((h) => (h === point.id ? null : h))}
                >
                  <span className="known__mark" aria-hidden>
                    ✳
                  </span>
                  <span className="known__fixed">
                    {point.label}
                    <span className="known__from is-impact">着弾</span>
                  </span>
                  <input
                    className="known__grid"
                    value={point.gridInput}
                    onChange={(e) => patchKnown(point.id, { gridInput: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${point.label} の座標`}
                  />
                  <button
                    className="known__remove"
                    onClick={() => {
                      onRemember('着弾点を削除')
                      onChange({ ...doc, known: doc.known.filter((k) => k.id !== point.id) })
                    }}
                    title="削除"
                    aria-label={`${point.label} を削除`}
                  >
                    ✕
                  </button>
                </li>
              ))}

              {/* 撃って確かめた標定も、由来が違うだけで同じ基準点 */}
              {settled.map((point) => (
                <li
                  key={point.id}
                  className="known__row is-settled"
                  onMouseEnter={() => setHighlight(point.id)}
                  onMouseLeave={() => setHighlight((h) => (h === point.id ? null : h))}
                >
                  <span className="known__mark" aria-hidden>
                    ◈
                  </span>
                  <span className="known__fixed">
                    {point.label}
                    <span className="known__from">実測</span>
                  </span>
                  <input
                    className="known__grid"
                    value={point.pinnedGrid ?? ''}
                    onChange={(e) => patchFix(point.id, { pinnedGrid: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${point.label} の実測座標`}
                  />
                  <button
                    className="known__release"
                    onClick={() => {
                      onRemember('実測座標を取り消し')
                      patchFix(point.id, { pinnedGrid: undefined })
                    }}
                    title="実測を取り消して、三角測量の推定に戻す"
                    aria-label={`${point.label} を推定に戻す`}
                  >
                    ↺
                  </button>
                </li>
              ))}
            </ol>

            <button
              className="section__add"
              onClick={() =>
                onChange({
                  ...doc,
                  known: [...doc.known, newReferencePoint(doc)],
                })
              }
            >
              ＋ 基準点
            </button>
          </div>
        </div>

        {pasteError.length > 0 && (
          <p className="section__error">
            読めなかった行: {pasteError.map((l) => `「${l}」`).join(' ')}
          </p>
        )}
      </section>

      <GridMap
        doc={doc}
        survey={survey}
        highlight={highlight}
        onHighlight={setHighlight}
        targets={targets}
        // 区画を畳んだら、その足場も地図から退ける
        hidden={
          nestOpen
            ? undefined
            : new Set<string>([NEST_FIX_ID, ...convoys.map((c) => c.id)])
        }
      />

      <section className="fixes">
        <div className="known__head">
          <h2 className="section__title">標定</h2>
          <span className="section__hint">
            観測元には既知点のほか、先に解けた標定点も選べます
          </span>
        </div>

        <div className="fixes__list">
          {active.map(renderFixCard)}
        </div>

        {cleared.length > 0 && (
          <details className="cleared">
            <summary className="cleared__head">
              撃破済み <strong>{cleared.length}</strong> 件
              <span className="cleared__hint">
                {cleared.map((f) => f.fix.label).join('・')}
              </span>
            </summary>
            <div className="fixes__list">{cleared.map(renderFixCard)}</div>
          </details>
        )}

        <div className="fixes__actions">
          <button
            className="section__add"
            onClick={() => onChange({ ...doc, fixes: [...doc.fixes, newFix(doc)] })}
          >
            ＋ 標定を追加
          </button>

          {drillArmed ? (
            <div className="drill__confirm">
              <p className="drill__warn">
                いまの偵察兵・基準点・標定をすべて演習用の盤面に差し替えます。取り消しは効きません
              </p>
              <button
                className="drill__go"
                onClick={() => {
                  onChange(generateDrill(Date.now()))
                  setDrillArmed(false)
                }}
              >
                差し替える
              </button>
              <button className="drill__cancel" onClick={() => setDrillArmed(false)}>
                やめる
              </button>
            </div>
          ) : (
            <button
              className="section__add"
              onClick={() => setDrillArmed(true)}
              title="ランダムな状況を組み立てて、いまの標定と差し替えます"
            >
              ▶ 演習
            </button>
          )}
        </div>
      </section>

      <footer className="footnote">
        <p>
          タイルは <strong>A1 から T10</strong>、1 タイル 1km 四方。サブ座標 <code>0:0</code>〜
          <code>9:9</code> は 100m 四方です。A1 が左下で、列 A→T が西→東、行 1→10 が南→北。
        </p>
        <p>
          方位どうし・距離どうし・方位と距離、どの組み合わせでも構いません。拘束が 2 つそろえば解けます。
          距離 2 つや方位と距離の組は交点が 2 箇所に出るので、観測をもう 1 つ足すか地形で絞ってください。
        </p>
        <p>
          <strong>推定した点を観測元にすると、その誤差はそのまま持ち越されます。</strong>
          段を重ねるほど最終的な誤差は大きくなるので、累積ぶんの表示を見ながら組んでください。
        </p>
        <p>
          緊急移動で自機の位置が分からなくなったら、上の <strong>IRON NEST</strong> の区画で
          <strong>座標を更新</strong>を押してください。補給隊を呼ぶ先が決まるので、
          戻ってきた報告を入れれば現在地が出ます。
        </p>
      </footer>
    </>
  )
}

function formatEntryGrid(grid: {
  col: number
  row: number
  subX: number | null
  subY: number | null
}) {
  const tile = `${'ABCDEFGHIJKLMNOPQRST'[grid.col]}${grid.row + 1}`
  return grid.subX === null || grid.subY === null ? tile : `${tile} ${grid.subX}:${grid.subY}`
}
