import { clsx } from "clsx"
import type { SelectHTMLAttributes } from "react"
import { ChevronDown } from "lucide-react"

export interface SelectOption {
  value: string
  label: string
  description?: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  labelClassName?: string
  options: SelectOption[]
  placeholder?: string
}

export default function Select({
  label,
  labelClassName,
  className,
  id,
  options,
  placeholder = "Select an option",
  disabled,
  value,
  ...props
}: SelectProps) {
  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label htmlFor={id} className={clsx("text-[13px] leading-none text-foreground", labelClassName)}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          className={clsx(
            "w-full appearance-none rounded-[2px] border border-input-border bg-input-background px-2 py-1 pr-6 h-[26px] text-[13px] text-input-foreground outline-none focus:border-[var(--vscode-focusBorder)]",
            disabled && "cursor-not-allowed opacity-60",
            className,
          )}
          {...props}
        >
          {!value && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.description ? ` - ${option.description}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--vscode-icon-foreground)]" />
      </div>
    </div>
  )
}
