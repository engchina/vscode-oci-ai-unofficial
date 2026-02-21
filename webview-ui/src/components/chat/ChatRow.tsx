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
    <div className={clsx("flex gap-3 px-4 py-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={clsx(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-panel",
          isUser
            ? "bg-[color-mix(in_srgb,var(--vscode-button-background)_25%,transparent)]"
            : "bg-[color-mix(in_srgb,var(--vscode-badge-background)_20%,transparent)]",
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div
        className={clsx(
          "max-w-[min(78ch,85%)] rounded-xl border px-3.5 py-2.5",
          isUser
            ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,transparent)] bg-[color-mix(in_srgb,var(--vscode-button-background)_16%,transparent)]"
            : "border-[color-mix(in_srgb,var(--vscode-badge-background)_35%,transparent)] bg-[color-mix(in_srgb,var(--vscode-badge-background)_12%,transparent)]",
        )}
      >
        {isUser ? <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p> : <MessageContent content={message.text} />}
      </div>
    </div>
  )
}
