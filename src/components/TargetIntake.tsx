import { useRef, useState } from 'react'
import {
  parseBearing,
  parseDistance,
  parseMeasurements,
  type Measurement,
} from '../lib/targets'

interface Props {
  onAdd: (measurements: Measurement[]) => void
}

/**
 * 目標の取り込み。
 *
 * ゲーム側のクリップボードは紙なので OS のコピーが効かず、プレイヤーは
 * 画面の `273.9° / 6.16km` を見て打ち直すことになる。単位も区切りも
 * 打つだけ無駄なので、数字だけを入れる 2 つの欄に分けてある。
 * テンキーから手を離さずに 方位 → Enter → 射程 → Enter で 1 件登録できる。
 *
 * OCR などで書式ごと持ってきた場合に備えて、貼り付けだけは
 * `273.9° / 6.16km` の形も（複数行まとめても）受け付ける。
 */
export function TargetIntake({ onAdd }: Props) {
  const [bearing, setBearing] = useState('')
  const [distance, setDistance] = useState('')
  const [touched, setTouched] = useState(false)

  const bearingRef = useRef<HTMLInputElement>(null)
  const distanceRef = useRef<HTMLInputElement>(null)

  const bearingValue = parseBearing(bearing)
  const distanceValue = parseDistance(distance)
  const ready = bearingValue !== null && distanceValue !== null

  const reset = () => {
    setBearing('')
    setDistance('')
    setTouched(false)
    bearingRef.current?.focus()
  }

  const commit = () => {
    if (!ready) {
      setTouched(true)
      return
    }
    onAdd([{ bearingDeg: bearingValue, distanceKm: distanceValue }])
    reset()
  }

  /** 貼り付けは書式付き・複数行を受け付ける。数字 1 つだけなら通常の入力に任せる。 */
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    const { ok } = parseMeasurements(text)
    if (ok.length === 0) return
    event.preventDefault()
    onAdd(ok)
    reset()
  }

  return (
    <section className="intake">
      <label className="intake__label" htmlFor="bearing">
        目標を追加
        <span className="intake__hint">
          数字だけでOK · Enter で次へ / 追加 · 書式ごと貼り付けても読みます
        </span>
      </label>

      <div className="intake__row">
        <div className={`intake__cell${touched && bearingValue === null ? ' is-invalid' : ''}`}>
          <span className="intake__cellname">方位角</span>
          <input
            id="bearing"
            ref={bearingRef}
            className="intake__field"
            value={bearing}
            onChange={(e) => setBearing(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                // 射程が既に埋まっているなら、そのまま登録まで進む
                if (distanceValue !== null) commit()
                else distanceRef.current?.focus()
              }
              if (e.key === 'Escape') reset()
            }}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="273.9"
            aria-label="方位角（度）"
            aria-invalid={touched && bearingValue === null}
            autoFocus
          />
          <span className="intake__unit" aria-hidden>
            °
          </span>
        </div>

        <div className={`intake__cell${touched && distanceValue === null ? ' is-invalid' : ''}`}>
          <span className="intake__cellname">射程</span>
          <input
            ref={distanceRef}
            className="intake__field"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') reset()
            }}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="6.16"
            aria-label="射程（キロメートル）"
            aria-invalid={touched && distanceValue === null}
          />
          <span className="intake__unit" aria-hidden>
            km
          </span>
        </div>

        <button className="intake__add" onClick={commit} disabled={!ready}>
          追加
        </button>
      </div>

      {touched && !ready && (
        <p className="intake__error">
          {bearingValue === null && '方位角は 0 以上 360 未満で入れてください。'}
          {distanceValue === null && '射程は 0 より大きい数で入れてください。'}
        </p>
      )}
    </section>
  )
}
