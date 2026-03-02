import { clsx } from "clsx"
import type { ReactNode } from "react"

export type NoticeTone = "neutral" | "info" | "success" | "warning" | "danger"
export type NoticeSize = "sm" | "md"

const toneClassNames: Record<NoticeTone, string> = {
  neutral: "border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] text-[var(--vscode-descriptionForeground)]",
  info: "border-[color-mix(in_srgb,var(--vscode-button-background)_32%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_84%,var(--vscode-button-background)_16%)] text-[var(--vscode-descriptionForeground)]",
  success: "border-success/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,green_6%)] text-success",
  warning: "border-[color-mix(in_srgb,var(--vscode-warningForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,yellow_12%)] text-[var(--vscode-warningForeground)]",
  danger: "border-[color-mix(in_srgb,var(--vscode-errorForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] text-[var(--vscode-errorForeground)]",
}

const sizeClassNames: Record<NoticeSize, string> = {
  sm: "px-2.5 py-1.5 text-[11px]",
  md: "px-2.5 py-2 text-xs",
}

interface InlineNoticeProps {
  tone?: NoticeTone
  size?: NoticeSize
  icon?: ReactNode
  title?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}

export default function InlineNotice({
  tone = "neutral",
  size = "sm",
  icon,
  title,
  actions,
  className,
  children,
}: InlineNoticeProps) {
  return (
    <div
      className={clsx(
        "rounded-md border",
        toneClassNames[tone],
        sizeClassNames[size],
        className,
      )}
    >
      <div className={clsx("flex gap-2.5", actions ? "flex-col sm:flex-row sm:items-center sm:justify-between" : "")}>
        <div className="min-w-0 flex items-start gap-2">
          {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
          <div className="min-w-0">
            {title ? <div className="font-medium text-[var(--vscode-foreground)]">{title}</div> : null}
            <div className={clsx("min-w-0", title && "mt-0.5")}>{children}</div>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
    </div>
  )
}
