import { AlertTriangle, ShieldAlert } from "lucide-react"
import { useEffect, useState } from "react"
import Button from "../ui/Button"
import Input from "../ui/Input"

interface GuardrailDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  details?: string[]
  tone?: "warning" | "danger"
  requireText?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export default function GuardrailDialog({
  open,
  title,
  description,
  confirmLabel,
  details = [],
  tone = "warning",
  requireText,
  busy = false,
  onCancel,
  onConfirm,
}: GuardrailDialogProps) {
  const [typedValue, setTypedValue] = useState("")

  useEffect(() => {
    if (open) {
      setTypedValue("")
    }
  }, [open, requireText])

  if (!open) {
    return null
  }

  const needsTypedConfirmation = Boolean(requireText?.trim())
  const normalizedRequiredText = requireText?.trim() ?? ""
  const isConfirmDisabled =
    busy || (needsTypedConfirmation && typedValue.trim() !== normalizedRequiredText)

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-lg rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--vscode-panel-border)] px-4 py-3">
          <div className={tone === "danger" ? "text-error" : "text-warning"}>
            {tone === "danger" ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-[var(--vscode-foreground)]">{title}</h3>
            <p className="mt-1 text-[12px] text-description">{description}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          {details.length > 0 && (
            <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-3 py-2">
              {details.map((detail, index) => (
                <div key={`${detail}-${index}`} className="text-[11px] text-description">
                  {detail}
                </div>
              ))}
            </div>
          )}

          {needsTypedConfirmation && (
            <Input
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              label={`Type ${normalizedRequiredText} to continue`}
              placeholder={normalizedRequiredText}
              autoFocus
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--vscode-panel-border)] px-4 py-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={isConfirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
