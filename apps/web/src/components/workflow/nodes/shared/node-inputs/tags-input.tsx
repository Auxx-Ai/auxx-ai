// apps/web/src/components/workflow/nodes/shared/node-inputs/tags-input.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { Badge } from '@auxx/ui/components/badge'
import { TagPicker } from '~/components/pickers/tag-picker'
import { api } from '~/trpc/react'
import { ChevronDown, Tags, X } from 'lucide-react'
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

    // Fetch tag details for display
    const { data: allTags } = api.tag.getAll.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    })

    // Get selected tag objects for display
    const selectedTagObjects = useMemo(
      () => allTags?.filter((t) => value.includes(t.id)) || [],
      [allTags, value]
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
                      {tag.emoji ? (
                        <span>{tag.emoji}</span>
                      ) : (
                        <div
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color || '#94a3b8' }}
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
