import { Bot, Sparkles } from "lucide-react"
import { useEffect } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import Card from "../ui/Card"
import InlineNotice from "../ui/InlineNotice"
import SubagentInspector from "./SubagentInspector"

interface SubagentsViewProps {
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}

export default function SubagentsView({ selectedRunId, onSelectRun }: SubagentsViewProps) {
  const { subagents, chatMessages } = useExtensionState()

  useEffect(() => {
    if (subagents.length === 0) {
      return
    }
    const selectedExists = selectedRunId ? subagents.some((run) => run.id === selectedRunId) : false
    if (!selectedExists) {
      const preferred = subagents.find((run) => run.status === "running" || run.status === "queued") ?? subagents[0]
      onSelectRun(preferred.id)
    }
  }, [onSelectRun, selectedRunId, subagents])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-[var(--vscode-icon-foreground)]" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">Subagents</span>
            <span className="mt-0.5 text-[11px] text-description">
              Inspect background runs, MCP approvals, and tool results without leaving the workbench.
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Card title="Why This View">
            <div className="text-[12px] leading-5 text-description">
              This inspector keeps the current VS Code plugin workflow intact while exposing the OpenClaw-style
              subagent runtime: status, approvals, live tool use, and steering.
            </div>
          </Card>
          <InlineNotice tone="info" size="sm" icon={<Sparkles size={12} />}>
            Spawn runs from chat with <code>/subagents spawn &lt;agentId&gt; &lt;task&gt;</code>, then use this page to
            steer, send follow-ups, or inspect MCP activity.
          </InlineNotice>
        </div>

        <SubagentInspector
          runs={subagents}
          chatMessages={chatMessages}
          selectedRunId={selectedRunId}
          onSelectRun={onSelectRun}
        />
      </div>
    </div>
  )
}
