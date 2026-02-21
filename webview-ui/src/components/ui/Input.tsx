import { clsx } from "clsx"
import type { InputHTMLAttributes } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export default function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-description">
          {label}
        </label>
      )}
      <input
        id={id}
        className={clsx(
          "w-full rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-input-foreground",
          "placeholder:text-input-placeholder",
          "outline-none focus:border-border",
          className,
        )}
        {...props}
      />
    </div>
  )
}
