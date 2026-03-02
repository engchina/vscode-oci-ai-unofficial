import { clsx } from "clsx"
import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  children: ReactNode
}

export default function Card({ title, className, children, ...props }: CardProps) {
  return (
    <div className={clsx("relative rounded border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2", className)} {...props}>
      {title && <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-foreground">{title}</h3>}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}
