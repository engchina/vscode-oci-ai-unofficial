import { Bot, Check, Plug, User, X } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import TextareaAutosize from "react-textarea-autosize"
import type { ChatImageData, ChatMessageData, ToolCallData } from "../../services/types"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
} from "../workbench/WorkbenchActionButtons"
import MessageActions from "./MessageActions"
import MessageContent from "./MessageContent"
import ToolCallBlock from "./ToolCallBlock"

interface ChatRowProps {
  message: ChatMessageData
  messageIndex: number
  isLastOfRole?: boolean
  onEdit: (messageIndex: number, newText: string) => void
  onRegenerate: (messageIndex: number) => void
}

export default function ChatRow({ message, messageIndex, isLastOfRole, onEdit, onRegenerate }: ChatRowProps) {
  const isUser = message.role === "user"
  const alignContainer = isUser ? "ml-auto" : "mr-auto"
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mcpBanner = useMemo(() => buildMcpBanner(message.toolCalls), [message.toolCalls])

  const startEdit = useCallback(() => {
    setEditText(message.text)
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [message.text])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditText("")
  }, [])

  const submitEdit = useCallback(() => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === message.text) {
      cancelEdit()
      return
    }
    setEditing(false)
    setEditText("")
    onEdit(messageIndex, trimmed)
  }, [editText, message.text, messageIndex, onEdit, cancelEdit])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        cancelEdit()
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submitEdit()
      }
    },
    [cancelEdit, submitEdit],
  )

  return (
    <div className="group/row flex flex-col gap-1 px-3 py-4 w-full border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
      <div
        className={`flex w-full max-w-[min(85%,56rem)] items-center gap-2 font-semibold text-[11px] text-[var(--vscode-sideBarTitle-foreground)] uppercase tracking-wide ${alignContainer} ${isUser ? "justify-end" : "justify-start"
          }`}
      >
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] text-[var(--vscode-icon-foreground)]">
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </div>
        <span>{isUser ? "You" : "Generative AI"}</span>
      </div>
      <div
        className={`w-full max-w-[min(85%,56rem)] text-[13px] text-[var(--vscode-foreground)] leading-relaxed ${alignContainer} ${isUser ? "pr-7 text-right" : "pl-7 text-left"
          }`}
      >
        {editing ? (
          <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
            <TextareaAutosize
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              minRows={2}
              maxRows={12}
              className="w-full resize-none rounded-[2px] border border-[var(--vscode-focusBorder)] bg-[var(--vscode-input-background)] px-2 py-1.5 text-[13px] text-[var(--vscode-input-foreground)] outline-none"
            />
            <WorkbenchCompactActionCluster>
              <WorkbenchActionButton type="button" onClick={submitEdit} className="h-7">
                <Check size={12} />
                Send
              </WorkbenchActionButton>
              <WorkbenchActionButton type="button" variant="ghost" onClick={cancelEdit} className="h-7 px-2.5 text-[11px]">
                <X size={12} />
                Cancel
              </WorkbenchActionButton>
            </WorkbenchCompactActionCluster>
          </div>
        ) : isUser ? (
          <div className="flex flex-col items-end gap-2">
            {message.text && (
              <div className="max-w-full text-left">
                <MessageContent content={message.text} />
              </div>
            )}
            {message.images && message.images.length > 0 && (
              <div className={`flex gap-2 overflow-x-auto pb-1 mt-1 ${isUser ? "justify-end" : "justify-start"}`}>
                {message.images.map((img, idx) => (
                  <a
                    key={`${img.name ?? "img"}-${idx}`}
                    href={img.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group w-24 shrink-0 overflow-hidden rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]"
                    title={attachmentName(img.name, idx)}
                  >
                    <AttachmentImage image={img} alt={attachmentName(img.name, idx)} />
                    <div className="truncate border-t border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-1.5 py-0.5 text-[10px] text-description transition-colors group-hover:text-foreground">
                      {attachmentName(img.name, idx)}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {mcpBanner && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 ${mcpBanner.tone.container}`}>
                <span className={`mt-0.5 shrink-0 ${mcpBanner.tone.icon}`}><Plug size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">{mcpBanner.title}</div>
                  <div className="mt-0.5 text-[11px] text-description">{mcpBanner.detail}</div>
                </div>
              </div>
            )}
            <MessageContent content={message.text} />
            {/* Tool call blocks */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                {message.toolCalls.map((tc) => (
                  <ToolCallBlock key={tc.id} toolCall={tc} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons — visible on hover */}
      {!editing && (
        <div
          className={`w-full max-w-[min(85%,56rem)] ${alignContainer} ${isUser ? "pr-7 text-right flex justify-end" : "pl-7 text-left"} pt-1 opacity-0 group-hover/row:opacity-100 transition-opacity`}
        >
          <MessageActions
            role={message.role}
            text={message.text}
            onEdit={isUser ? startEdit : undefined}
            onRegenerate={() => onRegenerate(messageIndex)}
          />
        </div>
      )}
    </div>
  )
}

function attachmentName(name: string | undefined, idx: number): string {
  const cleaned = name?.trim()
  if (cleaned) return cleaned
  return `image-${idx + 1}.png`
}

function AttachmentImage({ image, alt }: { image: ChatImageData; alt: string }) {
  const [error, setError] = useState<string | null>(null)
  const dataUrl = image.previewDataUrl ?? image.dataUrl

  // Check if dataUrl is valid
  if (!dataUrl || typeof dataUrl !== 'string') {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        No image data
      </div>
    )
  }

  if (!dataUrl.startsWith('data:image/')) {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        Invalid format: {dataUrl.substring(0, 30)}...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        {error}
      </div>
    )
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className="h-20 w-full object-cover"
      onError={(e) => {
        setError(`Load failed (${dataUrl.length} chars)`)
      }}
    />
  )
}


type McpBannerTone = {
  container: string
  icon: string
}

type McpBannerState = {
  title: string
  detail: string
  tone: McpBannerTone
}

function buildMcpBanner(toolCalls: ToolCallData[] | undefined): McpBannerState | null {
  if (!toolCalls || toolCalls.length === 0) {
    return null
  }

  const active = toolCalls.filter((toolCall) => toolCall.status === "running" || toolCall.status === "approved" || toolCall.status === "pending")
  if (active.length === 0) {
    return null
  }

  const servers = Array.from(new Set(active.map((toolCall) => (toolCall.serverName ?? toolCall.toolName).trim()).filter(Boolean)))
  const primaryStatus = resolvePrimaryMcpStatus(active)
  const label = servers.slice(0, 2).map((name) => name.toUpperCase()).join("、") + (servers.length > 2 ? ` +${servers.length - 2}` : "")

  return {
    title: `正在使用 MCP：${label}`,
    detail: describeMcpBannerDetail(primaryStatus, active),
    tone: resolveMcpBannerTone(primaryStatus, active),
  }
}

function resolvePrimaryMcpStatus(toolCalls: ToolCallData[]): ToolCallData["status"] {
  if (toolCalls.some((toolCall) => toolCall.status === "running")) {
    return "running"
  }
  if (toolCalls.some((toolCall) => toolCall.status === "pending")) {
    return "pending"
  }
  if (toolCalls.some((toolCall) => toolCall.status === "approved")) {
    return "approved"
  }
  return toolCalls[0]?.status ?? "running"
}

function describeMcpBannerDetail(status: ToolCallData["status"], toolCalls: ToolCallData[]): string {
  const promptCount = toolCalls.filter((toolCall) => toolCall.actionKind === "prompt").length
  const toolCount = toolCalls.filter((toolCall) => (toolCall.actionKind ?? "tool") === "tool").length
  const resourceCount = toolCalls.filter((toolCall) => toolCall.actionKind === "resource").length
  const parts = [
    promptCount ? `${promptCount} prompt` : "",
    toolCount ? `${toolCount} tool` : "",
    resourceCount ? `${resourceCount} resource` : "",
  ].filter(Boolean)
  const workload = parts.join(" • ") || `${toolCalls.length} action`

  switch (status) {
    case "running":
      return `${workload} executing now.`
    case "pending":
      return `${workload} waiting for approval before execution.`
    case "approved":
      return `${workload} approved and queued to run.`
    default:
      return `${workload} active.`
  }
}


function resolveMcpBannerTone(status: ToolCallData["status"], toolCalls: ToolCallData[]): McpBannerTone {
  if (toolCalls.some((toolCall) => toolCall.status === "error" || toolCall.result?.isError)) {
    return {
      container: "border-[color-mix(in_srgb,var(--vscode-inputValidation-errorBorder)_75%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-inputValidation-errorBackground)_18%,transparent)]",
      icon: "text-[var(--vscode-errorForeground)]",
    }
  }

  switch (status) {
    case "pending":
      return {
        container: "border-[color-mix(in_srgb,var(--vscode-charts-yellow)_50%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,var(--vscode-charts-yellow)_10%)]",
        icon: "text-[var(--vscode-charts-yellow)]",
      }
    case "approved":
      return {
        container: "border-[color-mix(in_srgb,var(--vscode-charts-green)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,var(--vscode-charts-green)_8%)]",
        icon: "text-[var(--vscode-charts-green)]",
      }
    case "running":
    default:
      return {
        container: "border-[color-mix(in_srgb,var(--vscode-charts-blue)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,var(--vscode-charts-blue)_8%)]",
        icon: "text-[var(--vscode-charts-blue)]",
      }
  }
}
