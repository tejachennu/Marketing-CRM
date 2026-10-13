import { parseRichText } from '@/lib/chat-message-format'

/**
 * Message text with WhatsApp formatting (*bold*, _italic_, ~strike~, `code`) and clickable links.
 * Everything is rendered as React text nodes, never as HTML.
 */
export function MessageText({ text, className = '' }: { text: string; className?: string }) {
  const tokens = parseRichText(text)

  return (
    <p className={`break-words whitespace-pre-wrap ${className}`}>
      {tokens.map((token, index) => {
        const style = [
          token.bold ? 'font-semibold' : '',
          token.italic ? 'italic' : '',
          token.strike ? 'line-through' : '',
          token.code ? 'font-mono text-[0.92em] px-1 py-px rounded bg-black/[0.06] dark:bg-white/10' : '',
        ].filter(Boolean).join(' ')

        if (token.href) {
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[#027eb5] dark:text-[#53bdeb] underline underline-offset-2 hover:opacity-80 ${style}`}
            >
              {token.text}
            </a>
          )
        }
        return style ? <span key={index} className={style}>{token.text}</span> : <span key={index}>{token.text}</span>
      })}
    </p>
  )
}
