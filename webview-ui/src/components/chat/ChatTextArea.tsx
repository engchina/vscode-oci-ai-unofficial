import { Cpu, Paperclip, SendHorizonal, Square, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react"
import TextareaAutosize from "react-textarea-autosize"
import type { ChatImageData, CodeContextPayload, SendMessageRequest } from "../../services/types"

interface ChatTextAreaProps {
  onSend: (request: SendMessageRequest) => void
  onCancel?: () => void
  disabled?: boolean
  placeholder?: string
  modelNames?: string
  pendingContext?: CodeContextPayload | null
  onContextConsumed?: () => void
}

const MAX_IMAGES = 10
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const THUMBNAIL_MAX_SIDE = 256

interface PendingImageAttachment extends ChatImageData {
  previewUrl: string
}

export default function ChatTextArea({
  onSend,
  onCancel,
  disabled = false,
  placeholder,
  modelNames,
  pendingContext,
  onContextConsumed
}: ChatTextAreaProps) {
  const [value, setValue] = useState("")
  const [images, setImages] = useState<PendingImageAttachment[]>([])
  const [selectedModelName, setSelectedModelName] = useState("")
  const [validationError, setValidationError] = useState<string>("")
  const [queuedAutoSend, setQueuedAutoSend] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelOptions = useMemo(() => splitModelNames(modelNames), [modelNames])

  useEffect(() => {
    if (modelOptions.length === 0) {
      setSelectedModelName("")
      return
    }
    setSelectedModelName((prev) => (prev && modelOptions.includes(prev) ? prev : modelOptions[0]))
  }, [modelOptions])

  // When code context is injected from the editor, pre-fill or auto-send.
  useEffect(() => {
    if (!pendingContext) return
    const fence = `\`\`\`${pendingContext.language}\n// From: ${pendingContext.filename}\n${pendingContext.code}\n\`\`\``
    if (pendingContext.prompt) {
      // Auto-send without user interaction (e.g. Code Review, Generate Docs).
      const fullMessage = `${fence}\n\n${pendingContext.prompt}`
      if (!disabled) {
        onSend({ text: fullMessage, modelName: selectedModelName || undefined })
      } else {
        // Avoid losing auto-send tasks while another response is streaming.
        setQueuedAutoSend(fullMessage)
      }
      onContextConsumed?.()
    } else {
      onContextConsumed?.()
      setValue(fence + "\n\n")
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length)
        }
      }, 50)
    }
  }, [pendingContext, onContextConsumed, onSend, disabled])

  useEffect(() => {
    if (disabled || !queuedAutoSend) return
    onSend({ text: queuedAutoSend, modelName: selectedModelName || undefined })
    setQueuedAutoSend(null)
  }, [disabled, queuedAutoSend, onSend, selectedModelName])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || disabled) return

    const payloadImages: ChatImageData[] = images.map(({ dataUrl, previewDataUrl, mimeType, name }) => ({
      dataUrl,
      previewDataUrl,
      mimeType,
      name,
    }))

    onSend({
      text: trimmed,
      images: payloadImages.length > 0 ? payloadImages : undefined,
      modelName: selectedModelName || undefined,
    })
    setValue("")
    setImages([])
    setValidationError("")
    // Re-focus after send.
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [value, images, disabled, onSend, selectedModelName])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handlePickImages = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const appendImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    const next: PendingImageAttachment[] = []
    let error = ""
    for (const [index, file] of files.entries()) {
      if (!file.type.startsWith("image/")) {
        error = `Unsupported file type: ${file.name || "clipboard image"}`
        continue
      }
      if (file.size === 0) {
        error = `Image is empty: ${file.name || "clipboard image"}`
        continue
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        error = `Image too large (max 5MB): ${file.name || "clipboard image"}`
        continue
      }
      try {
        const attachment = await buildPendingImageAttachment(file, index)
        next.push(attachment)
      } catch (attachError) {
        const reason = attachError instanceof Error ? attachError.message : "invalid image"
        error = `Failed to process image: ${file.name || "clipboard image"} (${reason})`
      }
    }

    setImages((prev) => {
      const available = Math.max(0, MAX_IMAGES - prev.length)
      const merged = [...prev, ...next.slice(0, available)]
      if (next.length > available && !error) {
        setValidationError(`Only ${MAX_IMAGES} images can be attached per message.`)
      }
      return merged
    })

    if (error) {
      setValidationError(error)
    } else if (next.length > 0) {
      setValidationError("")
    }
  }, [])

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ""
      if (files.length === 0) return
      await appendImageFiles(files)
    },
    [appendImageFiles],
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return

      const clipboardFiles = Array.from(e.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))
      const imageFiles =
        clipboardFiles.length > 0
          ? clipboardFiles
          : Array.from(e.clipboardData?.items ?? [])
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file))
      if (imageFiles.length === 0) return

      e.preventDefault()
      void appendImageFiles(imageFiles)
    },
    [appendImageFiles, disabled],
  )

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const canSend = !disabled && (value.trim().length > 0 || images.length > 0)

  return (
    <div className="border-t border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 pb-3 pt-3">
      <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,var(--vscode-foreground)_3%)] p-2 focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {images.length > 0 && (
          <div className="mb-2 rounded-lg border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,black_6%)] p-2">
            <div className="mb-1 px-0.5 text-xxs text-description">
              {images.length}/{MAX_IMAGES} image(s) attached
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {images.map((img, idx) => (
                <div
                  key={`${img.name ?? "image"}-${idx}`}
                  className="group relative inline-flex h-8 max-w-[180px] shrink-0 items-center gap-2 rounded-full border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] pl-1.5 pr-7"
                >
                  <InputImagePreview
                    dataUrl={img.dataUrl}
                    previewUrl={img.previewUrl}
                    alt={attachmentName(img.name, idx)}
                  />
                  <span className="truncate text-xs text-foreground">{attachmentName(img.name, idx)}</span>
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--vscode-editor-background)_72%,black_28%)] text-foreground opacity-85 transition-opacity group-hover:opacity-100"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <TextareaAutosize
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder ?? "Type your task here..."}
            disabled={disabled}
            minRows={2}
            maxRows={8}
            className="w-full resize-none bg-transparent px-1 py-1 pr-20 text-[13px] text-input-foreground outline-none placeholder:text-input-placeholder disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1">
            <button
              onClick={handlePickImages}
              disabled={disabled || images.length >= MAX_IMAGES}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground disabled:opacity-30"
              title={images.length >= MAX_IMAGES ? `Max ${MAX_IMAGES} images` : "Attach images"}
            >
              <Paperclip size={16} />
            </button>
            {disabled && onCancel ? (
              <button
                onClick={onCancel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground"
                title="Stop generating"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground disabled:opacity-30"
                title="Send message"
              >
                <SendHorizonal size={16} />
              </button>
            )}
          </div>
        </div>

        {validationError && (
          <p className="mt-2 px-1 text-xxs text-warning">{validationError}</p>
        )}

        <div className="mt-2 flex min-h-6 items-center justify-between gap-2 px-1">
          <p className="truncate text-xxs text-description" title="Enter to send, Shift+Enter for newline. Paste image with Ctrl+V or attach up to 10 images per message.">
            Enter to send, Shift+Enter for newline. Paste image with Ctrl+V or attach up to {MAX_IMAGES} images.
          </p>

          {modelOptions.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 text-xxs text-description">
              <Cpu size={12} />
              <select
                value={selectedModelName}
                onChange={(e) => setSelectedModelName(e.target.value)}
                disabled={disabled}
                className="h-6 max-w-48 rounded border border-input-border bg-input-background px-1.5 text-xxs text-input-foreground outline-none focus:border-border disabled:cursor-not-allowed disabled:opacity-60"
                title="Select model"
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function splitModelNames(raw: string | undefined): string[] {
  if (!raw) return []
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(trimmed)
  }
  return deduped
}

async function buildPendingImageAttachment(file: File, idx: number): Promise<PendingImageAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error("empty image")
  }

  const mimeType = resolveMimeType(file.type, bytes)
  if (!mimeType) {
    throw new Error("unsupported image format")
  }

  // Use FileReader to create data URL (more reliable than manual base64 encoding)
  const dataUrl = await readFileAsDataUrl(file)
  if (!dataUrl) {
    throw new Error("failed to read image")
  }

  const previewDataUrl = await createThumbnailDataUrl(bytes, mimeType)
  const previewUrl = previewDataUrl ?? dataUrl

  return {
    dataUrl,
    previewDataUrl,
    previewUrl,
    mimeType,
    name: file.name || `pasted-image-${idx + 1}.${extForMimeType(mimeType)}`,
  }
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result === "string") {
        resolve(result)
      } else {
        resolve(null)
      }
    }
    reader.onerror = () => {
      resolve(null)
    }
    reader.readAsDataURL(file)
  })
}

function resolveMimeType(fileType: string, bytes: Uint8Array): string | null {
  const normalizedFileType = normalizeMimeType(fileType)
  const sniffed = sniffImageMimeType(bytes)

  if (sniffed) {
    return sniffed
  }
  if (normalizedFileType?.startsWith("image/")) {
    return normalizedFileType
  }
  return null
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized === "image/jpg") {
    return "image/jpeg"
  }
  return normalized
}

function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a) {
    return "image/png"
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61) {
    return "image/gif"
  }

  if (bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50) {
    return "image/webp"
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp"
  }

  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return "image/x-icon"
  }

  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 1024))).trimStart()
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.includes("<svg")) {
    return "image/svg+xml"
  }

  return null
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function createThumbnailDataUrl(bytes: Uint8Array, mimeType: string): Promise<string | undefined> {
  const blobBytes = Uint8Array.from(bytes)
  const blob = new Blob([blobBytes], { type: mimeType })
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = await loadImage(objectUrl)
    const dimensions = scaleDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, THUMBNAIL_MAX_SIDE)
    if (!dimensions) {
      return undefined
    }

    const canvas = document.createElement("canvas")
    canvas.width = dimensions.width
    canvas.height = dimensions.height

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      return undefined
    }

    ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("image decode failed"))
    image.src = src
  })
}

function scaleDimensions(width: number, height: number, maxSide: number): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) {
    return null
  }

  const ratio = Math.min(1, maxSide / Math.max(width, height))
  const scaledWidth = Math.max(1, Math.round(width * ratio))
  const scaledHeight = Math.max(1, Math.round(height * ratio))
  return { width: scaledWidth, height: scaledHeight }
}

function extForMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType)
  if (normalized === "image/jpeg") return "jpg"
  if (normalized.startsWith("image/")) return normalized.slice("image/".length) || "png"
  return "png"
}

function attachmentName(name: string | undefined, idx: number): string {
  const cleaned = name?.trim()
  if (cleaned) return cleaned
  return `image-${idx + 1}.png`
}

function InputImagePreview({ dataUrl, previewUrl, alt }: { dataUrl: string; previewUrl: string; alt: string }) {
  const [error, setError] = useState(false)
  const sourceUrl = previewUrl || dataUrl

  // Check if sourceUrl is valid
  if (!sourceUrl || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('data:image/')) {
    return <div className="h-5 w-5 shrink-0 rounded-full bg-description/20" title="Invalid image" />
  }

  if (error) {
    return <div className="h-5 w-5 shrink-0 rounded-full bg-description/20" title="Load failed" />
  }

  return (
    <img
      src={sourceUrl}
      alt={alt}
      className="h-5 w-5 shrink-0 rounded-full object-cover"
      onError={() => setError(true)}
    />
  )
}
