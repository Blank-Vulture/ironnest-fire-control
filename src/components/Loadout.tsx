import { useEffect, useRef, useState } from 'react'
import { SIDES, SIDE_LABEL, type Side } from '../lib/guns'
import type { ShellCode } from '../lib/shells'
import type { PlanStep } from '../lib/targets'
import { ShellRound } from './ShellRound'
import { Turret } from './Turret'

interface Props {
  /** 射撃順に並んだ、まだ撃っていない射撃。 */
  steps: readonly PlanStep[]
}

/** 揚弾筒 1 基あたりの即応弾数。砲座には 2 基あって計 12 発。 */
const READY_ROUNDS = 6

/** 弾 1 発ぶんの間隔（px）。位置を計算で置くのでアニメーションが繋がる。 */
const PITCH = 24

/** 廃莢の見せ時間（ms）。CSS 側の animation と合わせる。 */
const EJECT_MS = 460

interface Slot {
  id: string
  code: ShellCode
  side: Side
  /** 砲塔側から数えた位置。0 が次に撃つ 1 発。 */
  index: number
  order: number
}

function slotsOf(steps: readonly PlanStep[]): Map<string, Slot> {
  const slots = new Map<string, Slot>()
  for (const side of SIDES) {
    steps
      .filter((step) => step.gun === side)
      .slice(0, READY_ROUNDS)
      .forEach((step, index) => {
        slots.set(step.solution.target.id, {
          id: step.solution.target.id,
          code: step.solution.target.shell,
          side,
          index,
          order: step.order,
        })
      })
  }
  return slots
}

/**
 * 装填の見取り図。
 *
 * 砲塔の図の左右の余白に、その砲がこれから撃つ弾を上向きに並べる。
 * ローダーが左右で独立しているので、どちらに何を込めればよいかを
 * 弾の並びそのもので示す。次に撃つ砲は砲身と L / R が橙になる。
 *
 * 弾は砲塔側の端から詰める。撃ち終えた弾が抜けると残りが砲へ送られ、
 * 先頭が橙になる ＝ 次弾が装填された、という動きになる。
 */
export function Loadout({ steps }: Props) {
  const nextSide = steps[0]?.gun ?? null

  const slots = slotsOf(steps)
  const previous = useRef<Map<string, Slot>>(new Map())
  const [spent, setSpent] = useState<Slot[]>([])

  useEffect(() => {
    // 前回あって今回無いものが、撃たれて抜けた弾。抜ける前の位置で描く。
    const gone = [...previous.current.values()].filter((slot) => !slots.has(slot.id))
    previous.current = slots

    if (gone.length === 0) return
    setSpent((prev) => [...prev, ...gone])

    const ids = new Set(gone.map((slot) => slot.id))
    const timer = window.setTimeout(
      () => setSpent((prev) => prev.filter((slot) => !ids.has(slot.id))),
      EJECT_MS,
    )
    return () => window.clearTimeout(timer)
    // slots は毎回作り直されるので、steps の変化だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])

  /** 砲塔側の端を 0 として、外へ向かって置く。左右で鏡像になる。 */
  const place = (side: Side, index: number) =>
    side === 'left' ? { right: index * PITCH } : { left: index * PITCH }

  return (
    <div className="loadout">
      {SIDES.map((side) => {
        const rounds = steps.filter((step) => step.gun === side)
        const shown = rounds.slice(0, READY_ROUNDS)
        const overflow = rounds.length - shown.length

        return (
          <div
            key={side}
            className={`mag mag--${side}`}
            // 弾架と見出しの幅を揃える。見出しだけ横に伸びると弾の並びと切れて見える。
            style={{ ['--rack-width' as string]: `${READY_ROUNDS * PITCH}px` }}
          >
            <div className="mag__rack">
              {shown.map((step, index) => (
                <ShellRound
                  key={step.solution.target.id}
                  code={step.solution.target.shell}
                  order={step.order}
                  next={index === 0}
                  imminent={side === nextSide}
                  style={place(side, index)}
                />
              ))}

              {spent
                .filter((slot) => slot.side === side)
                .map((slot) => (
                  <ShellRound
                    key={`spent-${slot.id}`}
                    code={slot.code}
                    order={slot.order}
                    ejecting
                    style={place(side, slot.index)}
                  />
                ))}

              {overflow > 0 && <span className="mag__overflow">+{overflow}</span>}
            </div>

            <p className="mag__label">
              {SIDE_LABEL[side]}
              <span className="mag__count">
                {rounds.length > 0 ? `${rounds.length} 発` : '無し'}
              </span>
            </p>
          </div>
        )
      })}

      <Turret firstSide={nextSide} />
    </div>
  )
}
