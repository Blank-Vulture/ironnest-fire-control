interface Props {
  /** 正なら右回り（時計回り）、負なら左回り。 */
  deg: number
}

/**
 * 旋回方向のアイコン。
 *
 * ↻ と ↺ の文字は小さく出すと見分けがつかないので、
 * 3/4 周の弧と矢じりで描いて、どちら回りかを形で示す。
 * 左回りは同じ図形を左右反転させたものなので、必ず対称になる。
 *
 * 方位はゲーム内でも時計回りに増える（北 0° → 東 90°）ので、
 * 方位差が正 = 右回りで一致する。
 */
export function TurnIcon({ deg }: Props) {
  const counterClockwise = deg < 0

  return (
    <svg
      className={`turnicon${counterClockwise ? ' is-ccw' : ''}`}
      viewBox="0 0 24 24"
      role="img"
      aria-label={counterClockwise ? '左回り' : '右回り'}
    >
      {/*
        中心 (12,12)・半径 8 の円を、右端 (20,12) から時計回りに 3/4 周して
        頂点 (12,4) で終える。右上の 1/4 を空けたままにすることで、
        どちら回りかが形だけで読める。
        始点をここに取らないと SVG が反対側の中心を選び、円の半分が枠外に出る。
      */}
      <path
        className="turnicon__arc"
        d="M 20 12 A 8 8 0 1 1 12 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* 終端での進行方向は真右。そこに矢じりを重ねる */}
      <path className="turnicon__head" d="M 11.5 0.4 L 17.6 4 L 11.5 7.6 Z" fill="currentColor" />
    </svg>
  )
}
