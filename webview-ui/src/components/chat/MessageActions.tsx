import { Check, Copy, Pencil, RotateCcw } from "lucide-react"
import { useCallback, useState } from "react"

export interface MessageActionsProps {
  role: "user" | "model"
  text: string
  onEdit?: () => void
  onRegenerate?: () => void
}

export default function MessageActions({ role, text, onEdit, onRegenerate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <div className="flex items-center gap-0.5">
      {/* Copy */}
      <ActionButton
        title={copied ? "Copied!" : "Copy"}
        onClick={handleCopy}
        icon={copied ? <Check size={13} /> : <Copy size={13} />}
        active={copied}
      />

      {/* Edit — user messages only */}
      {role === "user" && onEdit && (
        <ActionButton title="Edit" onClick={onEdit} icon={<Pencil size={13} />} />
      )}

      {/* Regenerate */}
      {onRegenerate && (
        <ActionButton title="Regenerate" onClick={onRegenerate} icon={<RotateCcw size={13} />} />
      )}
    </div>
  )
}

function ActionButton({
  title,
  onClick,
  icon,
  active = false,
}: {
  title: string
  onClick: () => void
  icon: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-[3px] transition-colors ${
        active
          ? "text-[var(--vscode-notificationsInfoIcon-foreground)]"
          : "text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
      }`}
    >
      {icon}
    </button>
  )
}
