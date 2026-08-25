/**
 * 次に何をすべきかの見立て。
 *
 * 標定の精度が足りないとき、選べる手はいくつかある。観測をもう 1 つ足す、
 * 照明弾で照らして偵察兵に見てもらう、偵察飛行の写真を撮る、そのまま撃つ。
 * どれが効くかは、誤差の大きさと、その誤差がどこから来ているかで変わる。
 *
 * 照明弾は着弾点のまわりを照らし、偵察飛行は撃った砲弾の着弾点のまわりに
 * 写真を置く。どちらも「どこへ撃つか」を決める必要があるので、その座標まで出す。
 */

import { formatPoint, type Point } from './grid'
import { shellByCode, type ShellCode } from './shells'
import { type Accuracy, type Cause, hitChance, prospect } from './accuracy'
import type { Observation } from './triangulate'
import { bearingBetween } from './grid'

export type AdviceKind = 'ready' | 'observe' | 'star' | 'recon' | 'decide'

export interface Advice {
  kind: AdviceKind
  headline: string
  detail: string
  /** 撃つ・照らす座標。決まるときだけ入る。 */
  atGrid?: string
}

/**
 * どの方角から見てもらえば誤差がいちばん減るか。
 *
 * いまの視線に対して直角に近いほど、同じ報告の幅でも位置の誤差が小さくなる。
 * 目標から見てその方角に観測点があれば効く。1 度刻みで一番いい向きを探す。
 */
export function bestViewingBearing(
  observations: readonly Observation[],
  target: Point,
): number | null {
  const lines = observations
    .filter((o) => o.bearingDeg !== null || o.rangeKm !== null)
    .map((o) => bearingBetween(o.position, target))
  if (lines.length === 0) return null

  let best = 0
  let bestScore = -1
  for (let candidate = 0; candidate < 180; candidate++) {
    // いちばん条件の悪い視線との交わり方が、その向きの実力になる
    const score = Math.min(
      ...lines.map((line) => Math.abs(Math.sin(((candidate - line) * Math.PI) / 180))),
    )
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  // 目標から見て観測点がいる向き。反対側でも同じことなので手前側を返す
  return best
}

export interface AdviceInput {
  position: Point
  /** もう一方の候補。決まっていなければ null。 */
  alternative: Point | null
  accuracy: Accuracy
  observations: readonly Observation[]
  shell: ShellCode
}

/**
 * 見立てを組み立てる。効く順に並べる。
 */
/** 誤差の出どころ。手の打ちようが違うので言い分ける。 */
function causeLabel(cause: Cause): string {
  if (cause === 'bearing') return '方位'
  if (cause === 'range') return '距離'
  return '座標'
}

/**
 * 座標は 100m マスまでしか読めないので、報告を丁寧にしても縮まない。
 * 打つ手が「角度の良い観測を足す」しかないことを言っておく。
 */
function causeNote(cause: Cause): string {
  return cause === 'position'
    ? '。座標は 100m マスまでしか読めないので、報告を丁寧にしても縮みません'
    : ''
}

export function adviseFix(input: AdviceInput): Advice[] {
  const { position, alternative, accuracy, observations, shell } = input
  const advice: Advice[] = []
  const effectRadiusKm = shellByCode(shell).radiusKm
  const starRadiusKm = shellByCode('STAR').radiusKm
  const metres = (km: number) => `${(km * 1000).toFixed(0)} m`

  // 候補が 2 つ残っているうちは、精度の話より先にどちらかを決める
  if (alternative !== null) {
    const apart = Math.hypot(alternative.x - position.x, alternative.y - position.y)
    advice.push({
      kind: 'decide',
      headline: '候補を 1 つに絞る',
      detail:
        apart > starRadiusKm * 2
          ? `候補が ${metres(apart)} 離れていて、照明弾 1 発では両方を照らせません。` +
            'どちらかへ撃って当たりで確かめるか、観測をもう 1 つ足してください'
          : `候補が ${metres(apart)} しか離れていないので、間を照らせば両方を確かめられます`,
      atGrid:
        apart > starRadiusKm * 2
          ? (formatPoint(position) ?? undefined)
          : (formatPoint({
              x: (position.x + alternative.x) / 2,
              y: (position.y + alternative.y) / 2,
            }) ?? undefined),
    })
  }

  const outlook = prospect(accuracy.radiusKm, effectRadiusKm)


  // 確率は目安なので 5% 刻みに丸める。1 の位まで出すと、
  // 見積もりの粗さに見合わない細かさに見える
  const chance = `${Math.round(hitChance(accuracy.radiusKm, effectRadiusKm) * 20) * 5}%`
  const versus =
    `見込み誤差 ±${metres(accuracy.radiusKm)} に対して ` +
    `${shell} の効果半径は ${metres(effectRadiusKm)}`

  if (alternative === null && outlook === 'good') {
    advice.push({
      kind: 'ready',
      headline: `撃てる見込み（命中 およそ ${chance}）`,
      detail: versus,
    })
    return advice
  }

  // 誤差の出どころを名指しして、どの方角から見れば効くかまで出す
  const worst = accuracy.contributions[0]
  const viewing = bestViewingBearing(observations, position)
  if (viewing !== null) {
    advice.push({
      kind: 'observe',
      headline: `方位 ${viewing.toFixed(0)}° / ${((viewing + 180) % 360).toFixed(0)}° の線上から観測を足す`,
      detail:
        `いまの視線に対して直角に近いので、同じ報告でも誤差がいちばん縮みます。` +
        (worst !== undefined
          ? `いま効いているのは ${worst.label} の${causeLabel(worst.cause)}` +
            `（±${metres(worst.shiftKm)}）です${causeNote(worst.cause)}`
          : ''),
    })
  }

  /*
   * 照らすか飛ばすかは、候補が 1 つに決まってから。
   *
   * 候補が 2 つ残っているときは、上の「候補を 1 つに絞る」がもう照らす場所まで
   * 出している。ここで別の座標を指してもう一度照らす話をすると、同じ画面に
   * 「間を照らせば両方を確かめられます」と「照らしきれません」が並ぶ。
   * 見る側には矛盾としか読めない。
   *
   * 精度の見立て（この先）は候補が割れていても出す。矛盾はしないし、
   * どちらを選ぶにせよ知っておきたい話なので。
   */
  if (alternative === null) {
    // 照明弾は着弾点のまわりを照らす。誤差がその範囲に収まるなら 1 発で足りる
    if (accuracy.radiusKm <= starRadiusKm) {
      advice.push({
        kind: 'star',
        headline: '照明弾で照らす',
        detail:
          `見込み誤差 ±${metres(accuracy.radiusKm)} は照明弾の範囲 ${metres(starRadiusKm)} に ` +
          '収まるので、1 発で目標を照らせます。偵察兵から新しい報告をもらってください',
        atGrid: formatPoint(position) ?? undefined,
      })
    } else {
      advice.push({
        kind: 'recon',
        headline: '偵察飛行で写真を撮る',
        detail:
          `見込み誤差 ±${metres(accuracy.radiusKm)} は照明弾の範囲 ${metres(starRadiusKm)} を ` +
          '超えるので、照らしきれません。ここへ 1 発撃って、その着弾点まわりの写真を撮ってください',
        atGrid: formatPoint(position) ?? undefined,
      })
    }
  }

  if (outlook === 'poor') {
    advice.push({
      kind: 'observe',
      headline: `このまま撃つと外れる公算（命中 およそ ${chance}）`,
      detail: versus,
    })
  } else if (outlook === 'marginal') {
    advice.push({
      kind: 'observe',
      headline: `当たるかどうかは五分五分（命中 およそ ${chance}）`,
      detail: `${versus}。外れても不思議ではありません`,
    })
  } else if (outlook === 'fair') {
    advice.push({
      kind: 'observe',
      headline: `当たる公算はあるが確実ではない（命中 およそ ${chance}）`,
      detail: versus,
    })
  }

  return advice
}
