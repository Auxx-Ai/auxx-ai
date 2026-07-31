// apps/homepage/src/app/platform/ai/agents/_mocks/mock-agent-panel.tsx
'use client'

import {
  ChevronRight,
  Clipboard,
  Code2,
  FileText,
  GitBranch,
  Hand,
  ListChecks,
  Maximize2,
  Square,
  Workflow,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '~/lib/utils'
import type { AgentCastMember } from '../_components/agent-cast'
import type { ProcedureLine, ProcedureLink, Segment } from '../_components/agent-scripts'

/**
 * The agent side of the run illustration: the `Persona` editor card, then the
 * `Procedures` section, then — once selection has happened — the chosen
 * procedure opening in place to reveal its steps.
 *
 * Ported from the real detail tab:
 * - `persona-editor.tsx` / `prose-editor-card.tsx` for the card chrome: an
 *   uppercase title in `text-xs font-semibold text-primary-500`, a character
 *   count, a divider, then copy / expand buttons.
 * - `procedures-section.tsx` for the section shell (`ListChecks`, the title and
 *   its one-line description) and `procedure-row.tsx` for the rows (a `TreeRow`
 *   with a `FileText` icon, the name, the `whenToUse` summary, and a chevron).
 * - `PromptEditorContent`'s `alwaysShowLineNumbers` for the opened body's
 *   right-aligned `tabular-nums` gutter.
 *
 * Everything is transcribed, not imported: the homepage has no `primary-*`
 * scale and must not pull `@auxx/lib` into its bundle.
 */

/**
 * Inline badges sit *inside* running prose, so they stay a notch smaller than
 * the surrounding `text-sm` and carry almost no vertical padding. Anything
 * heavier and the paragraphs read as a stack of chips instead of a sentence.
 */
const BADGE =
  'mx-px inline-flex items-center gap-0.5 rounded border px-1 py-0 align-baseline text-[11px] leading-[18px]'

/** Badge tones, copied from `custom-fields/client.ts`. */
const TONES = {
  indigo:
    'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-[#252058] dark:text-[#D0C8FF] dark:border-[#3b3578]',
  forest:
    'bg-green-100 text-green-900 border-green-500 dark:bg-[#0f2e21] dark:text-[#7ECFA6] dark:border-[#1a4631]',
  red: 'bg-red-50 text-red-600 border-black/10 dark:bg-[#4e1b28] dark:text-[#FFD1D1] dark:border-[#692623]',
  ref: 'bg-muted text-foreground/80 border-black/10 dark:border-white/10',
} as const

/* -------------------------------------------------------------------------- */
/* Editor card chrome                                                          */
/* -------------------------------------------------------------------------- */

function EditorCard({
  title,
  count,
  children,
  className,
}: {
  title: string
  count: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('me-1 rounded-[9px] p-0.5', className)}>
      <div className='flex h-full flex-col rounded-lg border bg-zinc-200/30 dark:bg-white/[0.03]'>
        <div className='flex items-center justify-between pl-3 pr-2 pt-1'>
          <div className='text-xs font-semibold uppercase leading-4 text-zinc-500'>{title}</div>
          <div className='flex items-center'>
            <span className='text-xs text-muted-foreground'>{count}</span>
            <div className='mx-2 h-3 w-px bg-zinc-200 dark:bg-white/15' />
            <div className='flex items-center space-x-[2px]'>
              <span className='flex size-6 items-center justify-center rounded-lg text-muted-foreground'>
                <Clipboard className='size-4' />
              </span>
              <span className='flex size-6 items-center justify-center rounded-lg text-muted-foreground'>
                <Maximize2 className='size-4' />
              </span>
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Procedure prose                                                             */
/* -------------------------------------------------------------------------- */

function SegmentRun({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => {
        const key = `${segment.t}-${i}`
        if (segment.t === 'text') return <span key={key}>{segment.v} </span>
        if (segment.t === 'tool' || segment.t === 'ref') {
          return (
            <span key={key} className={cn(BADGE, TONES.ref)}>
              {segment.v}
            </span>
          )
        }
        if (segment.t === 'code') {
          return (
            <span key={key} className={cn(BADGE, TONES.indigo)}>
              <Code2 className='size-3 shrink-0 opacity-70' />
              {segment.v}
            </span>
          )
        }
        if (segment.t === 'subprocedure') {
          return (
            <span key={key} className={cn(BADGE, TONES.forest)}>
              <Workflow className='size-3 shrink-0 opacity-70' />
              {segment.v}
            </span>
          )
        }
        return (
          <span key={key} className={cn(BADGE, TONES.red)}>
            {segment.v === 'handoff' ? (
              <Hand className='size-3 shrink-0 opacity-70' />
            ) : (
              <Square className='size-3 shrink-0 opacity-70' />
            )}
            {segment.v === 'handoff' ? 'Hand off to human' : 'End procedure'}
          </span>
        )
      })}
    </>
  )
}

function Line({
  line,
  index,
  active,
  agent,
  onSelect,
}: {
  line: ProcedureLine
  index: number
  active: boolean
  agent: AgentCastMember
  onSelect: (id: string) => void
}) {
  const isArm = line.arm != null
  return (
    <button
      type='button'
      onClick={() => onSelect(line.id)}
      className={cn(
        'relative flex w-full gap-2 rounded-md py-0.5 pr-2 text-left transition-colors',
        active && agent.accent.highlight
      )}>
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0.5 left-0 w-0.5 rounded-full transition-opacity',
          agent.accent.rule,
          active ? 'opacity-100' : 'opacity-0'
        )}
      />
      <span className='min-w-6 shrink-0 select-none pt-0.5 text-right text-xs leading-6 tabular-nums text-muted-foreground opacity-50'>
        {index + 1}
      </span>

      {isArm && (
        <>
          <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-200'>
            <GitBranch className='size-3.5' />
          </span>
          <span className='shrink-0 pt-0.5 text-xs font-semibold uppercase leading-6 tracking-wide text-foreground'>
            {line.arm === 'if' ? 'If' : 'Else'}
          </span>
        </>
      )}

      <span
        className={cn(
          'min-w-0 flex-1 text-sm leading-6',
          active ? 'text-foreground' : 'text-foreground/75',
          line.indent && !isArm && 'pl-8'
        )}>
        <SegmentRun segments={line.segments} />
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Procedure rows                                                              */
/* -------------------------------------------------------------------------- */

/** A closed `TreeRow`, as `procedure-row.tsx` renders it. */
function ProcedureRow({
  link,
  dimmed,
  agent,
  version,
}: {
  link: ProcedureLink
  dimmed: boolean
  agent: AgentCastMember
  version: string
}) {
  const open = !dimmed
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-1.5 transition-all',
        dimmed ? 'opacity-40' : cn('bg-background/70 ring-1', agent.accent.ring)
      )}>
      <FileText className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className='truncate text-sm font-medium text-foreground'>{link.name}</span>
          {open && (
            <span className='shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground'>
              {version}
            </span>
          )}
        </div>
        <p className='truncate text-xs text-muted-foreground'>{link.whenToUse}</p>
      </div>
      <ChevronRight
        className={cn(
          'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-90'
        )}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function MockAgentPanel({
  agent,
  persona,
  procedures,
  selectedId,
  version,
  /** Null until `selectProcedure` has run — the list stays closed. */
  openedId,
  activeLine,
  onSelectLine,
  reduceMotion,
  className,
}: {
  agent: AgentCastMember
  persona: string
  procedures: ProcedureLink[]
  selectedId: string
  version: string
  openedId: string | null
  activeLine: string | undefined
  onSelectLine: (id: string) => void
  reduceMotion: boolean | null
  className?: string
}) {
  const opened = procedures.find((p) => p.id === openedId)

  return (
    // `min-h-0` + a scrollable list below: the panel absorbs the procedure
    // opening inside its own box instead of growing and shoving the page down.
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <EditorCard title='Persona' count={persona.length} className='shrink-0'>
        <p className='px-3 pb-3 pt-1 text-sm leading-6 text-foreground/75'>{persona}</p>
      </EditorCard>

      {/* `procedures-section.tsx`: ListChecks + title + one-line description. */}
      <div className='me-1 flex min-h-0 flex-1 flex-col rounded-lg border bg-zinc-200/30 p-2 dark:bg-white/[0.03]'>
        <div className='flex items-center gap-1.5 px-1 pb-0.5 pt-1'>
          <ListChecks className='size-4 text-muted-foreground' />
          <span className='text-sm font-medium text-foreground'>Procedures</span>
          <span className='ml-auto text-xs text-muted-foreground'>{procedures.length}</span>
        </div>
        <p className='px-1 pb-2 text-xs text-muted-foreground'>
          Step-by-step playbooks the agent follows for specific situations.
        </p>

        {/* `p-px`: `overflow-y-auto` promotes overflow-x to `auto` too, so this
            box clips on all four sides at its padding edge. The rows' `ring-1`
            paints outside their border box, so without the pad the ring loses
            its left/right edges and the first and last row lose theirs. */}
        <div className='flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-px'>
          {procedures.map((link) => {
            const isOpen = link.id === openedId
            const isCandidate = openedId == null
            return (
              <div key={link.id}>
                <ProcedureRow
                  link={link}
                  dimmed={!isOpen && !isCandidate}
                  agent={agent}
                  version={version}
                />

                <AnimatePresence initial={false}>
                  {isOpen && opened?.lines && (
                    <motion.div
                      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}>
                      <div className='mt-1 rounded-md border bg-background/60 px-2 py-1.5'>
                        {opened.lines.map((line, index) => (
                          <Line
                            key={line.id}
                            line={line}
                            index={index}
                            active={line.id === activeLine}
                            agent={agent}
                            onSelect={onSelectLine}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

        {openedId == null && (
          <p className='mt-auto px-1 pt-3 text-[11px] italic text-muted-foreground'>
            Waiting for a message. One of these will be picked, not all of them.
          </p>
        )}
      </div>
    </div>
  )
}
