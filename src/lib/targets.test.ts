import { describe, expect, it } from 'vitest'
import {
  buildPlan,
  newTarget,
  parseBearing,
  parseDistance,
  parseMeasurement,
  pairSteps,
  parseMeasurements,
  resupplyQueue,
  solveTarget,
  type Target,
} from './targets'
import { formatTimeOfDay } from './time'

const at = (bearingDeg: number, distanceKm: number, patch: Partial<Target> = {}): Target => ({
  ...newTarget(bearingDeg, distanceKm),
  ...patch,
})

describe('数字だけの入力', () => {
  it('単位を打たなくても読む', () => {
    expect(parseBearing('273.9')).toBe(273.9)
    expect(parseDistance('6.16')).toBe(6.16)
  })

  it('単位が付いていても落として読む', () => {
    expect(parseBearing('273.9°')).toBe(273.9)
    expect(parseBearing('273.9度')).toBe(273.9)
    expect(parseDistance('6.16km')).toBe(6.16)
    expect(parseDistance('6.16 KM')).toBe(6.16)
  })

  it('全角のまま打っても読む', () => {
    expect(parseBearing('２７３．９')).toBe(273.9)
    expect(parseDistance('６．１６')).toBe(6.16)
  })

  it('整数だけでも読む', () => {
    expect(parseBearing('0')).toBe(0)
    expect(parseDistance('12')).toBe(12)
  })

  it('方位角は 0 以上 360 未満', () => {
    expect(parseBearing('359.9')).toBe(359.9)
    expect(parseBearing('360')).toBeNull()
    expect(parseBearing('-1')).toBeNull()
  })

  it('射程は正の数', () => {
    expect(parseDistance('0')).toBeNull()
    expect(parseDistance('-3')).toBeNull()
  })

  it('射程外でも数値としては読む（射程外として一覧に出すため）', () => {
    expect(parseDistance('40')).toBe(40)
  })

  it('数値以外や空は読まない', () => {
    for (const s of ['', ' ', 'abc', '1.2.3', '273.9 / 6.16']) {
      expect(parseBearing(s)).toBeNull()
      expect(parseDistance(s)).toBeNull()
    }
  })
})

describe('貼り付けの読み取り', () => {
  it('ゲームの書式をそのまま読む', () => {
    expect(parseMeasurement('273.9° / 6.16km')).toEqual({ bearingDeg: 273.9, distanceKm: 6.16 })
  })

  it('記号や単位のゆれを吸収する', () => {
    for (const s of ['273.9 / 6.16', '273.9°/6.16 km', '２７３.９° ／ ６.１６km']) {
      expect(parseMeasurement(s)).toEqual({ bearingDeg: 273.9, distanceKm: 6.16 })
    }
  })

  it('方位 0 度と 359.9 度を受け付ける', () => {
    expect(parseMeasurement('0.0° / 3km')?.bearingDeg).toBe(0)
    expect(parseMeasurement('359.9° / 3km')?.bearingDeg).toBe(359.9)
  })

  it('範囲外・数値不足は読まない', () => {
    for (const s of ['360.0° / 3km', '-5° / 3km', '273.9°', '', 'abc']) {
      expect(parseMeasurement(s)).toBeNull()
    }
  })

  it('複数行をまとめて読み、読めない行を分ける', () => {
    const { ok, bad } = parseMeasurements('273.9° / 6.16km\n\n55.9° / 5.78km\nゴミ行')
    expect(ok).toHaveLength(2)
    expect(bad).toEqual(['ゴミ行'])
  })
})

describe('目標の解', () => {
  it('装薬は届く最小のものが自動で選ばれる', () => {
    const s = solveTarget(at(273.9, 6.16))
    expect(s.charge).toBe(2)
    expect(s.elevationDeg).toBeCloseTo(36.96, 6)
  })

  it('装薬を手で上げると仰角が下がり飛翔時間も短くなる', () => {
    const auto = solveTarget(at(0, 6.16))
    const heavy = solveTarget(at(0, 6.16, { charge: 6 }))
    expect(heavy.elevationDeg!).toBeLessThan(auto.elevationDeg!)
    expect(heavy.flightSeconds!).toBeLessThan(auto.flightSeconds!)
  })

  it('届かない装薬を指定したら仰角を出さない', () => {
    const s = solveTarget(at(0, 12, { charge: 2 }))
    expect(s.charge).toBeNull()
    expect(s.elevationDeg).toBeNull()
    expect(s.outOfRange).toBe(false) // 装薬を上げれば届く
  })

  it('30 km を超えたら射程外', () => {
    expect(solveTarget(at(0, 30.1)).outOfRange).toBe(true)
    expect(solveTarget(at(0, 30)).outOfRange).toBe(false)
  })

  it('着弾時刻を入れると発射時刻が出る', () => {
    const s = solveTarget(at(0, 12.36, { charge: 3, impactDigits: '101010' }))
    expect(s.flightSeconds).toBeCloseTo(32.32, 2)
    // 10:10:10 − 32.32 秒 = 10:09:37.68 → 近い方の秒に寄せる
    expect(formatTimeOfDay(s.launch!)).toBe('10:09:38')
    expect(formatTimeOfDay(s.launch!, 2)).toBe('10:09:37.68')
  })

  it('着弾時刻が無ければ発射時刻は出ないが仰角は出る', () => {
    const s = solveTarget(at(0, 6.16))
    expect(s.launch).toBeNull()
    expect(s.elevationDeg).not.toBeNull()
  })
})

describe('射撃計画', () => {
  it('方位順に並べる', () => {
    const plan = buildPlan([at(90, 5), at(10, 5), at(50, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 50, 90])
  })

  it('いちばん広い隙間の直後から回るので旋回量が最小になる', () => {
    // 350, 10, 30 に散らばる。空いているのは 30→350 の 320 度。
    const plan = buildPlan([at(10, 5), at(350, 5), at(30, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 30])
    expect(plan.totalTurnDeg).toBeCloseTo(40)
  })

  it('ひとつ前からの旋回量を出す', () => {
    const plan = buildPlan([at(10, 5), at(350, 5), at(30, 5)])
    expect(plan.steps.map((s) => s.turnFromPrev)).toEqual([null, 20, 20])
  })

  it('左右の砲を交互に割り当てる', () => {
    const plan = buildPlan([at(10, 5), at(20, 5), at(30, 5), at(40, 5)])
    expect(plan.steps.map((s) => s.gun)).toEqual(['left', 'right', 'left', 'right'])
    expect(plan.steps.every((s) => !s.reloadStall)).toBe(true)
  })

  it('砲を手で指定できる', () => {
    const plan = buildPlan([at(10, 5, { gun: 'right' }), at(20, 5)])
    expect(plan.steps.map((s) => s.gun)).toEqual(['right', 'left'])
  })

  it('同じ砲が続いたら装填待ちとして印を付ける', () => {
    const plan = buildPlan([at(10, 5, { gun: 'left' }), at(20, 5, { gun: 'left' })])
    expect(plan.steps.map((s) => s.reloadStall)).toEqual([false, true])
  })

  it('射程外の目標は計画から外す', () => {
    const plan = buildPlan([at(10, 5), at(20, 40)])
    expect(plan.steps).toHaveLength(1)
    expect(plan.unplaced).toHaveLength(1)
    expect(plan.unplaced[0]!.target.distanceKm).toBe(40)
  })

  it('目標なし・1 件でも壊れない', () => {
    expect(buildPlan([]).steps).toEqual([])
    expect(buildPlan([]).totalTurnDeg).toBe(0)
    const one = buildPlan([at(10, 5)])
    expect(one.steps).toHaveLength(1)
    expect(one.steps[0]!.turnFromPrev).toBeNull()
    expect(one.totalTurnDeg).toBe(0)
  })
})

describe('行への組み分け', () => {
  const stepsOf = (...bearings: number[]) => buildPlan(bearings.map((b) => at(b, 5))).steps

  it('左右 1 発ずつを 1 行にまとめる', () => {
    const rows = pairSteps(stepsOf(10, 20, 30, 40))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.left!.order).toBe(1)
    expect(rows[0]!.right!.order).toBe(2)
    expect(rows[1]!.left!.order).toBe(3)
    expect(rows[1]!.right!.order).toBe(4)
  })

  it('行内の旋回と行間の旋回を分ける', () => {
    const rows = pairSteps(stepsOf(10, 20, 30, 40))
    expect(rows[0]!.leadTurn).toBeNull()
    expect(rows[0]!.midTurn).toBe(10)
    expect(rows[1]!.leadTurn).toBe(10)
    expect(rows[1]!.midTurn).toBe(10)
  })

  it('奇数なら最後の行は 1 発だけ', () => {
    const rows = pairSteps(stepsOf(10, 20, 30))
    expect(rows).toHaveLength(2)
    expect(rows[1]!.left!.order).toBe(3)
    expect(rows[1]!.right).toBeNull()
    expect(rows[1]!.midTurn).toBeNull()
  })

  it('同じ砲が続く行は組にしない', () => {
    const plan = buildPlan([
      at(10, 5, { gun: 'left' }),
      at(20, 5, { gun: 'left' }),
      at(30, 5, { gun: 'right' }),
    ])
    const rows = pairSteps(plan.steps)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.left!.order).toBe(1)
    expect(rows[0]!.right).toBeNull()
    expect(rows[1]!.left!.order).toBe(2)
    expect(rows[1]!.right!.order).toBe(3)
  })

  it('右砲が先の組でも左右の列は入れ替えない', () => {
    const plan = buildPlan([at(10, 5, { gun: 'right' }), at(20, 5)])
    const rows = pairSteps(plan.steps)
    expect(rows[0]!.right!.order).toBe(1)
    expect(rows[0]!.left!.order).toBe(2)
    expect(rows[0]!.firstSide).toBe('right')
  })

  it('目標なしなら行もなし', () => {
    expect(pairSteps([])).toEqual([])
  })
})

describe('旋回の向き', () => {
  it('まだ撃っていないうちは、いちばん広い隙間を通らないので常に右回り', () => {
    // 円周上のどこに散らばらせても、180 度を超える隙間は最大の 1 つしか
    // 存在しえない。その隙間を跨がない順路なので、逆回りは発生しない。
    const cases = [
      [10, 20, 30],
      [350, 10, 30],
      [0, 90, 180, 270],
      [5, 185, 200],
      [359.9, 0.1],
      [100, 279, 280],
    ]
    for (const bearings of cases) {
      const plan = buildPlan(bearings.map((b) => at(b, 5)))
      for (const step of plan.steps) {
        if (step.turnFromPrev !== null) expect(step.turnFromPrev).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('総旋回は「一周 − 最大の隙間」になる', () => {
    const plan = buildPlan([0, 90, 180, 270].map((b) => at(b, 5)))
    expect(plan.totalTurnDeg).toBeCloseTo(270) // 隙間はすべて 90 度
  })
})

describe('完了', () => {
  it('撃ち終えた目標は射撃順から外れ、完了一覧に移る', () => {
    const plan = buildPlan([at(10, 5), at(20, 5, { done: true }), at(30, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 30])
    expect(plan.done.map((s) => s.target.bearingDeg)).toEqual([20])
  })

  it('完了ぶんは旋回量に数えない', () => {
    // 10 → 20 → 30 で 20 度。20 を撃ち終えると 10 → 30 の 20 度のまま
    expect(buildPlan([at(10, 5), at(20, 5), at(30, 5)]).totalTurnDeg).toBeCloseTo(20)
    const after = buildPlan([at(10, 5), at(20, 5, { done: true }), at(30, 5)])
    expect(after.totalTurnDeg).toBeCloseTo(20)
    // 端を撃ち終えれば減る
    const trimmed = buildPlan([at(10, 5, { done: true }), at(20, 5), at(30, 5)])
    expect(trimmed.totalTurnDeg).toBeCloseTo(10)
  })

  it('完了で次に撃つ砲が入れ替わる', () => {
    const before = buildPlan([at(10, 5), at(20, 5)])
    expect(before.steps[0]!.gun).toBe('left')
    const after = buildPlan([at(10, 5, { done: true }), at(20, 5)])
    expect(after.steps[0]!.solution.target.bearingDeg).toBe(20)
    expect(after.steps[0]!.gun).toBe('left') // 残りの先頭から改めて交互に振り直す
  })

  it('全部撃ち終えたら射撃順は空になる', () => {
    const plan = buildPlan([at(10, 5, { done: true }), at(20, 5, { done: true })])
    expect(plan.steps).toEqual([])
    expect(plan.done).toHaveLength(2)
    expect(plan.totalTurnDeg).toBe(0)
  })

  it('射程外の目標を撃ち終え扱いにしたら完了側に入る', () => {
    const plan = buildPlan([at(10, 40, { done: true })])
    expect(plan.unplaced).toEqual([])
    expect(plan.done).toHaveLength(1)
  })
})

describe('撃った後の引き継ぎ', () => {
  const fired = (bearing: number, gun: 'left' | 'right', at: number) =>
    at_(bearing, 5, { done: true, firedGun: gun, firedAt: at })

  /** at() は done を渡せないので、ここでは素の Target を組む */
  const at_ = (b: number, d: number, patch: Partial<Target>): Target => ({
    ...newTarget(b, d),
    ...patch,
  })

  it('直前に使った砲の反対から割り当てを続ける', () => {
    // 左砲で撃った直後なら、次は右砲から始まる
    const plan = buildPlan([fired(10, 'left', 1), at(20, 5), at(30, 5)])
    expect(plan.steps.map((s) => s.gun)).toEqual(['right', 'left'])
  })

  it('撃つたびに左右が入れ替わらない', () => {
    const targets = [at(10, 5), at(20, 5), at(30, 5), at(40, 5)]
    const before = buildPlan(targets)
    const gunOf = (p: ReturnType<typeof buildPlan>, bearing: number) =>
      p.steps.find((s) => s.solution.target.bearingDeg === bearing)?.gun

    expect(gunOf(before, 20)).toBe('right')

    // 1 発目を撃った体で組み直しても、2 発目の砲は変わらない
    const after = buildPlan([
      { ...targets[0]!, done: true, firedGun: before.steps[0]!.gun, firedAt: 1 },
      ...targets.slice(1),
    ])
    expect(gunOf(after, 20)).toBe('right')
    expect(gunOf(after, 30)).toBe(gunOf(before, 30))
  })

  it('砲塔の現在位置から、寄せるのが安い側へ回る', () => {
    // 残りは 10 と 20。砲塔は 30 を向いている。奥端 20 に寄って反時計回りが安い。
    const plan = buildPlan([fired(30, 'left', 1), at(10, 5), at(20, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([20, 10])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(-10) // 左へ 10 度
    expect(plan.steps[1]!.turnFromPrev).toBeCloseTo(-10)
    expect(plan.totalTurnDeg).toBeCloseTo(20)
  })

  it('手前端に寄る方が安ければ時計回りのまま', () => {
    // 砲塔は 5 を向いている。手前端 10 に寄って時計回りが安い。
    const plan = buildPlan([fired(5, 'left', 1), at(10, 5), at(20, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 20])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(5)
  })

  it('最初の旋回は砲塔の現在位置からの量になる', () => {
    const plan = buildPlan([fired(0, 'left', 1), at(40, 5)])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(40)
    expect(plan.totalTurnDeg).toBeCloseTo(40)
  })

  it('いちばん新しく撃った 1 発を現在位置とする', () => {
    const plan = buildPlan([fired(0, 'left', 1), fired(200, 'right', 9), at(210, 5)])
    // 200 を向いているので 210 までは 10 度
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(10)
    expect(plan.steps[0]!.gun).toBe('left') // 直前が右砲
  })
})

describe('弾倉と補給', () => {
  /** 方位を散らして n 件。交互割り当てで左右に振り分けられる。 */
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => at(10 + i * 2, 5))

  it('その砲にとって何発目かを数える', () => {
    const plan = buildPlan(many(6))
    expect(plan.steps.map((s) => s.gun)).toEqual([
      'left', 'right', 'left', 'right', 'left', 'right',
    ])
    expect(plan.steps.map((s) => s.magIndex)).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('即応弾 6 発までは補給が要らない', () => {
    const plan = buildPlan(many(12))
    expect(plan.steps.every((s) => !s.needsResupply)).toBe(true)
    expect(plan.steps.filter((s) => s.gun === 'left')).toHaveLength(6)
    expect(plan.steps.filter((s) => s.gun === 'right')).toHaveLength(6)
  })

  it('7 発目から補給が要る', () => {
    const plan = buildPlan(many(14))
    const left = plan.steps.filter((s) => s.gun === 'left')
    expect(left).toHaveLength(7)
    expect(left.slice(0, 6).every((s) => !s.needsResupply)).toBe(true)
    expect(left[6]!.needsResupply).toBe(true)
    expect(left[6]!.magIndex).toBe(6)
  })

  it('補給する順に並べて返す', () => {
    const plan = buildPlan(many(16))
    const queue = resupplyQueue(plan.steps, 'left')
    expect(queue).toHaveLength(2)
    expect(queue.map((s) => s.magIndex)).toEqual([6, 7])
    // 射撃順どおりに並ぶ
    expect(queue[0]!.order).toBeLessThan(queue[1]!.order)
  })

  it('片方に固定すると、その砲だけ早く補給が要る', () => {
    const targets = Array.from({ length: 8 }, (_, i) =>
      at(10 + i * 2, 5, { gun: 'left' as const }),
    )
    const plan = buildPlan(targets)
    expect(resupplyQueue(plan.steps, 'left')).toHaveLength(2)
    expect(resupplyQueue(plan.steps, 'right')).toHaveLength(0)
  })

  it('撃ち終えたぶんは弾倉から抜けるので、補給の要否も戻る', () => {
    const targets = Array.from({ length: 14 }, (_, i) => at(10 + i * 2, 5))
    expect(resupplyQueue(buildPlan(targets).steps, 'left')).toHaveLength(1)
    // 2 発撃てば残り 12 発、左右 6 発ずつに収まる
    const after = targets.map((t, i) =>
      i < 2
        ? { ...t, done: true, firedAt: i + 1, firedGun: i % 2 === 0 ? ('left' as const) : ('right' as const) }
        : t,
    )
    expect(resupplyQueue(buildPlan(after).steps, 'left')).toHaveLength(0)
  })
})
