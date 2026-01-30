// apps/web/src/components/workflow/nodes/shared/node-inputs/tags-input.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { Badge } from '@auxx/ui/components/badge'
import { TagPicker } from '~/components/tags/ui/tag-picker'
import { useTagHierarchy } from '~/components/tags/hooks/use-tag-hierarchy'
import { ChevronDown, X } from 'lucide-react'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface TagsInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Allow multiple tag selection */
  allowMultiple?: boolean
}

/**
 * Tags input following node-input interface
 * Uses TagPicker to select tags for workflow nodes
 */
export const TagsInput = createNodeInput<TagsInputProps>(
  ({ inputs, onChange, isLoading, name, placeholder = 'Select tags...', allowMultiple = true }) => {
    const [open, setOpen] = useState(false)

    // Get current value (array of tag IDs)
    const value: string[] = useMemo(() => {
      const raw = inputs[name]
      if (!raw) return []
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) return parsed
        } catch {
          // Single string ID
          return [raw]
        }
      }
      return []
    }, [inputs, name])

    // Get tag details for display using useTagHierarchy
    const { flatTags } = useTagHierarchy()

    // Get selected tag objects for display
    const selectedTagObjects = useMemo(
      () => flatTags.filter((t) => value.includes(t.id)),
      [flatTags, value]
    )

    const handleChange = useCallback(
      (selectedTags: string[]) => {
        onChange(name, selectedTags)
        if (!allowMultiple && selectedTags.length > 0) {
          setOpen(false)
        }
      },
      [onChange, name, allowMultiple]
    )

    const removeTag = useCallback(
      (tagId: string) => {
        onChange(
          name,
          value.filter((id) => id !== tagId)
        )
      },
      [onChange, name, value]
    )

    return (
      <div className="flex flex-col gap-2 flex-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div>
              {selectedTagObjects.length > 0 ? (
                <div className="min-h-7 flex flex-row flex-wrap items-center gap-1">
                  {selectedTagObjects.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="pill"
                      size="xs"
                      className="gap-1 h-5 cursor-pointer">
                      {tag.tag_emoji ? (
                        <span>{tag.tag_emoji}</span>
                      ) : (
                        <div
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.tag_color || '#94a3b8' }}
                        />
                      )}
                      <span>{tag.title}</span>
                      <button
                        type="button"
                        onClick={() => removeTag(tag.id)}
                        className="hover:text-destructive">
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="h-7 flex items-center justify-between pe-1">
                  <span className="cursor-default text-sm text-primary-400 font-normal pt-0.5 truncate pointer-events-none">
                    {placeholder}
                  </span>
                  <ChevronDown className="size-4 text-foreground opacity-50" />
                </div>
              )}
            </div>
            {/* <Button variant="transparent" size="sm" className="justify-start" disabled={isLoading}>
              <Tags />
              {value.length > 0 ? `${value.length} tag(s) selected` : placeholder}
            </Button> */}
          </PopoverTrigger>
          <TagPicker
            open={open}
            onOpenChange={setOpen}
            selectedTags={value}
            onChange={handleChange}
            allowMultiple={allowMultiple}
          />
        </Popover>

        {/* Display selected tags */}
      </div>
    )
  }
)
