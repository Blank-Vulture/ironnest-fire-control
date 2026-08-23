/**
 * 弾道。すべてゲーム内の弾道計算機と同じ式で、近似は使っていない。
 *
 * 出典: Iron Nest Wiki / Ballistics Calculator（game version 1.0 検証済み）
 *   https://ironnestwiki.com/calculator
 *
 * 仰角:
 *   装薬 N の最大射程は 5N km。0 km を 0°、最大射程を 60° として線形に写す。
 *   これを解くと 仰角 = 距離 × 12 ÷ 装薬数 になり、ゲーム内で提示される
 *   手計算の式と一致する。最低仰角の制限は無い。
 *
 * 飛翔時間:
 *   弾速は砲弾の種類によらず基本 0.7 km/秒。装薬が smoothstep で倍率を掛ける。
 *     u = (装薬数 − 1) ÷ 5
 *     弾速 = 0.7 × [0.3 + 0.7 × (3u² − 2u³)]
 *     飛翔時間 = 距離 ÷ 弾速
 *   発射レバーを引いてから砲弾が出るまでのわずかな間は含まれない。
 */

export const CHARGES = [1, 2, 3, 4, 5, 6] as const
export type Charge = (typeof CHARGES)[number]

/** 装薬 1 段あたりの射程（km）。 */
export const RANGE_PER_CHARGE_KM = 5

/** 装薬 6 での最大射程（km）。 */
export const MAX_RANGE_KM = RANGE_PER_CHARGE_KM * 6

/** 最大射程で到達する仰角（度）。 */
export const MAX_ELEVATION_DEG = 60

/** 砲弾の基本速度（km/秒）。砲弾の種類によらず一定。 */
export const BASE_SHELL_SPEED_KM_S = 0.7

export function isCharge(value: number): value is Charge {
  return Number.isInteger(value) && value >= 1 && value <= 6
}

/** その装薬で届く最大距離（km）。 */
export function maxRangeKm(charge: Charge): number {
  return charge * RANGE_PER_CHARGE_KM
}

/**
 * その距離に届く最小の装薬数。距離が 0 以下、または 30 km を超えるなら null。
 * ゲーム内の計算機も「届く最小の装薬」を既定で選ぶ。
 */
export function requiredCharge(distanceKm: number): Charge | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > MAX_RANGE_KM) return null
  const charge = Math.ceil(distanceKm / RANGE_PER_CHARGE_KM)
  return isCharge(charge) ? charge : null
}

/** その装薬でその距離に届くか。 */
export function canReach(distanceKm: number, charge: Charge): boolean {
  return distanceKm > 0 && distanceKm <= maxRangeKm(charge)
}

/** 必要な仰角（度）。届かない組み合わせなら null。 */
export function elevationDeg(distanceKm: number, charge: Charge): number | null {
  if (!canReach(distanceKm, charge)) return null
  return (distanceKm * 12) / charge
}

/**
 * 装薬による弾速（km/秒）。装薬 1 で 0.21、装薬 6 で 0.7。
 * 間は smoothstep（3u² − 2u³）でつながる。
 */
export function shellSpeedKmPerSec(charge: Charge): number {
  const u = (charge - 1) / 5
  const smooth = 3 * u * u - 2 * u * u * u
  return BASE_SHELL_SPEED_KM_S * (0.3 + 0.7 * smooth)
}

/** 飛翔時間（秒）。届かない組み合わせなら null。 */
export function flightSeconds(distanceKm: number, charge: Charge): number | null {
  if (!canReach(distanceKm, charge)) return null
  return distanceKm / shellSpeedKmPerSec(charge)
}

/**
 * 方位の差。時計回りを正として (-180, 180] に収める。
 * 砲塔の旋回はどちら回りにも行けるので、常に短い方を返す。
 */
export function bearingDelta(from: number, to: number): number {
  const diff = ((((to - from) % 360) + 360) % 360)
  return diff > 180 ? diff - 360 : diff
}

/** 方位を 0 以上 360 未満に収める。 */
export function wrapBearing(deg: number): number {
  const x = deg % 360
  return x < 0 ? x + 360 : x
}
