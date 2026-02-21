import { clsx } from "clsx"
import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  children: ReactNode
}

export default function Card({ title, className, children, ...props }: CardProps) {
  return (
    <div className={clsx("rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-4", className)} {...props}>
      {title && <h3 className="mb-3 text-sm font-semibold">{title}</h3>}
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}
