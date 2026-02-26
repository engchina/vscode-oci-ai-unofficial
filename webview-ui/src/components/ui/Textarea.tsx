import { clsx } from "clsx"
import type { TextareaHTMLAttributes } from "react"

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export default function Textarea({ label, className, id, ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={id} className="text-[13px] leading-none text-foreground">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={clsx(
          "w-full rounded-[2px] border border-input-border bg-input-background px-2 py-1.5 text-[13px] text-input-foreground",
          "placeholder:text-input-placeholder",
          "outline-none focus:border-border focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)] focus:-outline-offset-1",
          "min-h-[120px] resize-y font-[inherit]",
          className,
        )}
        {...props}
      />
    </div>
  )
}
