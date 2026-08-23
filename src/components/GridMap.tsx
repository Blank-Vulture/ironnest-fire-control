import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  formatPoint,
  pointFrom,
  type Point,
} from '../lib/grid'
import { parseBearing, parseDistance, type Target } from '../lib/targets'
import { NEST_FIX_ID, type SurveyDoc, type SurveyResult } from '../lib/survey'

interface Props {
  doc: SurveyDoc
  survey: SurveyResult
  /** 外から指している点（既知点の一覧にホバーしたときなど）。 */
  highlight: string | null
  onHighlight: (id: string | null) => void
  /** 描かない点。畳んだ区画の足場を地図にも出さないために使う。 */
  hidden?: ReadonlySet<string>
  /** 射撃順の中身。撃ち終えた標定を見分けるために見る。 */
  targets: readonly Target[]
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRST'

/**
 * ゲーム内のマーカートークンに合わせる。友軍が青、敵と目標が赤、自機が黄。
 *
 * 観測員はすべて青にすると誰の報告か追えなくなるので、色相は青のまま
 * 明るさだけを変えて見分ける。青の一族という括りは崩さない。
 */
const FRIENDLY_HUE = 205
const FRIENDLY_LIGHTNESS = [70, 58, 46, 78, 52] as const
const HOSTILE = 'hsl(6 74% 60%)'
const HOSTILE_DIM = 'hsl(6 44% 48%)'

/** 基準点。ゲーム内の A〜E トークンに合わせて緑。 */
const REFERENCE = 'hsl(142 52% 55%)'

/** 着弾点。味方でも敵でも基準点でもないので、白に寄せて独立させる。 */
const IMPACT = 'hsl(40 12% 82%)'

function friendlyColor(index: number): string {
  return `hsl(${FRIENDLY_HUE} 72% ${FRIENDLY_LIGHTNESS[index % FRIENDLY_LIGHTNESS.length]!}%)`
}

/** 地図の外まで伸ばすための長さ（km）。対角より長ければよい。 */
const RAY_KM = 25

/** 北を上にする。SVG は y が下向きなので、その場で反転させる。 */
const sy = (y: number) => MAP_HEIGHT_KM - y

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

/** 全体が入る初期の見え方。左と下に目盛りのぶんの余白を取る。 */
const FULL_VIEW: ViewBox = {
  x: -0.7,
  y: -0.5,
  w: MAP_WIDTH_KM + 1.2,
  h: MAP_HEIGHT_KM + 1.3,
}

/** 寄れる限界と引ける限界（横幅、km）。 */
const MIN_SPAN = 1.5
const MAX_SPAN = FULL_VIEW.w

interface Marker {
  id: string
  kind: 'nest' | 'known' | 'impact' | 'fix' | 'alt'
  /** 吹き出しに出す名前。候補が 2 つあるときは「目標 1（候補地 2）」のようになる。 */
  name: string
  at: Point
  color: string
  /** 撃ち終えた点。印に取り消しの輪を重ねる。 */
  struck?: boolean
  /** 撃破された観測員。印を抜いて、残っている観測員と見分ける。 */
  lost?: boolean
}

/**
 * 戦術地図。
 *
 * 距離の報告は円、方位の報告は直線で描く。交わるところが目標なので、
 * 数字だけでは掴みにくい「どこで決まっているか」が形で分かる。
 * ゲーム内の地図と同じく A1 が左下、T10 が右上。
 *
 * 拡大しても点や字が膨らまないよう、印と文字の大きさは倍率から逆算して
 * 画面上で一定に保つ。線は vector-effect で太さを固定する。
 */
export function GridMap({ doc, survey, highlight, onHighlight, hidden, targets }: Props) {
  const isHidden = (id: string) => hidden?.has(id) === true

  /** その標定を撃ち終えたか。ゲーム内で撃破に印が付くのと同じ扱いにする。 */
  const struck = (fixId: string) =>
    targets.some((t) => t.originFixId === fixId && (t.done || t.outcome === 'hit'))
  const wrapRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewBox>(FULL_VIEW)
  const [width, setWidth] = useState(900)
  const [hovered, setHovered] = useState<Marker | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  // 画面上の大きさを知らないと、倍率から画素数へ戻せない
  useLayoutEffect(() => {
    const element = wrapRef.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  /** 画面上の px を地図の km に直す。印や字の大きさをこれで決める。 */
  const perPixel = view.w / Math.max(width, 1)
  const px = (n: number) => n * perPixel

  /**
   * 観測元の色。自機は黄、観測員は青の濃淡、標定した点は赤。
   * その点から引いた円や線も同じ色になるので、どこからの報告か辿れる。
   */
  const spotters = doc.known.filter((k) => !k.isNest && k.kind !== 'reference')
  const colorOf = (id: string): string => {
    const point = doc.known.find((k) => k.id === id)
    if (point?.isNest === true) return 'var(--accent)'
    if (point?.kind === 'reference') return REFERENCE
    if (point?.kind === 'impact') return IMPACT
    const spotterIndex = spotters.findIndex((k) => k.id === id)
    if (spotterIndex >= 0) return friendlyColor(spotterIndex)
    // 撃って確かめた標定は、もう推定ではなく基準点として働いている
    const fix = doc.fixes.find((f) => f.id === id)
    if (fix?.isReference === true && fix.pinnedGrid !== undefined) return REFERENCE
    return HOSTILE
  }

  /* ---------- 描くもの ---------- */

  const rays: { id: string; fromId: string; from: Point; to: Point; color: string }[] = []
  const circles: { id: string; fromId: string; at: Point; radius: number; color: string }[] = []

  for (const fix of doc.fixes) {
    if (isHidden(fix.id)) continue
    for (const sight of fix.sightings) {
      const from = survey.positions.get(sight.fromId)
      if (from === undefined || isHidden(sight.fromId)) continue
      const color = colorOf(sight.fromId)

      const bearingDeg = parseBearing(sight.bearingInput)
      if (bearingDeg !== null) {
        rays.push({
          id: sight.id,
          fromId: sight.fromId,
          from,
          to: pointFrom(from, bearingDeg, RAY_KM),
          color,
        })
      }
      const rangeKm = parseDistance(sight.rangeInput)
      if (rangeKm !== null) {
        circles.push({ id: sight.id, fromId: sight.fromId, at: from, radius: rangeKm, color })
      }
    }
  }

  const markers: Marker[] = []
  for (const point of doc.known) {
    const at = survey.positions.get(point.id)
    if (at === undefined || isHidden(point.id)) continue
    markers.push({
      id: point.id,
      kind: point.isNest ? 'nest' : point.kind === 'impact' ? 'impact' : 'known',
      name: point.label,
      at,
      color: colorOf(point.id),
      lost: point.lost === true,
    })
  }
  for (const resolved of survey.fixes) {
    if (resolved.status.kind !== 'solved' || isHidden(resolved.fix.id)) continue
    const ambiguous = resolved.alternative !== null
    // 自機の現在地を割り出している点だけは敵ではないので、自機の色で描く
    const self = resolved.fix.id === NEST_FIX_ID
    markers.push({
      id: resolved.fix.id,
      kind: 'fix',
      name: ambiguous ? `${resolved.fix.label}（候補地 1）` : resolved.fix.label,
      at: resolved.status.position,
      color: self ? 'var(--accent)' : colorOf(resolved.fix.id),
      struck: struck(resolved.fix.id),
    })
    if (resolved.alternative !== null) {
      markers.push({
        id: `${resolved.fix.id}-alt`,
        kind: 'alt',
        name: `${resolved.fix.label}（候補地 2）`,
        at: resolved.alternative,
        color: self ? 'var(--accent-dim)' : HOSTILE_DIM,
      })
    }
  }

  const shown = markers.find((m) => m.id === picked) ?? hovered

  /**
   * いま注目している点。色相は種類（味方・敵・自機）に使い切っているので、
   * 「誰の報告か」はここで濃淡を切り替えて示す。
   * 1 人ぶんだけを浮き上がらせる方が、全部を色で塗り分けるより追いやすい。
   */
  const focused = picked ?? hovered?.id ?? highlight
  const dimmed = (id: string) => focused !== null && focused !== id

  /* ---------- 拡大・パン ---------- */

  const clamp = (next: ViewBox): ViewBox => {
    const w = Math.min(MAX_SPAN, Math.max(MIN_SPAN, next.w))
    const h = (w / FULL_VIEW.w) * FULL_VIEW.h
    // 地図の外まで流れていかないよう、中心を盤面の中に留める
    const cx = Math.min(MAP_WIDTH_KM, Math.max(0, next.x + next.w / 2))
    const cy = Math.min(MAP_HEIGHT_KM, Math.max(0, next.y + next.h / 2))
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }

  const zoomAt = (factor: number, anchor?: { x: number; y: number }) =>
    setView((current) => {
      const w = Math.min(MAX_SPAN, Math.max(MIN_SPAN, current.w * factor))
      const scale = w / current.w
      const point = anchor ?? { x: current.x + current.w / 2, y: current.y + current.h / 2 }
      // 掴んだ点が動かないように、左上を引き戻す
      return clamp({
        x: point.x - (point.x - current.x) * scale,
        y: point.y - (point.y - current.y) * scale,
        w,
        h: current.h * scale,
      })
    })

  /** 画面の座標を地図の座標に直す。 */
  const toMap = (clientX: number, clientY: number): Point => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * view.h,
    }
  }

  // ホイールでの拡大。ページごとスクロールしないよう passive を切る
  useEffect(() => {
    const element = wrapRef.current
    if (element === null) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(Math.exp(event.deltaY * 0.0015), toMap(event.clientX, event.clientY))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)

  const onPointerDown = (event: React.PointerEvent) => {
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinch.current = null
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId)
    if (previous === undefined) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const active = [...pointers.current.values()]
    const rect = wrapRef.current!.getBoundingClientRect()

    if (active.length >= 2) {
      // 二本指はつまみ拡大
      const span = Math.hypot(active[0]!.x - active[1]!.x, active[0]!.y - active[1]!.y)
      if (pinch.current !== null && span > 0) {
        zoomAt(pinch.current / span, toMap((active[0]!.x + active[1]!.x) / 2, (active[0]!.y + active[1]!.y) / 2))
      }
      pinch.current = span
      return
    }

    const dx = ((event.clientX - previous.x) / rect.width) * view.w
    const dy = ((event.clientY - previous.y) / rect.height) * view.h
    setView((current) => clamp({ ...current, x: current.x - dx, y: current.y - dy }))
  }

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const fit = () => setView(FULL_VIEW)

  // 全体を映しているうちは縦スクロールをページに譲る。幅いっぱいの面なので、
  // 指が地図に乗っただけでページを送れなくなると詰む。
  // 寄せてからは地図が指を受け取り、上下にも動かせるようにする。
  const zoomedIn = view.w < MAX_SPAN - 0.01

  return (
    <div
      className="mapwrap"
      ref={wrapRef}
      style={{ touchAction: zoomedIn ? 'none' : 'pan-y' }}
    >
      <svg
        className="map"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label="戦術地図。距離を円、方位を直線で表す"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(event) => {
          // 印以外を押したら選択を外す
          if ((event.target as Element).closest('.pin') === null) {
            setPicked(null)
            onHighlight(null)
          }
        }}
      >
        <defs>
          <clipPath id="map-field">
            <rect x="0" y="0" width={MAP_WIDTH_KM} height={MAP_HEIGHT_KM} />
          </clipPath>
        </defs>

        <rect className="map__field" x="0" y="0" width={MAP_WIDTH_KM} height={MAP_HEIGHT_KM} />

        <g className="map__grid">
          {Array.from({ length: MAP_WIDTH_KM + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i} y1={0} x2={i} y2={MAP_HEIGHT_KM} />
          ))}
          {Array.from({ length: MAP_HEIGHT_KM + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i} x2={MAP_WIDTH_KM} y2={i} />
          ))}
        </g>

        {/* 目盛りは見えている範囲の縁に貼り付ける。
            寄せたときこそ座標を読みたいのに、盤面の外に置くと画面から消えてしまう。 */}
        <g className="map__labels" fontSize={px(11)}>
          {LETTERS.split('').map((letter, i) => {
            const x = i + 0.5
            if (x < view.x || x > view.x + view.w) return null
            return (
              <text key={letter} x={x} y={view.y + view.h - px(7)}>
                {letter}
              </text>
            )
          })}
          {Array.from({ length: MAP_HEIGHT_KM }, (_, i) => {
            const y = sy(i + 0.5)
            if (y < view.y || y > view.y + view.h) return null
            return (
              <text key={i} x={view.x + px(11)} y={y + px(4)}>
                {i + 1}
              </text>
            )
          })}
        </g>

        <g clipPath="url(#map-field)">
          {circles.map((circle) => (
            <circle
              key={circle.id}
              className={`map__range${dimmed(circle.fromId) ? ' is-dim' : ''}`}
              cx={circle.at.x}
              cy={sy(circle.at.y)}
              r={circle.radius}
              stroke={circle.color}
            />
          ))}
          {rays.map((ray) => (
            <line
              key={ray.id}
              className={`map__bearing${dimmed(ray.fromId) ? ' is-dim' : ''}`}
              x1={ray.from.x}
              y1={sy(ray.from.y)}
              x2={ray.to.x}
              y2={sy(ray.to.y)}
              stroke={ray.color}
            />
          ))}
        </g>

        {markers.map((marker) => (
          <Pin
            key={marker.id}
            marker={marker}
            px={px}
            active={shown?.id === marker.id}
            dim={dimmed(marker.id)}
            onEnter={() => setHovered(marker)}
            onLeave={() => setHovered((h) => (h?.id === marker.id ? null : h))}
            onPick={() => setPicked((p) => (p === marker.id ? null : marker.id))}
          />
        ))}
      </svg>

      {shown !== null && (
        <Callout marker={shown} view={view} pinned={picked === shown.id} />
      )}

      <div className="mapzoom">
        <button onClick={() => zoomAt(1 / 1.4)} aria-label="拡大">
          ＋
        </button>
        <button onClick={() => zoomAt(1.4)} aria-label="縮小">
          −
        </button>
        <button onClick={fit} aria-label="全体を表示">
          全体
        </button>
      </div>
    </div>
  )
}

interface PinProps {
  marker: Marker
  px: (n: number) => number
  active: boolean
  dim: boolean
  onEnter: () => void
  onLeave: () => void
  onPick: () => void
}

function Pin({ marker, px, active, dim, onEnter, onLeave, onPick }: PinProps) {
  const { at, kind, name } = marker
  const cx = at.x
  const cy = sy(at.y)

  return (
    <g
      className={`pin pin--${kind}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}${
        marker.struck === true ? ' is-struck' : ''
      }${marker.lost === true ? ' is-lost' : ''}`}
      style={{ color: marker.color }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={onPick}
    >
      {kind === 'nest' && (
        <>
          <circle className="pin__ring" cx={cx} cy={cy} r={px(13)} />
          <path
            className="pin__cross"
            d={`M ${cx - px(20)} ${cy} H ${cx + px(20)} M ${cx} ${cy - px(20)} V ${cy + px(20)}`}
          />
        </>
      )}
      {kind === 'impact' && (
        // 着弾の跡。星形にして、観測員の丸とも標定の × とも取り違えないようにする
        <path
          className="pin__burst"
          d={`M ${cx} ${cy - px(9)} L ${cx + px(2.6)} ${cy - px(2.6)} L ${cx + px(9)} ${cy} L ${cx + px(2.6)} ${cy + px(2.6)} L ${cx} ${cy + px(9)} L ${cx - px(2.6)} ${cy + px(2.6)} L ${cx - px(9)} ${cy} L ${cx - px(2.6)} ${cy - px(2.6)} Z`}
        />
      )}

      {kind === 'known' &&
        (marker.lost === true ? (
          // 撃破された観測員。中を抜いて×を重ね、残っている観測員と見分ける
          <>
            <circle className="pin__gone" cx={cx} cy={cy} r={px(7)} />
            <path
              className="pin__gonemark"
              d={`M ${cx - px(5)} ${cy - px(5)} L ${cx + px(5)} ${cy + px(5)} M ${cx + px(5)} ${cy - px(5)} L ${cx - px(5)} ${cy + px(5)}`}
            />
          </>
        ) : (
          <circle className="pin__dot" cx={cx} cy={cy} r={px(7)} />
        ))}
      {kind === 'fix' && (
        <path
          className="pin__x"
          d={`M ${cx - px(11)} ${cy - px(11)} L ${cx + px(11)} ${cy + px(11)} M ${cx + px(11)} ${cy - px(11)} L ${cx - px(11)} ${cy + px(11)}`}
        />
      )}
      {kind === 'alt' && <circle className="pin__alt" cx={cx} cy={cy} r={px(11)} />}

      {/* 撃ち終えた印。ゲーム内で撃破に札が置かれるのに合わせる */}
      {marker.struck === true && (
        <circle className="pin__struck" cx={cx} cy={cy} r={px(15)} />
      )}

      <text
        className="pin__name"
        x={cx}
        y={
          kind === 'nest'
            ? cy - px(26)
            : kind === 'known' || kind === 'impact'
              ? cy - px(13)
              : cy + px(24)
        }
        fontSize={px(10)}
      >
        {marker.lost === true ? `${name}（撃破）` : name}
      </text>

      {/* 指でも掴めるだけの当たり判定。見た目には出さない */}
      <circle className="pin__hit" cx={cx} cy={cy} r={px(16)} />
    </g>
  )
}

function Callout({ marker, view, pinned }: { marker: Marker; view: ViewBox; pinned: boolean }) {
  const grid = formatPoint(marker.at) ?? 'マップ外'
  return (
    <div
      className={`callout${pinned ? ' is-pinned' : ''}`}
      style={{
        left: `${((marker.at.x - view.x) / view.w) * 100}%`,
        top: `${((sy(marker.at.y) - view.y) / view.h) * 100}%`,
      }}
      role="status"
    >
      <span className="callout__name">{marker.name}</span>
      <span className="callout__grid">{grid}</span>
    </div>
  )
}
