import { clsx } from "clsx"
import { AlertTriangle, Bot } from "lucide-react"
import { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import CompartmentSelector from "../ui/CompartmentSelector"
import StreamingRow from "./StreamingRow"

interface ChatViewProps {
  isHidden?: boolean
}

export default function ChatView({ isHidden = false }: ChatViewProps) {
  const {
    chatMessages,
    isStreaming,
    streamingText,
    sendMessage,
    stopStreaming,
    genAiLlmModelId,
    pendingCodeContext,
    clearPendingCodeContext,
    configWarning
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
        <div className="flex items-start gap-2 border-b border-warning/20 bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,yellow_12%)] px-3 py-2 text-xs text-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{configWarning}</span>
        </div>
      )}
      <div className="px-3 pt-3 pb-1 border-b border-border-panel shrink-0">
        <CompartmentSelector featureKey="chat" />
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
                return <ChatRow message={chatMessages[index]} />
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
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-panel bg-list-background-hover">
        <Bot size={36} className="text-description" />
      </div>

      <h2 className="mb-2 text-lg font-semibold">What can I do for you?</h2>
      <p className="mb-8 text-center text-sm text-description">Ask about OCI resources, AI models, or coding tasks.</p>

      <div className="w-full max-w-xl rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium tracking-wider text-description uppercase">Recent</span>
        </div>
        <div className="rounded-lg border border-border-panel px-3 py-6 text-center text-xs text-description">
          No recent conversations yet. Start a new chat!
        </div>
      </div>
    </div>
  )
}
