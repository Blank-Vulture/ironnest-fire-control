import { useState } from 'react'

/**
 * このアプリが localStorage で使う接頭辞。
 * 版が上がって古いキーが残っていても、まとめて拾えるようにしてある。
 */
const PREFIX = 'iron-nest-timing/'

/** 消える保存の数。押す前に何が消えるか分かるように数えておく。 */
function savedKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null && key.startsWith(PREFIX)) keys.push(key)
  }
  return keys
}

/**
 * 保存をまるごと捨てる。
 *
 * 表記を変えても、すでに保存された文字列までは変わらない。「観測員」と呼んで
 * いた頃に置いた偵察兵は、その名前のまま残り続ける。名前は手で直せる値なので、
 * 既定値を変えても過去のぶんには届かない。捨てる手段が無いと、古い呼び名を
 * 抱えたまま使うことになる。
 *
 * localStorage.clear() は使わない。GitHub Pages は <ユーザ名>.github.io という
 * 1 つのオリジンを全リポジトリで共有するので、同じところに置いた別のページの
 * 保存まで巻き添えにする。このアプリの接頭辞が付いたものだけを消す。
 *
 * 元に戻せないので、一度で消えないようにしてある。↩ の取り消しも効かない。
 */
export function HardReset() {
  // 押した時点の件数。描画のたびに数えると、アプリが保存を書き直した
  // ぶんに追随できず、実際と食い違った件数が出たままになる。
  const [armed, setArmed] = useState<number | null>(null)

  if (armed === null) {
    return (
      <button className="reset__arm" onClick={() => setArmed(savedKeys().length)}>
        保存をすべて消す
      </button>
    )
  }

  return (
    <div className="reset__confirm">
      <p className="reset__warn">
        偵察兵・基準点・標定・射撃順が {armed} 件の保存ごと消えます。
        取り消しは効きません
      </p>
      <button
        className="reset__go"
        onClick={() => {
          for (const key of savedKeys()) localStorage.removeItem(key)
          // 画面が持っている状態も捨てたいので、読み直しから始める
          window.location.reload()
        }}
      >
        消す
      </button>
      <button className="reset__cancel" onClick={() => setArmed(null)}>
        やめる
      </button>
    </div>
  )
}
