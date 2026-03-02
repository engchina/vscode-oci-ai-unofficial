import { clsx } from "clsx"
import type { ReactNode } from "react"

interface WorkbenchInventoryCardProps {
  title: string
  subtitle?: string
  details?: string[]
  chips?: string[]
  rightSlot?: ReactNode
  footer?: ReactNode
  selected?: boolean
  highlighted?: boolean
  subtle?: boolean
  onClick: () => void
  buttonRef?: (node: HTMLButtonElement | null) => void
}

export default function WorkbenchInventoryCard({
  title,
  subtitle,
  details = [],
  chips = [],
  rightSlot,
  footer,
  selected = false,
  highlighted = false,
  subtle = false,
  onClick,
  buttonRef,
}: WorkbenchInventoryCardProps) {
  const mutedClassName = selected
    ? "text-[var(--vscode-list-activeSelectionForeground)]/80"
    : "text-[var(--vscode-descriptionForeground)]"

  const cardClassName = clsx(
    "w-full rounded-[2px] border px-2 py-1.5 text-left transition-colors",
    selected
      ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
      : highlighted
        ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,var(--vscode-button-background)_18%)] text-[var(--vscode-foreground)]"
        : subtle
          ? "border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
          : "border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]",
  )

  const content = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium">{title}</div>
        {subtitle && <div className={clsx("mt-0.5 truncate text-[10px]", mutedClassName)}>{subtitle}</div>}
        {details.length > 0 && (
          <div className={clsx("mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]", mutedClassName)}>
            {details.map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span key={chip} className={clsx("rounded-full border border-current/15 px-2 py-0.5 text-[10px]", mutedClassName)}>
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  )

  if (!footer) {
    return (
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        className={cardClassName}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={cardClassName}>
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        className="w-full text-left"
      >
        {content}
      </button>
      <div className="mt-2">{footer}</div>
    </div>
  )
}
