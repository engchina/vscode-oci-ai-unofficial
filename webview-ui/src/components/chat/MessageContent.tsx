import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { memo } from "react"

interface MessageContentProps {
  content: string
  className?: string
}

const markdownComponents: Components = {
  a: ({ node: _node, href, ...props }) => {
    const safeHref = sanitizeMarkdownUrl(href, "link")
    if (!safeHref) {
      return <span className="text-description">{props.children}</span>
    }
    return <a {...props} href={safeHref} target="_blank" rel="noreferrer" />
  },
  img: ({ node: _node, src, ...props }) => {
    const safeSrc = sanitizeMarkdownUrl(src, "image")
    if (!safeSrc) {
      return (
        <span className="inline-flex rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs text-description">
          {props.alt ?? "Blocked image"}
        </span>
      )
    }
    return (
      <img
        {...props}
        src={safeSrc}
        alt={props.alt ?? "Markdown image"}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="my-2 max-h-80 w-auto max-w-full rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] object-contain"
      />
    )
  },
}

function MessageContent({ content, className = "" }: MessageContentProps) {
  return (
    <div className={`max-w-none text-sm leading-6 [&_a]:text-link [&_a:hover]:text-link-hover [&_h1]:mb-2 [&_h1]:text-md [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_ul]:mb-2.5 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:mb-2.5 [&_ol]:ml-5 [&_ol]:list-decimal [&_li]:mb-1 [&_li:last-child]:mb-0 [&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-panel [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-description [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border-panel [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-border-panel [&_td]:px-2 [&_td]:py-1.5 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MessageContent)

export function sanitizeMarkdownUrl(rawUrl: string | undefined, kind: "link" | "image"): string | undefined {
  if (!rawUrl) {
    return undefined
  }
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return undefined
  }
  if (trimmed.startsWith("#")) {
    return kind === "link" ? trimmed : undefined
  }
  if (kind === "image" && (trimmed.startsWith("data:image/") || trimmed.startsWith("blob:"))) {
    return trimmed
  }
  try {
    const parsed = new URL(trimmed)
    if (kind === "link") {
      return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:" ? trimmed : undefined
    }
    return parsed.protocol === "https:" ? trimmed : undefined
  } catch {
    return undefined
  }
}
