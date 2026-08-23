/**
 * 砲弾の一覧（game version 1.0 の 20 種）。
 * 出典: Iron Nest Wiki / Ammunition — https://ironnestwiki.com/ammunition
 *
 * 砲弾の種類は射程にも仰角にも影響しない（全種 30 km、弾速も共通）。
 * 効果だけが違うので、このツールでは目標に何を撃つかの記録として持つ。
 */

export type ShellCode =
  | 'AP' | 'APHE' | 'ATMC' | 'CLMN' | 'CYAN'
  | 'DRIL' | 'EQKE' | 'FLCH' | 'HCHE' | 'HE'
  | 'INCN' | 'LE' | 'PLCM' | 'PHGN' | 'PRPG'
  | 'SMK' | 'STAR' | 'TEAR' | 'THRM' | 'WP'

export type ShellCategory =
  | '徹甲' | '実験' | 'クラスター' | '化学' | '支援' | '炸薬' | '焼夷'

export interface Shell {
  code: ShellCode
  /** ゲーム内の英語表記。 */
  name: string
  /** 日本語の短い呼び名。 */
  jp: string
  category: ShellCategory
  /** 損傷値。 */
  damage: number
  /** 効果半径（km）。 */
  radiusKm: number
  /** Requisition Credits での価格。 */
  costRc: number
}

export const SHELLS: readonly Shell[] = [
  { code: 'HE',   name: 'HIGH-EXPLOSIVE',                  jp: '榴弾',           category: '炸薬',       damage: 1, radiusKm: 0.25, costRc: 10 },
  { code: 'HCHE', name: 'HIGH-CAPACITY HIGH-EXPLOSIVE',    jp: '大容量榴弾',     category: '炸薬',       damage: 1, radiusKm: 0.55, costRc: 18 },
  { code: 'LE',   name: 'LOW-GRADE EXPLOSIVE',             jp: '低性能炸薬',     category: '炸薬',       damage: 1, radiusKm: 0.15, costRc: 8 },
  { code: 'FLCH', name: 'FLECHETTE',                       jp: 'フレシェット',   category: '炸薬',       damage: 1, radiusKm: 0.62, costRc: 20 },
  { code: 'AP',   name: 'ARMOR-PIERCING',                  jp: '徹甲',           category: '徹甲',       damage: 2, radiusKm: 0.15, costRc: 10 },
  { code: 'APHE', name: 'ARMOR-PIERCING HIGH-EXPLOSIVE',   jp: '徹甲榴弾',       category: '徹甲',       damage: 2, radiusKm: 0.25, costRc: 15 },
  { code: 'EQKE', name: 'EARTHQUAKE',                      jp: '地中貫通',       category: '徹甲',       damage: 2, radiusKm: 0.55, costRc: 26 },
  { code: 'CLMN', name: 'CLUSTER MUNITION',                jp: 'クラスター',     category: 'クラスター', damage: 1, radiusKm: 0.5,  costRc: 17 },
  { code: 'PLCM', name: 'PARACHUTE CLUSTER MUNITION',      jp: '落下傘クラスター', category: 'クラスター', damage: 1, radiusKm: 0.15, costRc: 15 },
  { code: 'PHGN', name: 'PHOSGENE',                        jp: 'ホスゲン',       category: '化学',       damage: 1, radiusKm: 0.62, costRc: 10 },
  { code: 'CYAN', name: 'CYANOGEN GAS',                    jp: 'シアン化ガス',   category: '化学',       damage: 1, radiusKm: 0.75, costRc: 28 },
  { code: 'WP',   name: 'WHITE PHOSPHORUS',                jp: '白リン',         category: '化学',       damage: 0, radiusKm: 0.75, costRc: 10 },
  { code: 'TEAR', name: 'TEAR GAS',                        jp: '催涙ガス',       category: '化学',       damage: 0, radiusKm: 0.75, costRc: 8 },
  { code: 'INCN', name: 'INCENDIARY',                      jp: '焼夷',           category: '焼夷',       damage: 1, radiusKm: 0.25, costRc: 12 },
  { code: 'THRM', name: 'THERMAL INCENDIARY',              jp: '高熱焼夷',       category: '焼夷',       damage: 1, radiusKm: 0.35, costRc: 22 },
  { code: 'SMK',  name: 'SMOKE',                           jp: '発煙',           category: '支援',       damage: 1, radiusKm: 1.0,  costRc: 2 },
  { code: 'STAR', name: 'ILLUMINATION / STAR',             jp: '照明',           category: '支援',       damage: 0, radiusKm: 0.5,  costRc: 2 },
  { code: 'PRPG', name: 'PROPAGANDA LEAFLET',              jp: '宣伝ビラ',       category: '支援',       damage: 0, radiusKm: 0.5,  costRc: 7 },
  { code: 'DRIL', name: 'DRILL / PRACTICE',                jp: '演習',           category: '支援',       damage: 1, radiusKm: 0.07, costRc: 3 },
  { code: 'ATMC', name: 'ATOMIC',                          jp: '原子',           category: '実験',       damage: 2, radiusKm: 3.0,  costRc: 666 },
]

const BY_CODE = new Map(SHELLS.map((s) => [s.code, s]))

export const DEFAULT_SHELL: ShellCode = 'HE'

export function shellByCode(code: ShellCode): Shell {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_SHELL)!
}

export function isShellCode(value: string): value is ShellCode {
  return BY_CODE.has(value as ShellCode)
}
