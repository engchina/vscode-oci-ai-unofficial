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
    <div className="flex flex-col gap-1 px-3 py-4 w-full border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
      <div className="flex items-center gap-2 font-semibold text-[11px] text-[var(--vscode-sideBarTitle-foreground)] uppercase tracking-wide">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] text-[var(--vscode-icon-foreground)]">
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </div>
        <span>{isUser ? "You" : "Generative AI"}</span>
      </div>
      <div className="pl-7 w-full text-[13px] text-[var(--vscode-foreground)] leading-relaxed">
        {isUser ? (
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
