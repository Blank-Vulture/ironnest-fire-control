/**
 * 標定の見込み誤差。
 *
 * 三角測量の式そのものは正確でも、入ってくる報告には必ず幅がある。
 * 方位は入れた桁数までしか読めないし、観測元の座標も 100m 四方のマスまでしか
 * 分からない。その幅が位置の誤差にどれだけ化けるかは、観測どうしの交わり方で決まる。
 *
 * 見落としやすいのは観測元の座標のほう。マスの ±50m は方位の ±0.5 度より
 * 小さく見えるが、浅く交わるとどちらも同じ倍率で増幅されるので、
 * 近い観測元ほどこちらが効いてくる。数えないと誤差を実際より小さく見積もる。
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
 * 距離の読み取り幅（km）。桁数が分からないときの既定値。
 * 観測元の座標のぶんはここではなく POSITION_SIGMA_KM で数える。二重に数えない。
 */
export const RANGE_SIGMA_KM = 0.05

/**
 * 観測元の座標の読み取り幅（km）。
 * 報告に載る座標は 100m 四方のマスまでなので、中心を採っても ±50m の幅が残る。
 */
export const POSITION_SIGMA_KM = 0.05

/** その観測の何が効いているか。直す手が変わるので分けて持つ。 */
export type Cause = 'bearing' | 'range' | 'position'

export interface Contribution {
  /** どの観測か。 */
  id: string
  label: string
  /** その観測の幅だけで位置がどれだけ動くか（km）。 */
  shiftKm: number
  /** いちばん効いている幅。 */
  cause: Cause
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
    // 出どころごとに分けて持つ。方位と座標は別々に生じる幅なので、
    // 大きい方だけ採ると小さい方が覆い隠されて誤差を過小に見積もる
    const byCause: Record<Cause, number> = { bearing: 0, range: 0, position: 0 }

    /** 振った結果がその出どころのこれまでの最大より大きければ控える。 */
    const consider = (candidate: Partial<Observation>, from: Cause) => {
      const moved = displacement(shiftedBy(observations, index, candidate), solved)
      if (moved > byCause[from]) byCause[from] = moved
    }

    if (observation.bearingDeg !== null) {
      const sigma = observation.bearingSigmaDeg ?? BEARING_SIGMA_DEG
      // 振る向きで効き方が変わることがあるので、両側を見て大きい方を採る
      consider({ bearingDeg: observation.bearingDeg + sigma }, 'bearing')
      consider({ bearingDeg: observation.bearingDeg - sigma }, 'bearing')
    }

    if (observation.rangeKm !== null) {
      const sigma = observation.rangeSigmaKm ?? RANGE_SIGMA_KM
      consider({ rangeKm: observation.rangeKm + sigma }, 'range')
      consider(
        { rangeKm: Math.max(0.01, observation.rangeKm - sigma) },
        'range',
      )
    }

    // 観測元がマスのどこにいるか分からないぶん。どちらへずれているかは
    // 分からないので、四方に振って最悪の向きを採る
    const positionSigma = observation.positionSigmaKm ?? POSITION_SIGMA_KM
    if (positionSigma > 0) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        consider(
          {
            position: {
              x: observation.position.x + dx * positionSigma,
              y: observation.position.y + dy * positionSigma,
            },
          },
          'position',
        )
      }
    }

    // 互いに独立とみなして二乗和平方根でまとめる
    const shiftKm = Math.hypot(byCause.bearing, byCause.range, byCause.position)
    if (shiftKm > 0) {
      const cause = (Object.keys(byCause) as Cause[]).reduce((worst, key) =>
        byCause[key] > byCause[worst] ? key : worst,
      )
      contributions.push({
        id: observation.id,
        label: observation.label,
        shiftKm,
        cause,
      })
    }
  })

  const radiusKm = Math.sqrt(
    contributions.reduce((sum, c) => sum + c.shiftKm * c.shiftKm, 0),
  )
  contributions.sort((a, b) => b.shiftKm - a.shiftKm)

  return { radiusKm, contributions }
}

/**
 * 見込み誤差と砲弾の効果半径から、当たる見込みを出す。
 *
 * 以前は「誤差が効果半径の半分までなら良し、効果半径までなら五分五分」と
 * 割合で切っていた。切る場所に根拠が無く、付ける名前も実態と合っていなかった。
 * 誤差が効果半径のちょうど半分なら当たる見込みは 95% あるのに「五分五分」と
 * 呼んでいたし、1.35 倍で「外れる公算」と言い切っていたが実際は 54% だった。
 *
 * 見込み誤差はばらつきの 1 標準偏差にあたるので、そこから確率を出して
 * 名前を付ける。切る場所は変わらず割合で決まるが、確率という意味のある量に
 * 結び付くので、「五分五分」が本当に五分五分を指すようになる。
 *
 * 浅い交差では誤差が一方向に細長く伸びるため、いちばん延びる向きの
 * 正規分布として見る。全方向に均した見方より辛く出るので、
 * 撃つ判断としてはこちら側に寄せておく。
 */
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26。小数 7 桁まで合うので、この用途には十分
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return x >= 0 ? y : -y
}

/** 効果半径のなかに目標が入る見込み（0〜1）。 */
export function hitChance(radiusKm: number, effectRadiusKm: number): number {
  if (radiusKm <= 0) return 1
  return erf(effectRadiusKm / (radiusKm * Math.SQRT2))
}

export type Prospect = 'good' | 'fair' | 'marginal' | 'poor'

export function prospect(radiusKm: number, effectRadiusKm: number): Prospect {
  const chance = hitChance(radiusKm, effectRadiusKm)
  if (chance >= 0.9) return 'good'
  if (chance >= 0.6) return 'fair'
  if (chance >= 0.35) return 'marginal'
  return 'poor'
}
