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
      <div className="flex items-center justify-between gap-2 border-b border-border-panel px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquareText size={15} />
          <span className="text-sm font-semibold">Conversation History</span>
          <span className="text-xs text-description">{messages.length} message(s)</span>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-description">
            No conversation history yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className="rounded-lg border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] px-3 py-2"
              >
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-description">
                  {msg.role === "user" ? "User" : "Assistant"}
                </div>
                <div className="whitespace-pre-wrap text-xs leading-5">
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
