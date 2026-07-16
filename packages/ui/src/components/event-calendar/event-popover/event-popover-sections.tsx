// packages/ui/src/components/event-calendar/event-popover/event-popover-sections.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { addMinutes, differenceInMinutes, format } from 'date-fns'
import {
  ArrowLeftRight,
  CalendarDays,
  Clock8,
  PanelRightOpen,
  RefreshCcw,
  User,
  X,
} from 'lucide-react'
import * as React from 'react'
import { AutosizeTextarea } from '../../autosize-textarea'
import { Avatar, AvatarFallback, AvatarImage } from '../../avatar'
import { Calendar } from '../../calendar'
import { AnimatedCollapsibleContent } from '../../collapsible'
import { useCommandNavigation } from '../../command'
import { useDockChrome } from '../../dock-panel'
import { PanelCard, PanelCardRow, PanelRowValue, PanelSectionLabel } from '../../panel-card'
import { Switch } from '../../switch'
import { SimpleTooltip } from '../../tooltip'
import { EventDrillPage } from './event-popover'
import { formatTimeOfDay } from './parse-time'
import { useSeriesScope } from './series-scope-chooser'
import { TimeInput } from './time-input'
import type { EventDrillItem, SeriesScope } from './types'

function withTimeOfDay(date: Date, hours: number, minutes: number): Date {
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * When a link row carries BOTH `href` and `onClick`, plain clicks run `onClick` (SPA nav via
 * the consumer's router) while modified clicks (cmd/ctrl/shift/middle) keep native anchor
 * behavior (open in new tab).
 */
function handleAnchorClick(e: React.MouseEvent, onClick?: () => void) {
  if (!onClick) return
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  onClick()
}

// ---------------------------------------------------------------------------
// EventTitleSection
// ---------------------------------------------------------------------------

interface EventTitleLink {
  icon?: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
}

export interface EventTitleAction {
  icon: React.ReactNode
  /** Accessible label, also shown as the button's tooltip (e.g. "Open work order"). */
  label: string
  href?: string
  onClick?: () => void
  /** Red hover styling for destructive actions (e.g. delete). */
  destructive?: boolean
}

/** One icon button in the `EventTitleSection` actions toolbar — ghost square with a tooltip,
 * anchor when `href` is set (modified-click → new tab), plain button otherwise. */
function EventTitleActionButton({ action }: { action: EventTitleAction }) {
  const className = cn(
    'shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
    action.destructive && 'hover:bg-destructive/10 hover:text-destructive'
  )
  const inner = action.href ? (
    <a
      href={action.href}
      onClick={(e) => handleAnchorClick(e, action.onClick)}
      aria-label={action.label}
      className={className}>
      {action.icon}
    </a>
  ) : (
    <button type='button' onClick={action.onClick} aria-label={action.label} className={className}>
      {action.icon}
    </button>
  )
  return <SimpleTooltip content={action.label}>{inner}</SimpleTooltip>
}

interface EventTitleSectionProps {
  title: string
  editable?: boolean
  onCommit?: (title: string) => void
  /** When set (and not `editable`), the title renders as a link. Plain click runs `onTitleClick`;
   * modified clicks fall back to `titleHref`'s native anchor behavior (new tab). */
  onTitleClick?: () => void
  titleHref?: string
  /** Toolbar of icon actions rendered above the title (open, dock, copy, delete, …) — the single
   * "event actions" location. Right-aligned; renders nothing when empty. */
  actions?: EventTitleAction[]
  subtitle?: React.ReactNode
  links?: EventTitleLink[]
}

/** Top `PanelCard`: an optional right-aligned actions toolbar, a borderless autosize title
 * (Notion autosave — commits on blur/Enter), optional subtitle node, and optional bordered-top
 * linked-record rows (decision #6). The title can double as a record link
 * (`onTitleClick`/`titleHref`). */
export function EventTitleSection({
  title,
  editable = false,
  onCommit,
  onTitleClick,
  titleHref,
  actions,
  subtitle,
  links,
}: EventTitleSectionProps) {
  const [draft, setDraft] = React.useState(title)
  const skipCommitRef = React.useRef(false)

  // When rendered inside a `DockPanel`, fold the dock's chrome controls (flip-side / pop-out /
  // close) into this same toolbar so the dock needs no separate header — the event title IS the
  // header. `useDockChrome()` is null in the floating popover, so nothing is added there.
  const dock = useDockChrome()
  const dockActions: EventTitleAction[] = dock
    ? [
        ...(dock.onFlipSide
          ? [
              {
                icon: <ArrowLeftRight />,
                label: 'Flip side',
                onClick: () => dock.onFlipSide?.(dock.side === 'left' ? 'right' : 'left'),
              },
            ]
          : []),
        ...(dock.onPopOut
          ? [{ icon: <PanelRightOpen />, label: 'Pop out', onClick: dock.onPopOut }]
          : []),
        ...(dock.onClose ? [{ icon: <X />, label: 'Close', onClick: dock.onClose }] : []),
      ]
    : []
  const allActions = [...(actions ?? []), ...dockActions]

  React.useEffect(() => {
    setDraft(title)
  }, [title])

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      setDraft(title)
      return
    }
    const trimmed = draft.trim()
    if (trimmed && trimmed !== title) onCommit?.(trimmed)
    else setDraft(title)
  }

  const titleNode = editable ? (
    <AutosizeTextarea
      rows={1}
      minHeight={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true
          setDraft(title)
          e.currentTarget.blur()
        }
      }}
      className='min-w-0 flex-1 resize-none rounded-none border-none bg-transparent p-0 text-xl font-semibold focus:border-none focus-visible:ring-0 focus:ring-0 dark:bg-transparent'
    />
  ) : onTitleClick || titleHref ? (
    titleHref ? (
      <a
        href={titleHref}
        onClick={(e) => handleAnchorClick(e, onTitleClick)}
        className='min-w-0 flex-1 truncate text-xl font-semibold hover:underline'>
        {title}
      </a>
    ) : (
      <button
        type='button'
        onClick={onTitleClick}
        className='min-w-0 flex-1 truncate text-left text-xl font-semibold hover:underline'>
        {title}
      </button>
    )
  ) : (
    <div className='min-w-0 flex-1 text-xl font-semibold'>{title}</div>
  )

  return (
    <PanelCard
      data-slot='event-title'
      data-docked={dock ? '' : undefined}
      className={cn(
        links?.length && 'space-y-3',
        // Docked: flatten the card into a sticky panel header (no floating-card chrome), full-bleed
        // over `PanelShell`'s p-2 and pinned to the scroll viewport top so the merged dock chrome
        // (close / pop-out) never scrolls away. `data-slot`/`data-docked` let consumers restyle.
        dock &&
          'sticky top-0 z-10 -mx-2 -mt-2 rounded-none border-0 border-b border-border/50 bg-background px-3 py-2'
      )}>
      {allActions.length > 0 && (
        <div className='-mt-1 -mr-1 flex items-center justify-end gap-0.5'>
          {allActions.map((action) => (
            <EventTitleActionButton key={action.label} action={action} />
          ))}
        </div>
      )}
      <div className='flex items-start gap-2'>{titleNode}</div>
      {subtitle && <div className='text-muted-foreground text-sm'>{subtitle}</div>}
      {links?.map((link) => {
        const content = (
          <>
            {link.icon && (
              <span className='shrink-0 text-foreground/50 [&_svg]:size-4.5'>{link.icon}</span>
            )}
            <span className='truncate text-sm'>{link.label}</span>
          </>
        )
        return link.href ? (
          <a
            key={link.label}
            href={link.href}
            onClick={(e) => handleAnchorClick(e, link.onClick)}
            className='flex items-center gap-3 border-t border-border/50 pt-3'>
            {content}
          </a>
        ) : (
          <button
            key={link.label}
            type='button'
            onClick={link.onClick}
            className='flex w-full items-center gap-3 border-t border-border/50 pt-3 text-left'>
            {content}
          </button>
        )
      })}
    </PanelCard>
  )
}

// ---------------------------------------------------------------------------
// EventDateTimeSection
// ---------------------------------------------------------------------------

interface EventDateTimeSectionProps {
  start: Date | null
  end: Date | null
  onChange?: (change: { start: Date; end: Date }, scope: SeriesScope) => void
  /** When set, a trailing toggle on the Date row reflects `start != null`; flipping it off is the
   * "unschedule" affordance. Omit to hide the toggle (e.g. the board popover, which unschedules
   * via a title action instead). */
  onDateToggle?: (value: boolean) => void
  allDay?: { value: boolean; onChange: (value: boolean) => void }
  use24Hour?: boolean
  disabled?: boolean
  defaultStartHour?: number
  /** Availability/overlap hints. When present, the Date row's icon becomes a circular warning
   * icon and its title is re-tinted amber, with the hints in a hover tooltip — swapped in place,
   * so a late-arriving async result never shifts layout (replaces the old `EventPopoverHints`). */
  warnings?: string[]
  /** App-level time editor injected here so this UI package does not depend on app code. */
  renderTimeEditor?: (props: EventTimeEditorProps) => React.ReactNode
}

export interface EventTimeEditorProps {
  start: Date
  end: Date
  use24Hour?: boolean
  onCommit: (which: 'start' | 'end', hours: number, minutes: number) => void
}

/** Labeled "Date & Time" card with mutually exclusive date/time editors that animate open
 * directly below their row. All `onChange` commits route through `useSeriesScope().gate`. */
export function EventDateTimeSection({
  start,
  end,
  onChange,
  onDateToggle,
  allDay,
  use24Hour,
  disabled,
  defaultStartHour = 9,
  warnings,
  renderTimeEditor,
}: EventDateTimeSectionProps) {
  const { gate } = useSeriesScope()
  const readOnly = disabled || !onChange
  const [openEditor, setOpenEditor] = React.useState<'date' | 'time' | null>(null)
  const [localTime, setLocalTime] = React.useState<{ start: Date; end: Date } | null>(() =>
    start && end ? { start, end } : null
  )

  React.useEffect(() => {
    if (openEditor !== 'time' && start && end) setLocalTime({ start, end })
  }, [end, openEditor, start])

  const handleDateSelect = (date: Date) => {
    let newStart: Date
    let newEnd: Date
    if (start && end) {
      const duration = differenceInMinutes(end, start)
      newStart = withTimeOfDay(date, start.getHours(), start.getMinutes())
      newEnd = addMinutes(newStart, duration)
    } else {
      newStart = withTimeOfDay(date, defaultStartHour, 0)
      newEnd = addMinutes(newStart, 60)
    }
    setOpenEditor(null)
    gate((scope) => onChange?.({ start: newStart, end: newEnd }, scope))
  }

  /**
   * Commits a start/end change from a given base (rather than closing over the section's own
   * `start`/`end` props). The inline editor can commit repeatedly, and in draft mode a commit may
   * not round-trip into new props, so it composes successive edits off local state. Returning the
   * resolved pair lets the editor adopt it immediately.
   */
  const commitTime = (
    base: { start: Date; end: Date },
    which: 'start' | 'end',
    hours: number,
    minutes: number
  ) => {
    const prevDuration = Math.max(differenceInMinutes(base.end, base.start), 30)
    let newStart = base.start
    let newEnd = base.end
    if (which === 'start') newStart = withTimeOfDay(base.start, hours, minutes)
    else newEnd = withTimeOfDay(base.end, hours, minutes)
    if (newEnd <= newStart) newEnd = addMinutes(newStart, prevDuration)
    gate((scope) => onChange?.({ start: newStart, end: newEnd }, scope))
    return { start: newStart, end: newEnd }
  }

  const handleTimeCommit = (which: 'start' | 'end', hours: number, minutes: number) => {
    if (!localTime) return
    const next = commitTime(localTime, which, hours, minutes)
    setLocalTime(next)
  }

  const toggleEditor = (editor: 'date' | 'time') => {
    const next = openEditor === editor ? null : editor
    if (next === 'time' && start && end) setLocalTime({ start, end })
    setOpenEditor(next)
  }

  return (
    <div className='space-y-2'>
      <PanelSectionLabel>Date & Time</PanelSectionLabel>
      <PanelCard divided>
        <PanelCardRow
          icon={<CalendarDays />}
          title='Date'
          warnings={warnings}
          description={start ? format(start, 'PPP') : 'No date'}
          trailing={
            <div className='flex items-center gap-2'>
              {onDateToggle && (
                <Switch
                  checked={start != null}
                  onCheckedChange={onDateToggle}
                  disabled={disabled}
                />
              )}
              {!readOnly && (
                <PanelRowValue
                  aria-label='Change date'
                  aria-expanded={openEditor === 'date'}
                  onClick={() => toggleEditor('date')}>
                  {null}
                </PanelRowValue>
              )}
            </div>
          }
        />
        <AnimatedCollapsibleContent open={openEditor === 'date'}>
          <div className='pb-1'>
            <Calendar mode='single' selected={start ?? undefined} onSelect={handleDateSelect} />
          </div>
        </AnimatedCollapsibleContent>
        <PanelCardRow
          icon={<Clock8 />}
          title='Time'
          description={
            start && end
              ? `${formatTimeOfDay(start, use24Hour)} – ${formatTimeOfDay(end, use24Hour)}`
              : 'No time'
          }
          trailing={
            !readOnly && start && end ? (
              <PanelRowValue
                aria-label='Change time'
                aria-expanded={openEditor === 'time'}
                onClick={() => toggleEditor('time')}>
                {null}
              </PanelRowValue>
            ) : null
          }
        />
        <AnimatedCollapsibleContent open={openEditor === 'time'}>
          {localTime && (
            <div className='pb-1'>
              {renderTimeEditor ? (
                renderTimeEditor({
                  ...localTime,
                  use24Hour,
                  onCommit: handleTimeCommit,
                })
              ) : (
                <InlineTimeEditor
                  {...localTime}
                  use24Hour={use24Hour}
                  onCommit={handleTimeCommit}
                />
              )}
            </div>
          )}
        </AnimatedCollapsibleContent>
        {allDay && (
          <PanelCardRow
            title='All day'
            trailing={
              <Switch
                checked={allDay.value}
                onCheckedChange={allDay.onChange}
                disabled={disabled}
              />
            }
          />
        )}
      </PanelCard>
    </div>
  )
}

function InlineTimeEditor({ start, end, onCommit, use24Hour }: EventTimeEditorProps) {
  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <div className='flex-1 space-y-1'>
          <div className='text-muted-foreground text-xs'>Start</div>
          <TimeInput
            value={start}
            onCommit={(h, m) => onCommit('start', h, m)}
            use24Hour={use24Hour}
          />
        </div>
        <div className='flex-1 space-y-1'>
          <div className='text-muted-foreground text-xs'>End</div>
          <TimeInput value={end} onCommit={(h, m) => onCommit('end', h, m)} use24Hour={use24Hour} />
        </div>
      </div>
      <div className='text-muted-foreground text-xs'>
        {formatDuration(differenceInMinutes(end, start))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EventRepeatSection
// ---------------------------------------------------------------------------

interface EventRepeatSectionProps {
  /** Short cadence label shown in the trailing pill (e.g. "Weekly", "Custom") — kept concise so
   * the pill never stretches the row. Full detail goes in `detail`. */
  label?: string
  /** The concrete cadence example (e.g. "Every 2 weeks on Mon, Wed until Dec 31"), rendered below
   * the row rather than in the pill so a long custom summary doesn't blow out the trigger. */
  detail?: string
  /** Content for the drill page; `close` pops back to the previous level (repeat edits bypass
   * the scope chooser by design — decision #3). */
  renderEditor: (close: () => void) => React.ReactNode
  /** Fires when the drill page opens/closes — consumers commit on close. Driven by a
   * presence-diff effect on the nav stack so it fires for Back/Escape/breadcrumb exits too, not
   * just an explicit close. */
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  placeholder?: string
}

/** Single-row `PanelCard`: Repeat row, trailing `PanelRowValue` with the short cadence label,
 * drills into a consumer-injected recurrence editor page. The full cadence example (`detail`)
 * renders below the row so a long custom summary stays out of the pill. */
export function EventRepeatSection({
  label,
  detail,
  renderEditor,
  onOpenChange,
  disabled,
  placeholder = 'Does not repeat',
}: EventRepeatSectionProps) {
  const { push, pop, current } = useCommandNavigation<EventDrillItem>()
  const isOpen = current?.id === 'repeat'
  const wasOpenRef = React.useRef(isOpen)

  React.useEffect(() => {
    if (wasOpenRef.current !== isOpen) {
      wasOpenRef.current = isOpen
      onOpenChange?.(isOpen)
    }
  }, [isOpen, onOpenChange])

  return (
    <PanelCard className={detail ? 'space-y-2' : undefined}>
      <PanelCardRow
        icon={<RefreshCcw />}
        title='Repeat'
        trailing={
          disabled ? (
            <span className='text-muted-foreground text-sm'>{label ?? placeholder}</span>
          ) : (
            <PanelRowValue onClick={() => push({ id: 'repeat', label: 'Repeat' })}>
              {label ?? placeholder}
            </PanelRowValue>
          )
        }
      />
      {detail && <p className='pl-7.5 text-muted-foreground text-xs'>{detail}</p>}
      {/* Portalled from HERE (the consumer's live subtree) so the editor re-renders with fresh
          consumer state on every edit — a frame-captured `render()` closure would freeze it. */}
      <EventDrillPage id='repeat'>{renderEditor(pop)}</EventDrillPage>
    </PanelCard>
  )
}

// ---------------------------------------------------------------------------
// EventPeopleSection
// ---------------------------------------------------------------------------

interface EventPeopleSectionProps {
  label?: string
  person: { name: string; avatarUrl?: string | null } | null
  /** Content for the drill page; `close` pops back to the previous level. Scope gating (if any)
   * is the consumer's job inside. */
  renderPicker: (close: () => void) => React.ReactNode
  disabled?: boolean
}

/** Single-row `PanelCard`: assignee row, trailing avatar + name pill, drills into a
 * consumer-injected picker page. */
export function EventPeopleSection({
  label = 'Assignee',
  person,
  renderPicker,
  disabled,
}: EventPeopleSectionProps) {
  const { push, pop } = useCommandNavigation<EventDrillItem>()

  const value = (
    <span className='flex min-w-0 items-center gap-1.5'>
      <Avatar className='size-5'>
        {person?.avatarUrl && <AvatarImage src={person.avatarUrl} alt={person.name} />}
        <AvatarFallback className='text-[10px]'>
          {person ? initials(person.name) : '?'}
        </AvatarFallback>
      </Avatar>
      <span className='truncate'>{person?.name ?? 'Unassigned'}</span>
    </span>
  )

  return (
    <PanelCard>
      <PanelCardRow
        icon={<User />}
        title={label}
        trailing={
          disabled ? (
            value
          ) : (
            <PanelRowValue onClick={() => push({ id: 'people', label })}>{value}</PanelRowValue>
          )
        }
      />
      <EventDrillPage id='people'>{renderPicker(pop)}</EventDrillPage>
    </PanelCard>
  )
}

// ---------------------------------------------------------------------------
// EventPopoverFooter
// ---------------------------------------------------------------------------

interface EventPopoverFooterAction {
  icon?: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
}

interface EventPopoverFooterProps {
  action?: EventPopoverFooterAction
  /** Consumer buttons (e.g. draft mode's primary "Schedule" button) land here. */
  children?: React.ReactNode
}

/** Generic open-action row (Notion's "Manage in Notion") plus an arbitrary trailing slot. */
export function EventPopoverFooter({ action, children }: EventPopoverFooterProps) {
  if (!action && !children) return null

  const rowClassName =
    'flex w-full items-center gap-2 rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground'

  return (
    <div className='space-y-1'>
      {action &&
        (action.href ? (
          <a
            href={action.href}
            onClick={(e) => handleAnchorClick(e, action.onClick)}
            className={rowClassName}>
            {action.icon && <span className='shrink-0 [&_svg]:size-4'>{action.icon}</span>}
            {action.label}
          </a>
        ) : (
          <button type='button' onClick={action.onClick} className={rowClassName}>
            {action.icon && <span className='shrink-0 [&_svg]:size-4'>{action.icon}</span>}
            {action.label}
          </button>
        ))}
      {children}
    </div>
  )
}
