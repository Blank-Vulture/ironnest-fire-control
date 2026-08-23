import { describe, expect, it } from 'vitest'
import { bearingBetween, distanceBetween, formatPoint, gridToPoint, parseGrid } from './grid'
import {
  NEST_FIX_ID,
  availableSources,
  isFixDurable,
  settledFixes,
  solveSurvey,
  trackedPoint,
  type Fix,
  type KnownPoint,
  type Sighting,
  type SurveyDoc,
} from './survey'

const at = (grid: string) => gridToPoint(parseGrid(grid)!)

const known = (id: string, grid: string, isNest = false): KnownPoint => ({
  id,
  label: id,
  gridInput: grid,
  isNest,
})

let counter = 0
const sighting = (fromId: string, bearing = '', range = ''): Sighting => ({
  id: `s${counter++}`,
  fromId,
  bearingInput: bearing,
  rangeInput: range,
})

const fix = (id: string, sightings: Sighting[], patch: Partial<Fix> = {}): Fix => ({
  id,
  label: id,
  sightings,
  // 既定では観測元にも使えるようにしておく（連鎖のテストで要る）
  isReference: true,
  isTarget: true,
  ...patch,
})

/** ある点から目標を見たときの、実際の報告を作る。 */
const rangeTo = (from: string, target: string) =>
  distanceBetween(at(from), at(target)).toFixed(4)
const bearingTo = (from: string, target: string) =>
  bearingBetween(at(from), at(target)).toFixed(3)

const solvedFix = (result: ReturnType<typeof solveSurvey>, id: string) => {
  const entry = result.fixes.find((f) => f.fix.id === id)!
  if (entry.status.kind !== 'solved') {
    throw new Error(`${id} が解けていない: ${entry.status.kind}`)
  }
  return { ...entry, position: entry.status.position }
}

describe('標定の網', () => {
  it('既知点だけで 1 段の標定ができる', () => {
    const doc: SurveyDoc = {
      known: [known('nest', 'I6 5:3', true), known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [
        fix('t1', [
          sighting('sp1', bearingTo('I9 9:1', 'F7 2:5')),
          sighting('sp2', bearingTo('K4 3:7', 'F7 2:5')),
        ]),
      ],
    }
    const result = solveSurvey(doc)
    expect(formatPoint(solvedFix(result, 't1').position)).toBe('F7 2:5')
    expect(result.nest).toEqual(at('I6 5:3'))
  })

  it('距離 3 つの重なる地点を出し、そこからさらに標定できる', () => {
    // 任務の例: 3 人の距離が重なる地点を基準点にして、
    // その基準点からの方位と、観測員 3 からの方位で目標を割り出す
    const ref = 'H5 0:0'
    const target = 'J3 0:0'
    const doc: SurveyDoc = {
      known: [
        known('nest', 'I6 5:3', true),
        known('sp1', 'I9 9:1'),
        known('sp2', 'K4 3:7'),
        known('sp3', 'E2 2:4'),
      ],
      fixes: [
        fix('ref', [
          sighting('sp1', '', rangeTo('I9 9:1', ref)),
          sighting('sp2', '', rangeTo('K4 3:7', ref)),
          sighting('sp3', '', rangeTo('E2 2:4', ref)),
        ]),
        fix('target', [
          sighting('ref', bearingTo(ref, target)),
          sighting('sp3', bearingTo('E2 2:4', target)),
        ]),
      ],
    }

    const result = solveSurvey(doc)
    const refFix = solvedFix(result, 'ref')
    expect(formatPoint(refFix.position)).toBe(ref)
    expect(refFix.chained).toBe(false)

    const found = solvedFix(result, 'target')
    expect(found.chained).toBe(true)
    expect(formatPoint(found.position)).toBe(target)
  })

  it('観測元の誤差は次の点へ持ち越される', () => {
    const ref = 'H5 0:0'
    const target = 'J3 0:0'
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7'), known('sp3', 'E2 2:4')],
      fixes: [
        fix('ref', [
          // わざと 1 つずらして、基準点自体に食い違いを持たせる
          sighting('sp1', '', rangeTo('I9 9:1', ref)),
          sighting('sp2', '', String(Number(rangeTo('K4 3:7', ref)) + 0.4)),
          sighting('sp3', '', rangeTo('E2 2:4', ref)),
        ]),
        fix('target', [
          sighting('ref', bearingTo(ref, target)),
          sighting('sp3', bearingTo('E2 2:4', target)),
        ]),
      ],
    }
    const result = solveSurvey(doc)
    const refFix = solvedFix(result, 'ref')
    const found = solvedFix(result, 'target')

    expect(refFix.residualKm).toBeGreaterThan(0.05)
    // 目標そのものは 2 本の線がきれいに交わるので、自身の食い違いは小さい
    expect(found.residualKm).toBeLessThan(0.01)
    // それでも累積では基準点のぶんを引きずる
    expect(found.accumulatedKm).toBeGreaterThanOrEqual(refFix.accumulatedKm)
    // 基準点がずれたぶん、目標も真値からずれる
    expect(distanceBetween(found.position, at(target))).toBeGreaterThan(0.05)
  })

  it('定義の順番が前後していても解ける', () => {
    const ref = 'H5 0:0'
    const target = 'J3 0:0'
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7'), known('sp3', 'E2 2:4')],
      fixes: [
        // 先に、まだ定義していない ref を参照する点を置く
        fix('target', [
          sighting('ref', bearingTo(ref, target)),
          sighting('sp3', bearingTo('E2 2:4', target)),
        ]),
        fix('ref', [
          sighting('sp1', '', rangeTo('I9 9:1', ref)),
          sighting('sp2', '', rangeTo('K4 3:7', ref)),
          sighting('sp3', '', rangeTo('E2 2:4', ref)),
        ]),
      ],
    }
    const result = solveSurvey(doc)
    expect(formatPoint(solvedFix(result, 'ref').position)).toBe(ref)
    expect(formatPoint(solvedFix(result, 'target').position)).toBe(target)
  })

  it('観測元が解けなければ、その点は待ちになる', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [
        fix('ref', [sighting('sp1', '90')]), // 拘束 1 つでは決まらない
        fix('target', [sighting('ref', '130'), sighting('sp1', '230')]),
      ],
    }
    const result = solveSurvey(doc)
    expect(result.fixes[0]!.status.kind).toBe('insufficient')
    const pending = result.fixes[1]!.status
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') expect(pending.missing).toEqual(['ref'])
  })

  it('参照が輪になっていても落ちない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [
        fix('a', [sighting('b', '90'), sighting('sp1', '10')]),
        fix('b', [sighting('a', '90'), sighting('sp1', '20')]),
      ],
    }
    const result = solveSurvey(doc)
    expect(result.fixes.map((f) => f.status.kind)).toEqual(['pending', 'pending'])
  })

  it('位置が読めない既知点は観測元にならない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('bad', 'ZZ99')],
      fixes: [fix('t', [sighting('sp1', '90'), sighting('bad', '180')])],
    }
    const result = solveSurvey(doc)
    const status = result.fixes[0]!.status
    expect(status.kind).toBe('pending')
    if (status.kind === 'pending') expect(status.missing).toEqual(['bad'])
  })

  it('方位も距離も空の観測は数に入れない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [fix('t', [sighting('sp1', '90'), sighting('sp2', '', '')])],
    }
    expect(result_kind(solveSurvey(doc))).toEqual(['insufficient'])
  })

  it('砲座が未設定なら nest は null', () => {
    const doc: SurveyDoc = { known: [known('sp1', 'I9 9:1')], fixes: [] }
    expect(solveSurvey(doc).nest).toBeNull()
  })
})

const result_kind = (r: ReturnType<typeof solveSurvey>) => r.fixes.map((f) => f.status.kind)

describe('観測元に選べる点', () => {
  it('既知点はすべて選べる', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [fix('t', [])],
    }
    expect(availableSources(doc, 't').map((p) => p.id)).toEqual(['sp1', 'sp2'])
  })

  it('補給隊は目標の観測元には出さない', () => {
    // 補給隊は自機の位置を割り出すためだけの臨時の点
    const doc: SurveyDoc = {
      known: [
        known('nest', 'I6 5:3', true),
        known('sp1', 'I9 9:1'),
        { ...known('c1', 'M2'), parentId: 'nest' },
        { ...known('c2', 'F2'), parentId: 'nest' },
      ],
      fixes: [fix('t', [])],
    }
    expect(availableSources(doc, 't').map((p) => p.id)).toEqual(['nest', 'sp1'])
  })

  it('自機の現在地を割り出す標定も観測元には出さない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [fix(NEST_FIX_ID, []), fix('t', [])],
    }
    expect(availableSources(doc, 't').map((p) => p.id)).toEqual(['sp1'])
  })

  it('自分自身は選べない', () => {
    const doc: SurveyDoc = { known: [], fixes: [fix('a', []), fix('b', [])] }
    expect(availableSources(doc, 'a').map((p) => p.id)).toEqual(['b'])
  })

  it('自分を辿ってくる点は選べない（輪を作らせない）', () => {
    // b は a を見ている。a から b は選べない。
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [fix('a', []), fix('b', [sighting('a', '90')]), fix('c', [])],
    }
    expect(availableSources(doc, 'a').map((p) => p.id)).toEqual(['sp1', 'c'])
  })

  it('間接的に辿ってくる点も選べない', () => {
    const doc: SurveyDoc = {
      known: [],
      fixes: [fix('a', []), fix('b', [sighting('a', '90')]), fix('c', [sighting('b', '90')])],
    }
    expect(availableSources(doc, 'a').map((p) => p.id)).toEqual([])
  })
})

describe('標定の役割', () => {
  it('観測基準点の印が無い標定は、観測元に出さない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [fix('ref', [], { isReference: false }), fix('t', [])],
    }
    expect(availableSources(doc, 't').map((p) => p.id)).toEqual(['sp1'])
  })

  it('攻撃対象と観測基準点は独立に持てる', () => {
    // 撃つ相手であり、かつ他を測る基準でもある点
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1')],
      fixes: [fix('both', [], { isReference: true, isTarget: true }), fix('t', [])],
    }
    expect(availableSources(doc, 't').map((p) => p.id)).toEqual(['sp1', 'both'])
    expect(doc.fixes[0]!.isTarget).toBe(true)
  })
})

describe('候補の確定', () => {
  const target = at('F7 2:5')
  const s1 = at('I9 9:1')
  const s2 = at('K4 3:7')

  /** 円 2 つ。交点が 2 箇所に出るので候補が割れる。 */
  const ambiguous = (patch: Partial<Fix> = {}): SurveyDoc => ({
    known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
    fixes: [
      fix(
        't',
        [
          sighting('sp1', '', distanceBetween(s1, target).toFixed(4)),
          sighting('sp2', '', distanceBetween(s2, target).toFixed(4)),
        ],
        patch,
      ),
    ],
  })

  it('既定では解いた順のまま、候補が 2 つ残る', () => {
    const entry = solvedFix(solveSurvey(ambiguous()), 't')
    expect(entry.alternative).not.toBeNull()
  })

  it('候補 2 を選ぶと、そちらが本命になる', () => {
    const before = solvedFix(solveSurvey(ambiguous()), 't')
    const after = solvedFix(solveSurvey(ambiguous({ chosen: 2 })), 't')

    expect(after.position.x).toBeCloseTo(before.alternative!.x, 6)
    expect(after.position.y).toBeCloseTo(before.alternative!.y, 6)
  })

  it('確定したら、もう一方は候補として残さない', () => {
    expect(solvedFix(solveSurvey(ambiguous({ chosen: 2 })), 't').alternative).toBeNull()
    expect(solvedFix(solveSurvey(ambiguous({ chosen: 1 })), 't').alternative).toBeNull()
  })

  it('候補 1 を選んでも位置は変わらない', () => {
    const before = solvedFix(solveSurvey(ambiguous()), 't')
    const after = solvedFix(solveSurvey(ambiguous({ chosen: 1 })), 't')
    expect(after.position.x).toBeCloseTo(before.position.x, 6)
  })

  it('候補が 1 つしか無いときに指定しても壊れない', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [
        fix(
          't',
          [
            sighting('sp1', bearingTo('I9 9:1', 'F7 2:5')),
            sighting('sp2', bearingTo('K4 3:7', 'F7 2:5')),
          ],
          { chosen: 2 },
        ),
      ],
    }
    expect(formatPoint(solvedFix(solveSurvey(doc), 't').position)).toBe('F7 2:5')
  })
})

describe('実測で確かめた座標', () => {
  it('入っていれば三角測量より優先し、誤差 0 で確定する', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [
        fix(
          'ref',
          [
            sighting('sp1', bearingTo('I9 9:1', 'F7 2:5')),
            sighting('sp2', bearingTo('K4 3:7', 'F7 2:5')),
          ],
          { pinnedGrid: 'H5 0:0' },
        ),
      ],
    }
    const entry = solvedFix(solveSurvey(doc), 'ref')
    expect(formatPoint(entry.position)).toBe('H5 0:0') // 観測が指す F7 2:5 ではない
    expect(entry.pinned).toBe(true)
    expect(entry.residualKm).toBe(0)
    expect(entry.alternative).toBeNull()
  })

  it('観測がひとつも無くても確定する', () => {
    const doc: SurveyDoc = {
      known: [],
      fixes: [fix('ref', [], { pinnedGrid: 'C3 4:5' })],
    }
    expect(formatPoint(solvedFix(solveSurvey(doc), 'ref').position)).toBe('C3 4:5')
  })

  it('確定した点を観測元にすると、誤差を持ち越さない', () => {
    const ref = 'H5 0:0'
    const target = 'J3 0:0'
    const doc: SurveyDoc = {
      known: [known('sp3', 'E2 2:4')],
      fixes: [
        fix('ref', [], { pinnedGrid: ref }),
        fix('t', [
          sighting('ref', bearingTo(ref, target)),
          sighting('sp3', bearingTo('E2 2:4', target)),
        ]),
      ],
    }
    const entry = solvedFix(solveSurvey(doc), 't')
    expect(formatPoint(entry.position)).toBe(target)
    // 観測元が実測値なので、積み上がる誤差が無い
    expect(entry.accumulatedKm).toBeLessThan(0.001)
  })

  it('読めない座標なら、これまでどおり三角測量で解く', () => {
    const doc: SurveyDoc = {
      known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
      fixes: [
        fix(
          'ref',
          [
            sighting('sp1', bearingTo('I9 9:1', 'F7 2:5')),
            sighting('sp2', bearingTo('K4 3:7', 'F7 2:5')),
          ],
          { pinnedGrid: 'ZZ99' },
        ),
      ],
    }
    const entry = solvedFix(solveSurvey(doc), 'ref')
    expect(entry.pinned).toBe(false)
    expect(formatPoint(entry.position)).toBe('F7 2:5')
  })
})

describe('カードが追いかける点', () => {
  const target = at('F7 2:5')
  const s1 = at('I9 9:1')
  const s2 = at('K4 3:7')

  const ambiguous = (patch: Partial<Fix> = {}): SurveyDoc => ({
    known: [known('sp1', 'I9 9:1'), known('sp2', 'K4 3:7')],
    fixes: [
      fix(
        't',
        [
          sighting('sp1', '', distanceBetween(s1, target).toFixed(4)),
          sighting('sp2', '', distanceBetween(s2, target).toFixed(4)),
        ],
        patch,
      ),
    ],
  })

  const entry = (patch: Partial<Fix> = {}) =>
    solveSurvey(ambiguous(patch)).fixes.find((f) => f.fix.id === 't')!

  it('候補が 2 つあるうちは、指している方を追う', () => {
    const e = entry()
    expect(trackedPoint(e, 1)).toEqual(e.status.kind === 'solved' ? e.status.position : null)
    expect(trackedPoint(e, 2)).toEqual(e.alternative)
  })

  it('候補が 1 つになったら、番号によらず本命を追う', () => {
    // 実測座標が入れば候補は消える。候補 2 を指したままのカードも取り残さない
    const e = entry({ pinnedGrid: 'H5 2:2' })
    const pinned = e.status.kind === 'solved' ? e.status.position : null
    expect(trackedPoint(e, 1)).toEqual(pinned)
    expect(trackedPoint(e, 2)).toEqual(pinned)
    expect(trackedPoint(e, undefined)).toEqual(pinned)
  })

  it('解けていなければ追いかけない', () => {
    const doc: SurveyDoc = { known: [], fixes: [fix('t', [])] }
    const unsolved = solveSurvey(doc).fixes[0]!
    expect(trackedPoint(unsolved, 1)).toBeNull()
  })
})

describe('片づけに巻き込んでよいか', () => {
  it('ただの標定は消してよい', () => {
    const doc: SurveyDoc = { known: [], fixes: [fix('t', [])] }
    expect(isFixDurable(doc, 't')).toBe(false)
  })

  it('実測で確定した座標を持つ標定は残す', () => {
    // 観測員を失えばもう作り直せない情報なので、消えたら終わり
    const doc: SurveyDoc = { known: [], fixes: [fix('t', [], { pinnedGrid: 'H5 2:2' })] }
    expect(isFixDurable(doc, 't')).toBe(true)
  })

  it('読めない座標が入っているだけなら守らない', () => {
    const doc: SurveyDoc = { known: [], fixes: [fix('t', [], { pinnedGrid: 'ZZ99' })] }
    expect(isFixDurable(doc, 't')).toBe(false)
  })

  it('他の標定の観測元になっている標定は残す', () => {
    const doc: SurveyDoc = {
      known: [],
      fixes: [fix('ref', []), fix('t', [sighting('ref', '90')])],
    }
    expect(isFixDurable(doc, 'ref')).toBe(true)
    expect(isFixDurable(doc, 't')).toBe(false)
  })

  it('存在しない標定は守らない', () => {
    expect(isFixDurable({ known: [], fixes: [] }, 'nope')).toBe(false)
  })
})

describe('既知点として扱える標定', () => {
  it('実測座標を持つものだけを拾う', () => {
    const doc: SurveyDoc = {
      known: [],
      fixes: [
        fix('a', [], { pinnedGrid: 'H5 2:2' }),
        fix('b', []),
        fix('c', [], { pinnedGrid: 'ZZ99' }),
      ],
    }
    expect(settledFixes(doc).map((f) => f.id)).toEqual(['a'])
  })

  it('自機の現在地を割り出す標定は含めない', () => {
    const doc: SurveyDoc = {
      known: [],
      fixes: [fix(NEST_FIX_ID, [], { pinnedGrid: 'H5 2:2' })],
    }
    expect(settledFixes(doc)).toEqual([])
  })
})
