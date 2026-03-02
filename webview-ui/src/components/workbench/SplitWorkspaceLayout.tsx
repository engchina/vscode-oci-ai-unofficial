import type { ReactNode } from "react"

interface SplitWorkspaceLayoutProps {
  sidebar: ReactNode
  main: ReactNode
}

export default function SplitWorkspaceLayout({ sidebar, main }: SplitWorkspaceLayoutProps) {
  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
      <section className="min-h-0 overflow-hidden rounded-xl border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_76%,white_24%)]">
        <div className="h-full overflow-y-auto p-2.5">{sidebar}</div>
      </section>
      <section className="min-h-0 overflow-hidden rounded-xl border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
        <div className="h-full overflow-y-auto p-2.5">{main}</div>
      </section>
    </div>
  )
}
