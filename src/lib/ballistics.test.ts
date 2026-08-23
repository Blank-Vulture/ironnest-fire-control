import { describe, expect, it } from 'vitest'
import {
  bearingDelta,
  canReach,
  elevationDeg,
  flightSeconds,
  maxRangeKm,
  requiredCharge,
  shellSpeedKmPerSec,
  wrapBearing,
  CHARGES,
} from './ballistics'

describe('射程', () => {
  it('装薬 1 段につき 5 km', () => {
    expect(CHARGES.map(maxRangeKm)).toEqual([5, 10, 15, 20, 25, 30])
  })

  it('届く最小の装薬を選ぶ', () => {
    expect(requiredCharge(6.16)).toBe(2)
    expect(requiredCharge(5)).toBe(1)
    expect(requiredCharge(5.01)).toBe(2)
    expect(requiredCharge(30)).toBe(6)
  })

  it('射程外と不正値は null', () => {
    expect(requiredCharge(30.01)).toBeNull()
    expect(requiredCharge(0)).toBeNull()
    expect(requiredCharge(-1)).toBeNull()
    expect(requiredCharge(NaN)).toBeNull()
  })

  it('境界ちょうどは届く', () => {
    expect(canReach(10, 2)).toBe(true)
    expect(canReach(10.01, 2)).toBe(false)
  })
})

describe('仰角', () => {
  it('ゲーム内の表示と一致する（クリップボードの実例）', () => {
    // 273.9° / 6.16km を装薬 2 で撃つと 36.96°
    expect(elevationDeg(6.16, 2)).toBeCloseTo(36.96, 6)
  })

  it('wiki の例と一致する', () => {
    // 12.36 km を装薬 3 で撃つと 49.44°
    expect(elevationDeg(12.36, 3)).toBeCloseTo(49.44, 6)
  })

  it('最大射程でちょうど 60 度', () => {
    for (const c of CHARGES) {
      expect(elevationDeg(maxRangeKm(c), c)).toBeCloseTo(60, 10)
    }
  })

  it('装薬を増やすと同じ距離でも仰角が下がる', () => {
    expect(elevationDeg(12, 3)!).toBeGreaterThan(elevationDeg(12, 6)!)
  })

  it('届かない組み合わせは null', () => {
    expect(elevationDeg(12, 2)).toBeNull()
    expect(elevationDeg(31, 6)).toBeNull()
  })
})

describe('飛翔時間', () => {
  it('装薬ごとの弾速が wiki の早見表と一致する', () => {
    const expected = [0.21, 0.26096, 0.38248, 0.52752, 0.64904, 0.7]
    CHARGES.forEach((c, i) => {
      expect(shellSpeedKmPerSec(c)).toBeCloseTo(expected[i]!, 5)
    })
  })

  it('wiki の例と一致する', () => {
    expect(flightSeconds(12.36, 3)!).toBeCloseTo(32.32, 2)
    expect(flightSeconds(12.36, 6)!).toBeCloseTo(17.66, 2)
  })

  it('装薬を増やすと速く着弾する', () => {
    expect(flightSeconds(12, 6)!).toBeLessThan(flightSeconds(12, 3)!)
  })

  it('届かない組み合わせは null', () => {
    expect(flightSeconds(12, 2)).toBeNull()
  })
})

describe('方位', () => {
  it('短い方の回り方を返す', () => {
    expect(bearingDelta(10, 20)).toBe(10)
    expect(bearingDelta(20, 10)).toBe(-10)
  })

  it('0 度をまたいでも短い方を選ぶ', () => {
    expect(bearingDelta(350, 10)).toBe(20)
    expect(bearingDelta(10, 350)).toBe(-20)
  })

  it('正反対は +180', () => {
    expect(bearingDelta(0, 180)).toBe(180)
    expect(bearingDelta(180, 0)).toBe(180)
  })

  it('範囲外の方位を畳む', () => {
    expect(wrapBearing(-10)).toBe(350)
    expect(wrapBearing(370)).toBe(10)
    expect(wrapBearing(360)).toBe(0)
  })
})
