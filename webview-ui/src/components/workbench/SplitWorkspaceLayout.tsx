import type { ReactNode } from "react"

interface SplitWorkspaceLayoutProps {
  sidebar: ReactNode
  main: ReactNode
}

export default function SplitWorkspaceLayout({ sidebar, main }: SplitWorkspaceLayoutProps) {
  return (
    <div className="grid h-full min-h-0 gap-2 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
      <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
        <div className="h-full overflow-y-auto p-2">{sidebar}</div>
      </section>
      <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
        <div className="h-full overflow-y-auto p-2">{main}</div>
      </section>
    </div>
  )
}
