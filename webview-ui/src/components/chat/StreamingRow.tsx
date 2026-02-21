import { Bot } from "lucide-react"
import MessageContent from "./MessageContent"

interface StreamingRowProps {
  text: string
}

export default function StreamingRow({ text }: StreamingRowProps) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-panel bg-[color-mix(in_srgb,var(--vscode-badge-background)_20%,transparent)]">
        <Bot size={14} />
      </div>
      <div className="max-w-[min(78ch,85%)] rounded-xl border border-[color-mix(in_srgb,var(--vscode-badge-background)_35%,transparent)] bg-[color-mix(in_srgb,var(--vscode-badge-background)_12%,transparent)] px-3.5 py-2.5">
        {text ? (
          <MessageContent content={text} />
        ) : (
          <div className="flex items-center gap-1 py-1.5">
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            <span className="streaming-dot inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
