import { clsx } from "clsx"
import { toneFromLifecycleState, type WorkbenchInsightTone } from "../../context/WorkbenchInsightContext"

const toneClassNames: Record<WorkbenchInsightTone, string> = {
  neutral:
    "border-[color-mix(in_srgb,var(--vscode-descriptionForeground)_28%,transparent)] bg-[color-mix(in_srgb,var(--vscode-descriptionForeground)_12%,var(--vscode-editor-background))] text-[color-mix(in_srgb,var(--vscode-descriptionForeground)_72%,white_28%)]",
  success: "border-success/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_84%,green_16%)] text-success",
  warning:
    "border-[color-mix(in_srgb,var(--vscode-warningForeground)_38%,transparent)] bg-[color-mix(in_srgb,var(--vscode-warningForeground)_18%,var(--vscode-editor-background))] text-[color-mix(in_srgb,var(--vscode-warningForeground)_82%,white_18%)]",
  danger:
    "border-[color-mix(in_srgb,var(--vscode-errorForeground)_40%,transparent)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_16%,var(--vscode-editor-background))] text-[color-mix(in_srgb,var(--vscode-errorForeground)_84%,white_16%)]",
}

function lifecycleStateClassName(state: string | undefined): string | undefined {
  const normalized = state?.trim().toUpperCase()
  if (normalized === "STOPPED") {
    return "border-[color-mix(in_srgb,var(--vscode-warningForeground)_46%,transparent)] bg-[color-mix(in_srgb,var(--vscode-warningForeground)_22%,var(--vscode-editor-background))] text-[color-mix(in_srgb,var(--vscode-warningForeground)_78%,white_22%)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--vscode-warningForeground)_12%,transparent)]"
  }
  return undefined
}

interface StatusBadgeProps {
  label: string
  tone?: WorkbenchInsightTone
  className?: string
  title?: string
  size?: "default" | "compact"
}

interface LifecycleBadgeProps {
  state?: string
  fallbackLabel?: string
  className?: string
  size?: "default" | "compact"
}

export default function StatusBadge({
  label,
  tone = "neutral",
  className,
  title,
  size = "default",
}: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        "shrink-0 border font-medium uppercase",
        size === "compact"
          ? "rounded-md px-1.5 py-0 text-[9px] leading-4 tracking-[0.12em]"
          : "rounded-full px-2 py-0.5 text-[10px] tracking-[0.14em]",
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
  size = "default",
}: LifecycleBadgeProps) {
  const label = state?.trim() || fallbackLabel
  return (
    <StatusBadge
      label={label}
      tone={toneFromLifecycleState(state)}
      size={size}
      className={clsx(lifecycleStateClassName(state), className)}
    />
  )
}
