import React from 'react'
import {
  type TagInputProps,
  type TagInputStyleClassesProps,
  type Tag as TagType,
} from './tag-input'

import { cva } from 'class-variance-authority'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'

export const tagVariants = cva(
  'transition-all border inline-flex items-center text-sm pl-2 rounded-md',
  {
    variants: {
      variant: {
        default:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50',
        primary:
          'bg-primary border-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
        destructive:
          'bg-destructive border-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50',
      },
      size: { sm: 'text-xs h-6', md: 'text-sm h-7', lg: 'text-base h-8', xl: 'text-lg h-9' },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export type TagProps = {
  tagObj: TagType
  variant: TagInputProps['variant']
  size: TagInputProps['size']
  onRemoveTag: (id: string) => void
  isActiveTag?: boolean
  tagClasses?: TagInputStyleClassesProps['tag']
  disabled?: boolean
} & Pick<TagInputProps, 'onTagClick'>

export const Tag: React.FC<TagProps> = ({
  tagObj,
  onTagClick,
  onRemoveTag,
  variant,
  size,
  isActiveTag,
  tagClasses,
  disabled,
}) => {
  return (
    <span
      key={tagObj.id}
      className={cn(
        tagVariants({ variant, size }),
        { 'ring-1 ring-info ring-offset-1 ring-offset-background': isActiveTag },
        tagClasses?.body
      )}
      onClick={() => onTagClick?.(tagObj)}>
      {tagObj.text}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation() // Prevent event from bubbling up to the tag span
          onRemoveTag(tagObj.id)
        }}
        disabled={disabled}
        className={cn(
          `ml-1 h-full w-5 rounded-r-md rounded-l-none hover:bg-primary-200 flex items-center justify-center`,
          tagClasses?.closeButton
        )}>
        <X />
      </Button>
    </span>
  )
}
