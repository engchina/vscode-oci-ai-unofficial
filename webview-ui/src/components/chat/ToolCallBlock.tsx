import { clsx } from "clsx"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plug,
  ShieldCheck,
  ShieldX,
  Wrench,
  X,
} from "lucide-react"
import { type ReactNode, useCallback, useMemo, useState } from "react"
import type { ToolCallData } from "../../services/types"
import { AgentServiceClient } from "../../services/grpc-client"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
} from "../workbench/WorkbenchActionButtons"
import ToolResultContent from "./ToolResultContent"

interface ToolCallBlockProps {
  toolCall: ToolCallData
}

const STATUS_ICON: Record<string, ReactNode> = {
  pending: <Loader2 size={14} className="animate-spin text-[var(--vscode-charts-yellow)]" />,
  approved: <ShieldCheck size={14} className="text-[var(--vscode-charts-green)]" />,
  denied: <ShieldX size={14} className="text-[var(--vscode-charts-red)]" />,
  running: <Loader2 size={14} className="animate-spin text-[var(--vscode-charts-blue)]" />,
  completed: <Check size={14} className="text-[var(--vscode-charts-green)]" />,
  error: <AlertTriangle size={14} className="text-[var(--vscode-charts-red)]" />,
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  denied: "Denied",
  running: "Running...",
  completed: "Completed",
  error: "Error",
}

export default function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [showParams, setShowParams] = useState(false)
  const [approving, setApproving] = useState(false)
  const [allowingAlways, setAllowingAlways] = useState(false)
  const timelineMeta = useMemo(() => formatTimelineMeta(toolCall), [toolCall])

  const handleApprove = useCallback(async () => {
    setApproving(true)
    try {
      await AgentServiceClient.approveToolCall(toolCall.id)
    } finally {
      setApproving(false)
    }
  }, [toolCall.id])

  const handleAllowAlways = useCallback(async () => {
    setAllowingAlways(true)
    try {
      await AgentServiceClient.approveToolCall(toolCall.id, true)
    } finally {
      setAllowingAlways(false)
    }
  }, [toolCall.id])

  const handleDeny = useCallback(async () => {
    try {
      await AgentServiceClient.denyToolCall(toolCall.id)
    } catch { /* ignore */ }
  }, [toolCall.id])

  const icon = toolCall.serverName ? <Plug size={14} /> : <Wrench size={14} />
  const actionLabel = toolCall.actionKind === "prompt"
    ? `prompt:${toolCall.actionTarget ?? toolCall.toolName}`
    : toolCall.actionKind === "resource"
      ? `resource:${toolCall.actionTarget ?? toolCall.toolName}`
      : toolCall.actionKind === "tool"
        ? `tool:${toolCall.actionTarget ?? toolCall.toolName}`
        : toolCall.toolName
  const label = toolCall.serverName
    ? `${toolCall.serverName} → ${actionLabel}`
    : toolCall.toolName

  const hasResult = toolCall.result && toolCall.result.content.length > 0

  return (
    <div
      className={clsx(
        "rounded-md border",
        toolCall.result?.isError
          ? "border-[var(--vscode-inputValidation-errorBorder)] bg-[color-mix(in_srgb,var(--vscode-inputValidation-errorBackground)_10%,transparent)]"
          : "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)]",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[var(--vscode-icon-foreground)]">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium">{label}</span>
          {toolCall.subagentLabel && (
            <span className="truncate text-[10px] text-description">Subagent: {toolCall.subagentLabel}</span>
          )}
          {timelineMeta ? (
            <span className="truncate text-[10px] text-description">{timelineMeta}</span>
          ) : null}
        </div>
        {STATUS_ICON[toolCall.status]}
        <span className="text-xs text-description">{STATUS_LABEL[toolCall.status]}</span>
      </div>

      {/* Parameters toggle */}
      {Object.keys(toolCall.parameters).length > 0 && (
        <>
          <button
            className="flex w-full items-center gap-1 border-t border-[var(--vscode-panel-border)] px-3 py-1 text-xs text-description hover:text-foreground"
            onClick={() => setShowParams(!showParams)}
          >
            {showParams ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Parameters
          </button>
          {showParams && (
            <div className="border-t border-[var(--vscode-panel-border)] px-3 py-2">
              <pre className="overflow-x-auto text-xs text-description whitespace-pre-wrap">
                {JSON.stringify(toolCall.parameters, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}

      {/* Approval buttons (when pending) */}
      {toolCall.status === "pending" && (
        <div className="border-t border-[var(--vscode-panel-border)] px-3 py-2">
          <WorkbenchCompactActionCluster>
            <WorkbenchActionButton
              variant="primary"
              onClick={handleApprove}
              disabled={approving || allowingAlways}
            >
              {approving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Approve Once
            </WorkbenchActionButton>
            {toolCall.serverName ? (
              <WorkbenchActionButton
                variant="secondary"
                onClick={handleAllowAlways}
                disabled={approving || allowingAlways}
              >
                {allowingAlways ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Allow Always
              </WorkbenchActionButton>
            ) : null}
            <WorkbenchActionButton variant="secondary" onClick={handleDeny} disabled={approving || allowingAlways}>
              <X size={14} />
              Deny
            </WorkbenchActionButton>
          </WorkbenchCompactActionCluster>
        </div>
      )}

      {/* Result */}
      {hasResult && (
        <div className="border-t border-[var(--vscode-panel-border)] px-3 py-2">
          <ToolResultContent content={toolCall.result!.content} />
        </div>
      )}
    </div>
  )
}

function formatTimelineMeta(toolCall: ToolCallData): string {
  const details: string[] = []
  const actionKind = formatActionKind(toolCall.actionKind)
  if (actionKind) {
    details.push(actionKind)
  }

  const startedAt = parseMaybeDate(toolCall.createdAt)
  const updatedAt = parseMaybeDate(toolCall.updatedAt)
  if (updatedAt) {
    details.push(`Updated ${updatedAt.toLocaleTimeString()}`)
  } else if (startedAt) {
    details.push(`Started ${startedAt.toLocaleTimeString()}`)
  }

  if (startedAt && updatedAt && updatedAt.getTime() >= startedAt.getTime()) {
    details.push(formatDuration(updatedAt.getTime() - startedAt.getTime()))
  }

  if (typeof toolCall.attemptCount === "number" && toolCall.attemptCount > 1) {
    details.push(`Attempts ${toolCall.attemptCount}`)
  }

  return details.join(" • ")
}

function formatActionKind(kind: ToolCallData["actionKind"]): string | undefined {
  if (!kind) {
    return undefined
  }
  switch (kind) {
    case "tool":
      return "Tool"
    case "prompt":
      return "Prompt"
    case "resource":
      return "Resource"
    default:
      return undefined
  }
}

function parseMaybeDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}
