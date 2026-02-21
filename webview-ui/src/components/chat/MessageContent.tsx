import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"

interface MessageContentProps {
  content: string
}

export default function MessageContent({ content }: MessageContentProps) {
  return (
    <div className="prose-invert max-w-none text-sm leading-relaxed [&_a]:text-link [&_a:hover]:text-link-hover [&_h1]:text-md [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:mb-2 [&_ol]:ml-4 [&_ol]:list-decimal [&_li]:mb-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-panel [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-description [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border-panel [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border-panel [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
