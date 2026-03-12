import { clsx } from "clsx"
import type { InputHTMLAttributes } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  labelClassName?: string
}

export default function Input({ label, labelClassName, className, id, ...props }: InputProps) {
  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label htmlFor={id} className={clsx("text-[13px] leading-none text-foreground", labelClassName)}>
          {label}
        </label>
      )}
      <input
        id={id}
        className={clsx(
          "w-full rounded-[2px] border border-input-border bg-input-background px-2 py-1 h-[26px] text-[13px] text-input-foreground",
          "placeholder:text-input-placeholder",
          "outline-none focus:border-border focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)] focus:-outline-offset-1",
          className,
        )}
        {...props}
      />
    </div>
  )
}
