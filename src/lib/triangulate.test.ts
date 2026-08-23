import { describe, expect, it } from 'vitest'
import {
  bearingBetween,
  distanceBetween,
  gridToPoint,
  parseGrid,
  type Point,
} from './grid'
import {
  SHALLOW_CROSSING_DEG,
  firingSolutionFrom,
  triangulate,
  type Observation,
} from './triangulate'

const at = (grid: string): Point => gridToPoint(parseGrid(grid)!)

/** 実際の目標を決めて、そこから見た報告を組み立てる。逆算ではなく順算で作る。 */
function report(
  id: string,
  from: Point,
  target: Point,
  give: 'bearing' | 'range' | 'both',
): Observation {
  return {
    id,
    label: id,
    position: from,
    bearingDeg: give === 'range' ? null : bearingBetween(from, target),
    rangeKm: give === 'bearing' ? null : distanceBetween(from, target),
  }
}

const solved = (result: ReturnType<typeof triangulate>) => {
  if (result.kind !== 'solved') throw new Error(`解けていない: ${result.kind}`)
  return result.estimate
}

describe('三角測量', () => {
  const target = at('F7 2:5')
  const s1 = at('I9 9:1')
  const s2 = at('K4 3:7')
  const s3 = at('E2 2:4')

  it('方位 2 本で位置が出る', () => {
    const e = solved(triangulate([report('1', s1, target, 'bearing'), report('2', s2, target, 'bearing')]))
    expect(e.position.x).toBeCloseTo(target.x, 3)
    expect(e.position.y).toBeCloseTo(target.y, 3)
    expect(e.residualKm).toBeLessThan(0.005)
  })

  it('距離 2 つで位置が出る', () => {
    const e = solved(triangulate([report('1', s1, target, 'range'), report('2', s2, target, 'range')]))
    // 円 2 つは 2 交点を持つので、どちらかに寄る
    const other = { x: e.alternative?.x ?? NaN, y: e.alternative?.y ?? NaN }
    const hit =
      Math.hypot(e.position.x - target.x, e.position.y - target.y) < 0.01 ||
      Math.hypot(other.x - target.x, other.y - target.y) < 0.01
    expect(hit).toBe(true)
  })

  it('距離 2 つだけなら曖昧だと伝える', () => {
    const e = solved(triangulate([report('1', s1, target, 'range'), report('2', s2, target, 'range')]))
    expect(e.alternative).not.toBeNull()
  })

  it('観測を 3 つにすれば曖昧さが消える', () => {
    const e = solved(
      triangulate([
        report('1', s1, target, 'range'),
        report('2', s2, target, 'range'),
        report('3', s3, target, 'range'),
      ]),
    )
    expect(e.alternative).toBeNull()
    expect(e.position.x).toBeCloseTo(target.x, 3)
    expect(e.position.y).toBeCloseTo(target.y, 3)
  })

  it('方位と距離を別々の観測員から混ぜられる', () => {
    // 「spotter1 から 3km」「spotter2 は方位 275 度」のような報告
    const e = solved(
      triangulate([report('1', s1, target, 'range'), report('2', s2, target, 'bearing')]),
    )
    const hit =
      Math.hypot(e.position.x - target.x, e.position.y - target.y) < 0.01 ||
      (e.alternative !== null &&
        Math.hypot(e.alternative.x - target.x, e.alternative.y - target.y) < 0.01)
    expect(hit).toBe(true)
  })

  it('1 人が方位と距離を両方持っていればそれだけで決まる', () => {
    const e = solved(triangulate([report('1', s1, target, 'both')]))
    expect(e.position.x).toBeCloseTo(target.x, 6)
    expect(e.position.y).toBeCloseTo(target.y, 6)
    expect(e.residualKm).toBeLessThan(1e-6)
    expect(e.alternative).toBeNull()
  })

  it('拘束が 1 つだけでは決まらない', () => {
    expect(triangulate([report('1', s1, target, 'bearing')])).toEqual({
      kind: 'insufficient',
      have: 1,
    })
    expect(triangulate([report('1', s1, target, 'range')])).toEqual({
      kind: 'insufficient',
      have: 1,
    })
    expect(triangulate([])).toEqual({ kind: 'insufficient', have: 0 })
  })

  it('方位も距離も無い観測員は数えない', () => {
    const blank: Observation = { id: 'x', label: 'x', position: s3, bearingDeg: null, rangeKm: null }
    expect(triangulate([report('1', s1, target, 'bearing'), blank])).toEqual({
      kind: 'insufficient',
      have: 1,
    })
  })

  it('互いに背を向けた方位は矛盾として返す', () => {
    // 方位線は向きを持つので、観測員の背後で交わっても解にしてはいけない
    const wrong: Observation = {
      ...report('2', s2, target, 'bearing'),
      bearingDeg: (bearingBetween(s2, target) + 180) % 360,
    }
    expect(triangulate([report('1', s1, target, 'bearing'), wrong])).toEqual({
      kind: 'contradictory',
      have: 2,
    })
  })

  it('重ならない距離円も矛盾として返す', () => {
    const a = report('1', s1, target, 'range')
    const b = report('2', s2, target, 'range')
    expect(triangulate([a, { ...b, rangeKm: 0.1 }])).toEqual({ kind: 'contradictory', have: 2 })
  })

  it('食い違う報告が混ざっても、交点があれば解いて残差で知らせる', () => {
    const wrong: Observation = {
      ...report('2', s2, target, 'bearing'),
      bearingDeg: (bearingBetween(s2, target) + 25) % 360,
    }
    const e = solved(triangulate([report('1', s1, target, 'bearing'), wrong, report('3', s3, target, 'range')]))
    expect(e.residualKm).toBeGreaterThan(0.1)
  })

  it('報告が食い違えば残差が大きくなる', () => {
    const off = report('2', s2, target, 'range')
    const clean = solved(triangulate([report('1', s1, target, 'range'), report('3', s3, target, 'range'), off]))
    const dirty = solved(
      triangulate([
        report('1', s1, target, 'range'),
        report('3', s3, target, 'range'),
        { ...off, rangeKm: off.rangeKm! + 1.5 },
      ]),
    )
    expect(clean.residualKm).toBeLessThan(0.01)
    expect(dirty.residualKm).toBeGreaterThan(0.2)
  })

  it('観測がぶれても、増やすほど真値に寄る', () => {
    const noisy = (o: Observation, delta: number): Observation => ({
      ...o,
      bearingDeg: o.bearingDeg === null ? null : o.bearingDeg + delta,
      rangeKm: o.rangeKm === null ? null : o.rangeKm + delta * 0.05,
    })
    const two = solved(
      triangulate([
        noisy(report('1', s1, target, 'both'), 1),
        noisy(report('2', s2, target, 'both'), -1),
      ]),
    )
    const three = solved(
      triangulate([
        noisy(report('1', s1, target, 'both'), 1),
        noisy(report('2', s2, target, 'both'), -1),
        report('3', s3, target, 'both'),
      ]),
    )
    const err = (p: Point) => Math.hypot(p.x - target.x, p.y - target.y)
    expect(err(three.position)).toBeLessThan(err(two.position))
  })
})

describe('交差角', () => {
  const target = at('J5 0:0')

  it('直角に近い交差では注意を出さない', () => {
    const e = solved(
      triangulate([
        report('1', at('J1 0:0'), target, 'bearing'),
        report('2', at('A5 0:0'), target, 'bearing'),
      ]),
    )
    expect(e.crossingAngleDeg).toBeGreaterThan(SHALLOW_CROSSING_DEG)
  })

  it('平行に近い方位 2 本は浅い交差として出る', () => {
    // ほぼ同じ方角から見ている 2 人
    const e = solved(
      triangulate([
        report('1', at('A1 0:0'), target, 'bearing'),
        report('2', at('B1 0:0'), target, 'bearing'),
      ]),
    )
    expect(e.crossingAngleDeg).toBeLessThan(SHALLOW_CROSSING_DEG)
  })

  it('距離が混ざっていれば交差角は出さない', () => {
    const e = solved(
      triangulate([
        report('1', at('J1 0:0'), target, 'bearing'),
        report('2', at('A5 0:0'), target, 'range'),
      ]),
    )
    expect(e.crossingAngleDeg).toBeNull()
  })
})

describe('砲座から見た諸元', () => {
  it('推定位置を方位と距離に直せる', () => {
    const nest = at('I6 5:3')
    const target = at('C6 3:7')
    const { bearingDeg, distanceKm } = firingSolutionFrom(nest, target)
    expect(bearingDeg).toBeCloseTo(bearingBetween(nest, target), 9)
    expect(distanceKm).toBeCloseTo(distanceBetween(nest, target), 9)
    expect(bearingDeg).toBeGreaterThan(180) // 西寄り
    expect(distanceKm).toBeCloseTo(6.2, 1)
  })
})

describe('盤面の外の候補', () => {
  /** 中心が同じ高さに並ぶ 2 円。交点は南北に開く。 */
  const pair = (cx1: number, cx2: number, y: number, radius: number): Observation[] => [
    { id: 'a', label: 'a', position: { x: cx1, y }, bearingDeg: null, rangeKm: radius },
    { id: 'b', label: 'b', position: { x: cx2, y }, bearingDeg: null, rangeKm: radius },
  ]

  it('交点の片方が地図の外なら、中の方を目標にする', () => {
    // 中心 (8,0.4) と (12,0.4)、半径 2.5。交点は (10, 1.9) と (10, -1.1)。
    // 後者は南端の外なので、目標にはなりえない。
    const e = solved(triangulate(pair(8, 12, 0.4, 2.5)))
    expect(e.position.x).toBeCloseTo(10, 3)
    expect(e.position.y).toBeCloseTo(1.9, 3)
    // 外の候補は相手にしないので、曖昧さも残らない
    expect(e.alternative).toBeNull()
  })

  it('両方とも盤面の中なら、これまでどおり曖昧として両方出す', () => {
    // 交点は (10, 6.5) と (10, 3.5)。どちらも盤面の中。
    const e = solved(triangulate(pair(8, 12, 5, 2.5)))
    expect(e.alternative).not.toBeNull()
    const ys = [e.position.y, e.alternative!.y].sort((p, q) => p - q)
    expect(ys[0]).toBeCloseTo(3.5, 3)
    expect(ys[1]).toBeCloseTo(6.5, 3)
  })

  it('どの候補も盤面の外なら、いちばん整合する点をそのまま返す', () => {
    // 東の外で交わる 2 円。選びようがないので、黙って捨てたりはしない。
    const e = solved(triangulate(pair(25, 29, 5, 2.5)))
    expect(e.position.x).toBeCloseTo(27, 3)
  })
})
