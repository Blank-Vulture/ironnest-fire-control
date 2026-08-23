import type { Side } from '../lib/guns'

interface Props {
  /** 最初に撃つ側。まだ決まっていなければ null。 */
  firstSide: Side | null
}

function barrelState(side: Side, firstSide: Side | null): string {
  if (firstSide === null) return 'is-idle'
  return side === firstSide ? 'is-first' : 'is-second'
}

/**
 * 砲座を真上から見た図。画面の左右が砲座の左右とそのまま一致するので、
 * どちらの入力欄がどちらの砲かをラベルを読まずに掴める。
 *
 * 形は wiki の記述に沿う: 戦艦の連装砲塔を大型化した砲塔に 800mm 砲を 2 門、
 * 後部に給弾筒 2 基、それを 4 脚の歩行機構が囲む。
 */
export function Turret({ firstSide }: Props) {
  return (
    <svg
      className="turret"
      viewBox="0 0 200 224"
      role="img"
      aria-label="砲座の配置図。砲身は左右に1門ずつ。"
    >
      {/* 4 脚の歩行機構。砲塔の外側を囲む */}
      <g className="turret__legs">
        <path d="M58 142 L22 150 L9 184" />
        <path d="M142 142 L178 150 L191 184" />
        <path d="M56 184 L20 200 L14 220" />
        <path d="M144 184 L180 200 L186 220" />
      </g>

      {/* 砲塔本体。前方が防楯、後方がやや広い */}
      <path className="turret__body" d="M56 200 L144 200 L150 126 L50 126 Z" />
      <rect className="turret__mantlet" x="58" y="114" width="84" height="18" rx="4" />

      {/* 後部の給弾筒 2 基 */}
      <circle className="turret__cylinder" cx="82" cy="180" r="10" />
      <circle className="turret__cylinder" cx="118" cy="180" r="10" />

      {/* 砲身 */}
      <g className={`turret__barrel ${barrelState('left', firstSide)}`}>
        <rect x="72" y="14" width="16" height="106" rx="4" />
        <rect className="turret__muzzle" x="69" y="6" width="22" height="13" rx="3" />
        <text className="turret__mark" x="80" y="158">
          L
        </text>
      </g>

      <g className={`turret__barrel ${barrelState('right', firstSide)}`}>
        <rect x="112" y="14" width="16" height="106" rx="4" />
        <rect className="turret__muzzle" x="109" y="6" width="22" height="13" rx="3" />
        <text className="turret__mark" x="120" y="158">
          R
        </text>
      </g>
    </svg>
  )
}
