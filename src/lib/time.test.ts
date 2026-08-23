import { describe, expect, it } from 'vitest'
import {
  crossesMidnight,
  formatFlight,
  formatTimeOfDay,
  launchSod,
  parseDuration,
  parseTimeOfDay,
  wrapSod,
} from './time'

describe('parseTimeOfDay', () => {
  it('基本の HH:MM:SS を読む', () => {
    expect(parseTimeOfDay('10:10:10')).toBe(10 * 3600 + 10 * 60 + 10)
  })
  it('秒を省いたら 0 秒とみなす', () => {
    expect(parseTimeOfDay('10:10')).toBe(10 * 3600 + 10 * 60)
  })
  it('区切りなしの 6 桁・4 桁を読む', () => {
    expect(parseTimeOfDay('101010')).toBe(36610)
    expect(parseTimeOfDay('1010')).toBe(36600)
  })
  it('区切りのゆれを吸収する', () => {
    for (const s of ['10.10.10', '10-10-10', '10 10 10', '１０：１０：１０']) {
      expect(parseTimeOfDay(s)).toBe(36610)
    }
  })
  it('1 桁でも読む', () => {
    expect(parseTimeOfDay('9:5:3')).toBe(9 * 3600 + 5 * 60 + 3)
  })
  it('日付境界', () => {
    expect(parseTimeOfDay('00:00:00')).toBe(0)
    expect(parseTimeOfDay('23:59:59')).toBe(86399)
  })
  it('範囲外・不正は null', () => {
    for (const s of ['24:00:00', '10:60:00', '10:10:60', '', 'abc', '10', '10:10:10:10', '1:2:3:4']) {
      expect(parseTimeOfDay(s)).toBeNull()
    }
  })
})

describe('parseDuration', () => {
  it('裸の数値は秒', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('45.5')).toBe(45.5)
  })
  it('単位付きを読む', () => {
    expect(parseDuration('45s')).toBe(45)
    expect(parseDuration('45秒')).toBe(45)
    expect(parseDuration('1m23s')).toBe(83)
    expect(parseDuration('1分23秒')).toBe(83)
  })
  it('コロン表記を読む', () => {
    expect(parseDuration('1:23')).toBe(83)
    expect(parseDuration('1:23.4')).toBeCloseTo(83.4)
    expect(parseDuration('0:01:23')).toBe(83)
  })
  it('全角数字を読む', () => {
    expect(parseDuration('４５')).toBe(45)
  })
  it('0 は有効', () => {
    expect(parseDuration('0')).toBe(0)
  })
  it('不正は null', () => {
    for (const s of ['', 'abc', '-5', '1:70', '86400', '1:2:3:4']) {
      expect(parseDuration(s)).toBeNull()
    }
  })
})

describe('launchSod', () => {
  it('着弾時刻から飛翔時間を引く', () => {
    const impact = parseTimeOfDay('10:10:10')!
    expect(formatTimeOfDay(launchSod(impact, 45))).toBe('10:09:25')
  })
  it('分・時をまたいで正しく借りる', () => {
    expect(formatTimeOfDay(launchSod(parseTimeOfDay('10:00:05')!, 10))).toBe('09:59:55')
    expect(formatTimeOfDay(launchSod(parseTimeOfDay('10:00:00')!, 3600))).toBe('09:00:00')
  })
  it('0 時をまたぐと前日に回り込む', () => {
    const impact = parseTimeOfDay('00:00:30')!
    expect(formatTimeOfDay(launchSod(impact, 60))).toBe('23:59:30')
    expect(crossesMidnight(impact, 60)).toBe(true)
    expect(crossesMidnight(impact, 10)).toBe(false)
  })
  it('小数の飛翔時間を保つ', () => {
    expect(formatTimeOfDay(launchSod(parseTimeOfDay('10:00:00')!, 12.5), 1)).toBe('09:59:47.5')
  })
})

describe('formatTimeOfDay', () => {
  it('ゼロ埋めする', () => {
    expect(formatTimeOfDay(0)).toBe('00:00:00')
    expect(formatTimeOfDay(3661)).toBe('01:01:01')
  })
  it('小数桁を付けられる', () => {
    expect(formatTimeOfDay(3661.25, 2)).toBe('01:01:01.25')
  })
  it('端数は四捨五入する', () => {
    expect(formatTimeOfDay(3661.4)).toBe('01:01:01')
    expect(formatTimeOfDay(3661.6)).toBe('01:01:02')
  })
  it('繰り上がりで分・時・日を越えても壊れない', () => {
    expect(formatTimeOfDay(59.6)).toBe('00:01:00')
    expect(formatTimeOfDay(3599.6)).toBe('01:00:00')
    expect(formatTimeOfDay(86399.6)).toBe('00:00:00')
    expect(formatTimeOfDay(59.96, 1)).toBe('00:01:00.0')
  })
})

describe('formatFlight', () => {
  it('1 分未満は秒だけを 0.1 秒まで', () => {
    expect(formatFlight(23.606)).toBe('23.6s')
    expect(formatFlight(0)).toBe('0.0s')
  })
  it('1 分以上は分と秒に分ける', () => {
    expect(formatFlight(83.25)).toBe('1分23.3s')
  })
})

describe('wrapSod', () => {
  it('負も 24 時間超も畳む', () => {
    expect(wrapSod(-1)).toBe(86399)
    expect(wrapSod(86400)).toBe(0)
    expect(wrapSod(86401)).toBe(1)
  })
})
