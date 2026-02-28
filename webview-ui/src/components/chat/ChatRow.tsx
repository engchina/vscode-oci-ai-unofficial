import { Bot, Check, User, X } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import TextareaAutosize from "react-textarea-autosize"
import type { ChatImageData, ChatMessageData } from "../../services/types"
import MessageActions from "./MessageActions"
import MessageContent from "./MessageContent"

interface ChatRowProps {
  message: ChatMessageData
  messageIndex: number
  isLastOfRole?: boolean
  onEdit: (messageIndex: number, newText: string) => void
  onRegenerate: (messageIndex: number) => void
}

export default function ChatRow({ message, messageIndex, isLastOfRole, onEdit, onRegenerate }: ChatRowProps) {
  const isUser = message.role === "user"
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = useCallback(() => {
    setEditText(message.text)
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [message.text])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditText("")
  }, [])

  const submitEdit = useCallback(() => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === message.text) {
      cancelEdit()
      return
    }
    setEditing(false)
    setEditText("")
    onEdit(messageIndex, trimmed)
  }, [editText, message.text, messageIndex, onEdit, cancelEdit])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        cancelEdit()
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submitEdit()
      }
    },
    [cancelEdit, submitEdit],
  )

  return (
    <div className="group/row flex flex-col gap-1 px-3 py-4 w-full border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
      <div className="flex items-center gap-2 font-semibold text-[11px] text-[var(--vscode-sideBarTitle-foreground)] uppercase tracking-wide">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] text-[var(--vscode-icon-foreground)]">
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </div>
        <span>{isUser ? "You" : "Generative AI"}</span>
      </div>
      <div className="pl-7 w-full text-[13px] text-[var(--vscode-foreground)] leading-relaxed">
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextareaAutosize
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              minRows={2}
              maxRows={12}
              className="w-full resize-none rounded-[2px] border border-[var(--vscode-focusBorder)] bg-[var(--vscode-input-background)] px-2 py-1.5 text-[13px] text-[var(--vscode-input-foreground)] outline-none"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={submitEdit}
                className="inline-flex h-7 items-center gap-1 rounded-[3px] bg-[var(--vscode-button-background)] px-2.5 text-[11px] font-medium text-[var(--vscode-button-foreground)] transition-colors hover:bg-[var(--vscode-button-hoverBackground)]"
              >
                <Check size={12} />
                Send
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex h-7 items-center gap-1 rounded-[3px] border border-[var(--vscode-panel-border)] bg-transparent px-2.5 text-[11px] font-medium text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="flex flex-col gap-2">
            {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
            {message.images && message.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 mt-1">
                {message.images.map((img, idx) => (
                  <a
                    key={`${img.name ?? "img"}-${idx}`}
                    href={img.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group w-24 shrink-0 overflow-hidden rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]"
                    title={attachmentName(img.name, idx)}
                  >
                    <AttachmentImage image={img} alt={attachmentName(img.name, idx)} />
                    <div className="truncate border-t border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-1.5 py-0.5 text-[10px] text-description transition-colors group-hover:text-foreground">
                      {attachmentName(img.name, idx)}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <MessageContent content={message.text} />
        )}
      </div>

      {/* Action buttons — visible on hover */}
      {!editing && (
        <div className="pl-7 pt-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <MessageActions
            role={message.role}
            text={message.text}
            onEdit={isUser ? startEdit : undefined}
            onRegenerate={() => onRegenerate(messageIndex)}
          />
        </div>
      )}
    </div>
  )
}

function attachmentName(name: string | undefined, idx: number): string {
  const cleaned = name?.trim()
  if (cleaned) return cleaned
  return `image-${idx + 1}.png`
}

function AttachmentImage({ image, alt }: { image: ChatImageData; alt: string }) {
  const [error, setError] = useState<string | null>(null)
  const dataUrl = image.previewDataUrl ?? image.dataUrl

  // Check if dataUrl is valid
  if (!dataUrl || typeof dataUrl !== 'string') {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        No image data
      </div>
    )
  }

  if (!dataUrl.startsWith('data:image/')) {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        Invalid format: {dataUrl.substring(0, 30)}...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-20 w-full items-center justify-center px-2 text-center text-[10px] text-description">
        {error}
      </div>
    )
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className="h-20 w-full object-cover"
      onError={(e) => {
        setError(`Load failed (${dataUrl.length} chars)`)
      }}
    />
  )
}
