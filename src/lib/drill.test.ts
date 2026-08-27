import { describe, expect, it } from 'vitest'
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, pointToGrid } from './grid'
import { solveSurvey } from './survey'
import { generateDrill } from './drill'

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7 + 1)

/** 「目標#3（地下）」「目標#5（集結・高価値）」のような名前からタグを拾う。 */
function tagsOf(label: string): Set<string> {
  const m = /^目標#\d+(?:（(.+)）)?$/.exec(label)
  if (!m || m[1] === undefined) return new Set()
  return new Set(m[1].split('・'))
}

describe('演習モードの盤面生成', () => {
  it('同じ seed からは同じ盤面が出る', () => {
    expect(generateDrill(12345)).toEqual(generateDrill(12345))
  })

  it('違う seed からは違う盤面が出る', () => {
    const a = generateDrill(1)
    const b = generateDrill(2)
    expect(a).not.toEqual(b)
  })

  it('偵察兵 3 人と砲座 1 つ、基準点 1〜2 つを置く', () => {
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      const nests = doc.known.filter((k) => k.isNest)
      const spotters = doc.known.filter((k) => k.kind === 'spotter')
      const references = doc.fixes.filter((f) => f.isReference)
      expect(nests).toHaveLength(1)
      expect(spotters).toHaveLength(3)
      expect(references.length).toBeGreaterThanOrEqual(1)
      expect(references.length).toBeLessThanOrEqual(2)
    }
  })

  it('目標を 5〜8 体置く', () => {
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      const targets = doc.fixes.filter((f) => f.isTarget)
      expect(targets.length).toBeGreaterThanOrEqual(5)
      expect(targets.length).toBeLessThanOrEqual(8)
    }
  })

  it('生成した盤面は solveSurvey ですべて解ける', () => {
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      const result = solveSurvey(doc)
      for (const resolved of result.fixes) {
        expect(resolved.status.kind, `seed ${seed} / ${resolved.fix.label}`).toBe('solved')
      }
    }
  })

  it('目標も基準点もすべて盤面（A1〜T10）の中に収まる', () => {
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      const result = solveSurvey(doc)
      for (const resolved of result.fixes) {
        if (resolved.status.kind !== 'solved') continue
        const { position } = resolved.status
        expect(position.x).toBeGreaterThanOrEqual(0)
        expect(position.x).toBeLessThan(MAP_WIDTH_KM)
        expect(position.y).toBeGreaterThanOrEqual(0)
        expect(position.y).toBeLessThan(MAP_HEIGHT_KM)
        expect(pointToGrid(position)).not.toBeNull()
      }
    }
  })

  it('装甲の目標には徹甲系（AP/APHE）を選ぶ', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isTarget)) {
        if (!tagsOf(fix.label).has('装甲')) continue
        expect(['AP', 'APHE']).toContain(fix.shell)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('地下の目標には地中貫通弾（EQKE）を選ぶ', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isTarget)) {
        if (!tagsOf(fix.label).has('地下')) continue
        expect(fix.shell).toBe('EQKE')
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('固まった（集結）目標には範囲弾（HCHE/CLMN）を選ぶ', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isTarget)) {
        if (!tagsOf(fix.label).has('集結')) continue
        expect(['HCHE', 'CLMN']).toContain(fix.shell)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('どの種類にも当たらない目標は既定弾（HE）のまま', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isTarget)) {
        const tags = tagsOf(fix.label)
        if (tags.has('装甲') || tags.has('地下') || tags.has('集結')) continue
        expect(fix.shell).toBe('HE')
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('高価値の目標は優先度 high、装甲・地下は raised、それ以外は normal', () => {
    let checkedHigh = 0
    let checkedRaised = 0
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isTarget)) {
        const tags = tagsOf(fix.label)
        if (tags.has('高価値')) {
          expect(fix.priority).toBe('high')
          checkedHigh++
        } else if (tags.has('装甲') || tags.has('地下')) {
          expect(fix.priority).toBe('raised')
          checkedRaised++
        } else {
          expect(fix.priority).toBe('normal')
        }
      }
    }
    expect(checkedHigh).toBeGreaterThan(0)
    expect(checkedRaised).toBeGreaterThan(0)
  })

  it('基準点は座標を直接置かず、偵察兵からの方位で解く', () => {
    for (const seed of SEEDS) {
      const doc = generateDrill(seed)
      for (const fix of doc.fixes.filter((f) => f.isReference)) {
        expect(fix.pinnedGrid).toBeUndefined()
        expect(fix.sightings.length).toBeGreaterThanOrEqual(2)
        for (const sighting of fix.sightings) {
          const source = doc.known.find((k) => k.id === sighting.fromId)
          expect(source?.kind).toBe('spotter')
        }
      }
    }
  })
})
