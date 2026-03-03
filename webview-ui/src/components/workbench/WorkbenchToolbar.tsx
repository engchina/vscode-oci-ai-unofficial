import { clsx } from "clsx"
import { RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import { WorkbenchActionButton } from "./WorkbenchActionButtons"

export function WorkbenchToolbarGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx("flex flex-wrap gap-1", className)}>{children}</div>
}

export function WorkbenchToolbarSpacer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx("ml-auto flex flex-wrap gap-1", className)}>{children}</div>
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
    <WorkbenchActionButton
      type="button"
      tone="secondaryAction"
      variant="secondary"
      className="h-6 min-w-6 px-1.5"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <RefreshCw size={14} className={clsx(spinning && "animate-spin")} />
    </WorkbenchActionButton>
  )
}
