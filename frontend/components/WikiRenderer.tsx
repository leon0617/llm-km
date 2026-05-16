'use client'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'

interface Props {
  content: string
}

// Convert [[page name]] to clickable links
function resolveWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    // strip display alias: [[name|alias]] → use name as href, alias as text
    const [href, label] = name.split('|')
    return `[${label || href}](/browse/${encodeURIComponent(href.trim())})`
  })
}

// Convert ![[image.png]] to markdown image syntax
function resolveImageLinks(content: string): string {
  return content.replace(/!\[\[([^\]]+)\]\]/g, (_, name) => {
    return `![${name}](/api/raw/assets/${encodeURIComponent(name)})`
  })
}

export default function WikiRenderer({ content }: Props) {
  const router = useRouter()
  // Order matters: ![[img]] must be converted to ![img](url) BEFORE
  // [[link]] → [link](url), otherwise the inner [[img]] gets eaten first
  // and the leading "!" is left dangling.
  const processed = resolveWikiLinks(resolveImageLinks(content))

  return (
    <div className="wiki-body prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('/browse/')) {
              return (
                <span
                  className="wiki-link"
                  onClick={() => router.push(href!)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && router.push(href!)}
                >
                  {children}
                </span>
              )
            }
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
