import { Cpu, SendHorizonal } from "lucide-react"
import { useCallback, useRef, useState, type KeyboardEvent } from "react"
import TextareaAutosize from "react-textarea-autosize"

interface ChatTextAreaProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  modelName?: string
}

export default function ChatTextArea({ onSend, disabled = false, placeholder, modelName }: ChatTextAreaProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    // Re-focus after send
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="border-t border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_93%,black_7%)] px-4 pb-3 pt-3">
      <div className="rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] p-2.5">
        <div className="relative">
          <TextareaAutosize
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Type your task here..."}
            disabled={disabled}
            minRows={2}
            maxRows={8}
            className="w-full resize-none rounded-lg border border-input-border bg-input-background px-3 py-2 pr-12 text-sm text-input-foreground outline-none placeholder:text-input-placeholder focus:border-border disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground disabled:opacity-30"
            title="Send message"
          >
            <SendHorizonal size={16} />
          </button>
        </div>

        <p className="mt-2 px-1 text-xxs text-description">
          Type @ for context, / for slash commands & workflows, hold shift to drag in files/images
        </p>

        <div className="mt-2 flex min-h-4 items-center justify-end px-1">
          {modelName && (
            <div className="flex items-center gap-1 text-xxs text-description">
              <Cpu size={12} />
              <span>{modelName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
