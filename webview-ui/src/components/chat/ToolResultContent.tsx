import type { ToolCallContent } from "../../services/types"
import MessageContent from "./MessageContent"

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
          return (
            <img
              key={`${item.type}-${index}`}
              src={item.dataUrl}
              alt="MCP result"
              className="mt-1 max-h-48 rounded border border-[var(--vscode-panel-border)]"
            />
          )
        }

        if (item.type === "resource" && item.uri) {
          return (
            <div key={`${item.type}-${index}`} className="flex flex-col gap-1 text-xs text-description">
              <div>Resource: {item.uri}</div>
              {item.text ? (
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs text-foreground">
                  {item.text}
                </pre>
              ) : null}
            </div>
          )
        }

        return null
      })}
    </div>
  )
}
