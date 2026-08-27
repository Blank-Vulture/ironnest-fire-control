import { useEffect, useState } from 'react'
import { ROUTE_TITLE, type Route } from '../lib/route'

interface StickyNavProps {
  route: Route
  go: (route: Route) => void
  /** FIRE CONTROL 側の待ち件数（plan.steps.length）。0 なら数を出さない。 */
  fireCount: number
}

/**
 * 常に置いておく画面切り替えボタン。
 *
 * PLOTTING で目標を積むほどページは縦に伸びる。積んだ直後に FIRE CONTROL
 * へ移るたびいちばん上まで戻ってタブを押す羽目になるので、その手間を
 * ここで肩代わりする。ただし上部のタブが見えているうちは同じ役目のボタンが
 * 二重に画面へ居座るだけなので、タブを見失ったときだけ出す。
 */
export function StickyNav({ route, go, fireCount }: StickyNavProps) {
  // タブが画面内にあるかどうか。ここが false になった瞬間だけボタンを出す。
  const [tabsHidden, setTabsHidden] = useState(false)

  useEffect(() => {
    // 既存の <nav className="tabs"> をそのまま観測対象にする。App.tsx に
    // ref を新設せずに済むので、タブ側の実装には一切触れずに追加できる。
    const tabs = document.querySelector('nav.tabs')
    if (tabs === null) return

    /*
     * 「見えなくなったか」だけで判定する。
     *
     * threshold を 1 にして intersectionRatio < 1 で見ると、要素の高さが
     * 小数（実測 43.5px）のせいで全部見えていても比率が 1 に届かず、
     * ページの先頭から出っぱなしになる。端数の出方は字の大きさや倍率で
     * 変わるので、比率で見ること自体をやめる。
     */
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry === undefined) return
        setTabsHidden(!entry.isIntersecting)
      },
      { threshold: 0 },
    )
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [])

  const next: Route = route === 'fire' ? 'plotting' : 'fire'
  const label = `${ROUTE_TITLE[next].name} へ`

  return (
    <button
      type="button"
      className={`stickynav${tabsHidden ? ' is-shown' : ''}`}
      onClick={() => go(next)}
      // タブを見ている間は操作の対象にしない。隠れたままでもクリックできて
      // しまうと、見えないボタンにキーボードやスクリーンリーダーの
      // フォーカスが飛んで迷子になる。
      aria-hidden={tabsHidden ? undefined : true}
      tabIndex={tabsHidden ? undefined : -1}
    >
      {label}
      {/* 添えるのは FIRE CONTROL 側の件数だけ。PLOTTING に何件あるかは
          タブ自体には出ていないので、ここで急に出すと基準がぶれる。 */}
      {next === 'fire' && fireCount > 0 && (
        <span className="stickynav__count">{fireCount}</span>
      )}
    </button>
  )
}
