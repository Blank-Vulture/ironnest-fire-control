/**
 * 実戦の配置をそのまま置いたテスト。
 *
 * 遊んでいる最中の画面をそのまま持ってきてある。単体のテストは 1 つの働きしか
 * 見ないので、組み合わさったときに数字がおかしくなっても気づけない。
 * 「ATMC を選んでいるのに五分五分と出る」はその類で、部品はどれも正しかった。
 *
 * 座標・報告・候補・射撃諸元まで実測値で固定してあるので、どこかを直したときに
 * 何がどう動いたかがここに出る。
 */
import { describe, expect, it } from 'vitest'
import { bearingBetween, distanceBetween, formatPoint, gridToPoint, parseGrid } from './grid'
import { solveSurvey, type SurveyDoc } from './survey'
import { estimateAccuracy, hitChance, prospect } from './accuracy'
import { adviseFix } from './advice'
import { shellByCode, type ShellCode } from './shells'

const NEST = 'I6 5:3'

/**
 * 偵察兵 2 人からの距離だけで解く配置。方位は報告に無い。
 *
 * 2 円がほとんど接しているため候補が 2 つ出て、しかも 868m しか離れない。
 * 交わりが浅いので、観測元の 100m マスがそのまま 1km 以上に化ける。
 */
const doc: SurveyDoc = {
  known: [
    { id: 'nest', label: 'IRON NEST', gridInput: NEST, isNest: true },
    { id: 's1', label: '偵察兵#1', gridInput: 'Q9 3:7', kind: 'spotter', isNest: false },
    { id: 's2', label: '偵察兵#2', gridInput: 'L5 3:3', kind: 'spotter', isNest: false },
    { id: 's3', label: '偵察兵#3', gridInput: 'M1 5:5', kind: 'spotter', isNest: false },
  ],
  fixes: [
    {
      id: 'f3',
      label: '目標#3',
      shell: 'ATMC',
      isTarget: true,
      isReference: false,
      sightings: [
        { id: 'a', fromId: 's3', bearingInput: '', rangeInput: '5.11' },
        { id: 'b', fromId: 's1', bearingInput: '', rangeInput: '3.97' },
      ],
    },
  ],
}

const solved = () => {
  const entry = solveSurvey(doc).fixes.find((f) => f.fix.id === 'f3')!
  if (entry.status.kind !== 'solved') throw new Error(entry.status.kind)
  return { ...entry, position: entry.status.position }
}

const advise = (shell: ShellCode) => {
  const entry = solved()
  return adviseFix({
    position: entry.position,
    alternative: entry.alternative,
    accuracy: estimateAccuracy(entry.observations, entry.position),
    observations: entry.observations,
    shell,
  })
}

describe('実戦の配置', () => {
  it('画面に出ていた位置と候補をそのまま出す', () => {
    const entry = solved()
    expect(formatPoint(entry.position)).toBe('O6 2:3')
    expect(formatPoint(entry.alternative!)).toBe('P5 0:9')
    // 候補が近すぎて、間を照らせば両方が視野に入る
    expect(Math.round(distanceBetween(entry.position, entry.alternative!) * 1000)).toBe(868)
  })

  it('画面に出ていた射撃諸元をそのまま出す', () => {
    const entry = solved()
    const nest = gridToPoint(parseGrid(NEST)!)
    expect(bearingBetween(nest, entry.position).toFixed(1)).toBe('90.0')
    expect(distanceBetween(nest, entry.position).toFixed(2)).toBe('5.75')
  })

  it('ほとんど接する 2 円なので、観測元のマスが数百 m に開く', () => {
    const entry = solved()
    const accuracy = estimateAccuracy(entry.observations, entry.position)
    expect(Math.round(accuracy.radiusKm * 1000)).toBe(272)
    // 距離は小数 2 桁まで読めていて ±5m しかない。効いているのは座標のほう
    expect(accuracy.contributions[0]!.cause).toBe('position')
  })

  it('候補の入れ替わりを誤差に数えない', () => {
    /*
     * 解き直すたびに、どちらの候補を「本命」と名乗るかが入れ替わる。
     * 返ってきた position をそのまま測っていた頃は、追っている点の動きでは
     * なく候補の入れ替わりを測ってしまい、候補間の 868m ぶんが誤差に化けて
     * ±1745m と出ていた。候補が 2 つ離れているほど大きく出るという、
     * 誤差としてはあべこべな振る舞いになる。
     */
    const entry = solved()
    const accuracy = estimateAccuracy(entry.observations, entry.position)
    const apart = distanceBetween(entry.position, entry.alternative!)
    expect(accuracy.radiusKm).toBeLessThan(apart)
  })

  it('報告どうしは矛盾していない。食い違いだけ見ても危うさは分からない', () => {
    expect(solved().residualKm).toBeLessThan(0.001)
  })
})

describe('実戦の配置 · 弾種ごとの見立て', () => {
  /*
   * 見込み誤差は ±1745m で固定。効果半径だけが変わる。
   * ここが弾種によって正しく入れ替わることを見る。
   */
  const radius = () => estimateAccuracy(solved().observations, solved().position).radiusKm

  const table: [ShellCode, number, number, string][] = [
    // 弾種, 効果半径 km, 命中の見込み %, 判定
    ['ATMC', 3.0, 100, 'good'],
    ['SMK', 1.0, 100, 'good'],
    ['CYAN', 0.75, 99, 'good'],
    ['HE', 0.25, 64, 'fair'],
    ['AP', 0.15, 42, 'marginal'],
  ]

  for (const [code, effectRadiusKm, percent, verdict] of table) {
    it(`${code}（効果半径 ${effectRadiusKm * 1000}m）は 命中 ${percent}% で ${verdict}`, () => {
      expect(shellByCode(code).radiusKm).toBe(effectRadiusKm)
      expect(Math.round(hitChance(radius(), effectRadiusKm) * 100)).toBe(percent)
      expect(prospect(radius(), effectRadiusKm)).toBe(verdict)
    })
  }

  it('ATMC では、当たらないかのような見立てを出さない', () => {
    // 効果半径 3000m に対して誤差は ±272m しかない
    const headlines = advise('ATMC').map((a) => a.headline)
    expect(headlines.some((h) => /五分五分|外れる公算|確実ではない/.test(h))).toBe(false)
  })

  it('効果半径が誤差に近づくほど、見立てが辛くなる', () => {
    expect(advise('HE').some((a) => a.headline.includes('確実ではない'))).toBe(true)
    expect(advise('AP').some((a) => a.headline.includes('五分五分'))).toBe(true)
  })

  it('候補が割れているうちは、照らす話を二重に出さない', () => {
    /*
     * 「候補を 1 つに絞る」がすでに照らす場所を出している。そこへ別の座標で
     * 照明弾・偵察飛行の話を重ねると、「間を照らせば両方を確かめられます」と
     * 「照らしきれません」が同じ画面に並んでしまう。
     */
    const kinds = advise('ATMC').map((a) => a.kind)
    expect(kinds).toContain('decide')
    expect(kinds).not.toContain('star')
    expect(kinds).not.toContain('recon')
  })

  it('弾種によらず、まず候補を 1 つに絞れと言う', () => {
    for (const [code] of table) {
      expect(advise(code)[0]!.kind).toBe('decide')
    }
  })
})
