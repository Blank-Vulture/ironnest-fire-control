import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (next: string) => void
  /** 整数部の欄の見た目を合わせるクラス。欄の形は呼ぶ側が決める。 */
  className: string
  label: string
}

/** 「300.4」を整数部と小数第 1 位に分ける。読めない字はそのまま整数部に残す。 */
function split(value: string): { whole: string; frac: string } {
  const dot = value.indexOf('.')
  if (dot < 0) return { whole: value, frac: '' }
  return { whole: value.slice(0, dot), frac: value.slice(dot + 1, dot + 2) }
}

/**
 * 方位の入力。整数部と小数第 1 位で欄を分ける。
 *
 * 報告の方位は小数第 1 位まで来るが、その桁はたいてい 0 になる。0 と分かって
 * いる欄が常に開いていると、打つ場所が増えるだけで場所も食う。畳んでおいて、
 * 0 以外だったときだけ開く。
 *
 * 畳んでいる間も値は `.0` を持つ。桁を省くと精度まで落ちるため。「300」と
 * 入れた方位は丸めだけで ±0.5 度の幅を持つ扱いになり（bearingSigmaFor）、
 * 浅く交わる標定ではそれが数百 m に開く。畳んで見せないだけで、報告どおりの
 * 精度は伝わる。
 *
 * すでに 0 以外が入っている値は開いた状態で出す。畳んだままだと、入っている
 * 数字が画面から消えてしまう。
 */
export function BearingInput({ value, onChange, className, label }: Props) {
  const { whole, frac } = split(value)
  const hasFrac = frac !== '' && frac !== '0'
  const [open, setOpen] = useState(hasFrac)
  const fracRef = useRef<HTMLInputElement>(null)
  const justOpened = useRef(false)

  // 0 以外が入ってきたら開く。貼り付けや取り消しで外から変わることがある
  useEffect(() => {
    if (hasFrac) setOpen(true)
  }, [hasFrac])

  // 開くボタンで開いたときだけ、そのまま打てるように送る
  useEffect(() => {
    if (open && justOpened.current) {
      justOpened.current = false
      fracRef.current?.select()
    }
  }, [open])

  /** 整数部と小数部から入力値を組み直す。空欄は空欄のまま返す。 */
  const compose = (nextWhole: string, nextFrac: string) => {
    const trimmed = nextWhole.trim()
    if (trimmed === '') return ''
    return `${trimmed}.${nextFrac === '' ? '0' : nextFrac}`
  }

  return (
    <span className="bearing">
      <input
        className={`bearing__whole ${className}`}
        value={whole}
        onChange={(e) => {
          // 「300.4」と丸ごと打たれても拾えるようにする
          const typed = split(e.target.value)
          onChange(compose(typed.whole, typed.frac === '' ? frac : typed.frac))
        }}
        placeholder={label}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
      />

      {open ? (
        <span className="bearing__tail">
          <span className="bearing__dot" aria-hidden>
            .
          </span>
          <input
            ref={fracRef}
            className="bearing__frac"
            value={whole === '' ? '' : frac === '' ? '0' : frac}
            onChange={(e) => {
              const digit = e.target.value.replace(/\D/g, '').slice(-1)
              onChange(compose(whole, digit))
            }}
            onFocus={(e) => e.target.select()}
            onBlur={() => {
              // 0 に戻したなら畳む。開いたままだと 0 の欄が並び続ける
              if (!hasFrac) setOpen(false)
            }}
            placeholder="0"
            inputMode="numeric"
            maxLength={1}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${label}の小数第 1 位`}
          />
        </span>
      ) : (
        <button
          type="button"
          className="bearing__open"
          onClick={() => {
            justOpened.current = true
            setOpen(true)
          }}
          title="小数第 1 位を入れる"
          aria-label={`${label}の小数第 1 位を入れる`}
        >
          .0
        </button>
      )}
    </span>
  )
}
