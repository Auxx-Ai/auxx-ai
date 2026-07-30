// apps/homepage/src/app/platform/crm/_components/access-lens-illustration.tsx
'use client'

import {
  Bot,
  Building2,
  CircleDollarSign,
  Lock,
  MessagesSquare,
  Pencil,
  ShieldCheck,
  Ticket,
  Trash2,
  User,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ENTITY_COLOR_CLASS } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'

const CYCLE_DURATION = 3800

/* -------------------------------------------------------------------------- */
/* The ladder                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The grant ladder, transcribed from `packages/lib/src/permissions/capabilities/rung.ts`.
 * Ordinal, so "does this viewer see this row?" is a numeric comparison here for
 * exactly the reason it is one in the product.
 */
const RUNG_RANK = { none: 0, metadata: 1, identity: 2, read: 3, edit: 4, admin: 5 } as const

type Rung = keyof typeof RUNG_RANK

/** True when `have` is at least `need` — the illustration's `satisfiesRung`. */
const satisfies = (have: Rung, need: Rung) => RUNG_RANK[have] >= RUNG_RANK[need]

interface RungMeta {
  label: string
  /** SVG stroke + dot color. */
  dot: string
  /** Badge classes. */
  chip: string
}

/**
 * Labels follow the product's own vocabulary (`LENS_LABELS`), reworded from
 * conversations to records — "the word rung never appears in UI" applies here too.
 */
const RUNGS: Record<Rung, RungMeta> = {
  none: {
    label: 'No access',
    dot: 'var(--color-zinc-400)',
    chip: 'bg-muted text-muted-foreground ring-foreground/10',
  },
  metadata: {
    label: 'Activity only',
    dot: 'var(--color-slate-400)',
    chip: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300',
  },
  identity: {
    label: 'Name only',
    dot: 'var(--color-sky-400)',
    chip: 'bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-400',
  },
  read: {
    label: 'Read',
    dot: 'var(--color-blue-400)',
    chip: 'bg-blue-500/10 text-blue-600 ring-blue-500/20 dark:text-blue-400',
  },
  edit: {
    label: 'Edit',
    dot: 'var(--color-amber-400)',
    chip: 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400',
  },
  admin: {
    label: 'Full',
    dot: 'var(--color-emerald-400)',
    chip: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
  },
}

/* -------------------------------------------------------------------------- */
/* The principals                                                              */
/* -------------------------------------------------------------------------- */

interface Principal {
  name: string
  kind: string
  icon: typeof UserRound
  rung: Rung
  caption: React.ReactNode
}

/**
 * Ascending the ladder top to bottom — one grantee of each type the grant table
 * actually accepts (member, group, profile, agent), so the agent reads as one
 * more row in the same list rather than a footnote.
 */
const PRINCIPALS: Principal[] = [
  {
    name: 'Marcus Webb',
    kind: 'Member · Support',
    icon: UserRound,
    rung: 'none',
    caption: (
      <>
        Marcus has <strong className='font-medium text-foreground'>No access</strong> to Tickets.
        The record isn&rsquo;t redacted for him — it isn&rsquo;t there. Not in the table, not in
        search, not from a link someone sent him.
      </>
    ),
  },
  {
    name: 'Billing',
    kind: 'Group · 4 people',
    icon: UsersRound,
    rung: 'metadata',
    caption: (
      <>
        Billing sees that the ticket <em>exists</em> and when it last moved — enough to reconcile an
        invoice against it. No name, no fields, no conversation.
      </>
    ),
  },
  {
    name: 'Ops (read-only)',
    kind: 'Permission profile',
    icon: ShieldCheck,
    rung: 'identity',
    caption: (
      <>
        The Ops profile gets the record&rsquo;s name and nothing under it. Enough to reference the
        ticket in a report, not enough to read it.
      </>
    ),
  },
  {
    name: 'Kopilot · Triage',
    kind: 'AI agent',
    icon: Bot,
    rung: 'read',
    caption: (
      <>
        Your agents are org members with their own permission profile.{' '}
        <strong className='font-medium text-foreground'>
          Triage reads the ticket it was asked to triage
        </strong>{' '}
        — and when it runs on Sarah&rsquo;s behalf, her access is a ceiling, never a promotion.
      </>
    ),
  },
  {
    name: 'Sarah Klein',
    kind: 'Member · assignee',
    icon: UserRound,
    rung: 'edit',
    caption: (
      <>
        Sarah owns the ticket, so she can change it. Handing it to someone else is still not hers to
        give — sharing is its own rung.
      </>
    ),
  },
  {
    name: 'Dana Osei',
    kind: 'Member · shared directly',
    icon: UserRound,
    rung: 'admin',
    caption: (
      <>
        Dana was shared <strong className='font-medium text-foreground'>this one record</strong> at
        Full. She can edit it and decide who else sees it — without being handed the Tickets object,
        or any other ticket in it.
      </>
    ),
  },
]

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A value that masks itself when the viewer's rung is below `from`.
 *
 * The mask is absolutely positioned over the real text and wipes in from the
 * left, so the row keeps the *shape* of the value it is hiding — the layout
 * never reflows between viewers, which is what makes the swap read as redaction
 * rather than as a different card.
 */
function Redact({
  rung,
  from,
  children,
  className,
}: {
  rung: Rung
  from: Rung
  children: React.ReactNode
  className?: string
}) {
  const visible = satisfies(rung, from)

  return (
    <span className={cn('relative inline-flex min-w-0 max-w-full align-middle', className)}>
      <motion.span
        className='truncate'
        initial={false}
        animate={{ opacity: visible ? 1 : 0, filter: visible ? 'blur(0px)' : 'blur(3px)' }}
        transition={{ duration: 0.35, ease: 'easeOut' }}>
        {children}
      </motion.span>
      <motion.span
        aria-hidden
        className='pointer-events-none absolute -inset-x-0.5 inset-y-0 origin-left overflow-hidden rounded-[3px] bg-foreground/[0.06] ring-1 ring-inset ring-foreground/[0.07]'
        initial={false}
        animate={{ scaleX: visible ? 0 : 1, opacity: visible ? 0 : 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}>
        <span className='absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_5px)] opacity-[0.18]' />
      </motion.span>
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* The record card                                                             */
/* -------------------------------------------------------------------------- */

const FIELDS = [
  { icon: User, label: 'Customer', value: 'Nadia Rahman' },
  { icon: Building2, label: 'Company', value: 'Aurora Supply Co.' },
  { icon: CircleDollarSign, label: 'Order total', value: '$1,284.00' },
] as const

/** Affordances light up at the rung that actually confers them. */
const ACTIONS = [
  { icon: Pencil, label: 'Edit', from: 'edit' as Rung },
  { icon: Users, label: 'Manage access', from: 'admin' as Rung },
  { icon: Trash2, label: 'Delete', from: 'admin' as Rung },
]

/**
 * One ticket, rendered at whatever rung the active principal holds. Every
 * conditional in here is `satisfies(rung, …)` against the same ladder the
 * server evaluates — the card is the `_access` stamp, drawn.
 */
function RecordCard({ rung, className }: { rung: Rung; className?: string }) {
  const meta = RUNGS[rung]
  const locked = rung === 'none'

  return (
    <motion.div
      initial={false}
      animate={{ opacity: locked ? 0.5 : 1 }}
      transition={{ duration: 0.4 }}
      className={cn(
        'w-full overflow-hidden rounded-xl bg-card text-card-foreground transition-[box-shadow,outline-color] duration-500',
        // At `none` the record is not redacted, it is ABSENT — so the card is
        // drawn as a ghost outline rather than as a card with its contents hidden.
        locked
          ? 'outline-1 outline-foreground/20 outline-dashed'
          : 'shadow-lg shadow-black/[.05] ring-1 ring-border-illustration',
        className
      )}>
      {/* Header — the record id is an envelope fact, the title is the identity projection. */}
      <div className='flex items-center gap-2 px-3 py-2.5'>
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md',
            locked ? 'bg-muted text-muted-foreground' : ENTITY_COLOR_CLASS.orange
          )}>
          {locked ? <Lock className='size-3' /> : <Ticket className='size-3.5' />}
        </span>
        <Redact rung={rung} from='metadata' className='font-mono text-[11px] text-foreground/70'>
          TCK-4821
        </Redact>
        <span className='ml-auto shrink-0'>
          <AnimatePresence initial={false} mode='popLayout'>
            <motion.span
              key={rung}
              initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
              transition={{ duration: 0.28 }}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                meta.chip
              )}>
              {locked && <Lock className='size-2.5' />}
              {meta.label}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>

      <div className='border-t border-border/60 px-3 py-2.5'>
        <Redact rung={rung} from='identity' className='text-[13px] font-medium'>
          Refund not received — order #10432
        </Redact>
      </div>

      {FIELDS.map((field) => (
        <div
          key={field.label}
          className='flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs'>
          <field.icon className='size-3.5 shrink-0 text-muted-foreground' />
          <span className='w-24 shrink-0 truncate text-muted-foreground'>{field.label}</span>
          {/* Not `flex-1`: the mask has to hug the value it hides, or it reads as a
              loading skeleton instead of a redaction. */}
          <Redact rung={rung} from='read' className='text-foreground/85'>
            {field.value}
          </Redact>
        </div>
      ))}

      {/* Envelope row — participants, counts, recency. Visible from `metadata` up. */}
      <div className='flex items-center gap-2 border-t border-border/60 px-3 py-2 text-[11px]'>
        <MessagesSquare className='size-3.5 shrink-0 text-muted-foreground' />
        <Redact rung={rung} from='metadata' className='text-muted-foreground'>
          3 participants · 12 messages · updated 2h ago
        </Redact>
      </div>

      <div className='flex items-center gap-1.5 border-t border-border/60 bg-muted/30 px-3 py-2'>
        {ACTIONS.map((action) => {
          const enabled = satisfies(rung, action.from)
          return (
            <motion.span
              key={action.label}
              initial={false}
              animate={{ opacity: enabled ? 1 : 0.35 }}
              transition={{ duration: 0.35 }}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium',
                enabled
                  ? 'bg-background text-foreground/80 ring-1 ring-border-illustration'
                  : 'text-muted-foreground line-through decoration-foreground/25'
              )}>
              <action.icon className='size-3' />
              {action.label}
            </motion.span>
          )
        })}
      </div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Principal chip                                                              */
/* -------------------------------------------------------------------------- */

function PrincipalChip({
  principal,
  active,
  onSelect,
  className,
}: {
  principal: Principal
  active: boolean
  onSelect: () => void
  className?: string
}) {
  const meta = RUNGS[principal.rung]

  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl bg-illustration px-2.5 py-2 text-left ring-1 transition-all duration-300',
        active
          ? 'opacity-100 shadow-md shadow-black/[.06] ring-foreground/20'
          : 'opacity-55 ring-border-illustration hover:opacity-80',
        className
      )}>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300',
          active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
        )}>
        <principal.icon className='size-3.5' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-[11px] font-semibold'>{principal.name}</span>
        <span className='block truncate text-[9px] text-muted-foreground'>{principal.kind}</span>
      </span>
      <span className='flex shrink-0 items-center gap-1.5'>
        <span className='size-1.5 rounded-full' style={{ background: meta.dot }} />
        <span className='text-[9px] text-muted-foreground'>{meta.label}</span>
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Desktop canvas                                                              */
/* -------------------------------------------------------------------------- */

const CHIP_W = 236
const CHIP_H = 54
const CHIP_GAP = 14
const CARD_X = 452
const CARD_W = 408
const CANVAS_W = CARD_X + CARD_W
const CANVAS_H = PRINCIPALS.length * CHIP_H + (PRINCIPALS.length - 1) * CHIP_GAP

/** Every beam converges on the card's left edge — one record, one resolved level. */
const ANCHOR_X = CARD_X
const ANCHOR_Y = CANVAS_H / 2

const chipTop = (i: number) => i * (CHIP_H + CHIP_GAP)
const beamPath = (i: number) => {
  const y = chipTop(i) + CHIP_H / 2
  return `M ${CHIP_W} ${y} C ${CHIP_W + 96} ${y}, ${ANCHOR_X - 96} ${ANCHOR_Y}, ${ANCHOR_X} ${ANCHOR_Y}`
}

function DesktopCanvas({
  active,
  onSelect,
}: {
  active: number
  onSelect: (index: number) => void
}) {
  const reduceMotion = useReducedMotion()
  const activePrincipal = PRINCIPALS[active]!
  const activeMeta = RUNGS[activePrincipal.rung]

  return (
    <div className='relative mx-auto' style={{ width: CANVAS_W, height: CANVAS_H }}>
      <svg
        aria-hidden
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        fill='none'
        className='absolute inset-0'>
        {PRINCIPALS.map((principal, i) => (
          <path
            key={principal.name}
            d={beamPath(i)}
            stroke='currentColor'
            strokeLinecap='round'
            strokeDasharray='2 5'
            className='text-foreground/20'
          />
        ))}

        {/* Only the active principal's beam runs — one evaluation at a time. */}
        {!reduceMotion && (
          <motion.path
            key={active}
            d={beamPath(active)}
            stroke={activeMeta.dot}
            strokeLinecap='round'
            strokeWidth={1.75}
            strokeDasharray='0.16 0.84'
            pathLength='1'
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -1 }}
            transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }}
          />
        )}

        <circle cx={ANCHOR_X} cy={ANCHOR_Y} r='3.5' fill={activeMeta.dot} />
        {!reduceMotion && (
          <motion.circle
            cx={ANCHOR_X}
            cy={ANCHOR_Y}
            r='3.5'
            fill='none'
            stroke={activeMeta.dot}
            initial={{ r: 3.5, opacity: 0.7 }}
            animate={{ r: 11, opacity: 0 }}
            transition={{ duration: 1.8, ease: 'easeOut', repeat: Infinity }}
          />
        )}
      </svg>

      <div className='absolute left-0 top-0' style={{ width: CHIP_W }}>
        {PRINCIPALS.map((principal, i) => (
          <div
            key={principal.name}
            className='absolute'
            style={{ top: chipTop(i), width: CHIP_W, height: CHIP_H }}>
            <PrincipalChip
              principal={principal}
              active={i === active}
              onSelect={() => onSelect(i)}
              className='h-full'
            />
          </div>
        ))}
      </div>

      <div className='absolute top-1/2 -translate-y-1/2' style={{ left: CARD_X, width: CARD_W }}>
        <RecordCard rung={activePrincipal.rung} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function MobileStack({ active, onSelect }: { active: number; onSelect: (index: number) => void }) {
  return (
    <div className='space-y-5'>
      <div className='grid gap-2 sm:grid-cols-2'>
        {PRINCIPALS.map((principal, i) => (
          <PrincipalChip
            key={principal.name}
            principal={principal}
            active={i === active}
            onSelect={() => onSelect(i)}
          />
        ))}
      </div>
      <RecordCard rung={PRINCIPALS[active]!.rung} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * One ticket, six principals, one ladder. The card re-renders at each viewer's
 * resolved level — fields wipe under a redaction mask, affordances light up at
 * the rung that confers them — instead of the usual org-chart-of-boxes.
 *
 * Autoplays until someone picks a principal, then follows them.
 */
export function AccessLensIllustration() {
  const reduceMotion = useReducedMotion()
  const [active, setActive] = useState(0)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (reduceMotion || pinned) return
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % PRINCIPALS.length)
    }, CYCLE_DURATION)
    return () => clearInterval(interval)
  }, [reduceMotion, pinned])

  const select = (index: number) => {
    setActive(index)
    setPinned(true)
  }

  return (
    <div>
      <div className='hidden lg:block'>
        <DesktopCanvas active={active} onSelect={select} />
      </div>
      <div className='lg:hidden'>
        <MobileStack active={active} onSelect={select} />
      </div>

      <div className='mx-auto mt-8 min-h-16 max-w-2xl text-center lg:min-h-14'>
        <AnimatePresence initial={false} mode='wait'>
          <motion.p
            key={active}
            initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.3 }}
            className='text-balance text-sm text-muted-foreground'>
            {PRINCIPALS[active]!.caption}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

export default AccessLensIllustration
