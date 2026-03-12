import { clsx } from "clsx"
import type { InputHTMLAttributes, ReactNode } from "react"

export function WorkbenchCompactFieldRow({
  label,
  children,
  className,
  labelClassName,
}: {
  label: string
  children: ReactNode
  className?: string
  labelClassName?: string
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className={clsx("shrink-0 text-[11px] text-description", labelClassName)}>{label}</span>
      {children}
    </div>
  )
}

export function WorkbenchCompactInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-7 min-w-0 flex-1 rounded-[2px] border border-input-border bg-input-background px-2 text-xs text-input-foreground outline-none focus:border-[var(--vscode-focusBorder)]",
        className,
      )}
    />
  )
}

export function WorkbenchSegmentedControl<T extends string>({
  value,
  items,
  onChange,
  className,
}: {
  value: T
  items: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx("flex gap-2", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={clsx(
            "h-7 flex-1 rounded-[2px] border px-2 text-[12px] font-medium",
            item.value === value
              ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
              : "border-input-border bg-input-background text-input-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function WorkbenchInlineRadioOption({
  name,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label
      className={clsx(
        "flex items-center gap-1.5 text-[11px]",
        disabled ? "cursor-not-allowed text-[var(--vscode-disabledForeground)]" : "cursor-pointer text-description hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="accent-button-background h-3 w-3"
      />
      <span>{children}</span>
    </label>
  )
}

export function WorkbenchMicroOptionButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-border-panel bg-input-background px-1.5 py-0.5 text-[10px] text-description transition-colors hover:bg-list-background-hover"
      title={title}
    >
      {children}
    </button>
  )
}
