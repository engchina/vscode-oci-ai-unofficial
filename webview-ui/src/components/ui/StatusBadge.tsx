import { clsx } from "clsx"
import { toneFromLifecycleState, type WorkbenchInsightTone } from "../../context/WorkbenchInsightContext"

const toneClassNames: Record<WorkbenchInsightTone, string> = {
  neutral: "border-[var(--vscode-panel-border)] text-[var(--vscode-descriptionForeground)]",
  success: "border-success/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_84%,green_16%)] text-success",
  warning: "border-[color-mix(in_srgb,var(--vscode-warningForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,yellow_12%)] text-[var(--vscode-warningForeground)]",
  danger: "border-[color-mix(in_srgb,var(--vscode-errorForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,red_12%)] text-[var(--vscode-errorForeground)]",
}

interface StatusBadgeProps {
  label: string
  tone?: WorkbenchInsightTone
  className?: string
  title?: string
}

interface LifecycleBadgeProps {
  state?: string
  fallbackLabel?: string
  className?: string
}

export default function StatusBadge({
  label,
  tone = "neutral",
  className,
  title,
}: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
        toneClassNames[tone],
        className,
      )}
    >
      {label}
    </span>
  )
}

export function LifecycleBadge({
  state,
  fallbackLabel = "Unknown",
  className,
}: LifecycleBadgeProps) {
  const label = state?.trim() || fallbackLabel
  return (
    <StatusBadge
      label={label}
      tone={toneFromLifecycleState(state)}
      className={className}
    />
  )
}
