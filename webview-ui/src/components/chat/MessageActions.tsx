import { Check, Copy, Pencil, RotateCcw } from "lucide-react"
import { useCallback, useState } from "react"
import { WorkbenchCompactActionCluster, WorkbenchIconActionButton } from "../workbench/WorkbenchActionButtons"

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
    <WorkbenchCompactActionCluster className="gap-0.5">
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
    </WorkbenchCompactActionCluster>
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
    <WorkbenchIconActionButton
      onClick={onClick}
      title={title}
      icon={icon}
      variant="icon"
      size="icon"
      className={`rounded-[3px] transition-colors ${
        active
          ? "text-[var(--vscode-notificationsInfoIcon-foreground)]"
          : "text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
      }`}
    />
  )
}
