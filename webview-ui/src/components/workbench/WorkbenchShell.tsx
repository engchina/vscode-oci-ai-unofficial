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

        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {secondaryGroups.length > 0 && (
              <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_82%,black_18%)]">
                <div className="flex items-center gap-3 overflow-x-auto px-3 py-2">
                  {secondaryGroups.map((group) => (
                    <section key={group.title} className="flex shrink-0 items-center gap-2">
                      <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vscode-descriptionForeground)]">
                        {group.title}
                      </h2>
                      <div
                        role="tablist"
                        aria-label={`${group.title} navigation`}
                        className="flex items-center gap-1 rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,white_8%)] p-1"
                      >
                        {group.items.map((item) => {
                          const isActive = item.id === activeViewId
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              onClick={() => onSelectView(item.id)}
                              title={item.description}
                              className={clsx(
                                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                                isActive
                                  ? "border-[var(--vscode-list-activeSelectionBackground)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                                  : "border-transparent text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
                              )}
                            >
                              {item.icon && <span className="shrink-0">{item.icon}</span>}
                              <span>{item.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}

            <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
          </div>

          {aside && (
            <aside className="hidden w-[300px] shrink-0 border-l border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_84%,black_16%)] xl:block">
              <div className="h-full overflow-y-auto p-2">{aside}</div>
            </aside>
          )}
        </div>
      </div>

      {statusBar && (
        <div className="flex min-h-8 shrink-0 items-center border-t border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_90%,black_10%)] px-2">
          {statusBar}
        </div>
      )}
    </div>
  )
}
