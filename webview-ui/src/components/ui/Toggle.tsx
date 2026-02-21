import { clsx } from "clsx"

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}

export default function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] px-3 py-2.5 sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        {label && <span className="block text-sm font-medium break-words">{label}</span>}
        {description && <span className="mt-1 block text-xs text-description break-words">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-success"
            : "bg-[color-mix(in_srgb,var(--vscode-descriptionForeground)_45%,transparent)]",
        )}
      >
        <span
          className={clsx(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  )
}
