// apps/web/src/components/kopilot/ui/messages/assistant-message.tsx

import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '~/components/global/tooltip'
import type { KopilotMessage, LinkSnapshot, ThinkingGroup } from '../../stores/kopilot-store'
import { useKopilotStore } from '../../stores/kopilot-store'
import '../../styles/kopilot-prose.css'
import { parse as partialJsonParse } from '../../utils/partial-json'
import { AuxxBlock } from '../blocks/auxx-block'
import { REFERENCE_BLOCK_TYPES } from '../blocks/block-schemas'
import { SparkleIcon } from '../sparkle-icon'
import { AuxxInlineLink } from './auxx-inline-link'
import { MessageActions } from './message-actions'
import { StreamingText } from './streaming-text'
import { ThinkingSteps } from './thinking-steps'

const REFERENCE_BLOCK_SET = new Set<string>(REFERENCE_BLOCK_TYPES)

/**
 * react-markdown's default urlTransform strips any href whose protocol isn't
 * in its hard-coded safe list (http/https/mailto/etc), which silently nukes
 * our `auxx://` chips before the `a()` component callback ever sees them.
 * Pass `auxx://` through; defer to the default sanitizer for everything else.
 */
const auxxUrlTransform: UrlTransform = (url) => {
  if (url.startsWith('auxx://')) return url
  return defaultUrlTransform(url)
}

/**
 * Extract a fenced `auxx:<type>` block from a react-markdown `code` node's
 * className. Returns the block type if this is a recognised auxx fence, else null.
 */
function parseAuxxType(className: string | undefined): string | null {
  if (!className) return null
  // react-markdown v10 encodes the fence language as "language-<info>"
  const match = className.match(/language-auxx:([a-z-]+)/)
  if (!match) return null
  const type = match[1]!
  return REFERENCE_BLOCK_SET.has(type) ? type : null
}

function buildMarkdownComponents(
  linkSnapshots: Record<string, LinkSnapshot> | undefined
): Components {
  return {
    code(props) {
      const { className, children } = props
      const auxxType = parseAuxxType(className)
      if (!auxxType) return <code className={className}>{children}</code>

      const raw = String(children ?? '').trim()
      if (!raw) {
        // Render the block shell with empty data so the chrome appears as soon
        // as the fence opens, instead of flashing a code-block placeholder.
        return <AuxxBlock type={auxxType} data={{}} />
      }
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        // Streaming / malformed: best-effort parse so users see the table fill
        // in row-by-row instead of raw JSON.
        try {
          data = partialJsonParse(raw)
        } catch {
          return (
            <pre className='not-prose'>
              <code>{String(children ?? '')}</code>
            </pre>
          )
        }
      }
      return <AuxxBlock type={auxxType} data={data} />
    },
    // Unwrap the <pre> that react-markdown wraps around our custom block so the
    // motion.div / cards aren't nested inside a monospace <pre>.
    pre(props) {
      const child = Array.isArray(props.children) ? props.children[0] : props.children
      const childEl = child as { props?: { className?: string } } | undefined
      if (childEl && parseAuxxType(childEl.props?.className)) {
        return <>{props.children}</>
      }
      return <pre {...props} />
    },
    a({ href, children }) {
      if (typeof href === 'string' && href.startsWith('auxx://')) {
        const label =
          typeof children === 'string'
            ? children
            : Array.isArray(children)
              ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
              : String(children ?? '')
        return <AuxxInlineLink href={href} label={label} snapshot={linkSnapshots?.[href]} />
      }
      return (
        <a href={href} target='_blank' rel='noreferrer'>
          {children}
        </a>
      )
    },
  }
}

interface AssistantMessageProps {
  message?: KopilotMessage
  /** When streaming, render this content instead of message.content */
  streamingContent?: string
  onThumbsUp?: () => void
  onThumbsDown?: () => void
  feedback?: { isPositive: boolean }
}

export function AssistantMessage({
  message,
  streamingContent,
  onThumbsUp,
  onThumbsDown,
  feedback,
}: AssistantMessageProps) {
  const isStreaming = streamingContent !== undefined
  const content = isStreaming ? streamingContent : (message?.content ?? '')

  const linkSnapshots = message?.linkSnapshots
  const markdownComponents = useMemo(() => buildMarkdownComponents(linkSnapshots), [linkSnapshots])

  const thinkingGroups = useKopilotStore((s) => s.thinkingGroups)
  const activeThinkingGroupId = useKopilotStore((s) => s.activeThinkingGroupId)

  // Find the thinking group attached to this message
  const thinkingGroup = message?.id
    ? Object.values(thinkingGroups).find((g) => g.messageId === message.id)
    : undefined
  // While streaming (no message yet), show the active thinking group
  const activeGroup =
    streamingContent !== undefined && activeThinkingGroupId
      ? thinkingGroups[activeThinkingGroupId]
      : undefined
  const group: ThinkingGroup | undefined = thinkingGroup ?? activeGroup

  return (
    <div className='group/message flex gap-2'>
      <SparkleIcon />
      <div className='min-w-0 flex-1 space-y-1'>
        {group && <ThinkingSteps group={group} />}
        {message?.error ? (
          <Tooltip content={message.error}>
            <div className='ml-2 inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs'>
              <AlertTriangle className='size-3 shrink-0 text-destructive' />
              <span className='font-medium text-destructive shrink-0'>Something went wrong</span>
            </div>
          </Tooltip>
        ) : (
          <div className='kopilot-prose'>
            {isStreaming ? (
              <StreamingText
                raw={content}
                isStreaming
                markdownComponents={markdownComponents}
                urlTransform={auxxUrlTransform}
              />
            ) : (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={auxxUrlTransform}>
                {content}
              </Markdown>
            )}
          </div>
        )}
        {!isStreaming && message && !message.error && (
          <MessageActions
            role='assistant'
            content={content}
            feedback={feedback}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
          />
        )}
      </div>
    </div>
  )
}
