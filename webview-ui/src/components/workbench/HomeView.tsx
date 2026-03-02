import { Bot, Database, Layers, MessageSquareText, Network, Server, Settings2 } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../ui/Button"
import Card from "../ui/Card"
import WelcomeGuide from "../ui/WelcomeGuide"

export interface HomeQuickAction {
  id: string
  label: string
  description: string
  icon: ReactNode
}

export interface HomeRecentItem {
  id: string
  label: string
  description: string
}

interface HomeViewProps {
  hasProfiles: boolean
  activeProfile: string
  region: string
  genAiRegion: string
  profilesCount: number
  chatCount: number
  quickActions: HomeQuickAction[]
  recentItems: HomeRecentItem[]
  onOpenAction: (id: string) => void
  onOpenSettings: () => void
}

const FEATURE_HIGHLIGHTS = [
  {
    icon: <Bot size={16} />,
    title: "Assistant",
    description: "Chat with OCI context, code context injection, and conversation history.",
  },
  {
    icon: <Network size={16} />,
    title: "Resources",
    description: "Browse VCNs, compute instances, and object storage with task-focused filters.",
  },
  {
    icon: <Database size={16} />,
    title: "Databases",
    description: "Switch from infrastructure discovery to SQL operations without leaving the workbench.",
  },
] as const

export default function HomeView({
  hasProfiles,
  activeProfile,
  region,
  genAiRegion,
  profilesCount,
  chatCount,
  quickActions,
  recentItems,
  onOpenAction,
  onOpenSettings,
}: HomeViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor-background)]">
      <section className="border-b border-[var(--vscode-panel-border)] bg-[radial-gradient(circle_at_top_left,rgba(108,162,255,0.18),transparent_42%),linear-gradient(180deg,color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)_0%,var(--vscode-editor-background)_100%)] px-6 py-6">
        <div className="max-w-5xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_86%,white_14%)] px-3 py-1 text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
            <Layers size={12} />
            OCI Workbench
          </div>
          <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-[var(--vscode-foreground)]">
            One workspace for chat, infrastructure, and database operations.
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-6 text-[var(--vscode-descriptionForeground)]">
            Navigate by domain on the left, keep your global OCI context at the top, and use the main workspace for the
            task currently in focus.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" size="md" onClick={() => onOpenAction("chat")}>
              <MessageSquareText size={14} className="mr-1.5" />
              Open Chat
            </Button>
            <Button variant="secondary" size="md" onClick={() => onOpenAction("sqlWorkbench")}>
              <Database size={14} className="mr-1.5" />
              SQL Workbench
            </Button>
            <Button variant="secondary" size="md" onClick={onOpenSettings}>
              <Settings2 size={14} className="mr-1.5" />
              Open Settings
            </Button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-5 px-6 py-5">
        {!hasProfiles && (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--vscode-panel-border)] px-4 py-3">
              <div className="text-[13px] font-semibold text-[var(--vscode-foreground)]">Initial setup</div>
              <div className="mt-1 text-[12px] text-[var(--vscode-descriptionForeground)]">
                Configure OCI access before using resource and database features.
              </div>
            </div>
            <div className="px-4 py-2">
              <WelcomeGuide onOpenSettings={onOpenSettings} />
            </div>
          </Card>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Card title="Quick Actions">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {quickActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onOpenAction(action.id)}
                    className="flex flex-col items-start gap-2 rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,white_8%)] px-4 py-4 text-left transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--vscode-button-background)_18%,transparent)] text-[var(--vscode-button-background)]">
                      {action.icon}
                    </span>
                    <span className="text-[13px] font-semibold text-[var(--vscode-foreground)]">{action.label}</span>
                    <span className="text-[12px] leading-5 text-[var(--vscode-descriptionForeground)]">{action.description}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card title="Capability Areas">
              <div className="grid gap-3 md:grid-cols-3">
                {FEATURE_HIGHLIGHTS.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_82%,white_18%)] px-4 py-4"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,white_18%)] text-[var(--vscode-icon-foreground)]">
                      {item.icon}
                    </div>
                    <div className="mt-3 text-[13px] font-semibold text-[var(--vscode-foreground)]">{item.title}</div>
                    <p className="mt-2 text-[12px] leading-5 text-[var(--vscode-descriptionForeground)]">{item.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <Card title="Environment">
              <InfoRow label="Active profile" value={activeProfile || "Not set"} icon={<Server size={14} />} />
              <InfoRow label="Primary region" value={region || "Not set"} icon={<Layers size={14} />} />
              <InfoRow label="GenAI region" value={genAiRegion || "Not set"} icon={<Bot size={14} />} />
              <InfoRow label="Configured profiles" value={`${profilesCount}`} icon={<Settings2 size={14} />} />
              <InfoRow label="Chat messages" value={`${chatCount}`} icon={<MessageSquareText size={14} />} />
            </Card>

            <Card title="Recent Destinations">
              {recentItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--vscode-panel-border)] px-4 py-6 text-center text-[12px] text-[var(--vscode-descriptionForeground)]">
                  Open a feature from the navigation to build a working set here.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenAction(item.id)}
                      className="rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3 text-left transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                    >
                      <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">{item.label}</div>
                      <div className="mt-1 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">{item.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,white_8%)] px-3 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_84%,white_16%)] text-[var(--vscode-icon-foreground)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{label}</span>
        <span className="mt-1 block truncate text-[13px] font-medium text-[var(--vscode-foreground)]">{value}</span>
      </span>
    </div>
  )
}
