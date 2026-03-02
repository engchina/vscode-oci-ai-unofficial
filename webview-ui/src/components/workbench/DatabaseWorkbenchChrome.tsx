import { clsx } from "clsx"
import { Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import StatusBadge from "../ui/StatusBadge"

interface MetaItem {
  label: string
  value: string
}

interface WorkbenchHeroProps {
  eyebrow: string
  title: string
  resourceId?: string
  badge?: ReactNode
  metaItems?: MetaItem[]
}

interface DatabaseWorkbenchHeroProps {
  eyebrow: string
  title: string
  resourceId?: string
  connected: boolean
  metaItems?: MetaItem[]
}

interface DatabaseContextStripProps {
  items: Array<MetaItem & { breakAll?: boolean }>
}

interface WorkbenchKeyValueStripProps {
  items: Array<MetaItem & { breakAll?: boolean }>
  className?: string
}

interface WorkbenchSectionProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
}

export function WorkbenchHero({
  eyebrow,
  title,
  resourceId,
  badge,
  metaItems = [],
}: WorkbenchHeroProps) {
  return (
    <div className="rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,white_4%)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{eyebrow}</div>
          <div className="mt-1 truncate text-[16px] font-semibold text-[var(--vscode-foreground)]">{title}</div>
          {resourceId && (
            <div className="truncate text-[11px] text-[var(--vscode-descriptionForeground)]">{resourceId}</div>
          )}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      {metaItems.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {metaItems.map((item) => (
            <SummaryMetaCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DatabaseWorkbenchHero({
  eyebrow,
  title,
  resourceId,
  connected,
  metaItems = [],
}: DatabaseWorkbenchHeroProps) {
  return (
    <WorkbenchHero
      eyebrow={eyebrow}
      title={title}
      resourceId={resourceId}
      metaItems={metaItems}
      badge={<StatusBadge label={connected ? "Connected" : "Disconnected"} tone={connected ? "success" : "neutral"} />}
    />
  )
}

export function WorkbenchKeyValueStrip({ items, className }: WorkbenchKeyValueStripProps) {
  return (
    <WorkbenchSurface className={clsx("px-2.5 py-2 text-[11px] text-description", className)}>
      {items.map((item) => (
        <div key={item.label} className={clsx(item.breakAll && "break-all")}>
          <span className="font-semibold text-foreground">{item.label}:</span> <code>{item.value}</code>
        </div>
      ))}
    </WorkbenchSurface>
  )
}

export function DatabaseContextStrip({ items }: DatabaseContextStripProps) {
  return (
    <WorkbenchKeyValueStrip items={items} />
  )
}

export function WorkbenchSection({
  title,
  subtitle,
  actions,
  children,
  bodyClassName,
}: WorkbenchSectionProps) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--vscode-foreground)]">{title}</div>
          {subtitle && <div className="mt-1 text-[11px] text-[var(--vscode-descriptionForeground)]">{subtitle}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={clsx("flex min-h-0 flex-1 flex-col gap-3 p-3", bodyClassName)}>{children}</div>
    </section>
  )
}

export function WorkbenchSurface({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={clsx("rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] p-3", className)}>
      {children}
    </div>
  )
}

export function WorkbenchLoadingState({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div className={clsx("flex min-h-[180px] items-center justify-center gap-2 rounded-[2px] border border-dashed border-[var(--vscode-panel-border)] px-4 py-8 text-center text-[12px] text-[var(--vscode-descriptionForeground)]", className)}>
      <Loader2 size={16} className="animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export function WorkbenchEmptyState({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon?: ReactNode
}) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-[2px] border border-dashed border-[var(--vscode-panel-border)] px-4 py-8 text-center">
      <div className="max-w-xs">
        {icon ? <div className="mb-3 flex justify-center text-[var(--vscode-descriptionForeground)]">{icon}</div> : null}
        <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">{title}</div>
        <div className="mt-2 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">{description}</div>
      </div>
    </div>
  )
}

export function SummaryMetaCard({ label, value }: MetaItem) {
  return (
    <WorkbenchSurface className="px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--vscode-descriptionForeground)]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-medium text-[var(--vscode-foreground)]">{value}</div>
    </WorkbenchSurface>
  )
}
