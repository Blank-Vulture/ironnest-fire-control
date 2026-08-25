interface Props {
  value: string
  onChange: (next: string) => void
  /** 外側の見た目を合わせるためのクラス。欄の形は呼ぶ側が決める。 */
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
 * 方位の入力。小数点で 2 つに分ける。
 *
 * 報告の方位は小数第 1 位まで来るが、その桁はたいてい 0 になる。1 つの欄に
 * まとめると、ほとんど 0 と分かっている字を毎回打つことになる。分けておけば
 * 整数部だけ打てば済み、0 以外だったときにもう 1 つの欄へ回せばよい。
 *
 * 桁を省くと精度まで落ちる。「300」と入れた方位は丸めだけで ±0.5 度の幅を
 * 持つ扱いになり（bearingSigmaFor）、浅く交わる標定ではそれが数百 m に開く。
 * ここで小数部を必ず持たせておくと、報告どおりの精度がそのまま伝わる。
 */
export function BearingInput({ value, onChange, className, label }: Props) {
  const { whole, frac } = split(value)

  /** 整数部と小数部から入力値を組み直す。空欄は空欄のまま返す。 */
  const compose = (nextWhole: string, nextFrac: string) => {
    const trimmed = nextWhole.trim()
    if (trimmed === '') return ''
    return `${trimmed}.${nextFrac === '' ? '0' : nextFrac}`
  }

  return (
    <span className={`bearing ${className}`}>
      <input
        className="bearing__whole"
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
      <span className="bearing__dot" aria-hidden>
        .
      </span>
      <input
        className="bearing__frac"
        value={whole === '' ? '' : frac === '' ? '0' : frac}
        onChange={(e) => {
          const digit = e.target.value.replace(/\D/g, '').slice(-1)
          onChange(compose(whole, digit))
        }}
        onFocus={(e) => e.target.select()}
        placeholder="0"
        inputMode="numeric"
        maxLength={1}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label}の小数第 1 位`}
      />
    </span>
  )
}
