import { clsx } from "clsx"
import { AlertTriangle, Bot, History, MessageSquareText, Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { AgentServiceClient } from "../../services/grpc-client"
import type { AgentMode } from "../../services/types"
import InlineNotice from "../ui/InlineNotice"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import CompartmentSelector from "../ui/CompartmentSelector"
import StreamingRow from "./StreamingRow"
import { WorkbenchActionButton, WorkbenchCompactActionCluster } from "../workbench/WorkbenchActionButtons"

interface ChatViewProps {
  isHidden?: boolean
  onNewChat: () => void
  onHistory?: () => void
}

export default function ChatView({ isHidden = false, onNewChat, onHistory }: ChatViewProps) {
  const {
    chatMessages,
    isStreaming,
    streamingText,
    sendMessage,
    stopStreaming,
    assistantModelNames,
    pendingCodeContext,
    clearPendingCodeContext,
    pendingChatDraft,
    clearPendingChatDraft,
    configWarning,
    editAndResend,
    regenerate,
    agentMode,
  } = useExtensionState()

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [pendingAgentMode, setPendingAgentMode] = useState<AgentMode | null>(null)
  const [isSavingAgentMode, setIsSavingAgentMode] = useState(false)
  const [agentModeError, setAgentModeError] = useState("")
  const effectiveAgentMode = pendingAgentMode ?? agentMode
  const agentModeHint = useMemo(
    () => (effectiveAgentMode === "agent" ? "Agent enables built-in tool use." : "Chat returns plain text only."),
    [effectiveAgentMode],
  )

  useEffect(() => {
    setPendingAgentMode(null)
  }, [agentMode])

  const handleAgentModeChange = useCallback(async (nextMode: AgentMode) => {
    if (isSavingAgentMode || nextMode === agentMode) {
      return
    }
    setPendingAgentMode(nextMode)
    setIsSavingAgentMode(true)
    setAgentModeError("")
    try {
      const currentSettings = await AgentServiceClient.getSettings()
      await AgentServiceClient.saveSettings({ ...currentSettings, mode: nextMode })
    } catch (error) {
      console.error("Failed to save agent mode:", error)
      const message = error instanceof Error ? error.message : "Failed to save Chat Agent mode."
      setAgentModeError(message)
      setPendingAgentMode(null)
    } finally {
      setIsSavingAgentMode(false)
    }
  }, [agentMode, isSavingAgentMode])

  // Auto-scroll when new messages arrive or streaming updates
  useEffect(() => {
    if (chatMessages.length > 0 || isStreaming) {
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({
          index: "LAST",
          behavior: "smooth",
        })
      }, 50)
    }
  }, [chatMessages.length, isStreaming, streamingText])

  const totalItems = chatMessages.length + (isStreaming ? 1 : 0)

  return (
    <div className={clsx("flex h-full min-h-0 flex-col", isHidden && "hidden")}>
      {configWarning && (
        <InlineNotice tone="warning" size="md" icon={<AlertTriangle size={13} />} className="rounded-none border-x-0 border-t-0">
          {configWarning}
        </InlineNotice>
      )}
      <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareText size={14} className="text-[var(--vscode-icon-foreground)]" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[12px] font-semibold tracking-wide uppercase text-[var(--vscode-sideBarTitle-foreground)]">Chat</span>
              <span className="mt-0.5 text-[11px] text-description">
                Prompt the assistant with OCI-aware context and coding support.
              </span>
            </div>
          </div>

          <WorkbenchCompactActionCluster>
            <WorkbenchActionButton variant="secondary" onClick={onNewChat}>
              <Plus size={12} className="mr-1" />
              New Chat
            </WorkbenchActionButton>
            {onHistory && (
              <WorkbenchActionButton variant="secondary" onClick={onHistory}>
                <History size={12} className="mr-1" />
                Open History
              </WorkbenchActionButton>
            )}
          </WorkbenchCompactActionCluster>
        </div>
      </div>
      <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-1.5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <CompartmentSelector featureKey="chat" />
            </div>
            <div className="shrink-0 lg:ml-3">
              <div
                className="inline-flex items-center rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,white_8%)] p-1"
                role="tablist"
                aria-label="Assistant mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveAgentMode === "chat"}
                  onClick={() => void handleAgentModeChange("chat")}
                  disabled={isSavingAgentMode}
                  className={clsx(
                    "group inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60",
                    effectiveAgentMode === "chat"
                      ? "border-[color-mix(in_srgb,var(--vscode-focusBorder)_72%,white_28%)] bg-[color-mix(in_srgb,var(--vscode-button-background)_82%,white_18%)] text-[var(--vscode-button-foreground)] shadow-[0_4px_12px_rgba(0,0,0,0.22)]"
                      : "border-transparent text-description hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
                  )}
                  title="Use chat mode"
                >
                  <span
                    className={clsx(
                      "inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
                      effectiveAgentMode === "chat"
                        ? "bg-[color-mix(in_srgb,var(--vscode-button-foreground)_18%,transparent)] text-[var(--vscode-button-foreground)]"
                        : "text-[var(--vscode-descriptionForeground)] group-hover:text-[var(--vscode-foreground)]",
                    )}
                  >
                    <MessageSquareText size={13} />
                  </span>
                  Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveAgentMode === "agent"}
                  onClick={() => void handleAgentModeChange("agent")}
                  disabled={isSavingAgentMode}
                  className={clsx(
                    "group inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60",
                    effectiveAgentMode === "agent"
                      ? "border-[color-mix(in_srgb,var(--vscode-focusBorder)_72%,white_28%)] bg-[color-mix(in_srgb,var(--vscode-button-background)_82%,white_18%)] text-[var(--vscode-button-foreground)] shadow-[0_4px_12px_rgba(0,0,0,0.22)]"
                      : "border-transparent text-description hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
                  )}
                  title="Use agent mode"
                >
                  <span
                    className={clsx(
                      "inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
                      effectiveAgentMode === "agent"
                        ? "bg-[color-mix(in_srgb,var(--vscode-button-foreground)_18%,transparent)] text-[var(--vscode-button-foreground)]"
                        : "text-[var(--vscode-descriptionForeground)] group-hover:text-[var(--vscode-foreground)]",
                    )}
                  >
                    <Bot size={13} />
                  </span>
                  Agent
                </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-description">
            {isSavingAgentMode ? "Saving assistant mode..." : agentModeHint}
          </p>
          {agentModeError && (
            <InlineNotice tone="warning" size="sm">
              {agentModeError}
            </InlineNotice>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {totalItems === 0 ? (
          <WelcomeSection />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            totalCount={totalItems}
            followOutput="smooth"
            className="h-full px-1 py-2"
            itemContent={(index) => {
              if (index < chatMessages.length) {
                return (
                  <ChatRow
                    message={chatMessages[index]}
                    messageIndex={index}
                    onEdit={editAndResend}
                    onRegenerate={regenerate}
                  />
                )
              }
              return <StreamingRow text={streamingText} />
            }}
          />
        )}
      </div>

      <ChatTextArea
        onSend={sendMessage}
        onCancel={stopStreaming}
        disabled={isStreaming}
        modelNames={assistantModelNames}
        pendingContext={pendingCodeContext}
        onContextConsumed={clearPendingCodeContext}
        pendingDraft={pendingChatDraft}
        onDraftConsumed={clearPendingChatDraft}
        placeholder="Type a task, `/help`, `/skills`, `/skill <id> <task>`, or `/subagents ...`"
      />
    </div>
  )
}

function WelcomeSection() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-8">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-icon-foreground)]">
        <Bot size={24} />
      </div>

      <h2 className="mb-1 text-[16px] font-semibold text-[var(--vscode-foreground)]">What can I do for you?</h2>
      <p className="mb-8 text-center text-[13px] text-description">Ask about OCI resources, AI models, coding tasks, or invoke reusable skills.</p>

      <div className="w-full max-w-xl rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider text-description uppercase">Recent</span>
        </div>
        <div className="rounded border border-[var(--vscode-panel-border)] border-dashed px-3 py-6 text-center text-[12px] text-description bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,var(--vscode-foreground)_2%)]">
          No recent conversations yet. Start a new chat!
        </div>
      </div>
    </div>
  )
}
