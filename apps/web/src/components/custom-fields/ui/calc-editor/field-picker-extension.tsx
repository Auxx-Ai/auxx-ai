// apps/web/src/components/custom-fields/ui/calc-editor/field-picker-extension.tsx
'use client'

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import React, { useImperativeHandle, useRef, forwardRef } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'

/** Item type for the field picker (field or function) */
interface FieldItem {
  type: 'field' | 'function'
  key: string
  label: string
  description?: string
  fieldType?: string
  signature?: string
  example?: string
}

/** Suggestion handler props from TipTap */
interface SuggestionProps {
  query: string
  range: { from: number; to: number }
  clientRect: (() => DOMRect | null) | null
  editor: any
}

/** Field picker extension options */
interface FieldPickerExtensionOptions {
  suggestion: {
    char: string
    allowSpaces: boolean
    startOfLine: boolean
    items: (query: string) => FieldItem[]
    render: () => {
      onStart: (props: SuggestionProps) => void
      onUpdate: (props: SuggestionProps) => void
      onKeyDown: (props: { event: KeyboardEvent }) => boolean
      onExit: () => void
    }
  }
}

const suggestionPluginKey = new PluginKey('field-picker-suggestion')

/**
 * Field picker extension for formula TipTap editor.
 * Triggers on "{" character to show field and function suggestions.
 */
export const FieldPickerExtension = Extension.create<FieldPickerExtensionOptions>({
  name: 'field-picker',

  addOptions() {
    return {
      suggestion: {
        char: '{',
        allowSpaces: false,
        startOfLine: false,
        items: () => [],
        render: () => ({
          onStart: () => {},
          onUpdate: () => {},
          onKeyDown: () => false,
          onExit: () => {},
        }),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: suggestionPluginKey,
        items: ({ query }: { query: string }) => {
          return this.options.suggestion.items(query)
        },
      }),
    ]
  },
})

/** Props for the picker list component */
interface FieldPickerListProps {
  items: FieldItem[]
  command: (item: FieldItem) => void
  query: string
}

/** Ref interface for keyboard handling */
interface FieldPickerListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/** Picker UI component using shadcn Command */
const FieldPickerList = forwardRef<FieldPickerListRef, FieldPickerListProps>(({ items, command, query }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  // Filter items based on query
  const filteredItems = React.useMemo(() => {
    if (!query) return items
    const lowerQuery = query.toLowerCase()
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lowerQuery) ||
        item.key.toLowerCase().includes(lowerQuery) ||
        item.description?.toLowerCase().includes(lowerQuery)
    )
  }, [items, query])

  // Reset selection when items change
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filteredItems])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i > 0 ? i - 1 : filteredItems.length - 1))
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i < filteredItems.length - 1 ? i + 1 : 0))
        return true
      }
      if (event.key === 'Enter') {
        const item = filteredItems[selectedIndex]
        if (item) {
          command(item)
          return true
        }
      }
      return false
    },
  }))

  const fields = filteredItems.filter((i) => i.type === 'field')
  const functions = filteredItems.filter((i) => i.type === 'function')

  // Calculate selected index across both groups
  let globalIndex = 0

  return (
    <div ref={containerRef} className="rounded-lg border bg-popover shadow-lg w-[320px] max-h-[300px] overflow-y-auto">
      <Command>
        <CommandList>
          {filteredItems.length === 0 && <CommandEmpty>No matches found</CommandEmpty>}

          {fields.length > 0 && (
            <CommandGroup heading="Fields">
              {fields.map((item) => {
                const isSelected = globalIndex === selectedIndex
                globalIndex++
                return (
                  <CommandItem
                    key={item.key}
                    onSelect={() => command(item)}
                    className={isSelected ? 'bg-accent' : ''}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.fieldType}</span>
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {functions.length > 0 && (
            <CommandGroup heading="Functions">
              {functions.map((item) => {
                const isSelected = globalIndex === selectedIndex
                globalIndex++
                return (
                  <CommandItem
                    key={item.key}
                    onSelect={() => command(item)}
                    className={isSelected ? 'bg-accent' : ''}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">{item.signature}</span>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  )
})

FieldPickerList.displayName = 'FieldPickerList'

/**
 * Factory function to create a configured FieldPickerExtension.
 *
 * @param availableFields - Array of fields that can be referenced in the expression
 */
export function createFieldPickerExtension(availableFields: Array<{ key: string; label: string; type: string }>) {
  // Build items list with fields and functions
  const functions = getAvailableFunctions()

  const buildItems = (_query: string): FieldItem[] => {
    const fieldItems: FieldItem[] = availableFields.map((f) => ({
      type: 'field' as const,
      key: f.key,
      label: f.label,
      fieldType: f.type,
    }))

    const funcItems: FieldItem[] = functions.map((f) => ({
      type: 'function' as const,
      key: f.name,
      label: f.name,
      description: f.description,
      signature: f.signature,
      example: f.example,
    }))

    return [...fieldItems, ...funcItems]
  }

  return FieldPickerExtension.configure({
    suggestion: {
      char: '{',
      allowSpaces: false,
      startOfLine: false,
      items: buildItems,
      render: () => {
        let component: ReactRenderer<FieldPickerListRef>
        let popup: TippyInstance[]

        return {
          onStart: (props: SuggestionProps) => {
            component = new ReactRenderer(FieldPickerList, {
              props: {
                items: buildItems(props.query),
                query: props.query || '',
                command: (item: FieldItem) => {
                  if (item.type === 'field') {
                    // Insert field node
                    props.editor
                      .chain()
                      .focus()
                      .deleteRange({ from: props.range.from, to: props.range.to })
                      .insertContent({
                        type: 'field-node',
                        attrs: { fieldKey: item.key },
                      })
                      .run()
                  } else {
                    // Insert function text with parentheses
                    props.editor
                      .chain()
                      .focus()
                      .deleteRange({ from: props.range.from, to: props.range.to })
                      .insertContent(`${item.key}(`)
                      .run()
                  }
                },
              },
              editor: props.editor,
            })

            if (!props.clientRect) return

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
              maxWidth: 400,
              zIndex: 9999,
              animation: false,
            })
          },

          onUpdate(props: SuggestionProps) {
            component?.updateProps({
              items: buildItems(props.query),
              query: props.query || '',
              command: (item: FieldItem) => {
                if (item.type === 'field') {
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent({
                      type: 'field-node',
                      attrs: { fieldKey: item.key },
                    })
                    .run()
                } else {
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent(`${item.key}(`)
                    .run()
                }
              },
            })

            if (!props.clientRect) return
            popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
          },

          onKeyDown(props: { event: KeyboardEvent }) {
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide()
              return true
            }
            return component?.ref?.onKeyDown(props.event) ?? false
          },

          onExit() {
            popup?.[0]?.destroy()
            component?.destroy()
          },
        }
      },
    },
  })
}
