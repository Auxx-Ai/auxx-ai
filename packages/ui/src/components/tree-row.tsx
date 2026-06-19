// packages/ui/src/components/tree-row.tsx
'use client'

import { SimpleTooltip, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React from 'react'

export interface TreeRowProps {
  /** Leading slot — icon, checkbox, etc. */
  icon?: React.ReactNode
  /** Main label. */
  title: React.ReactNode
  /** Help-icon tooltip rendered next to the title (e.g. a slug or tool description). */
  description?: string
  /** Secondary text rendered to the right of the description. */
  secondary?: React.ReactNode
  /** Right-side slot — switch, badge cluster, count text, etc. */
  actions?: React.ReactNode
  /** Escape hatch — full custom trailing content; if set, replaces `actions` + chevron. */
  trailing?: React.ReactNode

  /** 0-based indent. Each step adds ~1.5rem of paddingLeft. */
  depth?: number

  /** Show a right-side chevron that rotates with `isOpen`. */
  expandable?: boolean
  /**
   * Move the expand affordance to the leading icon: render the icon at rest and
   * swap it for the chevron on row hover (no trailing chevron). Requires
   * `expandable`. Falls back to a plain icon when there's nothing to expand.
   */
  chevronOnHover?: boolean
  /** Controlled expand state. */
  isOpen?: boolean
  /**
   * Fired by the chevron and by a click anywhere on the row. Supply it without
   * `expandable` to make the whole row a toggle (e.g. flip a trailing switch).
   */
  onToggleOpen?: () => void

  /** Click on the title text — useful for "click row to toggle checkbox" UX. */
  onTitleClick?: () => void

  /**
   * Rendered below the row when `isOpen` is true. If `isOpen` is undefined
   * and `expandable` is false, children always render.
   */
  children?: React.ReactNode

  /** Class for the outer container. */
  className?: string
  /** Class for the single-line row itself. */
  rowClassName?: string
}

/** One indent step, in rem. Exported so column-based variants (GridTreeRow) can
 *  apply the same step inside their first cell. */
export const INDENT_REM = 1.5

/** The connector line / icon center offset from a row's content start: row
 *  px-1 (0.25rem) + half of the size-7 icon box (0.875rem). */
const ICON_CENTER_REM = 1.125

const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

/**
 * The leading icon slot, shared by both row variants. With `chevronOnHover` +
 * `expandable`, the icon swaps to an expand chevron on row hover (occupying the
 * same `size-7` box, so the connector line still lands on its center); otherwise
 * it's a plain icon. Returns null when there's nothing to show.
 */
function LeadingIcon({
  icon,
  expandable,
  isOpen,
  chevronOnHover,
  onToggleOpen,
}: {
  icon?: React.ReactNode
  expandable?: boolean
  isOpen?: boolean
  chevronOnHover?: boolean
  onToggleOpen?: () => void
}) {
  const swap = !!chevronOnHover && !!expandable
  if (icon === undefined && !swap) return null
  return (
    <span className='relative flex size-7 shrink-0 items-center justify-center px-1 text-muted-foreground'>
      {icon !== undefined && (
        <span
          className={cn(
            'flex items-center justify-center transition-opacity',
            swap && 'group-hover/tree-row:opacity-0'
          )}>
          {icon}
        </span>
      )}
      {swap && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onToggleOpen?.()
          }}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          className='absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/tree-row:opacity-100'>
          <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
        </button>
      )}
    </span>
  )
}

export interface BaseTreeRowProps {
  /** 0-based indent — only drives the connector line position here; the visible
   *  indent is applied by the variant (TreeRow pads the row, GridTreeRow the cell). */
  depth?: number
  expandable?: boolean
  isOpen?: boolean
  /** The single-line row content. The variant owns its layout + indent. */
  line: React.ReactNode
  /** Nested rows, revealed (animated) when open. */
  children?: React.ReactNode
  /** Class for the outer container. */
  className?: string
}

/**
 * The shared TreeRow shell: the outer container, the animated children block,
 * and the vertical connector line that joins a parent's icon center to its
 * nested rows. Layout-agnostic — {@link TreeRow} (flex) and {@link GridTreeRow}
 * (columns) both compose it, so the connector/animation logic lives in one place.
 */
export function BaseTreeRow({
  depth = 0,
  expandable = false,
  isOpen,
  line,
  children,
  className,
}: BaseTreeRowProps) {
  // Connector sits on this row's icon center. Child rows are one INDENT_REM
  // further in, so the gap stays consistent at every depth.
  const connectorLeftRem = depth * INDENT_REM + ICON_CENTER_REM
  const showChildren = expandable ? !!isOpen : (isOpen ?? children !== undefined)

  return (
    <div className={cn('relative', className)}>
      {line}

      <AnimatePresence initial={false}>
        {showChildren && children && (
          <motion.div
            initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
            animate={{
              height: 'auto',
              opacity: 1,
              filter: 'blur(0px)',
              overflow: 'hidden',
              transitionEnd: { overflow: 'visible' },
            }}
            exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className='relative flex flex-col'>
            <div
              className='absolute bottom-0 top-0 z-0 w-px bg-border'
              style={{ left: `${connectorLeftRem}rem` }}
            />
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Outline-style single-line row with an indent, optional chevron, and an
 * animated children block. Used across the agent detail page for the Tools
 * toolset/per-tool tree and the Knowledge resource-scope tree. Pairs with
 * `Section` as the row-level primitive.
 */
export function TreeRow({
  icon,
  title,
  description,
  secondary,
  actions,
  trailing,
  depth = 0,
  expandable = false,
  chevronOnHover = false,
  isOpen,
  onToggleOpen,
  onTitleClick,
  children,
  className,
  rowClassName,
}: TreeRowProps) {
  const paddingLeftRem = depth * INDENT_REM
  // The whole row is clickable whenever a toggle handler is supplied — `expandable`
  // only controls the chevron, not whether clicking the row does something.
  const rowClickable = onToggleOpen !== undefined

  const titleNode = (
    <span
      className={cn(
        'truncate px-1 py-1.5 text-foreground text-sm',
        onTitleClick && 'cursor-pointer'
      )}
      onClick={
        onTitleClick
          ? (e) => {
              e.stopPropagation()
              onTitleClick()
            }
          : undefined
      }>
      {title}
    </span>
  )

  const line = (
    <div style={{ paddingLeft: `${paddingLeftRem}rem` }}>
      <div
        className={cn(
          'group/tree-row flex items-center justify-between rounded-md text-sm px-1',
          'text-muted-foreground hover:bg-background',
          rowClickable && 'cursor-pointer',
          rowClassName
        )}
        onClick={rowClickable ? onToggleOpen : undefined}>
        <div className='flex items-center flex-1 min-w-0'>
          <LeadingIcon
            icon={icon}
            expandable={expandable}
            isOpen={isOpen}
            chevronOnHover={chevronOnHover}
            onToggleOpen={onToggleOpen}
          />

          {titleNode}
          {description && (
            <TooltipExplanation text={description} className='text-primary-400 shrink-0' />
          )}
          {secondary && <span className='ml-1 truncate text-primary-400 text-sm'>{secondary}</span>}

          {/* Trailing chevron — omitted when the icon doubles as the hover chevron. */}
          {expandable && !chevronOnHover && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onToggleOpen?.()
              }}
              className='p-1 rounded-md hover:bg-primary/5'
              aria-label={isOpen ? 'Collapse' : 'Expand'}>
              <ChevronRight
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </button>
          )}
        </div>

        {trailing ? (
          <div onClick={stopPropagation}>{trailing}</div>
        ) : (
          actions && (
            <div className='flex items-center' onClick={stopPropagation}>
              {actions}
            </div>
          )
        )}
      </div>
    </div>
  )

  return (
    <BaseTreeRow
      depth={depth}
      expandable={expandable}
      isOpen={isOpen}
      className={className}
      line={line}>
      {children}
    </BaseTreeRow>
  )
}

export interface GridTreeRowProps {
  /** Leading slot in the first cell — icon, type glyph, etc. */
  icon?: React.ReactNode
  /** First-cell content (the source label). Truncates within the fixed column. */
  title: React.ReactNode
  /**
   * Cells placed left-to-right after the first (source) cell — e.g. an arrow,
   * a target picker, an actions cluster. Their count must match the non-first
   * columns in `columns`.
   */
  cells?: React.ReactNode[]
  /**
   * `grid-template-columns` for the row line. The first column is the source
   * cell (give it a fixed width so the later columns stay at a fixed x at every
   * depth); the rest map to `cells`.
   */
  columns: string
  /** Draw subtle full-height dividers between cells (condition-badge look). */
  divided?: boolean

  /** 0-based indent — applied inside the first cell, not to the whole row. */
  depth?: number
  expandable?: boolean
  /** Swap the leading icon for the expand chevron on row hover (see TreeRow). */
  chevronOnHover?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void

  children?: React.ReactNode
  className?: string
  rowClassName?: string
}

/**
 * Column variant of {@link TreeRow}. The depth indent lives inside the first
 * (source) cell instead of shifting the whole row, so the arrow/target/action
 * columns line up at a fixed x regardless of nesting depth. Cells stretch to the
 * row height so transparent, full-height pickers blend into the row (see the
 * Data Connectors mapping editor). Shares the connector line + animation with
 * TreeRow via {@link BaseTreeRow}.
 */
export function GridTreeRow({
  icon,
  title,
  cells = [],
  columns,
  divided = false,
  depth = 0,
  expandable = false,
  chevronOnHover = false,
  isOpen,
  onToggleOpen,
  children,
  className,
  rowClassName,
}: GridTreeRowProps) {
  const indentRem = depth * INDENT_REM
  const rowClickable = onToggleOpen !== undefined

  const line = (
    <div
      className={cn('group/tree-row relative text-sm', rowClickable && 'cursor-pointer')}
      onClick={rowClickable ? onToggleOpen : undefined}>
      {/* Hover background — a standalone layer, independent of the grid columns,
          inset to the indent so the highlight lines up with the content (matching
          TreeRow's indented hover rather than spanning the gutter). */}
      <div
        className='absolute inset-y-0 right-0 rounded-md transition-colors group-hover/tree-row:bg-background'
        style={{ left: `${indentRem}rem` }}
      />

      <div
        className={cn(
          'relative grid min-h-9 items-stretch px-1 text-muted-foreground',
          rowClassName
        )}
        style={{ gridTemplateColumns: columns }}>
        {/* First cell — indent + icon + source label (truncates) + chevron. The
            cell stretches to the row height, so a full-height picker handed in as
            `title` blends into the row. */}
        <div className='flex min-w-0 items-center' style={{ paddingLeft: `${indentRem}rem` }}>
          <LeadingIcon
            icon={icon}
            expandable={expandable}
            isOpen={isOpen}
            chevronOnHover={chevronOnHover}
            onToggleOpen={onToggleOpen}
          />
          <div className='flex-1 truncate px-1 text-foreground'>{title}</div>
          {/* Trailing chevron — omitted when the icon doubles as the hover chevron. */}
          {expandable && !chevronOnHover && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onToggleOpen?.()
              }}
              className='rounded-md p-1 hover:bg-primary/5 shrink-0'
              aria-label={isOpen ? 'Collapse' : 'Expand'}>
              <ChevronRight
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </button>
          )}
        </div>

        {/* Remaining cells — clicks here never toggle the row. */}
        {cells.map((cell, i) => (
          <div
            key={i}
            onClick={stopPropagation}
            className={cn('flex min-w-0 items-center', divided && 'border-l border-border/60')}>
            {cell}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <BaseTreeRow
      depth={depth}
      expandable={expandable}
      isOpen={isOpen}
      className={className}
      line={line}>
      {children}
    </BaseTreeRow>
  )
}

/**
 * Hover-revealed icon button for a TreeRow's `actions`/`trailing` slot. Holds
 * the text color (so `<Trash2 />` needs no class) and sizes child svgs to 3.5.
 * Fades in on row hover via the `group/tree-row` group. Pass `tooltipText` to
 * wrap it in a left-side tooltip; omit it for no tooltip.
 *
 * Two axes:
 * - `variant` — `default` / `destructive` for pure hover-revealed actions.
 *   `owned` / `contributing` are persistent, colour-coded *state* toggles (the
 *   Data Connectors mapping target-mode chip): they show their state at rest,
 *   not on hover.
 * - `persistent` — set true to force a hover-revealed (`default`/`destructive`)
 *   button to stay visible. The mode variants are already visible at rest, so
 *   they don't need it.
 */
const treeRowButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-opacity [&_svg]:size-3.5',
  {
    variants: {
      // default/destructive are hover-revealed; the colour-coded target-mode
      // toggles (owned/contributing) carry their own opacity-100 to stay visible.
      variant: {
        default:
          'text-muted-foreground hover:bg-primary/5 hover:text-foreground opacity-0 group-hover/tree-row:opacity-100',
        destructive:
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover/tree-row:opacity-100',
        owned:
          'border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 opacity-100',
        contributing:
          'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 opacity-100',
      },
      // Override to force a hover-revealed button to stay visible. Defined after
      // `variant`, so twMerge lets `true` win over the variant's opacity-0.
      persistent: {
        false: '',
        true: 'opacity-100',
      },
    },
    defaultVariants: { variant: 'default', persistent: false },
  }
)

export interface TreeRowButtonProps
  extends React.ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof treeRowButtonVariants> {
  /** Tooltip text shown on the left. When omitted, no tooltip is rendered. */
  tooltipText?: string
}

export function TreeRowButton({
  variant,
  persistent,
  className,
  tooltipText,
  type = 'button',
  ...props
}: TreeRowButtonProps) {
  const button = (
    <button
      type={type}
      className={cn(treeRowButtonVariants({ variant, persistent }), className)}
      {...props}
    />
  )

  if (!tooltipText) return button

  return (
    <SimpleTooltip side='left' content={tooltipText} allowInteraction delayDuration={500}>
      {button}
    </SimpleTooltip>
  )
}

export { treeRowButtonVariants }

export default React.memo(TreeRow)
