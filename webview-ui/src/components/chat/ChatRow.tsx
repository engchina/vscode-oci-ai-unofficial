import { clsx } from "clsx"
import { Bot, User } from "lucide-react"
import { useState } from "react"
import type { ChatImageData, ChatMessageData } from "../../services/types"
import MessageContent from "./MessageContent"

interface ChatRowProps {
  message: ChatMessageData
}

export default function ChatRow({ message }: ChatRowProps) {
  const isUser = message.role === "user"

  return (
    <div className={clsx("flex gap-3 px-4 py-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={clsx(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-panel",
          isUser
            ? "bg-[color-mix(in_srgb,var(--vscode-button-background)_25%,transparent)]"
            : "bg-[color-mix(in_srgb,var(--vscode-badge-background)_20%,transparent)]",
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div
        className={clsx(
          "max-w-[min(78ch,85%)] rounded-xl border px-3.5 py-2.5",
          isUser
            ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,transparent)] bg-[color-mix(in_srgb,var(--vscode-button-background)_16%,transparent)]"
            : "border-[color-mix(in_srgb,var(--vscode-badge-background)_35%,transparent)] bg-[color-mix(in_srgb,var(--vscode-badge-background)_12%,transparent)]",
        )}
      >
        {isUser ? (
          <div className="flex flex-col gap-2">
            {message.text && <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>}
            {message.images && message.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {message.images.map((img, idx) => (
                  <a
                    key={`${img.name ?? "img"}-${idx}`}
                    href={img.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group w-28 shrink-0 overflow-hidden rounded-lg border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)]"
                    title={attachmentName(img.name, idx)}
                  >
                    <AttachmentImage image={img} alt={attachmentName(img.name, idx)} />
                    <div className="truncate border-t border-border-panel px-2 py-1 text-[11px] text-description transition-colors group-hover:text-foreground">
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
        const target = e.target as HTMLImageElement
        setError(`Load failed (${dataUrl.length} chars)`)
      }}
    />
  )
}
