import { clsx } from "clsx"
import type { ReactNode } from "react"

interface WorkbenchActionInventoryCardProps {
  title: string
  subtitle?: string
  meta?: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
  selected?: boolean
  highlighted?: boolean
  onSelect?: () => void
  cardRef?: (node: HTMLDivElement | null) => void
  children?: ReactNode
}

export default function WorkbenchActionInventoryCard({
  title,
  subtitle,
  meta,
  trailing,
  actions,
  selected = false,
  highlighted = false,
  onSelect,
  cardRef,
  children,
}: WorkbenchActionInventoryCardProps) {
  return (
    <div
      ref={cardRef}
      className={clsx(
        "flex flex-col gap-1.5 rounded-[2px] border p-2 transition-colors",
        onSelect && "cursor-pointer",
        selected && highlighted
          ? "border-[var(--vscode-focusBorder)] bg-[color-mix(in_srgb,var(--vscode-list-hoverBackground)_82%,var(--vscode-button-background)_18%)]"
          : selected
            ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-hoverBackground)]"
            : highlighted
              ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,var(--vscode-button-background)_18%)]"
              : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)]",
      )}
      onClick={() => {
        if (!selected) {
          onSelect?.()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-[var(--vscode-foreground)]">{title}</span>
          {subtitle && <span className="truncate text-[11px] text-description">{subtitle}</span>}
          {meta && <div className="mt-1">{meta}</div>}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>

      {children}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
