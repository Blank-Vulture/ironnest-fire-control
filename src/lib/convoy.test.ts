import { describe, expect, it } from 'vitest'
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  bearingBetween,
  distanceBetween,
  formatGrid,
  gridToPoint,
  parseGrid,
  type Point,
} from './grid'
import { planConvoyRequest } from './convoy'

const at = (grid: string) => gridToPoint(parseGrid(grid)!)

const onMap = (p: Point) =>
  p.x >= 0 && p.x < MAP_WIDTH_KM && p.y >= 0 && p.y < MAP_HEIGHT_KM

/** 2 隊から見た自機の方位が、どれだけ開いているか。 */
const crossing = (a: Point, b: Point, target: Point) => {
  const diff = Math.abs(bearingBetween(a, target) - bearingBetween(b, target))
  const folded = diff % 360
  return Math.min(folded, 360 - folded)
}

describe('補給隊への要請先', () => {
  const cases = ['I6 5:3', 'A1 0:0', 'T10 9:9', 'A10 0:9', 'T1 9:0', 'J5 5:5', 'B2 0:0']

  it('どこから跳んでも 2 隊ぶん決まる', () => {
    for (const grid of cases) {
      expect(planConvoyRequest(at(grid)), grid).not.toBeNull()
    }
  })

  it('要請先はどちらも盤面の中に収まる', () => {
    for (const grid of cases) {
      const plan = planConvoyRequest(at(grid))!
      for (const tile of plan.tiles) {
        expect(onMap(gridToPoint(tile)), `${grid} → ${formatGrid(tile)}`).toBe(true)
      }
    }
  })

  it('タイル単位で返す（大まかな座標しか指定できないため）', () => {
    const plan = planConvoyRequest(at('I6 5:3'))!
    for (const tile of plan.tiles) {
      expect(tile.subX).toBeNull()
      expect(tile.subY).toBeNull()
      expect(formatGrid(tile)).toMatch(/^[A-T](10|[1-9])$/)
    }
  })

  it('2 隊は別のタイルに呼ぶ', () => {
    for (const grid of cases) {
      const [a, b] = planConvoyRequest(at(grid))!.tiles
      expect(a.col !== b.col || a.row !== b.row, grid).toBe(true)
    }
  })

  it('2 隊から見た自機の方位が直角に近く開く', () => {
    for (const grid of cases) {
      const target = at(grid)
      const [a, b] = planConvoyRequest(at(grid))!.tiles
      const angle = crossing(gridToPoint(a), gridToPoint(b), target)
      // タイル中心へ丸めるぶんずれるので、直角ちょうどにはならない
      expect(angle, `${grid}: ${angle.toFixed(0)}°`).toBeGreaterThan(55)
    }
  })

  it('広いところでは望ましい距離まで離す', () => {
    const target = at('J5 5:5')
    const plan = planConvoyRequest(target)!
    expect(plan.distanceKm).toBe(5)
    for (const tile of plan.tiles) {
      // タイル中心へ丸めるので、ぴったり 5km にはならない
      expect(distanceBetween(gridToPoint(tile), target)).toBeGreaterThan(3.5)
    }
  })

  it('角に寄っていたら距離を詰めてでも盤面に収める', () => {
    const plan = planConvoyRequest(at('A1 0:0'))!
    expect(plan.tiles.every((t) => onMap(gridToPoint(t)))).toBe(true)
  })
})
