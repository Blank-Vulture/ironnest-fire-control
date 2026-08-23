import { adviseFix, type Advice } from '../lib/advice'
import type { Accuracy } from '../lib/accuracy'
import type { Point } from '../lib/grid'
import type { ShellCode } from '../lib/shells'
import type { Observation } from '../lib/triangulate'

interface Props {
  position: Point
  alternative: Point | null
  accuracy: Accuracy
  observations: readonly Observation[]
  shell: ShellCode
}

const ICON: Record<Advice['kind'], string> = {
  ready: '✓',
  observe: '◎',
  star: '☀',
  recon: '✈',
  decide: '?',
}

/**
 * 次に何をすべきかの見立て。
 *
 * 見込み誤差の数字だけ出しても、どうすれば縮むのかは分からない。
 * 観測を足すならどの方角から見てもらうか、照明弾や偵察飛行を使うなら
 * どこへ撃つのかまで出す。
 */
export function FixAdvice(props: Props) {
  const advice = adviseFix(props)
  if (advice.length === 0) return null

  return (
    <ul className="advice">
      {advice.map((item) => (
        <li key={`${item.kind}-${item.headline}`} className={`advice__item is-${item.kind}`}>
          <span className="advice__icon" aria-hidden>
            {ICON[item.kind]}
          </span>
          <div className="advice__body">
            <p className="advice__headline">
              {item.headline}
              {item.atGrid !== undefined && <span className="advice__at">{item.atGrid}</span>}
            </p>
            <p className="advice__detail">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
