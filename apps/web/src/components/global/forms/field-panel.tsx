// apps/web/src/components/global/forms/field-panel.tsx

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type React from 'react'
import { Tooltip, TooltipExplanation } from '~/components/global/tooltip'
import type { BaseType } from '~/components/workflow/types/unified-types'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { ValidationErrorBadge } from './validation-error-badge'

/**
 * Variants for FieldPanel orientation
 * Controls how FieldPanelRow children lay out their label and content
 */
const fieldPanelVariants = cva(
  [
    'relative grow rounded-2xl px-1.5 py-0.5',
    'bg-primary-200/30 dark:bg-[#23272e]/30 border flex flex-col focus-within:border-primary-300',
    '[&>[data-slot=field-row]:not(:has(~[data-slot=field-row]))]:border-b-0',
  ],
  {
    variants: {
      orientation: {
        horizontal: [
          // field-row: horizontal layout (default behavior)
          '[&_[data-slot=field-row]]:flex-row [&_[data-slot=field-row]]:items-start',
          // field-row-label: fixed width and height
          '[&_[data-slot=field-row-label]]:w-40 [&_[data-slot=field-row-label]]:shrink-0 [&_[data-slot=field-row-label]]:min-h-8',
        ],
        vertical: [
          // field-row: vertical layout (stacked)
          '[&_[data-slot=field-row]]:flex-col [&_[data-slot=field-row]]:items-stretch',
          // field-row-label: full width
          '[&_[data-slot=field-row-label]]:w-full [&_[data-slot=field-row-label]]:shrink [&_[data-slot=field-row-label]]:pt-1.5 [&_[data-slot=field-row-label]]:pb-1 [&_[data-slot=field-row-content]]:ps-2',
          '[&_[data-slot=field-row]]:pb-1',
        ],
        responsive: [
          '@container',
          // Base (mobile): vertical layout
          '[&_[data-slot=field-row]]:flex-col [&_[data-slot=field-row]]:items-stretch',
          '[&_[data-slot=field-row-label]]:w-full [&_[data-slot=field-row-label]]:shrink [&_[data-slot=field-row-label]]:pt-1.5 [&_[data-slot=field-row-label]]:pb-1 [&_[data-slot=field-row-content]]:ps-2',
          '[&_[data-slot=field-row]]:pb-1',
          // @sm+ : horizontal layout
          '@sm:[&_[data-slot=field-row]]:flex-row @sm:[&_[data-slot=field-row]]:items-start',
          '@sm:[&_[data-slot=field-row-label]]:w-40 @sm:[&_[data-slot=field-row-label]]:shrink-0 @sm:[&_[data-slot=field-row-label]]:min-h-8',
          '@sm:[&_[data-slot=field-row-label]]:pt-0 @sm:[&_[data-slot=field-row-label]]:pb-0 @sm:[&_[data-slot=field-row-content]]:ps-0',
          '@sm:[&_[data-slot=field-row]]:pb-0',
        ],
      },
    },
    defaultVariants: {
      orientation: 'responsive',
    },
  }
)

/**
 * Bordered, rounded panel that groups labeled form rows (FieldPanelRow).
 * Formerly VarEditorField — generic form-layout primitive, not workflow-specific.
 */
interface FieldPanelProps extends VariantProps<typeof fieldPanelVariants> {
  children: React.ReactNode
  validationError?: string
  validationType?: 'error' | 'warning'
  className?: string
}

const FieldPanel: React.FC<FieldPanelProps> = ({
  children,
  validationError,
  validationType = 'error',
  orientation = 'responsive',
  className,
}) => {
  return (
    <div
      data-slot='field'
      data-orientation={orientation}
      className={cn(fieldPanelVariants({ orientation }), className)}>
      {children}
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

interface FieldPanelRowProps {
  children: React.ReactNode
  title: string
  description?: string
  isRequired?: boolean
  validationError?: string
  validationType?: 'error' | 'warning'
  type?: BaseType
  showIcon?: boolean
  icon?: React.ReactNode
  className?: string
  /** When provided, renders a clear button on row hover (positioned on the right edge) */
  onClear?: () => void
}

/**
 * Labeled row inside a FieldPanel: label (with optional icon/description) + content.
 * Formerly VarEditorFieldRow.
 */
const FieldPanelRow: React.FC<FieldPanelRowProps> = ({
  children,
  title,
  description,
  isRequired = false,
  validationError,
  validationType = 'error',
  type,
  icon,
  showIcon = false,
  className,
  onClear,
}) => {
  return (
    <div
      data-slot='field-row'
      className={cn(
        'group/field-row relative flex border-b dark:border-b-[#404754]/20',
        className
      )}>
      <div
        data-slot='field-row-label'
        className='flex flex-row gap-1 ps-2 items-center [&_svg]:size-4'>
        {showIcon && (icon ? icon : <VarTypeIcon type={type!} />)}
        <div className='text-sm'>
          <span className='text-primary-600'>{title}</span>
          {isRequired && <span className='text-red-500'>*</span>}
        </div>
        {description && <TooltipExplanation text={description} />}
      </div>
      <div data-slot='field-row-content' className='w-full flex-1 relative'>
        {children}
      </div>
      {onClear && (
        <div className='absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/field-row:opacity-100 transition-opacity z-10'>
          <Tooltip content='Clear content'>
            <Button
              variant='ghost'
              size='icon-xs'
              className='size-4 bg-primary-500/30 text-primary-100 transition-colors hover:bg-bad-100 hover:text-bad-500'
              onClick={onClear}>
              <X className='size-3!' />
            </Button>
          </Tooltip>
        </div>
      )}
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

export { FieldPanel, FieldPanelRow }
