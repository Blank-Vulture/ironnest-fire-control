import { useEffect, useState } from 'react'

/**
 * 画面。GitHub Pages は静的配信なので、履歴 API ではなくハッシュで切り替える。
 * サーバ側の書き換え規則も 404 フォールバックも要らない。
 */
export const ROUTES = ['fire', 'plotting'] as const
export type Route = (typeof ROUTES)[number]

export const ROUTE_TITLE: Record<Route, { name: string; jp: string; note: string }> = {
  fire: {
    name: 'FIRE CONTROL',
    jp: '射撃管制',
    note: '方位角 / 射程 → 仰角 · 装薬 · 飛翔時間 · 発射時刻',
  },
  plotting: {
    name: 'PLOTTING',
    jp: '標定',
    note: '観測員の報告から目標の位置を割り出す',
  },
}

const HASH: Record<Route, string> = { fire: '#/', plotting: '#/plotting' }

function readHash(): Route {
  return window.location.hash.startsWith('#/plotting') ? 'plotting' : 'fire'
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash)

  useEffect(() => {
    const onChange = () => setRoute(readHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  // タブや履歴から、いまどちらの画面かが分かるようにしておく
  useEffect(() => {
    const { name, jp } = ROUTE_TITLE[route]
    document.title = `Iron Nest ${name} — ${jp}`
  }, [route])

  return [route, (next) => { window.location.hash = HASH[next] }]
}
