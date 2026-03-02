import { clsx } from "clsx"
import { RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../ui/Button"

export function WorkbenchToolbarGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx("flex flex-wrap gap-1.5", className)}>{children}</div>
}

export function WorkbenchToolbarSpacer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx("ml-auto flex flex-wrap gap-1.5", className)}>{children}</div>
}

export function WorkbenchRefreshButton({
  onClick,
  disabled,
  spinning,
  title = "Refresh",
}: {
  onClick: () => void
  disabled?: boolean
  spinning?: boolean
  title?: string
}) {
  return (
    <Button
      variant="icon"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <RefreshCw size={14} className={clsx(spinning && "animate-spin")} />
    </Button>
  )
}
