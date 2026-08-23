import type { CSSProperties } from 'react'
import { shellByCode, type ShellCode } from '../lib/shells'

interface Props {
  code: ShellCode
  /** 射撃順。弾の下に出す。 */
  order: number
  /** その砲が次に撃つ 1 発か（＝いま装填しておく弾）。 */
  next?: boolean
  /** その砲が全体の中でも次に撃つ側か。 */
  imminent?: boolean
  /** 弾倉に入りきらず、補給して撃つぶんか。 */
  stowed?: boolean
  /** 廃莢中か。抜けていく途中の描画。 */
  ejecting?: boolean
  style?: CSSProperties
}

/**
 * 弾 1 発の絵。弾体に弾種コードを縦書きで入れる。
 *
 * 実際の装填はローダーで 1 発ずつ行うので、砲の脇に上向きで並べて
 * 「左に何を、右に何を込めるか」を弾の並びそのもので見せる。
 */
export function ShellRound({
  code,
  order,
  next = false,
  imminent = false,
  stowed = false,
  ejecting = false,
  style,
}: Props) {
  const chars = [...code]
  // 4 文字コード（HCHE など）も弾体に収まるよう、字数で行間を詰める
  const lead = Math.min(10.5, 31 / chars.length)
  const fontSize = lead * 0.86
  const top = 15 + (31 - lead * chars.length) / 2 + fontSize * 0.82

  return (
    <div
      className={`round${next ? ' is-next' : ''}${next && imminent ? ' is-imminent' : ''}${
        stowed ? ' is-stowed' : ''
      }${ejecting ? ' is-ejecting' : ''}`}
      style={style}
      title={`${code} — ${shellByCode(code).jp}`}
      aria-hidden={ejecting}
    >
      <svg className="round__svg" viewBox="0 0 20 54" role="img" aria-label={`${order}発目 ${code}`}>
        {/* 弾体。上が尖頭部 */}
        <path
          className="round__body"
          d="M 3 15 C 3 8 6.6 2.5 10 2.5 C 13.4 2.5 17 8 17 15 L 17 46 L 3 46 Z"
        />
        {/* 弾帯 */}
        <rect className="round__band" x="3" y="39.5" width="14" height="2.6" />
        {/* 薬莢底 */}
        <rect className="round__base" x="2.2" y="46" width="15.6" height="4.6" rx="1.2" />

        <text className="round__code" x="10" y={top} fontSize={fontSize}>
          {chars.map((ch, i) => (
            <tspan key={i} x="10" dy={i === 0 ? 0 : lead}>
              {ch}
            </tspan>
          ))}
        </text>
      </svg>
      <span className="round__order">{ejecting ? '' : order}</span>
    </div>
  )
}
