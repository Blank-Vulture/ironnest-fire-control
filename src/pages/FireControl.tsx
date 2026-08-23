import { FiringPlan } from '../components/FiringPlan'
import { TargetIntake } from '../components/TargetIntake'
import { isShellCode } from '../lib/shells'
import type {
  ChargeSetting,
  FiringPlan as Plan,
  GunSetting,
  Measurement,
  Target,
} from '../lib/targets'

interface Props {
  plan: Plan
  targetCount: number
  onAdd: (measurements: Measurement[]) => void
  onPatch: (id: string, change: Partial<Target>) => void
  onToggleDone: (id: string) => void
  onReportOutcome: (id: string, outcome: 'hit' | 'miss') => void
  verifyFixIds: ReadonlySet<string>
  onRemove: (id: string) => void
  onClear: () => void
}

export function FireControl({
  plan,
  targetCount,
  onAdd,
  onPatch,
  onToggleDone,
  onReportOutcome,
  verifyFixIds,
  onRemove,
  onClear,
}: Props) {
  return (
    <>
      <TargetIntake onAdd={onAdd} />

      <FiringPlan
        plan={plan}
        onShell={(id, code) => isShellCode(code) && onPatch(id, { shell: code })}
        onCharge={(id, charge: ChargeSetting) => onPatch(id, { charge })}
        onGun={(id, gun: GunSetting) => onPatch(id, { gun })}
        onImpact={(id, impactDigits) => onPatch(id, { impactDigits })}
        onToggleDone={onToggleDone}
        onReportOutcome={onReportOutcome}
        verifyFixIds={verifyFixIds}
        onRemove={onRemove}
      />

      {targetCount > 0 && (
        <button className="clear" onClick={onClear}>
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
    </>
  )
}
