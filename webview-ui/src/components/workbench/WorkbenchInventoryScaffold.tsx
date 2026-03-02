import type { ReactNode } from "react"

export function WorkbenchInventorySummary({
  label,
  count,
  description,
}: {
  label: string
  count: string
  description: string
}) {
  return (
    <div className="rounded-md border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] px-2 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{label}</div>
      <div className="mt-1 text-[13px] font-semibold text-[var(--vscode-foreground)]">{count}</div>
      <div className="mt-0.5 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">{description}</div>
    </div>
  )
}

export function WorkbenchInventoryGroupHeading({
  children,
}: {
  children: ReactNode
}) {
  return (
    <h5 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
      {children}
    </h5>
  )
}

export function WorkbenchInventoryRegionHeading({
  children,
}: {
  children: ReactNode
}) {
  return (
    <h6 className="text-[10px] font-semibold uppercase tracking-wider text-description border-b border-[var(--vscode-panel-border)] pb-0.5">
      {children}
    </h6>
  )
}

export function WorkbenchInventoryFilterEmpty({
  message,
}: {
  message: string
}) {
  return (
    <p className="py-6 text-center text-[12px] text-description">{message}</p>
  )
}
