// apps/web/src/components/kopilot/ui/messages/assistant-message.tsx

import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '~/components/global/tooltip'
import type { ContentPart, KopilotMessage, LinkSnapshot } from '../../stores/kopilot-store'
import type { InlineApprovalHandler } from './thinking-steps'
import '../../styles/kopilot-prose.css'
import { parse as partialJsonParse } from '../../utils/partial-json'
import { AuxxBlock } from '../blocks/auxx-block'
import { REFERENCE_BLOCK_TYPES } from '../blocks/block-schemas'
import { SparkleIcon } from '../sparkle-icon'
import { AssistantThinkingStatus } from './assistant-thinking-status'
import { AuxxInlineLink } from './auxx-inline-link'
import { MessageActions } from './message-actions'
import { proseTableComponents } from './prose-table'
import { StreamingText } from './streaming-text'
import { type ThinkingPillStep, ThinkingSteps } from './thinking-steps'

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
      let lastValueTruncated = false
      try {
        data = JSON.parse(raw)
      } catch {
        // Streaming / malformed: best-effort parse so users see the table fill
        // in row-by-row instead of raw JSON.
        try {
          data = partialJsonParse(raw)
          // The stream currently ends inside an unterminated string, so the
          // last parsed string value is a truncated prefix — blocks that fetch
          // by id use this to withhold the trailing id until it completes.
          lastValueTruncated = partialJsonParse.lastStringUnterminated === true
        } catch {
          return (
            <pre className='not-prose'>
              <code>{String(children ?? '')}</code>
            </pre>
          )
        }
      }
      return <AuxxBlock type={auxxType} data={data} lastValueTruncated={lastValueTruncated} />
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
    ...proseTableComponents,
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

/**
 * One run produced by walking `parts[]`. Contiguous tool_call parts collapse
 * into a single 'tool_calls' run; contiguous text parts collapse into a
 * single 'text' run; thinking parts attach to the next tool_calls run as
 * `precedingThinking` on the FIRST step (matching today's UX).
 */
type Run =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool_calls'
      steps: ThinkingPillStep[]
      /** True while at least one step is still running / awaiting approval. */
      isRunning: boolean
    }

/**
 * Partition the message parts into render runs. Walks parts once, threads
 * each `thinking` part into the next `tool_call` step. Pure projection — no
 * state, no fallbacks. Same data path for streaming and refresh.
 */
function groupRuns(parts: ContentPart[]): Run[] {
  const runs: Run[] = []
  let pendingThinking = ''
  let currentToolRun: Extract<Run, { kind: 'tool_calls' }> | null = null
  let currentTextRun: Extract<Run, { kind: 'text' }> | null = null

  for (const p of parts) {
    if (p.type === 'thinking') {
      pendingThinking += pendingThinking ? `\n\n${p.text}` : p.text
      continue
    }
    if (p.type === 'tool_call') {
      // Close any in-flight text run.
      currentTextRun = null
      if (!currentToolRun) {
        currentToolRun = { kind: 'tool_calls', steps: [], isRunning: false }
        runs.push(currentToolRun)
      }
      currentToolRun.steps.push({
        id: p.toolCallId,
        toolCall: p,
        thinking: pendingThinking.trim() || undefined,
      })
      pendingThinking = ''
      if (p.status === 'running' || p.status === 'awaiting-approval') {
        currentToolRun.isRunning = true
      }
      continue
    }
    if (p.type === 'text') {
      // Close any in-flight tool run.
      currentToolRun = null
      if (!currentTextRun) {
        currentTextRun = { kind: 'text', text: '' }
        runs.push(currentTextRun)
      }
      currentTextRun.text += p.text
    }
  }

  // Trailing thinking with no tool to attach to — surface it as its own
  // tool-less pill so the user can still see what the model was reasoning
  // about. Empty toolCall list + pendingThinking makes the pill render the
  // italic text under a "Thinking…" header.
  if (pendingThinking.trim() && !runs.some((r) => r.kind === 'tool_calls')) {
    runs.push({
      kind: 'tool_calls',
      steps: [],
      isRunning: true,
    })
  }

  return runs
}

/**
 * Whether `runIndex` is the trailing text run. Used to gate the smooth-stream
 * wrapper: only the latest text run (the one currently growing from
 * `text-delta` events) gets word-by-word reveal; earlier text runs render as
 * settled markdown.
 */
function isLastTextRun(runIndex: number, runs: Run[]): boolean {
  for (let i = runIndex + 1; i < runs.length; i++) {
    if (runs[i]!.kind === 'tool_calls') return false
  }
  return true
}

/**
 * Lookup that returns the persisted approval system message for a given
 * `toolCallId`, or undefined if there is no approval associated with that
 * call. Used by `ThinkingSteps` to render the approval card inline at the
 * tool_call's position rather than as a standalone sibling.
 */
export type InlineApprovalLookup = (toolCallId: string) => KopilotMessage | undefined

interface AssistantMessageProps {
  message: KopilotMessage
  isStreaming?: boolean
  onThumbsUp?: () => void
  onThumbsDown?: () => void
  feedback?: { isPositive: boolean }
  approvalForToolCall?: InlineApprovalLookup
  onApproval?: InlineApprovalHandler
}

export function AssistantMessage({
  message,
  isStreaming = false,
  onThumbsUp,
  onThumbsDown,
  feedback,
  approvalForToolCall,
  onApproval,
}: AssistantMessageProps) {
  const linkSnapshots = message.linkSnapshots
  const markdownComponents = useMemo(() => buildMarkdownComponents(linkSnapshots), [linkSnapshots])

  const parts = message.parts ?? []
  const runs = useMemo(() => groupRuns(parts), [parts])

  // Concatenate all text runs for the copy/regenerate actions row.
  const proseForActions = useMemo(
    () =>
      runs
        .filter((r): r is Extract<Run, { kind: 'text' }> => r.kind === 'text')
        .map((r) => r.text)
        .join('\n\n'),
    [runs]
  )

  // The per-run indicators (ThinkingSteps spinner, StreamingText reveal) go
  // dark during the LLM round-trip between a tool finishing and the next part
  // arriving — a 16–38s dead zone in multi-tool turns where nothing on screen
  // moves. Show a trailing working status whenever we're streaming and the last
  // run isn't already spinning (a running tool run owns its own spinner). The
  // `runs.length === 0` case is handled by the dedicated branch below.
  const lastRun = runs[runs.length - 1]
  const showTrailingStatus =
    isStreaming && runs.length > 0 && !(lastRun?.kind === 'tool_calls' && lastRun.isRunning)

  return (
    <div className='group/message flex gap-2'>
      <SparkleIcon />
      <div className='min-w-0 flex-1 space-y-1'>
        {message.error ? (
          <Tooltip content={message.error}>
            <div className='ml-2 inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs'>
              <AlertTriangle className='size-3 shrink-0 text-destructive' />
              <span className='font-medium text-destructive shrink-0'>Something went wrong</span>
            </div>
          </Tooltip>
        ) : runs.length === 0 && isStreaming ? (
          <AssistantThinkingStatus />
        ) : (
          runs.map((run, i) => {
            if (run.kind === 'tool_calls') {
              return (
                <ThinkingSteps
                  key={`tools-${i}`}
                  steps={run.steps}
                  isRunning={isStreaming && run.isRunning}
                  approvalForToolCall={approvalForToolCall}
                  onApproval={onApproval}
                />
              )
            }
            // Text run.
            const useSmoothStream = isStreaming && isLastTextRun(i, runs)
            return (
              <div key={`text-${i}`} className='kopilot-prose'>
                {useSmoothStream ? (
                  <StreamingText
                    raw={run.text}
                    isStreaming
                    markdownComponents={markdownComponents}
                    urlTransform={auxxUrlTransform}
                  />
                ) : (
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                    urlTransform={auxxUrlTransform}>
                    {run.text}
                  </Markdown>
                )}
              </div>
            )
          })
        )}
        {showTrailingStatus && !message.error && <AssistantThinkingStatus />}
        {!isStreaming && !message.error && (
          <MessageActions
            role='assistant'
            content={proseForActions}
            feedback={feedback}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
          />
        )}
      </div>
    </div>
  )
}
