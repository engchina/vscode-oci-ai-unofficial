import { clsx } from "clsx"
import { Bot } from "lucide-react"
import { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import StreamingRow from "./StreamingRow"

interface ChatViewProps {
  isHidden?: boolean
}

export default function ChatView({ isHidden = false }: ChatViewProps) {
  const { chatMessages, isStreaming, streamingText, sendMessage, genAiLlmModelId } = useExtensionState()

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
    <div className={clsx("flex h-full flex-col", isHidden && "hidden")}>
      {/* Messages / Welcome */}
      <div className="flex-1 overflow-hidden">
        {totalItems === 0 ? (
          <WelcomeSection />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            totalCount={totalItems}
            followOutput="smooth"
            className="h-full"
            itemContent={(index) => {
              if (index < chatMessages.length) {
                return <ChatRow message={chatMessages[index]} />
              }
              return <StreamingRow text={streamingText} />
            }}
          />
        )}
      </div>

      {/* Input */}
      <ChatTextArea onSend={sendMessage} disabled={isStreaming} modelName={genAiLlmModelId} />
    </div>
  )
}

function WelcomeSection() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      {/* Robot Icon */}
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(128,128,128,0.15)]">
        <Bot size={36} className="text-description" />
      </div>

      {/* Title */}
      <h2 className="mb-8 text-lg font-medium">What can I do for you?</h2>

      {/* Recent section placeholder */}
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium tracking-wider text-description uppercase">Recent</span>
        </div>
        <div className="py-4 text-center text-xs text-description">
          No recent conversations yet. Start a new chat!
        </div>
      </div>
    </div>
  )
}
