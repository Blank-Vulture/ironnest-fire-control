/**
 * 時刻・時間の解析と整形。
 *
 * このアプリは「日付」を持たない。ゲームから与えられるのは 10:10:10 のような
 * 時刻だけなので、内部表現は一貫して「その日の 0:00:00 からの経過秒」
 * （seconds of day, 略して sod, 0 <= sod < 86400、小数あり）とする。
 */

export const SECONDS_PER_DAY = 86_400

/** 全角数字・全角コロン・和文記号を半角に寄せる。日本語入力のまま貼れるように。 */
function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/．/g, '.')
    .replace(/　/g, ' ')
    .trim()
}

/**
 * 打った数字にコロンを差し込んで見せる。101010 → 10:10:10。
 * 途中まででも崩れないので、打ちながら形が育っていく。
 */
export function formatTimeDigits(digits: string): string {
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`
}

/** 入力から時刻として使う数字だけを取り出す（最大 6 桁）。 */
export function toTimeDigits(input: string): string {
  return input.replace(/[^\d]/g, '').slice(0, 6)
}

/**
 * 着弾時刻の解析。受け付ける形:
 *   "10:10:10" / "10:10" / "101010" / "1010" / "10.10.10" / "10-10-10" / "10 10 10"
 * 返り値は sod。解析不能・範囲外なら null。
 */
export function parseTimeOfDay(input: string): number | null {
  const s = normalize(input).replace(/[\-./\s;]/g, ':')
  if (s === '') return null

  let parts: string[]
  if (s.includes(':')) {
    parts = s.split(':').filter((p) => p !== '')
  } else if (/^\d{6}$/.test(s)) {
    parts = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)]
  } else if (/^\d{4}$/.test(s)) {
    parts = [s.slice(0, 2), s.slice(2, 4)]
  } else {
    return null
  }

  if (parts.length < 2 || parts.length > 3) return null
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null

  const h = Number(parts[0])
  const m = Number(parts[1])
  const sec = parts.length === 3 ? Number(parts[2]) : 0
  if (h > 23 || m > 59 || sec > 59) return null

  return h * 3600 + m * 60 + sec
}

/**
 * 飛翔時間（着弾までにかかる時間）の解析。ゲームUIの表記ゆれを吸収する。
 * 受け付ける形:
 *   "45" / "45.5" / "45s" / "45秒"        → 秒として解釈
 *   "1:23" / "1:23.4"                     → 分:秒
 *   "0:01:23"                             → 時:分:秒
 *   "1m23s" / "1分23秒"                   → 分と秒
 * 返り値は秒（小数可）。解析不能・負・1日以上なら null。
 */
export function parseDuration(input: string): number | null {
  const s = normalize(input)
  if (s === '') return null

  let seconds: number | null = null

  if (s.includes(':')) {
    const parts = s.split(':')
    if (parts.length < 2 || parts.length > 3) return null
    if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null
    const nums = parts.map(Number)
    // 先頭以外は 60 未満でなければ表記として不正
    if (nums.slice(1).some((n) => n >= 60)) return null
    seconds =
      nums.length === 3
        ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]!
        : nums[0]! * 60 + nums[1]!
  } else {
    const hms = /^(?:(\d+(?:\.\d+)?)\s*(?:h|時間|時))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|分))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|秒)?)?$/.exec(s)
    if (!hms || (hms[1] === undefined && hms[2] === undefined && hms[3] === undefined)) return null
    seconds = Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0)
  }

  if (seconds === null || !Number.isFinite(seconds)) return null
  if (seconds < 0 || seconds >= SECONDS_PER_DAY) return null
  return seconds
}

/** sod を 0 <= x < 86400 に丸め込む（負の値・24時間超えを日跨ぎとして扱う）。 */
export function wrapSod(sod: number): number {
  const x = sod % SECONDS_PER_DAY
  return x < 0 ? x + SECONDS_PER_DAY : x
}

/**
 * 逆算の本体。着弾時刻から飛翔時間を引いて発射時刻を出す。
 * 引いた結果が前日に回り込む場合も wrap して返す。
 */
export function launchSod(impactSod: number, flightSeconds: number): number {
  return wrapSod(impactSod - flightSeconds)
}

/** 発射が着弾の前日にずれ込むか（0時をまたぐか）。 */
export function crossesMidnight(impactSod: number, flightSeconds: number): boolean {
  return impactSod - flightSeconds < 0
}

/**
 * sod を "HH:MM:SS" に整形。decimals を与えると秒に小数を付ける。
 *
 * 端数は切り捨てではなく四捨五入する。ゲーム内時計は秒単位でしか読めないので、
 * 近い方の秒に寄せた方が着弾のずれが小さくなる。
 * 先に丸めてから桁に分けることで 23:59:59.6 → 00:00:00 の繰り上がりも通る。
 */
export function formatTimeOfDay(sod: number, decimals = 0): string {
  const factor = 10 ** decimals
  const x = wrapSod(Math.round(wrapSod(sod) * factor) / factor)
  const h = Math.floor(x / 3600)
  const m = Math.floor((x % 3600) / 60)
  const s = x % 60
  const ss =
    decimals > 0
      ? s.toFixed(decimals).padStart(3 + decimals, '0')
      : Math.round(s).toString().padStart(2, '0')
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`
}

/**
 * 飛翔時間の表示。1 分未満は秒だけ、それ以上は分と秒に分ける。
 * 0.1 秒まで出すのは、装薬を変えたときの差が数十分の一秒で効くため。
 */
export function formatFlight(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}分${s.toFixed(1)}s`
}
