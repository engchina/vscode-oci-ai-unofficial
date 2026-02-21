import { clsx } from "clsx"
import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  children: ReactNode
}

export default function Card({ title, className, children, ...props }: CardProps) {
  return (
    <div
      className={clsx("rounded-lg border border-border-panel p-3", className)}
      {...props}
    >
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}
