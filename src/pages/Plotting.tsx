import { useMemo, useState } from 'react'
import { FixCard } from '../components/FixCard'
import { isNestLabel, parseGrid, parseRoster } from '../lib/grid'
import {
  availableSources,
  solveSurvey,
  type Fix,
  type KnownPoint,
  type Sighting,
  type SurveyDoc,
} from '../lib/survey'
import type { Measurement } from '../lib/targets'

interface Props {
  doc: SurveyDoc
  onChange: (doc: SurveyDoc) => void
  onAddTarget: (measurement: Measurement) => void
}

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function newKnownPoint(index: number): KnownPoint {
  return { id: id('k'), label: `観測員 ${index}`, gridInput: '', isNest: false }
}

export function newSighting(): Sighting {
  return { id: id('s'), fromId: '', bearingInput: '', rangeInput: '' }
}

export function newFix(index: number): Fix {
  return { id: id('f'), label: `目標 ${index}`, sightings: [newSighting(), newSighting()] }
}

export function emptySurveyDoc(): SurveyDoc {
  return {
    known: [
      { id: id('k'), label: '砲座', gridInput: '', isNest: true },
      newKnownPoint(1),
      newKnownPoint(2),
    ],
    fixes: [newFix(1)],
  }
}

/**
 * 標定の画面。
 *
 * 既知点（観測員と砲座）と、そこから割り出す標定点を分けて置く。
 * 標定点は既知点だけでなく、先に解けた標定点も観測元にできるので、
 * 「距離が重なる地点をまず出し、そこからの方位で目標を出す」という
 * 段を重ねた任務がそのまま組める。
 */
export function Plotting({ doc, onChange, onAddTarget }: Props) {
  const [pasteError, setPasteError] = useState<string[]>([])

  const survey = useMemo(() => solveSurvey(doc), [doc])

  const patchKnown = (pointId: string, change: Partial<KnownPoint>) =>
    onChange({ ...doc, known: doc.known.map((k) => (k.id === pointId ? { ...k, ...change } : k)) })

  const patchFix = (fixId: string, change: Partial<Fix>) =>
    onChange({ ...doc, fixes: doc.fixes.map((f) => (f.id === fixId ? { ...f, ...change } : f)) })

  /** 名簿をまとめて貼ると、砲座の行と観測員の行に振り分ける。 */
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
          label: nest?.label ?? '砲座',
          gridInput: nestEntry ? formatEntryGrid(nestEntry.grid) : (nest?.gridInput ?? ''),
          isNest: true,
        },
        ...others.map((entry, i) => ({
          id: id('k'),
          label: entry.label || `観測員 ${i + 1}`,
          gridInput: formatEntryGrid(entry.grid),
          isNest: false,
        })),
      ],
    })
    setPasteError(bad)
  }

  return (
    <>
      <section className="known">
        <div className="known__head">
          <h2 className="section__title">既知点</h2>
          <span className="section__hint">
            クリップボードの名簿（<code>Spotter1 - I9 9:1</code>）をどこかの欄に貼ると振り分けます
          </span>
        </div>

        <ol className="known__list">
          {doc.known.map((point) => {
            const bad = point.gridInput !== '' && parseGrid(point.gridInput) === null
            return (
              <li key={point.id} className={`known__row${point.isNest ? ' is-nest' : ''}`}>
                <span className="known__mark" aria-hidden>
                  {point.isNest ? '◉' : '○'}
                </span>
                <input
                  className="known__label"
                  value={point.label}
                  onChange={(e) => patchKnown(point.id, { label: e.target.value })}
                  spellCheck={false}
                  aria-label="点の名前"
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
                  onClick={() =>
                    onChange({ ...doc, known: doc.known.filter((k) => k.id !== point.id) })
                  }
                  disabled={point.isNest}
                  title={point.isNest ? '砲座は消せません' : '削除'}
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
            onChange({ ...doc, known: [...doc.known, newKnownPoint(doc.known.length)] })
          }
        >
          ＋ 点を追加
        </button>

        {pasteError.length > 0 && (
          <p className="section__error">
            読めなかった行: {pasteError.map((l) => `「${l}」`).join(' ')}
          </p>
        )}
      </section>

      <section className="fixes">
        <div className="known__head">
          <h2 className="section__title">標定</h2>
          <span className="section__hint">
            観測元には既知点のほか、先に解けた標定点も選べます
          </span>
        </div>

        <div className="fixes__list">
          {survey.fixes.map((resolved) => (
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
                  sightings: [...resolved.fix.sightings, newSighting()],
                })
              }
              onRemoveSighting={(sightingId) =>
                patchFix(resolved.fix.id, {
                  sightings: resolved.fix.sightings.filter((s) => s.id !== sightingId),
                })
              }
              onRemove={() =>
                onChange({ ...doc, fixes: doc.fixes.filter((f) => f.id !== resolved.fix.id) })
              }
              onAddTarget={onAddTarget}
            />
          ))}
        </div>

        <button
          className="section__add"
          onClick={() => onChange({ ...doc, fixes: [...doc.fixes, newFix(doc.fixes.length + 1)] })}
        >
          ＋ 標定を追加
        </button>
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
