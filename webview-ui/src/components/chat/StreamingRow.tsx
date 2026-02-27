import { Bot } from "lucide-react"
import MessageContent from "./MessageContent"

interface StreamingRowProps {
  text: string
}

export default function StreamingRow({ text }: StreamingRowProps) {
  return (
    <div className="flex flex-col gap-1 px-3 py-4 w-full border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
      <div className="flex items-center gap-2 font-semibold text-[11px] text-[var(--vscode-sideBarTitle-foreground)] uppercase tracking-wide">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] text-[var(--vscode-icon-foreground)]">
          <Bot size={12} />
        </div>
        <span>Generative AI</span>
      </div>
      <div className="pl-7 w-full text-[13px] text-[var(--vscode-foreground)] leading-relaxed">
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
