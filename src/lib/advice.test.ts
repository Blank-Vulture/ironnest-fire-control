import { describe, expect, it } from 'vitest'
import { bearingBetween, distanceBetween, type Point } from './grid'
import { triangulate, type Observation } from './triangulate'
import { estimateAccuracy } from './accuracy'
import { adviseFix, bestViewingBearing, compareCandidates } from './advice'
import type { ShellCode } from './shells'

const target: Point = { x: 10, y: 5 }

const look = (id: string, from: Point, kind: 'bearing' | 'range' = 'bearing'): Observation => ({
  id,
  label: id,
  position: from,
  bearingDeg: kind === 'bearing' ? bearingBetween(from, target) : null,
  rangeKm: kind === 'range' ? distanceBetween(from, target) : null,
})

const advise = (observations: Observation[], shell: ShellCode = 'HE') => {
  const result = triangulate(observations)
  if (result.kind !== 'solved') throw new Error('解けていない')
  return adviseFix({
    position: result.estimate.position,
    alternative: result.estimate.alternative,
    accuracy: estimateAccuracy(observations, result.estimate.position),
    observations,
    shell,
  })
}

describe('観測を足すべき方角', () => {
  it('1 本の視線に対しては直角を勧める', () => {
    // 真南から見ている（視線は北向き 0 度）ので、東西の線上を勧める
    const angle = bestViewingBearing([look('a', { x: 10, y: 1 })], target)
    expect(angle).toBeCloseTo(90, 0)
  })

  it('2 本の視線の間を取る', () => {
    // 0 度と 90 度から見ている。どちらとも 45 度で交わる向きが最善になる
    const angle = bestViewingBearing(
      [look('a', { x: 10, y: 1 }), look('b', { x: 6, y: 5 })],
      target,
    )
    expect(angle).toBeCloseTo(45, 0)
  })

  it('観測が無ければ勧めようがない', () => {
    expect(bestViewingBearing([], target)).toBeNull()
  })
})

describe('見立て', () => {
  // 実測した見込み誤差を添えてある。効果半径は HE 250m / AP 150m、照明弾は 500m
  /** 直角に 4km。±86m */
  const square = [look('a', { x: 10, y: 1 }), look('b', { x: 6, y: 5 })]
  /** 30 度で 4km。±166m */
  const slant = [look('a', { x: 10, y: 1 }), look('b', { x: 8, y: 1.536 })]
  /** 15 度で 4km。±331m */
  const narrow = [look('a', { x: 10, y: 1 }), look('b', { x: 11.04, y: 1.14 })]
  /** 8 度で 6km。±764m */
  const shallow = [look('a', { x: 10, y: -1 }), look('b', { x: 10.83, y: -0.94 })]

  it('誤差が効果半径に収まっていれば、撃てると言い切る', () => {
    const [first] = advise(square)
    expect(first!.kind).toBe('ready')
    expect(advise(square)).toHaveLength(1)
  })

  it('当たる見込みが高ければ撃てると言い切る', () => {
    // ±86m 対 HE の 250m。命中はほぼ確実
    expect(advise(square, 'HE')[0]!.kind).toBe('ready')
  })

  it('言い切れない精度なら、そう言う', () => {
    // ±166m 対 HE の 250m。当たる公算はあるが確実ではない
    const shots = advise(slant, 'HE')
    expect(shots[0]!.kind).not.toBe('ready')
    expect(shots.some((a) => a.headline.includes('確実ではない'))).toBe(true)
  })

  it('効果半径の小さい弾では同じ精度でも足りない', () => {
    // 同じ ±331m でも、HE の 250m なら五分五分、AP の 150m では届かない
    expect(advise(narrow, 'HE').some((a) => a.headline.includes('五分五分'))).toBe(true)
    expect(advise(narrow, 'AP').some((a) => a.headline.includes('外れる公算'))).toBe(true)
  })

  it('見立てには命中の見込みを添える', () => {
    expect(advise(square, 'HE')[0]!.headline).toMatch(/命中 およそ \d+%/)
    expect(advise(narrow, 'HE').some((a) => /命中 およそ \d+%/.test(a.headline))).toBe(true)
  })

  it('浅い交差では観測を足すよう勧める', () => {
    const kinds = advise(shallow).map((a) => a.kind)
    expect(kinds).toContain('observe')
  })

  it('誤差が照明弾の範囲に収まるなら照明弾を勧める', () => {
    // ±331m は照明弾の 500m に収まるので、1 発照らせば見てもらえる
    const advices = advise(narrow, 'AP')
    const star = advices.find((a) => a.kind === 'star')
    expect(star).toBeDefined()
    expect(star!.atGrid).toBeTruthy()
  })

  it('照らしきれない誤差なら偵察飛行を勧める', () => {
    // ±571m は照明弾の 500m を超えるので照らしきれない
    const advices = advise(shallow)
    expect(advices.some((a) => a.kind === 'recon')).toBe(true)
    expect(advices.some((a) => a.kind === 'star')).toBe(false)
  })

  it('外れる公算なら、そう言う', () => {
    // ±571m は HE の効果半径 250m を大きく超える
    expect(advise(shallow).some((a) => a.headline.includes('外れる公算'))).toBe(true)
    expect(advise(square).some((a) => a.headline.includes('外れる公算'))).toBe(false)
  })

  it('候補が 2 つあるうちは、まず絞れと言う', () => {
    // 距離 2 つは交点が 2 箇所に出る。目標と一直線に並べると接してしまうので外す
    const two = [look('a', { x: 8, y: 4 }, 'range'), look('b', { x: 12, y: 4 }, 'range')]
    const advices = advise(two)
    expect(advices[0]!.kind).toBe('decide')
    expect(advices[0]!.atGrid).toBeTruthy()
  })
})

describe('先に撃つ候補', () => {
  const HE = 0.25

  it('当たりやすいほうを先に撃つ', () => {
    const near = { radiusKm: 0.1, residualKm: 0 }
    const far = { radiusKm: 0.5, residualKm: 0 }
    expect(compareCandidates(near, far, HE)).toBeLessThan(0)
    expect(compareCandidates(far, near, HE)).toBeGreaterThan(0)
  })

  it('当たりやすさが並んだら、報告に合うほうを採る', () => {
    // 距離 2 本の候補は鏡像なので、誤差はほぼ必ず並ぶ
    const fits = { radiusKm: 0.27, residualKm: 0 }
    const loose = { radiusKm: 0.275, residualKm: 0.4 }
    expect(compareCandidates(fits, loose, HE)).toBeLessThan(0)
    expect(compareCandidates(loose, fits, HE)).toBeGreaterThan(0)
  })

  it('食い違いのほうが大きくても、当たりやすさが違えばそちらを優先する', () => {
    // 当てられない点に先に撃っても、外れたのか的が違うのか分からない
    const likely = { radiusKm: 0.9, residualKm: 0 }
    const hittable = { radiusKm: 0.05, residualKm: 0.4 }
    expect(compareCandidates(likely, hittable, HE)).toBeGreaterThan(0)
  })

  it('どちらも決め手が無ければ順番を動かさない', () => {
    const same = { radiusKm: 0.27, residualKm: 0 }
    expect(compareCandidates(same, { ...same }, HE)).toBe(0)
    // 実測どおりの僅差。ここで並べ替わると見ていた候補が勝手に入れ替わる
    expect(compareCandidates(same, { radiusKm: 0.275, residualKm: 0 }, HE)).toBe(0)
  })
})
