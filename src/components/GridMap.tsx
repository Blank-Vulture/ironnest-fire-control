import { MAP_HEIGHT_KM, MAP_WIDTH_KM, pointFrom, type Point } from '../lib/grid'
import { parseBearing, parseDistance } from '../lib/targets'
import type { SurveyDoc, SurveyResult } from '../lib/survey'

interface Props {
  doc: SurveyDoc
  survey: SurveyResult
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRST'

/** 観測元ごとに色を変える。線と円が重なっても、どこからの報告か追える。 */
const HUES = [42, 190, 275, 350, 145] as const

/** 地図の外まで伸ばすための長さ（km）。対角より長ければよい。 */
const RAY_KM = 25

/** 北を上にする。SVG は y が下向きなので、その場で反転させる。 */
const sy = (y: number) => MAP_HEIGHT_KM - y

/**
 * 戦術地図。
 *
 * 距離の報告は円、方位の報告は直線で描く。交わるところが目標なので、
 * 数字だけでは掴みにくい「どこで決まっているか」が形で分かる。
 * ゲーム内の地図と同じく A1 が左下、T10 が右上。
 */
export function GridMap({ doc, survey }: Props) {
  const sources = [...doc.known, ...doc.fixes]
  const hueOf = (id: string) => HUES[sources.findIndex((s) => s.id === id) % HUES.length]!

  const rays: { id: string; from: Point; to: Point; hue: number }[] = []
  const circles: { id: string; at: Point; radius: number; hue: number }[] = []

  for (const fix of doc.fixes) {
    for (const sighting of fix.sightings) {
      const from = survey.positions.get(sighting.fromId)
      if (from === undefined) continue
      const hue = hueOf(sighting.fromId)

      const bearingDeg = parseBearing(sighting.bearingInput)
      if (bearingDeg !== null) {
        rays.push({ id: sighting.id, from, to: pointFrom(from, bearingDeg, RAY_KM), hue })
      }

      const rangeKm = parseDistance(sighting.rangeInput)
      if (rangeKm !== null) {
        circles.push({ id: sighting.id, at: from, radius: rangeKm, hue })
      }
    }
  }

  return (
    <svg
      className="map"
      viewBox={`-0.7 -0.5 ${MAP_WIDTH_KM + 1.2} ${MAP_HEIGHT_KM + 1.3}`}
      role="img"
      aria-label="戦術地図。距離を円、方位を直線で表す"
    >
      <defs>
        <clipPath id="map-field">
          <rect x="0" y="0" width={MAP_WIDTH_KM} height={MAP_HEIGHT_KM} />
        </clipPath>
      </defs>

      <rect className="map__field" x="0" y="0" width={MAP_WIDTH_KM} height={MAP_HEIGHT_KM} />

      {/* 1km ごとのタイル */}
      <g className="map__grid">
        {Array.from({ length: MAP_WIDTH_KM + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i} y1={0} x2={i} y2={MAP_HEIGHT_KM} />
        ))}
        {Array.from({ length: MAP_HEIGHT_KM + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i} x2={MAP_WIDTH_KM} y2={i} />
        ))}
      </g>

      <g className="map__labels">
        {LETTERS.split('').map((letter, i) => (
          <text key={letter} x={i + 0.5} y={MAP_HEIGHT_KM + 0.62}>
            {letter}
          </text>
        ))}
        {Array.from({ length: MAP_HEIGHT_KM }, (_, i) => (
          <text key={i} x={-0.28} y={sy(i + 0.5) + 0.13}>
            {i + 1}
          </text>
        ))}
      </g>

      <g clipPath="url(#map-field)">
        {/* 距離の報告は円 */}
        {circles.map((circle) => (
          <circle
            key={circle.id}
            className="map__range"
            cx={circle.at.x}
            cy={sy(circle.at.y)}
            r={circle.radius}
            stroke={`hsl(${circle.hue} 70% 62%)`}
          />
        ))}

        {/* 方位の報告は直線 */}
        {rays.map((ray) => (
          <line
            key={ray.id}
            className="map__bearing"
            x1={ray.from.x}
            y1={sy(ray.from.y)}
            x2={ray.to.x}
            y2={sy(ray.to.y)}
            stroke={`hsl(${ray.hue} 70% 62%)`}
          />
        ))}
      </g>

      {/* 既知点 */}
      {doc.known.map((point) => {
        const at = survey.positions.get(point.id)
        if (at === undefined) return null
        return point.isNest ? (
          <g key={point.id} className="map__nest">
            <circle cx={at.x} cy={sy(at.y)} r="0.42" />
            <path
              d={`M ${at.x - 0.62} ${sy(at.y)} H ${at.x + 0.62} M ${at.x} ${sy(at.y) - 0.62} V ${sy(at.y) + 0.62}`}
            />
            <text x={at.x} y={sy(at.y) - 0.82}>
              {point.label}
            </text>
          </g>
        ) : (
          <g key={point.id} className="map__spot" style={{ color: `hsl(${hueOf(point.id)} 70% 62%)` }}>
            <circle cx={at.x} cy={sy(at.y)} r="0.22" />
            <text x={at.x} y={sy(at.y) - 0.42}>
              {point.label}
            </text>
          </g>
        )
      })}

      {/* 標定できた点 */}
      {survey.fixes.map((resolved) => {
        if (resolved.status.kind !== 'solved') return null
        const at = resolved.status.position
        return (
          <g key={resolved.fix.id} className="map__fix">
            <path
              d={`M ${at.x - 0.34} ${sy(at.y) - 0.34} L ${at.x + 0.34} ${sy(at.y) + 0.34} M ${at.x + 0.34} ${sy(at.y) - 0.34} L ${at.x - 0.34} ${sy(at.y) + 0.34}`}
            />
            <text x={at.x} y={sy(at.y) + 0.78}>
              {resolved.fix.label}
            </text>
          </g>
        )
      })}

      {/* もう一方の候補 */}
      {survey.fixes.map((resolved) =>
        resolved.alternative === null ? null : (
          <g key={`alt-${resolved.fix.id}`} className="map__alt">
            <circle cx={resolved.alternative.x} cy={sy(resolved.alternative.y)} r="0.34" />
            <text x={resolved.alternative.x} y={sy(resolved.alternative.y) + 0.78}>
              もう一方
            </text>
          </g>
        ),
      )}
    </svg>
  )
}
