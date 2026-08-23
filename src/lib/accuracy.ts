/**
 * 標定の見込み誤差。
 *
 * 三角測量の式そのものは正確でも、入ってくる報告には必ず幅がある。
 * 方位は度単位までしか読めないし、座標は 100m 四方のマスまでしか分からない。
 * その幅が位置の誤差にどれだけ化けるかは、観測どうしの交わり方で決まる。
 *
 * 直角に近く交われば幅はそのまま残るだけだが、浅く交わると跳ね上がる。
 * 交差角 15 度なら、方位が 0.5 度ずれただけで数百 m 動くことがある。
 * 「同じ手順で撃っているのに当たったり外れたりする」のはこれが理由になる。
 *
 * 解き方の癖に引きずられないよう、式で近似せず、報告を実際に振ってみて
 * 答えがどれだけ動くかで測る。
 */

import { distanceBetween, type Point } from './grid'
import { triangulate, type Observation } from './triangulate'

/**
 * 方位の読み取り幅（度）。
 * 指示書に載る方位は度単位までなので、丸めだけで ±0.5 度の幅がある。
 */
export const BEARING_SIGMA_DEG = 0.5

/**
 * 距離の読み取り幅（km）。
 * 観測元の座標が 100m 四方のマスまでしか分からないぶんを見込む。
 */
export const RANGE_SIGMA_KM = 0.05

export interface Contribution {
  /** どの観測か。 */
  id: string
  label: string
  /** その観測の幅だけで位置がどれだけ動くか（km）。 */
  shiftKm: number
}

export interface Accuracy {
  /** 位置の見込み誤差（km）。各観測のぶんを二乗和平方根でまとめたもの。 */
  radiusKm: number
  /** 効き方の大きい順。先頭を直すのがいちばん効く。 */
  contributions: Contribution[]
}

function shiftedBy(
  observations: readonly Observation[],
  index: number,
  change: Partial<Observation>,
): Observation[] {
  return observations.map((o, i) => (i === index ? { ...o, ...change } : o))
}

/** 振った報告で解き直して、答えがどれだけ動いたかを測る。 */
function displacement(
  observations: readonly Observation[],
  from: Point,
): number {
  const result = triangulate(observations)
  return result.kind === 'solved' ? distanceBetween(from, result.estimate.position) : 0
}

/**
 * 報告の幅が位置の誤差にどれだけ化けるかを測る。
 *
 * 観測をひとつずつ幅のぶんだけ振って、答えの動きを見る。振れ幅は互いに
 * 独立とみなして二乗和平方根でまとめる。
 */
export function estimateAccuracy(
  observations: readonly Observation[],
  solved: Point,
): Accuracy {
  const contributions: Contribution[] = []

  observations.forEach((observation, index) => {
    let shiftKm = 0

    if (observation.bearingDeg !== null) {
      // 振る向きで効き方が変わることがあるので、大きい方を採る
      const plus = displacement(
        shiftedBy(observations, index, {
          bearingDeg: observation.bearingDeg + BEARING_SIGMA_DEG,
        }),
        solved,
      )
      const minus = displacement(
        shiftedBy(observations, index, {
          bearingDeg: observation.bearingDeg - BEARING_SIGMA_DEG,
        }),
        solved,
      )
      shiftKm = Math.max(shiftKm, plus, minus)
    }

    if (observation.rangeKm !== null) {
      const plus = displacement(
        shiftedBy(observations, index, { rangeKm: observation.rangeKm + RANGE_SIGMA_KM }),
        solved,
      )
      const minus = displacement(
        shiftedBy(observations, index, {
          rangeKm: Math.max(0.01, observation.rangeKm - RANGE_SIGMA_KM),
        }),
        solved,
      )
      shiftKm = Math.max(shiftKm, plus, minus)
    }

    if (shiftKm > 0) {
      contributions.push({ id: observation.id, label: observation.label, shiftKm })
    }
  })

  const radiusKm = Math.sqrt(
    contributions.reduce((sum, c) => sum + c.shiftKm * c.shiftKm, 0),
  )
  contributions.sort((a, b) => b.shiftKm - a.shiftKm)

  return { radiusKm, contributions }
}

/**
 * 見込み誤差と砲弾の効果半径を突き合わせた見立て。
 *
 * 誤差が効果半径と同じくらいあると、当たるかどうかは五分五分になる。
 * 「収まっているから大丈夫」と言えるのは、効果半径の半分までに
 * 収まっているとき。そこを超えたら際どい、超え切ったら外れる公算とする。
 */
export type Prospect = 'good' | 'marginal' | 'poor'

export function prospect(radiusKm: number, effectRadiusKm: number): Prospect {
  if (radiusKm <= effectRadiusKm * 0.5) return 'good'
  if (radiusKm <= effectRadiusKm) return 'marginal'
  return 'poor'
}
