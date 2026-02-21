import { clsx } from "clsx"
import { Bot, User } from "lucide-react"
import type { ChatMessageData } from "../../services/types"
import MessageContent from "./MessageContent"

interface ChatRowProps {
  message: ChatMessageData
}

export default function ChatRow({ message }: ChatRowProps) {
  const isUser = message.role === "user"

  return (
    <div className={clsx("flex gap-2 px-3 py-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={clsx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-[rgba(249,115,22,0.25)]" : "bg-[rgba(56,189,248,0.2)]",
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div
        className={clsx(
          "max-w-[85%] rounded-lg px-3 py-2",
          isUser
            ? "bg-[rgba(249,115,22,0.12)] border border-[rgba(249,115,22,0.3)]"
            : "bg-[rgba(56,189,248,0.08)] border border-[rgba(56,189,248,0.2)]",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.text}</p>
        ) : (
          <MessageContent content={message.text} />
        )}
      </div>
    </div>
  )
}
