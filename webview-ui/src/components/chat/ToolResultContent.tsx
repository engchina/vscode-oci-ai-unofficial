import type { ToolCallContent } from "../../services/types"
import MessageContent, { sanitizeMarkdownUrl } from "./MessageContent"

interface ToolResultContentProps {
  content: ToolCallContent[]
}

export default function ToolResultContent({ content }: ToolResultContentProps) {
  return (
    <div className="flex flex-col gap-2">
      {content.map((item, index) => {
        if (item.type === "text" && item.text) {
          return (
            <div key={`${item.type}-${index}`} className="text-xs">
              <MessageContent content={item.text} />
            </div>
          )
        }

        if (item.type === "image" && item.dataUrl) {
          const safeImageUrl = sanitizeMarkdownUrl(item.dataUrl, "image")
          if (!safeImageUrl) {
            return (
              <div
                key={`${item.type}-${index}`}
                className="inline-flex rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs text-description"
              >
                Blocked image result
              </div>
            )
          }
          return (
            <img
              key={`${item.type}-${index}`}
              src={safeImageUrl}
              alt="MCP result"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="mt-1 max-h-48 max-w-full rounded border border-[var(--vscode-panel-border)]"
            />
          )
        }

        if (item.type === "resource" && item.uri) {
          return (
            <div key={`${item.type}-${index}`} className="flex flex-col gap-1 text-xs text-description">
              <div>Resource: {item.uri}</div>
              {item.text ? (
                <div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs text-foreground">
                  <MessageContent content={item.text} />
                </div>
              ) : null}
            </div>
          )
        }

        return null
      })}
    </div>
  )
}
