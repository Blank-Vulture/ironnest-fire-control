/**
 * 戦術地図のグリッド。
 *
 * 出典: Iron Nest Wiki / Map Measurements — https://ironnestwiki.com/wiki/map-measurements
 *
 *   タイルは A1 から T10。1 タイルは 1km 四方で、さらに 10×10 に分かれた
 *   0:0 から 9:9 のマスを持つ。小さいマスは 100m 四方。
 *   「F2 4:6」はタイル F2 の中のマス 4:6 を指す。
 *
 * 向きは A1 が左下、T10 が右上。列 A→T が西→東、行 1→10 が南→北で、
 * サブ座標も 0→9 が左→右・下→上。画面の上下と数字の向きが逆にならない、
 * 素直な直交座標になっている。
 *
 * 位置はマップ南西端を原点とする km で持つ。x が東、y が北。
 */

export const COLUMNS = 20 // A..T
export const ROWS = 10 // 1..10
export const TILE_KM = 1
export const SUB_PER_TILE = 10
export const SUB_KM = TILE_KM / SUB_PER_TILE

export const MAP_WIDTH_KM = COLUMNS * TILE_KM
export const MAP_HEIGHT_KM = ROWS * TILE_KM

export interface GridRef {
  /** 列。A を 0 とする。 */
  col: number
  /** 行。1 を 0 とする。 */
  row: number
  /** タイル内の東向き 0..9。省略なら null。 */
  subX: number | null
  /** タイル内の北向き 0..9。省略なら null。 */
  subY: number | null
}

export interface Point {
  /** 東向き km。マップ西端が 0。 */
  x: number
  /** 北向き km。マップ南端が 0。 */
  y: number
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRST'

function normalize(input: string): string {
  return input
    .replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/　/g, ' ')
    .toUpperCase()
    .trim()
}

/**
 * 「I6 5:3」のような座標を読む。サブ座標は省略できる。
 * 区切りはコロン・セミコロン・空白・ハイフンのどれでもよい。
 */
export function parseGrid(input: string): GridRef | null {
  const s = normalize(input)
  const m = /^([A-T])\s*(\d{1,2})(?:\s*[:;\-\s]\s*(\d)\s*[:;\-\s]?\s*(\d))?$/.exec(s)
  if (!m) return null

  const col = LETTERS.indexOf(m[1]!)
  const row = Number(m[2]) - 1
  if (col < 0 || row < 0 || row >= ROWS) return null

  const subX = m[3] !== undefined ? Number(m[3]) : null
  const subY = m[4] !== undefined ? Number(m[4]) : null
  return { col, row, subX, subY }
}

/**
 * グリッドの指す点を km に直す。
 * サブ座標があればそのマスの中心、無ければタイルの中心を返す。
 * 100m マスの中心を取るので、もともと ±50m の幅を持つ。
 */
export function gridToPoint(ref: GridRef): Point {
  const offset = (sub: number | null) =>
    sub === null ? TILE_KM / 2 : sub * SUB_KM + SUB_KM / 2
  return {
    x: ref.col * TILE_KM + offset(ref.subX),
    y: ref.row * TILE_KM + offset(ref.subY),
  }
}

/** km の点をグリッドに直す。マップ外なら null。 */
export function pointToGrid(point: Point): GridRef | null {
  if (point.x < 0 || point.x >= MAP_WIDTH_KM) return null
  if (point.y < 0 || point.y >= MAP_HEIGHT_KM) return null

  const col = Math.floor(point.x / TILE_KM)
  const row = Math.floor(point.y / TILE_KM)
  return {
    col,
    row,
    subX: Math.min(9, Math.floor(((point.x - col * TILE_KM) / TILE_KM) * SUB_PER_TILE)),
    subY: Math.min(9, Math.floor(((point.y - row * TILE_KM) / TILE_KM) * SUB_PER_TILE)),
  }
}

/** 「I6 5:3」の形に整える。 */
export function formatGrid(ref: GridRef): string {
  const tile = `${LETTERS[ref.col] ?? '?'}${ref.row + 1}`
  return ref.subX === null || ref.subY === null ? tile : `${tile} ${ref.subX}:${ref.subY}`
}

/** 点をそのまま「I6 5:3」に。マップ外なら null。 */
export function formatPoint(point: Point): string | null {
  const ref = pointToGrid(point)
  return ref === null ? null : formatGrid(ref)
}

/* ---------- 方位と距離 ---------- */

/**
 * from から to への方位（度）。北が 0 で時計回り。
 * 画面の x が東、y が北なので atan2(東, 北) がそのまま方位になる。
 */
export function bearingBetween(from: Point, to: Point): number {
  const deg = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI
  return (deg % 360 + 360) % 360
}

/** from から to への距離（km）。 */
export function distanceBetween(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** 方位と距離から点を求める。 */
export function pointFrom(origin: Point, bearingDeg: number, rangeKm: number): Point {
  const rad = (bearingDeg * Math.PI) / 180
  return {
    x: origin.x + rangeKm * Math.sin(rad),
    y: origin.y + rangeKm * Math.cos(rad),
  }
}

/* ---------- 名簿の取り込み ---------- */

export interface RosterEntry {
  /** 「Spotter1」のような見出し。無ければ空。 */
  label: string
  grid: GridRef
}

/**
 * 「Spotter1 - I9 9:1」のような行から見出しと座標を取り出す。
 *
 * 行の頭から座標らしきものを探すと、"Spotte(r1)" のように見出しの中の
 * 文字と数字を座標と読み違える。座標は必ず行末にあるので、末尾から
 * 語をひとつずつ伸ばして、いちばん長く読めたところを座標とする。
 */
export function parseRosterLine(line: string): RosterEntry | null {
  const tokens = line.trim().split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return null

  for (let take = Math.min(4, tokens.length); take >= 1; take--) {
    const grid = parseGrid(tokens.slice(tokens.length - take).join(' '))
    if (grid === null) continue
    const label = tokens
      .slice(0, tokens.length - take)
      .join(' ')
      .replace(/[\s\-–—:：]+$/, '')
      .trim()
    return { label, grid }
  }
  return null
}

/** 名簿をまとめて読む。読めた行と読めなかった行を分けて返す。 */
export function parseRoster(text: string): { entries: RosterEntry[]; bad: string[] } {
  const entries: RosterEntry[] = []
  const bad: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const entry = parseRosterLine(raw)
    if (entry) entries.push(entry)
    else bad.push(raw.trim())
  }
  return { entries, bad }
}

/** 砲座自身の行か。名簿には自機の位置も混ざってくる。 */
export function isNestLabel(label: string): boolean {
  return /iron\s*nest|ironnest|自機|本機|砲座/i.test(label)
}
