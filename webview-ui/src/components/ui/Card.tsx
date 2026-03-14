import { clsx } from "clsx"
import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  actions?: ReactNode
  children: ReactNode
}

export default function Card({ title, actions, className, children, ...props }: CardProps) {
  return (
    <div className={clsx("relative rounded border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2", className)} {...props}>
      {(title || actions) ? (
        <div className="mb-1 flex items-start justify-between gap-2">
          {title ? <h3 className="min-w-0 text-[13px] font-semibold uppercase tracking-wider text-foreground">{title}</h3> : <div />}
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}
