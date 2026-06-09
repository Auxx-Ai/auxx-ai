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
  /** Controlled expand state. */
  isOpen?: boolean
  /** Click handler for the chevron. */
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

const INDENT_REM = 1.5

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
  isOpen,
  onToggleOpen,
  onTitleClick,
  children,
  className,
  rowClassName,
}: TreeRowProps) {
  const paddingLeftRem = 0 + depth * INDENT_REM
  // Connector sits on this row's icon center: paddingLeft + row px-1 (0.25rem) +
  // half of size-7 (0.875rem) = paddingLeft + 1.125rem. Child rows are one
  // INDENT_REM further in, so the gap between connector and child row is
  // INDENT_REM - 1.125 — consistent at every depth.
  const connectorLeftRem = paddingLeftRem + 1.125
  const showChildren = expandable ? !!isOpen : (isOpen ?? children !== undefined)

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

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className={cn('relative', className)}>
      <div style={{ paddingLeft: `${paddingLeftRem}rem` }}>
        <div
          className={cn(
            'group/tree-row flex items-center justify-between rounded-md text-sm px-1',
            'text-muted-foreground hover:bg-background',
            expandable && 'cursor-pointer',
            rowClassName
          )}
          onClick={expandable ? onToggleOpen : undefined}>
          <div className='flex items-center flex-1 min-w-0'>
            {icon !== undefined && (
              <span className='flex items-center justify-center px-1 size-7 text-muted-foreground shrink-0'>
                {icon}
              </span>
            )}

            {titleNode}
            {description && (
              <TooltipExplanation text={description} className='text-primary-400 shrink-0' />
            )}
            {secondary && (
              <span className='ml-1 truncate text-primary-400 text-sm'>{secondary}</span>
            )}

            {expandable && (
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
 * Hover-revealed icon button for a TreeRow's `actions`/`trailing` slot. Holds
 * the text color (so `<Trash2 />` needs no class) and sizes child svgs to 3.5.
 * Fades in on row hover via the `group/tree-row` group. Pass `tooltipText` to
 * wrap it in a left-side tooltip; omit it for no tooltip.
 */
const treeRowButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/tree-row:opacity-100 [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'hover:bg-primary/5 hover:text-foreground',
        destructive: 'hover:bg-destructive/10 hover:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
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
  className,
  tooltipText,
  type = 'button',
  ...props
}: TreeRowButtonProps) {
  const button = (
    <button type={type} className={cn(treeRowButtonVariants({ variant }), className)} {...props} />
  )

  if (!tooltipText) return button

  return (
    <SimpleTooltip side='left' content={tooltipText} allowInteraction>
      {button}
    </SimpleTooltip>
  )
}

export { treeRowButtonVariants }

export default React.memo(TreeRow)
