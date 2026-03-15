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
import MessageContent from "./MessageContent"
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
  const actionKindLabel = useMemo(() => formatActionKind(toolCall.actionKind)?.toLowerCase() ?? "tool", [toolCall.actionKind])
  const statusDetail = useMemo(() => buildStatusDetail(toolCall, actionKindLabel), [toolCall, actionKindLabel])
  const targetHint = useMemo(() => extractPrimaryTarget(toolCall.parameters), [toolCall.parameters])

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
    } catch {
      /* ignore */
    }
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
  const highlightTone = getHighlightTone(toolCall)

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-md border",
        toolCall.result?.isError
          ? "border-[var(--vscode-inputValidation-errorBorder)] bg-[color-mix(in_srgb,var(--vscode-inputValidation-errorBackground)_10%,transparent)]"
          : highlightTone.container,
      )}
    >
      {(toolCall.status === "pending" || toolCall.status === "approved" || toolCall.status === "running") && (
        <div className={clsx("border-b px-3 py-2", highlightTone.banner)}>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{STATUS_ICON[toolCall.status]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                MCP {actionKindLabel} {toolCall.status === "running" ? "in progress" : toolCall.status}
              </div>
              <div className="mt-0.5 text-xs text-description">
                {statusDetail}
                {targetHint ? <span className="ml-1 text-foreground">Target: {targetHint}</span> : null}
              </div>
            </div>
          </div>
          {toolCall.status === "running" && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--vscode-editor-background)_72%,transparent)]">
              <div className="h-full w-1/3 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-[var(--vscode-charts-blue)]" />
            </div>
          )}
        </div>
      )}

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
              <MessageContent
                content={toJsonCodeBlock(toolCall.parameters)}
                className="text-xs text-description"
              />
            </div>
          )}
        </>
      )}

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

      {hasResult && (
        <div className="border-t border-[var(--vscode-panel-border)] px-3 py-2">
          <ToolResultContent content={toolCall.result!.content} />
        </div>
      )}
    </div>
  )
}

function toJsonCodeBlock(value: Record<string, unknown>): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
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

function getHighlightTone(toolCall: ToolCallData): { container: string; banner: string } {
  if (toolCall.result?.isError || toolCall.status === "error") {
    return {
      container: "border-[var(--vscode-inputValidation-errorBorder)] bg-[color-mix(in_srgb,var(--vscode-inputValidation-errorBackground)_10%,transparent)]",
      banner: "border-[var(--vscode-inputValidation-errorBorder)] bg-[color-mix(in_srgb,var(--vscode-inputValidation-errorBackground)_22%,transparent)]",
    }
  }
  if (toolCall.status === "running") {
    return {
      container: "border-[color-mix(in_srgb,var(--vscode-charts-blue)_55%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,var(--vscode-charts-blue)_6%)]",
      banner: "border-[color-mix(in_srgb,var(--vscode-charts-blue)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-charts-blue)_16%,transparent)]",
    }
  }
  if (toolCall.status === "pending") {
    return {
      container: "border-[color-mix(in_srgb,var(--vscode-charts-yellow)_50%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,var(--vscode-charts-yellow)_6%)]",
      banner: "border-[color-mix(in_srgb,var(--vscode-charts-yellow)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-charts-yellow)_16%,transparent)]",
    }
  }
  if (toolCall.status === "approved") {
    return {
      container: "border-[color-mix(in_srgb,var(--vscode-charts-green)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,var(--vscode-charts-green)_5%)]",
      banner: "border-[color-mix(in_srgb,var(--vscode-charts-green)_40%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-charts-green)_14%,transparent)]",
    }
  }
  return {
    container: "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)]",
    banner: "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,white_8%)]",
  }
}

function buildStatusDetail(toolCall: ToolCallData, actionKindLabel: string): string {
  switch (toolCall.status) {
    case "pending":
      return `Waiting for your approval before the MCP ${actionKindLabel} is executed.`
    case "approved":
      return `Approval received. The MCP ${actionKindLabel} is queued to run next.`
    case "running":
      return `Executing the MCP ${actionKindLabel} on the connected server now.`
    case "completed":
      return `The MCP ${actionKindLabel} finished successfully.`
    case "error":
      return `The MCP ${actionKindLabel} failed. Review the result details below.`
    case "denied":
      return `The MCP ${actionKindLabel} was denied and did not run.`
    default:
      return `MCP ${actionKindLabel} status updated.`
  }
}

function extractPrimaryTarget(parameters: Record<string, unknown>): string | undefined {
  const preferredKeys = ["url", "uri", "path", "file", "query", "command", "name"]
  for (const key of preferredKeys) {
    const value = parameters[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return undefined
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
