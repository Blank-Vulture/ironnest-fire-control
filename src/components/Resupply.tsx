import { READY_ROUNDS_PER_GUN, SIDE_LABEL, type Side } from '../lib/guns'
import { shellByCode } from '../lib/shells'
import type { PlanStep } from '../lib/targets'

interface Props {
  side: Side
  /** 補給して撃つぶんを、補給する順に。 */
  queue: readonly PlanStep[]
}

/**
 * 補給の指示。
 *
 * 弾倉に入るのは片側 6 発までなので、それを超える目標を抱えている砲は
 * 途中で揚弾が要る。射撃順のうち即応弾を撃ち切る位置にこれを挟んで、
 * 何を何発目に上げればよいかをそのまま読めるようにする。
 */
export function Resupply({ side, queue }: Props) {
  if (queue.length === 0) return null

  return (
    <aside className={`resupply resupply--${side}`}>
      <header className="resupply__head">
        <span className="resupply__mark" aria-hidden>
          ▲
        </span>
        <div>
          <p className="resupply__title">{SIDE_LABEL[side]} — 下記の弾を補給してください</p>
          <p className="resupply__note">
            弾倉の即応弾 {READY_ROUNDS_PER_GUN} 発をここで撃ち切ります
          </p>
        </div>
      </header>

      <ol className="resupply__list">
        {queue.map((step, i) => {
          const shell = shellByCode(step.solution.target.shell)
          return (
            <li key={step.solution.target.id}>
              <span className="resupply__nth">{i + 1} 発目</span>
              <span className="resupply__code">{shell.code}</span>
              <span className="resupply__name">{shell.jp}</span>
              <span className="resupply__order">射撃順 {step.order}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
