import { describe, expect, it } from 'vitest'
import {
  bearingBetween,
  distanceBetween,
  formatGrid,
  formatPoint,
  gridToPoint,
  parseGrid,
  isNestLabel,
  parseRoster,
  parseRosterLine,
  pointFrom,
  pointToGrid,
} from './grid'

describe('グリッドの読み取り', () => {
  it('タイルとサブ座標を読む', () => {
    expect(parseGrid('I6 5:3')).toEqual({ col: 8, row: 5, subX: 5, subY: 3 })
  })

  it('小文字・全角・区切りのゆれを吸収する', () => {
    for (const s of ['i6 5:3', 'Ｉ６ ５：３', 'I6 5 3', 'I6-5-3', 'I6  5:3']) {
      expect(parseGrid(s)).toEqual({ col: 8, row: 5, subX: 5, subY: 3 })
    }
  })

  it('サブ座標は省略できる', () => {
    expect(parseGrid('A1')).toEqual({ col: 0, row: 0, subX: null, subY: null })
  })

  it('端の座標を受け付ける', () => {
    expect(parseGrid('A1 0:0')).toEqual({ col: 0, row: 0, subX: 0, subY: 0 })
    expect(parseGrid('T10 9:9')).toEqual({ col: 19, row: 9, subX: 9, subY: 9 })
  })

  it('範囲外・不正は読まない', () => {
    for (const s of ['U1', 'A0', 'A11', 'I6 5', '', '6I 5:3', 'あ1']) {
      expect(parseGrid(s)).toBeNull()
    }
  })
})

describe('グリッドと km の変換', () => {
  it('A1 が左下の原点側になる', () => {
    // 1 マス 100m なので 0:0 の中心は 50m
    expect(gridToPoint(parseGrid('A1 0:0')!)).toEqual({ x: 0.05, y: 0.05 })
  })

  it('列は東へ、行は北へ増える', () => {
    const a = gridToPoint(parseGrid('A1 0:0')!)
    const b = gridToPoint(parseGrid('B1 0:0')!)
    const c = gridToPoint(parseGrid('A2 0:0')!)
    expect(b.x - a.x).toBeCloseTo(1) // 1 タイル＝東へ 1km
    expect(b.y).toBeCloseTo(a.y)
    expect(c.y - a.y).toBeCloseTo(1) // 1 行＝北へ 1km
    expect(c.x).toBeCloseTo(a.x)
  })

  it('サブ座標は 100m 刻みで効く', () => {
    const a = gridToPoint(parseGrid('F2 4:6')!)
    expect(a.x).toBeCloseTo(5 + 0.45)
    expect(a.y).toBeCloseTo(1 + 0.65)
  })

  it('サブ座標が無ければタイルの中心', () => {
    expect(gridToPoint(parseGrid('A1')!)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('T10 9:9 がマップの右上になる', () => {
    const p = gridToPoint(parseGrid('T10 9:9')!)
    expect(p.x).toBeCloseTo(19.95)
    expect(p.y).toBeCloseTo(9.95)
  })

  it('km からグリッドへ戻せる', () => {
    for (const s of ['A1 0:0', 'I6 5:3', 'F2 4:6', 'T10 9:9']) {
      const ref = parseGrid(s)!
      expect(formatGrid(pointToGrid(gridToPoint(ref))!)).toBe(s)
    }
  })

  it('マップ外は座標にならない', () => {
    expect(pointToGrid({ x: -0.1, y: 5 })).toBeNull()
    expect(pointToGrid({ x: 20, y: 5 })).toBeNull()
    expect(pointToGrid({ x: 5, y: 10 })).toBeNull()
    expect(formatPoint({ x: 25, y: 5 })).toBeNull()
  })
})

describe('方位と距離', () => {
  const origin = { x: 10, y: 5 }

  it('北が 0 度、東が 90 度', () => {
    expect(bearingBetween(origin, { x: 10, y: 8 })).toBeCloseTo(0)
    expect(bearingBetween(origin, { x: 13, y: 5 })).toBeCloseTo(90)
    expect(bearingBetween(origin, { x: 10, y: 2 })).toBeCloseTo(180)
    expect(bearingBetween(origin, { x: 7, y: 5 })).toBeCloseTo(270)
  })

  it('斜めも合う', () => {
    expect(bearingBetween(origin, { x: 11, y: 6 })).toBeCloseTo(45)
    expect(bearingBetween(origin, { x: 9, y: 6 })).toBeCloseTo(315)
  })

  it('距離は素直なユークリッド距離', () => {
    expect(distanceBetween(origin, { x: 13, y: 9 })).toBeCloseTo(5)
  })

  it('方位と距離から点を戻せる', () => {
    for (const bearing of [0, 45, 90, 137.5, 180, 273.9, 359.9]) {
      const p = pointFrom(origin, bearing, 4.2)
      expect(bearingBetween(origin, p)).toBeCloseTo(bearing, 6)
      expect(distanceBetween(origin, p)).toBeCloseTo(4.2, 9)
    }
  })
})

describe('名簿の取り込み', () => {
  it('見出しと座標を分けて読む', () => {
    expect(parseRosterLine('Spotter1 - I9 9:1')).toEqual({
      label: 'Spotter1',
      grid: { col: 8, row: 8, subX: 9, subY: 1 },
    })
  })

  it('見出しの中の文字と数字を座標と読み違えない', () => {
    // "Spotte(r1)" が R1 に化けないこと
    expect(parseRosterLine('Spotter1 - I9 9:1')!.grid.col).toBe(8)
    expect(parseRosterLine('Spotter1 I9')!.label).toBe('Spotter1')
    expect(parseRosterLine('Spotter1 I9')!.grid).toEqual({
      col: 8, row: 8, subX: null, subY: null,
    })
  })

  it('区切り記号のゆれを吸収する', () => {
    for (const s of ['Spotter2 - K4 3:7', 'Spotter2 — K4 3:7', 'Spotter2: K4 3:7', 'Spotter2  K4 3:7']) {
      expect(parseRosterLine(s)).toEqual({
        label: 'Spotter2',
        grid: { col: 10, row: 3, subX: 3, subY: 7 },
      })
    }
  })

  it('見出しが無くても読む', () => {
    expect(parseRosterLine('E2 2:4')).toEqual({
      label: '',
      grid: { col: 4, row: 1, subX: 2, subY: 4 },
    })
  })

  it('クリップボードの塊をまとめて読む', () => {
    const { entries, bad } = parseRoster(
      ['Iron Nest - I6 5:3', 'Spotter1 - I9 9:1', 'Spotter2 - K4 3:7', 'Spotter3 - E2 2:4', 'ゴミ行'].join('\n'),
    )
    expect(entries).toHaveLength(4)
    expect(entries.map((e) => e.label)).toEqual(['Iron Nest', 'Spotter1', 'Spotter2', 'Spotter3'])
    expect(formatGrid(entries[0]!.grid)).toBe('I6 5:3')
    expect(bad).toEqual(['ゴミ行'])
  })

  it('自機の行を見分ける', () => {
    expect(isNestLabel('Iron Nest')).toBe(true)
    expect(isNestLabel('IRON NEST')).toBe(true)
    expect(isNestLabel('自機')).toBe(true)
    expect(isNestLabel('Spotter1')).toBe(false)
  })
})
