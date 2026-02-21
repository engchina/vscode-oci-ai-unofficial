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
    <div className="border-t border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] px-3 pt-2 pb-2">
      {/* Textarea with send button */}
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
          className="w-full resize-none rounded-lg border border-input-border bg-input-background px-3 py-2 pr-10 text-sm text-input-foreground outline-none placeholder:text-input-placeholder focus:border-border disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="absolute right-2 bottom-2 flex h-6 w-6 items-center justify-center rounded text-description transition-colors hover:text-foreground disabled:opacity-30"
          title="Send message"
        >
          <SendHorizonal size={16} />
        </button>
      </div>

      {/* Help text */}
      <p className="mt-1.5 text-xxs text-description">
        Type @ for context, / for slash commands & workflows, hold shift to drag in files/images
      </p>

      {/* Bottom bar: model name */}
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {/* spacer */}
        </div>
        {modelName && (
          <div className="flex items-center gap-1 text-xxs text-description">
            <Cpu size={12} />
            <span>{modelName}</span>
          </div>
        )}
      </div>
    </div>
  )
}
