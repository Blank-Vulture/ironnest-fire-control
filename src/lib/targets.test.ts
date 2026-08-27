import { describe, expect, it } from 'vitest'
import {
  applyOriginShell,
  applyTargetShell,
  bearingSigmaFor,
  buildPlan,
  distanceSigmaFor,
  newTarget,
  pairSteps,
  parseBearing,
  parseDistance,
  parseMeasurement,
  parseMeasurements,
  reprojectTarget,
  resupplyQueue,
  solveTarget,
  type Priority,
  type Target,
} from './targets'
import { pointFrom } from './grid'
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

describe('撃破の優先度', () => {
  it('高価値目標を先に撃つ。旋回が遠くても', () => {
    // 10, 30 は隣同士。200 だけが反対側にあるが、そちらが高価値
    const plan = buildPlan([
      at(10, 5),
      at(30, 5),
      at(200, 5, { priority: 'high' }),
    ])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([200, 10, 30])
  })

  it('段の中では方位で並べる', () => {
    /*
     * 高価値の 50, 90 を先に撃つ。撃ち終えた砲塔は 90 を向いているので、
     * 標準の 10, 30 へは近い 30 から入って 10 へ抜けるほうが安い。
     * 段の中を方位で並べるだけでなく、回る向きも直前の段から決まる。
     */
    const plan = buildPlan([
      at(90, 5, { priority: 'high' }),
      at(10, 5),
      at(50, 5, { priority: 'high' }),
      at(30, 5),
    ])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([50, 90, 30, 10])
  })

  it('何も付けない目標は自動で後ろへ下がる', () => {
    // 既定の「通常」がいちばん下の段なので、急ぐものに印を付けるだけで済む
    const plan = buildPlan([
      at(10, 5),
      at(20, 5, { priority: 'raised' }),
      at(30, 5, { priority: 'high' }),
    ])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([30, 20, 10])
  })

  it('段が変わる前に付けた「後回し」は通常として扱う', () => {
    /*
     * 保存に残っている古い値。読めないまま素通しするとどの段にも入らず、
     * 射撃順から静かに消える。いまは通常がいちばん下なので、意味も変わらない。
     */
    const stale = { ...at(10, 5), priority: 'low' as unknown as Priority }
    const plan = buildPlan([stale, at(30, 5, { priority: 'high' })])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([30, 10])
  })

  it('優先度を付けなければ、これまでどおり方位だけで並ぶ', () => {
    const plan = buildPlan([at(90, 5), at(10, 5), at(50, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 50, 90])
  })

  it('段を跨ぐときは、直前の段を撃ち終えた方位から続ける', () => {
    /*
     * 高価値を 100→140 で終えると、砲塔は 140 を向いている。標準の 350 と 10
     * のうち、そこから近いのは 10（130 度）で、350 は 150 度ある。
     * 近いほうから入るので 10→350 になる。段ごとに独立して組んで必ず
     * 「隙間の直後」から始めると、ここで 20 度余計に回ることになる。
     */
    const plan = buildPlan([
      at(100, 5, { priority: 'high' }),
      at(140, 5, { priority: 'high' }),
      at(350, 5),
      at(10, 5),
    ])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([100, 140, 10, 350])
  })

  it('境界をまたぐ配置でも、段の中で隙間を跨がない', () => {
    // 359 と 1 は隣。150 は反対側。高価値の中でも 359→1 の順になってほしい
    const plan = buildPlan([
      at(150, 5, { priority: 'high' }),
      at(1, 5, { priority: 'high' }),
      at(359, 5, { priority: 'high' }),
    ])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([359, 1, 150])
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

  it('撃った 1 発だけを基準に、回る向きを選び直したりしない', () => {
    /*
     * 30 は他に何も撃っていない状態での 1 発目なので、10・20 の並びはいつもどおり
     * 隙間の直後から時計回りに決まる（10 → 20）。撃った 30 自身の方位を「現在位置」
     * として向きの選び直しに使うと、その 1 発を基準に毎回いちばん安い側へ回ろうと
     * してしまい、後から他を飛ばして撃つたびに残りの並びが逆転する。
     * 実際の旋回量（turnFromPrev）は引き続き 30 を向いた砲塔からの実測値になる。
     */
    const plan = buildPlan([fired(30, 'left', 1), at(10, 5), at(20, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 20])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(-20)
    expect(plan.steps[1]!.turnFromPrev).toBeCloseTo(10)
    expect(plan.totalTurnDeg).toBeCloseTo(30)
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

describe('方位の境界（0 度をまたぐ並べ替え）', () => {
  const order = (plan: ReturnType<typeof buildPlan>) =>
    plan.steps.map((s) => s.solution.target.bearingDeg)
  const turns = (plan: ReturnType<typeof buildPlan>) => plan.steps.map((s) => s.turnFromPrev)

  /** 実装とは別に、隣り合う目標の隙間のうち最大のものを求める。 */
  const widestGap = (bearings: readonly number[]) => {
    const sorted = [...bearings].sort((a, b) => a - b)
    let widest = 0
    for (let i = 0; i < sorted.length; i++) {
      const gap = (((sorted[(i + 1) % sorted.length]! - sorted[i]!) % 360) + 360) % 360
      widest = Math.max(widest, gap)
    }
    return widest
  }

  it('359 度と 1 度は隣として扱う', () => {
    // 0 度をまたぐ 2 度の隙間を通り、150 度へは 149 度で届く。
    // 数値の大小で並べると 1 → 150 → 359 になってしまい、209 度が無駄になる。
    const plan = buildPlan([at(359, 5), at(1, 5), at(150, 5)])
    expect(order(plan)).toEqual([359, 1, 150])
    expect(turns(plan)).toEqual([null, 2, 149])
    expect(plan.totalTurnDeg).toBeCloseTo(151)
  })

  it('入力の順番を変えても同じ射撃順になる', () => {
    const bearings = [359, 1, 150]
    const expected = [359, 1, 150]
    for (const perm of [
      [359, 1, 150],
      [1, 150, 359],
      [150, 359, 1],
      [1, 359, 150],
      [150, 1, 359],
      [359, 150, 1],
    ]) {
      expect(order(buildPlan(perm.map((b) => at(b, 5))))).toEqual(expected)
      expect(perm).toHaveLength(bearings.length)
    }
  })

  it('0 度をまたぐ 2 点で、遠回りしない', () => {
    const plan = buildPlan([at(350, 5), at(10, 5)])
    expect(order(plan)).toEqual([350, 10])
    expect(plan.totalTurnDeg).toBeCloseTo(20) // 340 度ではなく 20 度
  })

  it('0 度を跨いだ小数の並びも崩れない', () => {
    const plan = buildPlan([at(359.9, 5), at(0.1, 5)])
    expect(order(plan)).toEqual([359.9, 0.1])
    expect(plan.totalTurnDeg).toBeCloseTo(0.2)
  })

  it('0 度をまたいで連続する目標を順に舐める', () => {
    const plan = buildPlan([at(358, 5), at(359, 5), at(0, 5), at(1, 5), at(2, 5)])
    expect(order(plan)).toEqual([358, 359, 0, 1, 2])
    expect(turns(plan)).toEqual([null, 1, 1, 1, 1])
    expect(plan.totalTurnDeg).toBeCloseTo(4)
  })

  it('方位が同じなら旋回不要になる', () => {
    const plan = buildPlan([at(90, 5), at(90, 5), at(200, 5)])
    expect(turns(plan)[1]).toBe(0)
    expect(plan.totalTurnDeg).toBeCloseTo(110)
  })

  it('全部同じ方位なら一度も旋回しない', () => {
    const plan = buildPlan([at(42, 5), at(42, 5), at(42, 5)])
    expect(plan.totalTurnDeg).toBe(0)
  })

  it('正反対の 2 点はどちら回りでも 180 度', () => {
    const plan = buildPlan([at(0, 5), at(180, 5)])
    expect(plan.totalTurnDeg).toBeCloseTo(180)
    expect(Math.abs(turns(plan)[1]!)).toBeCloseTo(180)
  })

  it('1 回の旋回が 180 度を超えることはない', () => {
    const sets = [
      [359, 1, 150],
      [0, 90, 180, 270],
      [5, 185],
      [10, 200, 210],
      [1, 2, 359],
      [100, 279, 280],
    ]
    for (const bearings of sets) {
      for (const step of buildPlan(bearings.map((b) => at(b, 5))).steps) {
        if (step.turnFromPrev !== null) expect(Math.abs(step.turnFromPrev)).toBeLessThanOrEqual(180)
      }
    }
  })

  it('総旋回は「一周 − いちばん広い隙間」に一致する', () => {
    // 乱数の種を固定して、円周上の散らばり方をひととおり試す
    let seed = 20260823
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 200; trial++) {
      const count = 2 + Math.floor(random() * 7)
      const bearings = Array.from({ length: count }, () =>
        Math.round(random() * 3599) / 10,
      )
      const plan = buildPlan(bearings.map((b) => at(b, 5)))
      expect(plan.totalTurnDeg).toBeCloseTo(360 - widestGap(bearings), 6)
    }
  })
})

describe('撃った後の境界（0 度をまたぐ引き継ぎ）', () => {
  const firedAt = (bearing: number): Target => ({
    ...newTarget(bearing, 5),
    done: true,
    firedAt: 1,
    firedGun: 'left',
  })

  it('弧の手前端が 0 度の向こう側なら、左へ戻ってから右回りに流す', () => {
    // 砲塔は 1 度を向いている。359 度へは左に 2 度、150 度へは右に 149 度。
    // 359 に戻ってから 150 へ流す方が、150 を先に撃つより安い。
    // 最初の 1 手だけが左で、そこから先は右回りになる。
    const plan = buildPlan([firedAt(1), at(359, 5), at(150, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([359, 150])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(-2) // 左へ 2 度
    expect(plan.steps[1]!.turnFromPrev).toBeCloseTo(151)
    expect(plan.totalTurnDeg).toBeCloseTo(153)
  })

  it('0 度をまたいで進む方が近ければ右回りのまま', () => {
    const plan = buildPlan([firedAt(359), at(1, 5), at(150, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([1, 150])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(2)
    expect(plan.totalTurnDeg).toBeCloseTo(151)
  })

  it('撃った 1 発だけでは、0 度をまたぐ塊でも向きを選び直さない', () => {
    /*
     * 残りは 350・10・20 の塊。25 は他に何も撃っていない状態での 1 発目なので、
     * 塊の並びはいつもどおり隙間の直後から時計回りに決まる（350 → 10 → 20）。
     * 25 自身を基準に安い側を選び直すと反時計回りの方が近く見えるが、それは
     * 「撃つたびに向きを選び直す」と同じ挙動になってしまう。実際の最初の旋回
     * （turnFromPrev）は引き続き 25 を向いた砲塔からの実測値なので大きく出る。
     */
    const plan = buildPlan([firedAt(25), at(350, 5), at(10, 5), at(20, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 20])
    expect(plan.steps.map((s) => s.turnFromPrev)).toEqual([-35, 20, 10])
    expect(plan.totalTurnDeg).toBeCloseTo(65)
  })

  it('手前端の方が近ければ、0 度をまたぐ塊でも右回りに舐める', () => {
    const plan = buildPlan([firedAt(5), at(350, 5), at(10, 5), at(20, 5)])
    expect(plan.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 20])
    expect(plan.steps.map((s) => s.turnFromPrev)).toEqual([-15, 20, 10])
    expect(plan.totalTurnDeg).toBeCloseTo(45)
  })

  it('砲塔が目標と同じ方位なら、最初の旋回は 0 になる', () => {
    const plan = buildPlan([firedAt(359.9), at(359.9, 5), at(10, 5)])
    expect(plan.steps[0]!.turnFromPrev).toBeCloseTo(0)
  })
})

describe('撃っても残りの並びが変わらない', () => {
  const skip = (targets: readonly Target[], bearingDeg: number, firedAt: number, firedGun: 'left' | 'right') =>
    targets.map((t) =>
      t.bearingDeg === bearingDeg ? { ...t, done: true, firedAt, firedGun } : t,
    )

  it('弧をまたぐ配置で、飛ばして撃っても残りの並びは崩れない', () => {
    /*
     * バグの再現ケース。350・10・30・170 は弧をまたいで並ぶ。170 を飛ばして
     * 先に撃つと、以前の実装では残り 3 件（350・10・30）が完全に逆順になって
     * いた。撃つ前に決めた並びから 170 を抜いただけの形を保つべきで、
     * それ以外の並びが選び直されてはいけない。
     */
    const targets = [at(350, 5), at(10, 5), at(30, 5), at(170, 5)]
    const before = buildPlan(targets)
    expect(before.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 30, 170])

    const after = buildPlan(skip(targets, 170, 1, 'left'))
    expect(after.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 30])
  })

  it('端ではなく途中の 1 件を飛ばして撃っても崩れない', () => {
    // 弧の端（170）ではなく、真ん中寄りの 10 を飛ばして撃つ場合も同じ
    const targets = [at(350, 5), at(10, 5), at(30, 5), at(170, 5)]
    const after = buildPlan(skip(targets, 10, 1, 'left'))
    expect(after.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 30, 170])
  })

  it('続けて何件飛ばして撃っても、そのたびに並びが選び直されない', () => {
    // 170 を撃った後、続けて 30 も飛ばして撃つ。残る 350・10 の並びは変わらない
    const targets = [at(350, 5), at(10, 5), at(30, 5), at(170, 5)]
    const afterOne = buildPlan(skip(targets, 170, 1, 'left'))
    expect(afterOne.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10, 30])

    const afterTwo = buildPlan(skip(skip(targets, 170, 1, 'left'), 30, 2, 'right'))
    expect(afterTwo.steps.map((s) => s.solution.target.bearingDeg)).toEqual([350, 10])
  })

  it('順番どおりに撃つ分には、もともと並びは変わらない', () => {
    // 回帰確認。先頭から順に撃つケースはバグ修正前から問題なかった
    const targets = [at(350, 5), at(10, 5), at(30, 5), at(170, 5)]
    const after = buildPlan(skip(targets, 350, 1, 'left'))
    expect(after.steps.map((s) => s.solution.target.bearingDeg)).toEqual([10, 30, 170])
  })

  it('新しい目標を足したときは、並びが変わってよい', () => {
    // 撃った操作では並びを変えないが、目標が増えて弧の形自体が変わるときは
    // 並びが変わって当然。それ自体は崩れとして扱わない
    const targets = [at(350, 5), at(10, 5), at(30, 5), at(170, 5)]
    const after = buildPlan([...skip(targets, 170, 1, 'left'), at(190, 5)])
    expect(after.steps.map((s) => s.solution.target.bearingDeg)).toContain(190)
    expect(after.steps).toHaveLength(4) // 350, 10, 30, 190（170 は完了済み）
  })
})

describe('砲座が動いたとき', () => {
  const nestA = { x: 8.55, y: 5.35 }
  const nestB = { x: 10.25, y: 3.05 }

  it('目標の盤面上の位置は動かない', () => {
    const target = at(273.9, 6.16)
    const moved = reprojectTarget(target, nestA, nestB)
    const before = pointFrom(nestA, target.bearingDeg, target.distanceKm)
    const after = pointFrom(nestB, moved.bearingDeg, moved.distanceKm)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('方位も距離も新しい位置から測り直される', () => {
    const moved = reprojectTarget(at(0, 3), nestA, nestB)
    expect(moved.bearingDeg).not.toBeCloseTo(0)
    expect(moved.distanceKm).not.toBeCloseTo(3)
  })

  it('砲座が動いていなければ何も変わらない', () => {
    const target = at(137.5, 4.2)
    const moved = reprojectTarget(target, nestA, nestA)
    expect(moved.bearingDeg).toBeCloseTo(target.bearingDeg, 9)
    expect(moved.distanceKm).toBeCloseTo(target.distanceKm, 9)
  })

  it('弾種や着弾時刻などはそのまま残る', () => {
    const target = at(90, 5, { shell: 'AP', charge: 4, impactDigits: '101010', done: true })
    const moved = reprojectTarget(target, nestA, nestB)
    expect(moved.shell).toBe('AP')
    expect(moved.charge).toBe(4)
    expect(moved.impactDigits).toBe('101010')
    expect(moved.done).toBe(true)
    expect(moved.id).toBe(target.id)
  })

  it('往復させると元に戻る', () => {
    const target = at(273.9, 6.16)
    const round = reprojectTarget(reprojectTarget(target, nestA, nestB), nestB, nestA)
    expect(round.bearingDeg).toBeCloseTo(target.bearingDeg, 6)
    expect(round.distanceKm).toBeCloseTo(target.distanceKm, 9)
  })
})

describe('弾種の同期', () => {
  it('弾種を変えても他のカードは変わらない', () => {
    const a = at(90, 5, { id: 'a', shell: 'HE' })
    const b = at(180, 5, { id: 'b', shell: 'HE' })
    const next = applyTargetShell([a, b], 'a', 'AP')
    expect(next.find((t) => t.id === 'a')?.shell).toBe('AP')
    expect(next.find((t) => t.id === 'b')?.shell).toBe('HE')
  })

  it('id が無ければ何も変わらない', () => {
    const a = at(90, 5, { id: 'a', shell: 'HE' })
    const next = applyTargetShell([a], 'nope', 'AP')
    expect(next).toEqual([a])
  })

  it('同じ標定から出したカードだけ弾種が揃う', () => {
    const a = at(90, 5, { id: 'a', originFixId: 'f1', shell: 'HE' })
    const b = at(180, 5, { id: 'b', originFixId: 'f1', shell: 'HE' })
    const c = at(0, 5, { id: 'c', originFixId: 'f2', shell: 'HE' })
    const manual = at(45, 5, { id: 'd', shell: 'HE' }) // 標定を経ずに手で足したカード

    const next = applyOriginShell([a, b, c, manual], 'f1', 'AP')
    expect(next.find((t) => t.id === 'a')?.shell).toBe('AP')
    expect(next.find((t) => t.id === 'b')?.shell).toBe('AP')
    expect(next.find((t) => t.id === 'c')?.shell).toBe('HE')
    expect(next.find((t) => t.id === 'd')?.shell).toBe('HE')
  })
})

describe('射撃順の番号', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => at(10 + i * 5, 5))

  it('撃ち終えたぶんの続きから振る', () => {
    const targets = many(4)
    const before = buildPlan(targets)
    expect(before.steps.map((s) => s.order)).toEqual([1, 2, 3, 4])

    // 1 発目を撃つ
    const after = buildPlan([
      { ...targets[0]!, done: true, firedGun: before.steps[0]!.gun, firedAt: 1 },
      ...targets.slice(1),
    ])
    expect(after.steps.map((s) => s.order)).toEqual([2, 3, 4])
  })

  it('撃っても残りの番号が動かない', () => {
    const targets = many(4)
    const before = buildPlan(targets)
    const orderOf = (plan: ReturnType<typeof buildPlan>, bearing: number) =>
      plan.steps.find((s) => s.solution.target.bearingDeg === bearing)?.order

    const after = buildPlan([
      { ...targets[0]!, done: true, firedGun: before.steps[0]!.gun, firedAt: 1 },
      ...targets.slice(1),
    ])
    for (const bearing of [15, 20, 25]) {
      expect(orderOf(after, bearing), `方位 ${bearing}`).toBe(orderOf(before, bearing))
    }
  })

  it('何発撃っても番号は繰り上がらない', () => {
    const targets = many(4)
    const plan = buildPlan(
      targets.map((t, i) =>
        i < 2 ? { ...t, done: true, firedAt: i + 1, firedGun: 'left' as const } : t,
      ),
    )
    expect(plan.steps.map((s) => s.order)).toEqual([3, 4])
  })
})

describe('方位の読み取り幅', () => {
  it('点を打たずに入れても、小数第 1 位まで読めた扱いにする', () => {
    // 報告の方位は必ず小数第 1 位まで来る。その桁がたいてい 0 なので、
    // 「300」と入れるのは 300.0 のことであって「300 度前後」ではない
    expect(bearingSigmaFor('300')).toBeCloseTo(0.05, 6)
    expect(bearingSigmaFor('300.0')).toBeCloseTo(0.05, 6)
    expect(bearingSigmaFor('300.4')).toBeCloseTo(0.05, 6)
  })

  it('小数第 2 位まで入れたら、そのぶんせまくなる', () => {
    expect(bearingSigmaFor('300.25')).toBeCloseTo(0.005, 6)
  })

  it('距離は書いた桁のとおりに読む。方位のような決まった桁が無いため', () => {
    expect(distanceSigmaFor('4')).toBeCloseTo(0.5, 6)
  })

  it('距離も同じ理屈で読む', () => {
    expect(distanceSigmaFor('4')).toBeCloseTo(0.5, 6)
    expect(distanceSigmaFor('3.71')).toBeCloseTo(0.005, 6)
  })
})
