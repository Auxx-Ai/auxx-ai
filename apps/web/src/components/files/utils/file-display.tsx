// apps/web/src/components/files/utils/file-display.tsx

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { getFileIcon } from './file-icon'
import { getStandardFileType } from './file-type'

const fileDisplayVariants = cva('flex items-center', {
  variants: {
    variant: {
      default: 'gap-2',
      compact: 'justify-center',
      detailed: 'gap-2',
    },
    size: {
      sm: 'gap-1',
      md: 'gap-2',
      lg: 'gap-3',
    },
    layout: {
      horizontal: 'flex-row',
      vertical: 'flex-col',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
    layout: 'horizontal',
  },
})

export interface FileDisplayProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof fileDisplayVariants> {
  /** MIME type of the file */
  mimeType?: string
  /** File extension */
  ext?: string
  /** CSS classes for the icon */
  iconClassName?: string
}

/**
 * FileDisplay component that shows a file icon with optional file type text
 * Provides a consistent way to display file information across the application
 */
type FileDisplayWithRefProps = FileDisplayProps & React.RefAttributes<HTMLDivElement>

export const FileDisplay: React.FC<FileDisplayWithRefProps> = ({
  className,
  variant,
  size,
  layout,
  mimeType,
  ext,
  iconClassName,
  ref,
  ...props
}) => {
  // Get the standard file type for display
  const fileType = getStandardFileType(mimeType, ext)

  // Define size-based styling for icons and text
  const sizeClasses = {
    sm: {
      icon: 'h-3 w-3',
      text: 'text-xs',
      primaryText: 'text-xs font-medium',
      secondaryText: 'text-xs text-muted-foreground',
    },
    md: {
      icon: 'h-4 w-4',
      text: 'text-sm',
      primaryText: 'text-sm font-medium',
      secondaryText: 'text-xs text-muted-foreground',
    },
    lg: {
      icon: 'h-5 w-5',
      text: 'text-base',
      primaryText: 'text-base font-medium',
      secondaryText: 'text-sm text-muted-foreground',
    },
  }

  const currentSize = sizeClasses[size || 'md']
  const finalIconClassName = iconClassName || currentSize.icon

  // Render based on variant
  const renderContent = () => {
    switch (variant) {
      case 'compact':
        return getFileIcon(mimeType, ext, finalIconClassName)

      case 'detailed':
        return (
          <>
            {getFileIcon(mimeType, ext, finalIconClassName)}
            <div className='flex flex-col min-w-0'>
              <span className={currentSize.primaryText}>{fileType}</span>
              {mimeType && (
                <span className={cn(currentSize.secondaryText, 'truncate')}>{mimeType}</span>
              )}
            </div>
          </>
        )

      default:
        return (
          <>
            {getFileIcon(mimeType, ext, finalIconClassName)}
            <span className={cn('font-medium', currentSize.text)}>{fileType}</span>
          </>
        )
    }
  }

  return (
    <div
      ref={ref}
      className={cn(fileDisplayVariants({ variant, size, layout, className }))}
      title={variant === 'compact' ? fileType : undefined}
      {...props}>
      {renderContent()}
    </div>
  )
}
FileDisplay.displayName = 'FileDisplay'
