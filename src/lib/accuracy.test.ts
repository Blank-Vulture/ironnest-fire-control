import { describe, expect, it } from 'vitest'
import { bearingBetween, distanceBetween, gridToPoint, parseGrid, type Point } from './grid'
import { triangulate, type Observation } from './triangulate'
import { BEARING_SIGMA_DEG, estimateAccuracy, prospect } from './accuracy'

const at = (grid: string) => gridToPoint(parseGrid(grid)!)

const sighting = (id: string, from: Point, target: Point, kind: 'bearing' | 'range'): Observation => ({
  id,
  label: id,
  position: from,
  bearingDeg: kind === 'bearing' ? bearingBetween(from, target) : null,
  rangeKm: kind === 'range' ? distanceBetween(from, target) : null,
})

const solve = (observations: Observation[]) => {
  const result = triangulate(observations)
  if (result.kind !== 'solved') throw new Error('解けていない')
  return result.estimate.position
}

const measure = (observations: Observation[]) =>
  estimateAccuracy(observations, solve(observations))

describe('見込み誤差', () => {
  const target = { x: 10, y: 5 }

  it('直角に交わる方位 2 本は誤差が小さい', () => {
    const observations = [
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 6, y: 5 }, target, 'bearing'),
    ]
    // 距離 4km で 0.5 度なら横ずれ 35m。直角ならほぼそのまま残る
    const { radiusKm } = measure(observations)
    expect(radiusKm).toBeGreaterThan(0.02)
    expect(radiusKm).toBeLessThan(0.09)
  })

  it('浅く交わる方位 2 本は誤差が跳ね上がる', () => {
    // 同じ側から 15 度違いで見る。距離は直角の場合と揃える
    const observations = [
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 11.04, y: 1.14 }, target, 'bearing'),
    ]
    const shallow = measure(observations).radiusKm
    const square = measure([
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 6, y: 5 }, target, 'bearing'),
    ]).radiusKm
    expect(shallow).toBeGreaterThan(square * 3)
  })

  it('観測を足すと誤差が縮む', () => {
    const two = measure([
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 6, y: 5 }, target, 'bearing'),
    ]).radiusKm
    const three = measure([
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 6, y: 5 }, target, 'bearing'),
      sighting('c', { x: 10, y: 9 }, target, 'range'),
    ]).radiusKm
    expect(three).toBeLessThan(two)
  })

  it('遠くから見るほど方位のぶれが効く', () => {
    const near = measure([
      sighting('a', { x: 10, y: 3 }, target, 'bearing'),
      sighting('b', { x: 8, y: 5 }, target, 'bearing'),
    ]).radiusKm
    const far = measure([
      sighting('a', { x: 10, y: 1 }, target, 'bearing'),
      sighting('b', { x: 6, y: 5 }, target, 'bearing'),
    ]).radiusKm
    expect(far).toBeGreaterThan(near)
  })

  it('いちばん効いている観測を先頭に出す', () => {
    const observations = [
      // 遠くから見ている方が、同じ 0.5 度でも横ずれが大きい
      sighting('遠い', { x: 10, y: 1 }, target, 'bearing'),
      sighting('近い', { x: 8.5, y: 5 }, target, 'bearing'),
    ]
    const { contributions } = measure(observations)
    expect(contributions[0]!.label).toBe('遠い')
    expect(contributions).toHaveLength(2)
  })

  it('報告に幅が無ければ誤差も出ない', () => {
    const blank: Observation = {
      id: 'x', label: 'x', position: { x: 1, y: 1 }, bearingDeg: null, rangeKm: null,
    }
    expect(estimateAccuracy([blank], target).radiusKm).toBe(0)
  })

  it('方位の読み取り幅は度単位の丸めぶん', () => {
    expect(BEARING_SIGMA_DEG).toBe(0.5)
  })
})

describe('添付された実例', () => {
  // 基準点A K2 6:5 からの方位 300 度、偵察兵#3 C5 3:7 からの方位 105 度。
  // 交差角は 15 度しかないので、度単位の丸めだけで数百 m ずれる。
  it('交差角 15 度では誤差が数百 m に開く', () => {
    const alpha = at('K2 6:5')
    const scout = at('C5 3:7')
    const observations: Observation[] = [
      { id: 'a', label: '基準点A', position: alpha, bearingDeg: 300, rangeKm: null },
      { id: 's', label: '偵察兵#3', position: scout, bearingDeg: 105, rangeKm: null },
    ]
    const result = triangulate(observations)
    expect(result.kind).toBe('solved')
    if (result.kind !== 'solved') return

    expect(result.estimate.crossingAngleDeg).toBeCloseTo(15, 0)
    const { radiusKm } = estimateAccuracy(observations, result.estimate.position)
    expect(radiusKm).toBeGreaterThan(0.2)
    expect(radiusKm).toBeLessThan(0.6)
  })
})

describe('効果半径との突き合わせ', () => {
  it('効果半径の半分までに収まっていれば見込みあり', () => {
    expect(prospect(0.1, 0.25)).toBe('good')
    expect(prospect(0.125, 0.25)).toBe('good')
  })
  it('効果半径と同じくらいなら五分五分', () => {
    expect(prospect(0.2, 0.25)).toBe('marginal')
    expect(prospect(0.25, 0.25)).toBe('marginal')
  })
  it('効果半径を超えたら外れる公算', () => {
    expect(prospect(0.26, 0.25)).toBe('poor')
    expect(prospect(0.9, 0.25)).toBe('poor')
  })
})
