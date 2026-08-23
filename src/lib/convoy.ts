/**
 * 補給隊への位置報告要請。
 *
 * 緊急移動で跳ぶと自機の座標が分からなくなる。跳ぶ先は発動した地点を中心に
 * ばらけるだけで、いきなり遠方へ飛ぶことはない。つまり移動前の位置が
 * 「だいたいこのあたり」という当てになる。
 *
 * 位置報告の要請では A1 や I2 くらいの大まかな座標しか指定できないので、
 * どのタイルに要請を出すかをこちらで決めてしまう。狙いは 2 隊からの視線が
 * 直角に近く交わること。浅い角度で交わると、報告のわずかなぶれが
 * 位置の大きな誤差になる。
 */

import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  gridToPoint,
  pointFrom,
  pointToGrid,
  type GridRef,
  type Point,
} from './grid'

/**
 * 要請を出す距離（km）。近すぎると報告のぶれに弱く、遠すぎると盤外に出る。
 * 望ましい距離から順に試して、盤面に収まった時点で確定する。
 */
const DISTANCES_KM = [5, 4, 3, 2] as const

/** 2 隊の視線が直角に交わるよう、要請先どうしを 90 度離す。 */
const SEPARATION_DEG = 90

export interface ConvoyPlan {
  /** 要請を出すタイル。サブ座標は持たない（大まかにしか指定できないため）。 */
  tiles: [GridRef, GridRef]
  /** 実際に取れた離れ具合（km）。 */
  distanceKm: number
}

/** 盤面の縁からの余裕（km）。負なら盤外。 */
function margin(point: Point): number {
  return Math.min(point.x, point.y, MAP_WIDTH_KM - point.x, MAP_HEIGHT_KM - point.y)
}

/** タイルの中心に丸める。要請では A1 のようなタイル単位しか指定できない。 */
function toTile(point: Point): GridRef | null {
  const ref = pointToGrid(point)
  return ref === null ? null : { ...ref, subX: null, subY: null }
}

/**
 * 移動前の位置を手がかりに、2 隊をどのタイルへ呼ぶか決める。
 *
 * 中心のまわりを一周ぶん試して、2 隊とも盤面の内側にいちばん余裕をもって
 * 収まる向きを選ぶ。角に寄っていて 5km では収まらないときは距離を詰める。
 */
export function planConvoyRequest(lastKnown: Point): ConvoyPlan | null {
  for (const distanceKm of DISTANCES_KM) {
    let best: { plan: ConvoyPlan; score: number } | null = null

    for (let rotation = 0; rotation < 360; rotation += 5) {
      const a = pointFrom(lastKnown, rotation, distanceKm)
      const b = pointFrom(lastKnown, rotation + SEPARATION_DEG, distanceKm)
      // 2 隊のうち条件の悪い方が、その向きの実力になる
      const score = Math.min(margin(a), margin(b))
      if (score <= 0) continue

      const tileA = toTile(a)
      const tileB = toTile(b)
      if (tileA === null || tileB === null) continue
      // 同じタイルに 2 隊呼んでも意味がない
      if (tileA.col === tileB.col && tileA.row === tileB.row) continue

      if (best === null || score > best.score) {
        best = { plan: { tiles: [tileA, tileB], distanceKm }, score }
      }
    }

    // この距離で収まったなら、これ以上詰める必要はない
    if (best !== null) return best.plan
  }

  return null
}

/** 要請先のタイルの中心。地図に置くときの位置になる。 */
export function tileCenter(ref: GridRef): Point {
  return gridToPoint(ref)
}
