import { Search } from "lucide-react"
import type { ReactNode } from "react"
import { clsx } from "clsx"

export interface WorkbenchPrimaryItem {
  id: string
  label: string
  icon: ReactNode
}

export interface WorkbenchSecondaryItem {
  id: string
  label: string
  description: string
  icon?: ReactNode
}

export interface WorkbenchSecondaryGroup {
  title: string
  items: WorkbenchSecondaryItem[]
}

interface WorkbenchShellProps {
  appTitle: string
  appSubtitle: string
  searchValue: string
  onSearchChange: (value: string) => void
  primaryItems: WorkbenchPrimaryItem[]
  activePrimaryId: string
  onSelectPrimary: (id: string) => void
  secondaryGroups: WorkbenchSecondaryGroup[]
  activeViewId: string
  onSelectView: (id: string) => void
  headerMeta?: ReactNode
  headerActions?: ReactNode
  statusBar?: ReactNode
  aside?: ReactNode
  children: ReactNode
}

export default function WorkbenchShell({
  appTitle,
  appSubtitle,
  searchValue,
  onSearchChange,
  primaryItems,
  activePrimaryId,
  onSelectPrimary,
  secondaryGroups,
  activeViewId,
  onSelectView,
  headerMeta,
  headerActions,
  statusBar,
  aside,
  children,
}: WorkbenchShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_88%,black_12%)] px-2">
        <div className="min-w-0 shrink-0">
          <div className="text-[12px] leading-tight font-semibold tracking-wide text-[var(--vscode-foreground)]">{appTitle}</div>
          <div className="text-[10px] leading-tight text-[var(--vscode-descriptionForeground)]">{appSubtitle}</div>
        </div>

        <label className="hidden min-w-0 max-w-xl flex-1 items-center gap-1.5 rounded-md border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] px-2 py-1 text-[12px] text-[var(--vscode-input-foreground)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1 md:flex">
          <Search size={13} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
          <input
            type="text"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Jump to feature..."
            className="w-full appearance-none border-0 bg-transparent p-0 text-[var(--vscode-input-foreground)] shadow-none outline-none ring-0 placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus-visible:outline-none"
          />
        </label>

        {headerMeta && <div className="hidden items-center gap-1 xl:flex">{headerMeta}</div>}

        {headerActions && <div className="ml-auto flex items-center gap-1">{headerActions}</div>}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[84px] shrink-0 flex-col gap-1 border-r border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_92%,black_8%)] px-2 py-2">
          {primaryItems.map((item) => {
            const isActive = item.id === activePrimaryId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPrimary(item.id)}
                className={clsx(
                  "flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center transition-colors",
                  isActive
                    ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
                )}
                title={item.label}
                aria-label={item.label}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)]">
                  {item.icon}
                </span>
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </button>
            )
          })}
        </aside>

        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
          <div className="border-b border-[var(--vscode-panel-border)] px-2 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--vscode-descriptionForeground)]">
              Navigation
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            <div className="flex flex-col gap-2">
              {secondaryGroups.map((group) => (
                <section key={group.title} className="flex flex-col gap-1">
                  <h2 className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vscode-descriptionForeground)]">
                    {group.title}
                  </h2>
                  <div className="flex flex-col gap-1">
                    {group.items.map((item) => {
                      const isActive = item.id === activeViewId
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectView(item.id)}
                          className={clsx(
                            "flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                            isActive
                              ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                              : "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-list-hoverForeground)]",
                          )}
                        >
                          {item.icon && (
                            <span className="mt-0.5 shrink-0 text-[var(--vscode-icon-foreground)]">{item.icon}</span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium">{item.label}</span>
                            <span
                              className={clsx(
                                "mt-0.5 block text-[11px] leading-relaxed",
                                isActive
                                  ? "text-[color-mix(in_srgb,var(--vscode-list-activeSelectionForeground)_72%,transparent)]"
                                  : "text-[var(--vscode-descriptionForeground)]",
                              )}
                            >
                              {item.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>

        {aside && (
          <aside className="hidden w-[300px] shrink-0 border-l border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_84%,black_16%)] xl:block">
            <div className="h-full overflow-y-auto p-2">{aside}</div>
          </aside>
        )}
      </div>

      {statusBar && (
        <div className="flex min-h-8 shrink-0 items-center border-t border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_90%,black_10%)] px-2">
          {statusBar}
        </div>
      )}
    </div>
  )
}
