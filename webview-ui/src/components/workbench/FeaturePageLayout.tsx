import { clsx } from "clsx"
import type { ReactNode } from "react"
import { WorkbenchIconActionButton } from "./WorkbenchActionButtons"

interface FeaturePageLayoutProps {
  title: string
  description?: string
  icon: ReactNode
  leading?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  controls?: ReactNode
  children: ReactNode
  contentClassName?: string
}

export default function FeaturePageLayout({
  title,
  description,
  icon,
  leading,
  status,
  actions,
  controls,
  children,
  contentClassName,
}: FeaturePageLayoutProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vscode-editor-background)]">
      <div className="flex items-center justify-between gap-2.5 border-b border-[var(--vscode-panel-border)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_84%,white_16%)] text-[var(--vscode-icon-foreground)]">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-wide text-[var(--vscode-foreground)]">{title}</div>
            {description && (
              <div className="mt-0.5 truncate text-[11px] text-[var(--vscode-descriptionForeground)]">{description}</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {status}
          {actions}
        </div>
      </div>

      {controls && (
        <div className="border-b border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,white_6%)] px-3 py-2.5">
          {controls}
        </div>
      )}

      <div className={clsx("min-h-0 flex-1 overflow-hidden", contentClassName)}>{children}</div>
    </div>
  )
}

interface FeatureSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}

export function FeatureSearchInput({
  value,
  onChange,
  placeholder,
  className,
}: FeatureSearchInputProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-md border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] px-2.5 py-1.5 focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0 text-[var(--vscode-icon-foreground)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[13px] text-[var(--vscode-input-foreground)] outline-none placeholder:text-[var(--vscode-input-placeholderForeground)]"
      />
      {value && (
        <WorkbenchIconActionButton
          onClick={() => onChange("")}
          type="button"
          variant="icon"
          size="icon"
          title="Clear filter"
          icon={(
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          )}
          className="h-5 w-5 rounded-[2px] p-0 text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
        />
      )}
    </div>
  )
}
