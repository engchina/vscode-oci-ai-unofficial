import { Bot, Clock3, Compass, ExternalLink, FileText, Loader2, MessageSquareText, RefreshCw, Send, SquareTerminal, StopCircle, Wrench } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { SubagentServiceClient } from "../../services/grpc-client"
import type { ChatMessageData, SubagentRunData, ToolCallData } from "../../services/types"
import Card from "../ui/Card"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
  WorkbenchDestructiveButton,
} from "../workbench/WorkbenchActionButtons"
import ToolCallBlock from "../chat/ToolCallBlock"

const STATUS_TONE: Record<SubagentRunData["status"], "success" | "warning" | "danger" | "neutral"> = {
  queued: "warning",
  running: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
}

type TimelineFilter = "all" | "pending" | "error" | "tool" | "prompt" | "resource"

const TIMELINE_FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "error", label: "Errors" },
  { id: "tool", label: "Tools" },
  { id: "prompt", label: "Prompts" },
  { id: "resource", label: "Resources" },
]

interface SubagentInspectorProps {
  runs: SubagentRunData[]
  chatMessages: ChatMessageData[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  compact?: boolean
  onOpenFullView?: () => void
}

export default function SubagentInspector({
  runs,
  chatMessages,
  selectedRunId,
  onSelectRun,
  compact = false,
  onOpenFullView,
}: SubagentInspectorProps) {
  const { sendSubagentMessage, steerSubagent, killSubagent } = useExtensionState()
  const [draft, setDraft] = useState("")
  const [busyAction, setBusyAction] = useState<"send" | "steer" | "kill" | null>(null)
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all")
  const [transcriptState, setTranscriptState] = useState<{
    runId: string
    transcriptPath?: string
    transcript?: string
    updatedAt?: string
    loading: boolean
    error?: string
  } | null>(null)

  const selectedRun = useMemo(() => {
    if (runs.length === 0) return undefined
    return runs.find((run) => run.id === selectedRunId) ?? runs[0]
  }, [runs, selectedRunId])

  const toolCalls = useMemo(() => {
    if (!selectedRun) return []
    return deriveToolCallsForRun(chatMessages, selectedRun.id)
  }, [chatMessages, selectedRun])

  const pendingApprovals = useMemo(
    () => toolCalls.filter((toolCall) => toolCall.status === "pending"),
    [toolCalls],
  )

  const filteredToolCalls = useMemo(
    () => filterToolCalls(toolCalls, timelineFilter),
    [timelineFilter, toolCalls],
  )

  const timelineSummary = useMemo(
    () => summarizeToolCalls(toolCalls),
    [toolCalls],
  )

  const recentLogs = useMemo(() => {
    if (!selectedRun) return []
    const entries = [...selectedRun.logs].reverse()
    return compact ? entries.slice(0, 8) : entries.slice(0, 20)
  }, [compact, selectedRun])

  const loadTranscript = useCallback(async (runId: string) => {
    setTranscriptState((current) => ({
      runId,
      transcriptPath: current?.runId === runId ? current.transcriptPath : undefined,
      transcript: current?.runId === runId ? current.transcript : undefined,
      updatedAt: current?.runId === runId ? current.updatedAt : undefined,
      loading: true,
      error: undefined,
    }))
    try {
      const response = await SubagentServiceClient.getTranscript({ runId })
      setTranscriptState({
        runId,
        transcriptPath: response.transcriptPath,
        transcript: response.transcript,
        updatedAt: response.updatedAt,
        loading: false,
      })
    } catch (error) {
      setTranscriptState({
        runId,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    if (!selectedRun) {
      setTranscriptState(null)
      return
    }

    let cancelled = false
    setTranscriptState((current) => {
      if (current?.runId === selectedRun.id && current.updatedAt === selectedRun.updatedAt) {
        return current
      }
      return {
        runId: selectedRun.id,
        transcriptPath: current?.runId === selectedRun.id ? current.transcriptPath : selectedRun.transcriptPath,
        transcript: current?.runId === selectedRun.id ? current.transcript : undefined,
        updatedAt: current?.runId === selectedRun.id ? current.updatedAt : undefined,
        loading: true,
        error: undefined,
      }
    })

    void (async () => {
      try {
        const response = await SubagentServiceClient.getTranscript({ runId: selectedRun.id })
        if (cancelled) {
          return
        }
        setTranscriptState({
          runId: selectedRun.id,
          transcriptPath: response.transcriptPath,
          transcript: response.transcript,
          updatedAt: response.updatedAt,
          loading: false,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        setTranscriptState({
          runId: selectedRun.id,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedRun?.id, selectedRun?.updatedAt, selectedRun?.transcriptPath])

  const handleSend = useCallback(async () => {
    if (!selectedRun) return
    setBusyAction("send")
    try {
      await sendSubagentMessage(selectedRun.id, draft)
      setDraft("")
    } finally {
      setBusyAction(null)
    }
  }, [draft, selectedRun, sendSubagentMessage])

  const handleSteer = useCallback(async () => {
    if (!selectedRun) return
    setBusyAction("steer")
    try {
      await steerSubagent(selectedRun.id, draft)
      setDraft("")
    } finally {
      setBusyAction(null)
    }
  }, [draft, selectedRun, steerSubagent])

  const handleKill = useCallback(async () => {
    if (!selectedRun) return
    setBusyAction("kill")
    try {
      await killSubagent(selectedRun.id)
    } finally {
      setBusyAction(null)
    }
  }, [killSubagent, selectedRun])

  if (runs.length === 0) {
    return (
      <Card title={compact ? "Subagents" : "Subagent Inspector"}>
        <div className="flex flex-col gap-2 py-3">
          <InlineNotice tone="info" size="sm">
            No subagents yet. Spawn one from chat with <code>/subagents spawn &lt;agentId&gt; &lt;task&gt;</code>.
          </InlineNotice>
          {onOpenFullView ? (
            <WorkbenchActionButton variant="secondary" onClick={onOpenFullView}>
              <ExternalLink size={12} />
              Open Subagents
            </WorkbenchActionButton>
          ) : null}
        </div>
      </Card>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Card title={compact ? "Subagents" : "Runs"}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-description">
            {runs.length} tracked run{runs.length === 1 ? "" : "s"}
          </div>
          {onOpenFullView ? (
            <WorkbenchActionButton variant="secondary" onClick={onOpenFullView}>
              <ExternalLink size={12} />
              Open
            </WorkbenchActionButton>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {runs.slice(0, compact ? 6 : runs.length).map((run) => {
            const selected = selectedRun?.id === run.id
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun(run.id)}
                className={[
                  "flex items-start justify-between gap-2 rounded border px-2 py-2 text-left transition-colors",
                  selected
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)]",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold">{run.shortId}</span>
                    <StatusBadge label={run.status} tone={STATUS_TONE[run.status]} size="compact" />
                  </div>
                  <div className="mt-1 text-[12px] font-medium">{run.agentId}</div>
                  <div className="mt-1 text-[11px] text-description">{truncateText(run.task, compact ? 72 : 120)}</div>
                </div>
                <div className="shrink-0 text-right text-[10px] text-description">
                  <div>{run.pendingApprovalCount} approvals</div>
                  <div>{run.messageCount} msgs</div>
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      {selectedRun ? (
        <>
          <Card title={compact ? selectedRun.shortId : `Inspector ${selectedRun.shortId}`}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={selectedRun.status} tone={STATUS_TONE[selectedRun.status]} />
              <span className="text-[12px] font-medium">{selectedRun.agentId}</span>
              <span className="text-[11px] text-description">{selectedRun.modelName ?? "default model"}</span>
            </div>
            <div className="grid gap-2 text-[11px] text-description md:grid-cols-2">
              <MetaRow icon={<MessageSquareText size={12} />} label="Messages" value={`${selectedRun.messageCount}`} />
              <MetaRow icon={<Clock3 size={12} />} label="Runtime" value={formatRuntime(selectedRun.runtimeMs)} />
              <MetaRow icon={<Compass size={12} />} label="Pending approvals" value={`${selectedRun.pendingApprovalCount}`} />
              <MetaRow icon={<FileText size={12} />} label="Transcript" value={selectedRun.transcriptPath} />
              <MetaRow icon={<Wrench size={12} />} label="MCP actions" value={`${timelineSummary.total}`} />
              <MetaRow
                icon={<Bot size={12} />}
                label="Breakdown"
                value={`${timelineSummary.tools} tools • ${timelineSummary.prompts} prompts • ${timelineSummary.resources} resources`}
              />
            </div>
            <div className="text-[12px] text-foreground whitespace-pre-wrap">{selectedRun.task}</div>
            {selectedRun.resultText ? (
              <InlineNotice tone="info" size="sm" icon={<Bot size={12} />}>
                <div className="font-medium">Latest result</div>
                <div className="mt-1 whitespace-pre-wrap">{truncateText(selectedRun.resultText, compact ? 320 : 1200)}</div>
              </InlineNotice>
            ) : null}
            {selectedRun.errorText ? (
              <InlineNotice tone="danger" size="sm">
                {selectedRun.errorText}
              </InlineNotice>
            ) : null}
          </Card>

          <Card
            title={compact ? "Transcript" : "Transcript Preview"}
            actions={selectedRun ? (
              <WorkbenchActionButton
                variant="secondary"
                onClick={() => void loadTranscript(selectedRun.id)}
                disabled={transcriptState?.loading === true}
              >
                {transcriptState?.loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Refresh
              </WorkbenchActionButton>
            ) : undefined}
          >
            <div className="text-[11px] text-description break-all">
              {transcriptState?.transcriptPath ?? selectedRun.transcriptPath}
            </div>
            {transcriptState?.error ? (
              <InlineNotice tone="danger" size="sm">
                {transcriptState.error}
              </InlineNotice>
            ) : null}
            {transcriptState?.loading && !transcriptState.transcript ? (
              <InlineNotice tone="info" size="sm" icon={<Loader2 size={12} className="animate-spin" />}>
                Loading transcript preview...
              </InlineNotice>
            ) : null}
            {transcriptState?.transcript ? (
              <>
                <div
                  className={[
                    "overflow-y-auto rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2 py-2 text-[11px] leading-5 text-foreground whitespace-pre-wrap",
                    compact ? "max-h-[180px]" : "max-h-[320px]",
                  ].join(" ")}
                >
                  {buildTranscriptPreview(transcriptState.transcript, compact)}
                </div>
                {isTranscriptTrimmed(transcriptState.transcript, compact) ? (
                  <div className="text-[10px] text-description">
                    Showing the latest transcript section for quick inspection.
                  </div>
                ) : null}
              </>
            ) : !transcriptState?.loading ? (
              <InlineNotice tone="info" size="sm">
                No transcript is available for this subagent yet.
              </InlineNotice>
            ) : null}
          </Card>

          {pendingApprovals.length > 0 ? (
            <Card title={compact ? "Approvals" : "Pending Approvals"}>
              <InlineNotice tone="warning" size="sm">
                Resolve approvals here without leaving the subagent inspector.
              </InlineNotice>
              <div className="flex flex-col gap-2">
                {pendingApprovals.slice(0, compact ? 2 : 6).map((toolCall) => (
                  <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
              {pendingApprovals.length > (compact ? 2 : 6) ? (
                <div className="text-[11px] text-description">
                  {pendingApprovals.length - (compact ? 2 : 6)} more pending approval
                  {pendingApprovals.length - (compact ? 2 : 6) === 1 ? "" : "s"} remain in this run.
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title={compact ? "Control" : "Control Surface"}>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Send a follow-up task or steering note..."
              className={compact ? "min-h-[88px]" : "min-h-[120px]"}
            />
            <WorkbenchCompactActionCluster>
              <WorkbenchActionButton
                variant="primary"
                onClick={() => void handleSend()}
                disabled={!draft.trim() || busyAction !== null || selectedRun.status === "cancelled"}
              >
                {busyAction === "send" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send
              </WorkbenchActionButton>
              <WorkbenchActionButton
                variant="secondary"
                onClick={() => void handleSteer()}
                disabled={!draft.trim() || busyAction !== null || selectedRun.status === "cancelled"}
              >
                {busyAction === "steer" ? <Loader2 size={12} className="animate-spin" /> : <Compass size={12} />}
                Steer
              </WorkbenchActionButton>
              <WorkbenchDestructiveButton
                variant="secondary"
                onClick={() => void handleKill()}
                disabled={busyAction !== null || selectedRun.status === "cancelled"}
              >
                {busyAction === "kill" ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
                Kill
              </WorkbenchDestructiveButton>
            </WorkbenchCompactActionCluster>
          </Card>

          <Card title={compact ? "Tools" : "Tool & Result Timeline"}>
            {toolCalls.length === 0 ? (
              <InlineNotice tone="info" size="sm" icon={<Wrench size={12} />}>
                This subagent has not used MCP tools yet.
              </InlineNotice>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge label={`All ${timelineSummary.total}`} tone="neutral" size="compact" />
                  <StatusBadge label={`Pending ${timelineSummary.pending}`} tone="warning" size="compact" />
                  <StatusBadge label={`Errors ${timelineSummary.errors}`} tone="danger" size="compact" />
                  <StatusBadge label={`Done ${timelineSummary.completed}`} tone="success" size="compact" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {TIMELINE_FILTERS.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setTimelineFilter(filter.id)}
                      className={[
                        "rounded border px-2 py-1 text-[11px] transition-colors",
                        timelineFilter === filter.id
                          ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                          : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-description hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
                      ].join(" ")}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                {filteredToolCalls.length === 0 ? (
                  <InlineNotice tone="info" size="sm">
                    No MCP timeline entries match the current filter.
                  </InlineNotice>
                ) : null}
                {filteredToolCalls.slice(0, compact ? 4 : 12).map((toolCall) => (
                  <div key={toolCall.id} className="flex flex-col gap-1">
                    <div className="text-[10px] text-description">
                      {formatTimestamp(toolCall.updatedAt ?? toolCall.createdAt)}
                    </div>
                    <ToolCallBlock toolCall={toolCall} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={compact ? "Activity" : "Activity Timeline"}>
            {recentLogs.length === 0 ? (
              <InlineNotice tone="info" size="sm" icon={<SquareTerminal size={12} />}>
                No activity logged yet.
              </InlineNotice>
            ) : (
              <div className="flex flex-col gap-2">
                {recentLogs.map((entry, index) => (
                  <div key={`${entry.timestamp}-${index}`} className="rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge label={entry.kind} tone={toneForLogKind(entry.kind)} size="compact" />
                      <span className="text-[10px] text-description">{formatTimestamp(entry.timestamp)}</span>
                    </div>
                    <div className="mt-1 text-[12px] whitespace-pre-wrap">{entry.message}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}

function deriveToolCallsForRun(chatMessages: ChatMessageData[], runId: string): ToolCallData[] {
  return chatMessages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.subagentId === runId)
    .sort((left, right) => {
      const leftValue = Date.parse(left.createdAt ?? left.updatedAt ?? "") || 0
      const rightValue = Date.parse(right.createdAt ?? right.updatedAt ?? "") || 0
      return rightValue - leftValue
    })
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "Unknown time"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

function formatRuntime(runtimeMs: number | undefined): string {
  if (typeof runtimeMs !== "number" || !Number.isFinite(runtimeMs)) {
    return "-"
  }
  return runtimeMs >= 1000 ? `${(runtimeMs / 1000).toFixed(1)}s` : `${runtimeMs} ms`
}

function toneForLogKind(kind: SubagentRunData["logs"][number]["kind"]): "success" | "warning" | "danger" | "neutral" {
  switch (kind) {
    case "assistant":
      return "success"
    case "approval":
    case "tool":
      return "warning"
    case "error":
      return "danger"
    default:
      return "neutral"
  }
}

function filterToolCalls(toolCalls: ToolCallData[], filter: TimelineFilter): ToolCallData[] {
  switch (filter) {
    case "pending":
      return toolCalls.filter((toolCall) => toolCall.status === "pending")
    case "error":
      return toolCalls.filter((toolCall) => toolCall.status === "error" || Boolean(toolCall.result?.isError))
    case "tool":
      return toolCalls.filter((toolCall) => (toolCall.actionKind ?? "tool") === "tool")
    case "prompt":
      return toolCalls.filter((toolCall) => toolCall.actionKind === "prompt")
    case "resource":
      return toolCalls.filter((toolCall) => toolCall.actionKind === "resource")
    case "all":
    default:
      return toolCalls
  }
}

function summarizeToolCalls(toolCalls: ToolCallData[]): {
  total: number
  pending: number
  completed: number
  errors: number
  tools: number
  prompts: number
  resources: number
} {
  return toolCalls.reduce(
    (summary, toolCall) => {
      summary.total += 1
      if (toolCall.status === "pending") {
        summary.pending += 1
      }
      if (toolCall.status === "completed") {
        summary.completed += 1
      }
      if (toolCall.status === "error" || toolCall.result?.isError) {
        summary.errors += 1
      }

      switch (toolCall.actionKind ?? "tool") {
        case "prompt":
          summary.prompts += 1
          break
        case "resource":
          summary.resources += 1
          break
        case "tool":
        default:
          summary.tools += 1
          break
      }

      return summary
    },
    {
      total: 0,
      pending: 0,
      completed: 0,
      errors: 0,
      tools: 0,
      prompts: 0,
      resources: 0,
    },
  )
}

function buildTranscriptPreview(transcript: string, compact: boolean): string {
  const limit = compact ? 2200 : 6400
  const normalized = transcript.trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `...\n${normalized.slice(normalized.length - limit)}`
}

function isTranscriptTrimmed(transcript: string, compact: boolean): boolean {
  return transcript.trim().length > (compact ? 2200 : 6400)
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2 rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2 py-1.5">
      <span className="mt-0.5 shrink-0 text-description">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.16em] text-description">{label}</div>
        <div className="break-all text-[11px] text-foreground">{value}</div>
      </div>
    </div>
  )
}
