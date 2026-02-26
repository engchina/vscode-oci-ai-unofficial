import { clsx } from "clsx"
import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  children: ReactNode
}

export default function Card({ title, className, children, ...props }: CardProps) {
  return (
    <div className={clsx("rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-3 relative", className)} {...props}>
      {title && <h3 className="mb-2 text-[13px] font-semibold text-foreground uppercase tracking-wider">{title}</h3>}
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}
