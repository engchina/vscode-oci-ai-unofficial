import { Bot } from "lucide-react"
import MessageContent from "./MessageContent"

interface StreamingRowProps {
  text: string
}

export default function StreamingRow({ text }: StreamingRowProps) {
  return (
    <div className="flex gap-2 px-3 py-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(56,189,248,0.2)]">
        <Bot size={14} />
      </div>
      <div className="max-w-[85%] rounded-lg border border-[rgba(56,189,248,0.2)] bg-[rgba(56,189,248,0.08)] px-3 py-2">
        {text ? (
          <MessageContent content={text} />
        ) : (
          <div className="flex items-center gap-1 py-1">
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
