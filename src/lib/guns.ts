/**
 * 砲の識別。
 *
 * Iron Nest の砲座は戦艦由来の 800mm 砲が左右 1 門ずつ。
 * 装填と仰角は左右で独立しているが、旋回は砲塔ごとなので方位は共通になる。
 * 連続射撃で方位の修正が律速になるのはこのため。
 */

export const SIDES = ['left', 'right'] as const
export type Side = (typeof SIDES)[number]

export const SIDE_LABEL: Record<Side, string> = {
  left: '左砲',
  right: '右砲',
}

export const SIDE_MARK: Record<Side, string> = {
  left: 'L',
  right: 'R',
}
