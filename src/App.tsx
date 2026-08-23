import { useCallback, useEffect, useMemo, useState } from 'react'
import { FiringPlan } from './components/FiringPlan'
import { TargetIntake } from './components/TargetIntake'
import { isShellCode } from './lib/shells'
import {
  buildPlan,
  newTarget,
  type ChargeSetting,
  type GunSetting,
  type Measurement,
  type Target,
} from './lib/targets'

const STORAGE_KEY = 'iron-nest-timing/v4'

function load(): Target[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // 形が違うものは黙って捨てる。壊れた保存で起動できなくなる方が困る。
    return parsed.filter(
      (t): t is Target =>
        typeof t?.id === 'string' &&
        Number.isFinite(t?.bearingDeg) &&
        Number.isFinite(t?.distanceKm) &&
        typeof t?.shell === 'string' &&
        typeof t?.impactDigits === 'string' &&
        typeof t?.flightOverride === 'string',
    )
  } catch {
    return []
  }
}

export function App() {
  const [targets, setTargets] = useState<Target[]>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
    } catch {
      // プライベートモード等で書けなくても動作自体は続ける
    }
  }, [targets])

  const plan = useMemo(() => buildPlan(targets), [targets])

  const patch = useCallback(
    (id: string, change: Partial<Target>) =>
      setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t))),
    [],
  )

  const add = useCallback(
    (measurements: Measurement[]) =>
      setTargets((prev) => [
        ...prev,
        ...measurements.map((m) => newTarget(m.bearingDeg, m.distanceKm)),
      ]),
    [],
  )

  const remove = useCallback(
    (id: string) => setTargets((prev) => prev.filter((t) => t.id !== id)),
    [],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          IRON NEST <span className="topbar__accent">FIRE CONTROL</span>
        </h1>
        <p className="topbar__sub">方位角 / 射程 → 仰角 · 装薬 · 飛翔時間 · 発射時刻</p>
      </header>

      <TargetIntake onAdd={add} />

      <FiringPlan
        plan={plan}
        onShell={(id, code) => isShellCode(code) && patch(id, { shell: code })}
        onCharge={(id, charge: ChargeSetting) => patch(id, { charge })}
        onGun={(id, gun: GunSetting) => patch(id, { gun })}
        onImpact={(id, impactDigits) => patch(id, { impactDigits })}
        onFlightOverride={(id, flightOverride) => patch(id, { flightOverride })}
        onRemove={remove}
      />

      {targets.length > 0 && (
        <button className="clear" onClick={() => setTargets([])}>
          目標をすべて消す
        </button>
      )}

      <footer className="footnote">
        <p>
          仰角 <code>= 距離 × 12 ÷ 装薬数</code>、装薬 N の射程は <code>5N km</code>。
          飛翔時間は <code>距離 ÷ 弾速</code>、弾速は <code>0.7 × [0.3 + 0.7 × (3u² − 2u³)]</code>（
          <code>u = (装薬数 − 1) ÷ 5</code>）。いずれもゲーム内の弾道計算機と同じ式です。
        </p>
        <p>
          砲塔の旋回は左右共通なので、方位が近い順に並べて左右の砲を交互に使えば、
          撃つたびの旋回が最小で済みます。<strong>総旋回</strong>が全目標を撃ち終えるまでの合計です。
        </p>
        <p>
          着弾時刻を入れた目標だけ発射時刻を出します。着弾時刻も飛翔時間もゲーム内の時間軸なので、
          発射時刻もそのままゲーム内時計で読めます。飛翔時間は発射レバーから砲弾が出るまでの
          わずかな間を含みません。
        </p>
      </footer>
    </div>
  )
}
