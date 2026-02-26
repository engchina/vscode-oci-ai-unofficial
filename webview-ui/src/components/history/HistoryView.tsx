import { ArrowLeft, MessageSquareText, Trash2 } from "lucide-react"
import Button from "../ui/Button"

interface HistoryViewProps {
  messages: Array<{ role: "user" | "model"; text: string }>
  onBack: () => void
  onClear: () => void
}

export default function HistoryView({ messages, onBack, onClear }: HistoryViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquareText size={14} className="text-[var(--vscode-icon-foreground)]" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">History</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft size={12} className="mr-1" />
            Back
          </Button>
          <Button variant="secondary" size="sm" onClick={onClear} disabled={messages.length === 0}>
            <Trash2 size={12} className="mr-1" />
            Clear
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-description">
            No conversation history yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2"
              >
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
                  {msg.role === "user" ? "User" : "Generative AI"}
                </div>
                <div className="whitespace-pre-wrap text-[13px] text-[var(--vscode-foreground)] leading-relaxed">
                  {msg.text || "(empty)"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
