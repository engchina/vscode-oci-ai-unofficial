import { MessageSquareText, Trash2 } from "lucide-react"
import { useState } from "react"
import GuardrailDialog from "../common/GuardrailDialog"
import { WorkbenchActionButton, WorkbenchBackButton, WorkbenchCompactActionCluster } from "../workbench/WorkbenchActionButtons"
import {
  buildWorkbenchResourceGuardrailDetails,
  createClearResourceGuardrail,
  type WorkbenchGuardrailState,
} from "../workbench/guardrail"
import { backToLabel } from "../workbench/navigationLabels"
import MessageContent from "../chat/MessageContent"

interface HistoryViewProps {
  messages: Array<{ role: "user" | "model"; text: string }>
  onBack?: () => void
  onClear: () => void
}

export default function HistoryView({ messages, onBack, onClear }: HistoryViewProps) {
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)

  const requestClear = () => {
    setGuardrail(createClearResourceGuardrail({
      resourceKind: "chat-history",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Thread",
        resourceName: "Current conversation",
        extras: [
          { label: "Messages", value: String(messages.length) },
        ],
      }),
      onConfirm: async () => {
        onClear()
      },
    }))
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareText size={14} className="text-[var(--vscode-icon-foreground)]" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">History</span>
              <span className="mt-0.5 text-[11px] text-description">
                Review prior assistant responses and clear the current thread.
              </span>
            </div>
          </div>
          <WorkbenchCompactActionCluster>
            {onBack && (
              <WorkbenchBackButton onClick={onBack} label={backToLabel("Chat")} />
            )}
            <WorkbenchActionButton variant="secondary" onClick={requestClear} disabled={messages.length === 0}>
              <Trash2 size={12} className="mr-1" />
              Clear
            </WorkbenchActionButton>
          </WorkbenchCompactActionCluster>
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
                  className={`rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2 ${msg.role === "user" ? "text-right" : "text-left"}`}
                >
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
                    {msg.role === "user" ? "User" : "Generative AI"}
                  </div>
                  <div className="text-[13px] text-[var(--vscode-foreground)] leading-relaxed">
                    {msg.text ? <MessageContent content={msg.text} /> : "(empty)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        onCancel={() => setGuardrail(null)}
        onConfirm={async () => {
          if (!guardrail) return
          await guardrail.onConfirm()
          setGuardrail(null)
        }}
      />
    </>
  )
}
