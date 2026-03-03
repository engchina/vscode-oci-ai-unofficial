import { clsx } from "clsx"
import { AlertTriangle, Bot, History, MessageSquareText, Plus } from "lucide-react"
import { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
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
    genAiLlmModelId,
    pendingCodeContext,
    clearPendingCodeContext,
    configWarning,
    editAndResend,
    regenerate,
  } = useExtensionState()

  const virtuosoRef = useRef<VirtuosoHandle>(null)

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
      <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-1">
        <div>
          <CompartmentSelector featureKey="chat" />
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
        modelNames={genAiLlmModelId}
        pendingContext={pendingCodeContext}
        onContextConsumed={clearPendingCodeContext}
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
      <p className="mb-8 text-center text-[13px] text-description">Ask about OCI resources, AI models, or coding tasks.</p>

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
