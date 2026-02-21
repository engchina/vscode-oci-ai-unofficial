import { clsx } from "clsx"
import type { TextareaHTMLAttributes } from "react"

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export default function Textarea({ label, className, id, ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-description">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={clsx(
          "w-full rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-input-foreground",
          "placeholder:text-input-placeholder",
          "outline-none focus:border-border",
          "min-h-[120px] resize-y font-[inherit]",
          className,
        )}
        {...props}
      />
    </div>
  )
}
