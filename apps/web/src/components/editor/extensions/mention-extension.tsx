// src/components/editor/extensions/mention-extension.tsx
// This file implements the TipTap mention extension for the Auxx.ai editor.
// It provides @mention functionality with async suggestions and custom rendering.

import { Extension, mergeAttributes } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { MentionPopover, type MentionPopoverRef, type MentionItem } from '../mention-popover'
import { useCallback } from 'react'
import { MentionNode } from './mention-node'

/**
 * Configuration options for the Mention extension
 */
interface MentionExtensionOptions {
  suggestion: {
    char: string
    allowSpaces: boolean
    startOfLine: boolean
    items: (query: string) => Promise<MentionItem[]> | MentionItem[]
    render: () => {
      onStart: (props: any) => void
      onUpdate: (props: any) => void
      onKeyDown: (props: any) => boolean
      onExit: () => void
    }
  }
}

/**
 * Mention extension for TipTap editor
 * Triggers on "@" character and provides user mention suggestions
 * Based on the slash-command extension implementation patterns
 * @see https://tiptap.dev/api/extensions/suggestion
 */
export const MentionExtension = Extension.create<MentionExtensionOptions>({
  name: 'mention',
  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addOptions() {
    return {
      suggestion: {
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        items: async () => {
          // Default implementation - should be overridden
          return []
        },
        render: () => {
          let component: ReactRenderer<MentionPopoverRef>
          let popup: TippyInstance[]

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(MentionPopover, {
                props: {
                  ...props,
                  command: ({ id, name }: MentionItem) => {
                    // Insert mention node
                    props.editor
                      .chain()
                      .focus()
                      .insertContent({ type: 'mention', attrs: { id, label: name } })
                      .run()
                  },
                },
                editor: props.editor,
              })

              if (!props.clientRect) {
                return
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },

            onUpdate(props: any) {
              component?.updateProps({
                ...props,
                command: ({ id, name }: MentionItem) => {
                  // Insert mention node
                  props.editor
                    .chain()
                    .focus()
                    .insertContent({ type: 'mention', attrs: { id, label: name } })
                    .run()
                },
              })

              if (!props.clientRect) {
                return
              }

              popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
            },

            onKeyDown(props: any) {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide()
                return true
              }

              if (!component?.ref) {
                return false
              }

              return component.ref.onKeyDown(props.event)
            },

            onExit() {
              popup?.[0]?.destroy()
              component?.destroy()
            },
          }
        },
      },
    }
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.id) {
            return {}
          }
          return { 'data-id': attributes.id }
        },
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.label) {
            return {}
          }
          return { 'data-label': attributes.label }
        },
      },
      mentionSuggestionChar: {
        default: '@',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-suggestion-char'),
        renderHTML: (attributes: Record<string, any>) => {
          return { 'data-mention-suggestion-char': attributes.mentionSuggestionChar }
        },
      },
    }
  },
  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
    // Simplified: remove MentionStorage usage, as it's not defined or used elsewhere
    const mergedOptions = { ...this.options }
    mergedOptions.HTMLAttributes = mergeAttributes(
      { 'data-type': this.name },
      this.options.HTMLAttributes,
      HTMLAttributes,
      { class: 'bg-red-500' } // Add Tailwind class for red background
    )
    const html = this.options.renderHTML?.({ options: mergedOptions, node })
    if (typeof html === 'string') {
      return [
        'span',
        mergeAttributes(
          { 'data-type': this.name, class: 'bg-red-500' },
          this.options.HTMLAttributes,
          HTMLAttributes
        ),
        html,
      ]
    }
    // If html is an array or object, ensure the class is present
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name, class: 'bg-red-500' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      html,
    ]
  },
  addProseMirrorPlugins() {
    // Fix Suggestion options: items expects (props: { query: string; editor: Editor })
    const suggestion = {
      ...this.options.suggestion,
      items: (props: { query: string; editor: any }) => this.options.suggestion.items(props.query),
    }
    return [Suggestion({ editor: this.editor, ...suggestion })]
  },
})

/**
 * Factory function to create a MentionExtension with async user fetching
 * @param fetchUsers - Function to fetch mentionable users/items
 * @returns Configured MentionExtension instance
 */
export const createMentionExtension = (
  fetchUsers: (query: string) => Promise<MentionItem[]> | MentionItem[]
) => {
  return MentionExtension.configure({
    suggestion: {
      char: '@',
      allowSpaces: false,
      startOfLine: false,
      items: async (query: string) => {
        try {
          const items = await fetchUsers(query)
          return items || [] // Ensure we always return an array
        } catch (error) {
          console.error('Error fetching mention suggestions:', error)
          return [] // Return empty array on error
        }
      },
      render: () => {
        let component: ReactRenderer<MentionPopoverRef>
        let popup: TippyInstance[]
        let isLoading = false
        let currentQuery = ''
        let currentItems: MentionItem[] = []

        return {
          onStart: async (props: any) => {
            currentQuery = props.query || ''
            component = new ReactRenderer(MentionPopover, {
              props: {
                ...props,
                isLoading,
                command: ({ id, name }: MentionItem) => {
                  // Insert mention as text with @ prefix
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent({ type: 'mention-node', attrs: { id, label: name } })
                    .insertContent(' ')
                    .run()
                },
              },
              editor: props.editor,
            })

            if (!props.clientRect) {
              return
            }

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            })
          },

          onUpdate: async (props: any) => {
            // Only fetch new items if the query changes
            const newQuery = props.query || ''

            if (newQuery !== currentQuery) {
              currentQuery = newQuery
              isLoading = true

              // Update with loading state first
              component?.updateProps({
                ...props,
                isLoading: true,
                items: currentItems,
                command: ({ id, name }: MentionItem) => {
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent({ type: 'mention-node', attrs: { id, label: name } })
                    .insertContent(' ')
                    .run()
                },
              })

              try {
                // Fetch new items
                const items = await props.items
                currentItems = Array.isArray(items) ? items : []
                isLoading = false

                // Update with fetched items
                component?.updateProps({
                  ...props,
                  isLoading: false,
                  items: currentItems,
                  command: ({ id, name }: MentionItem) => {
                    props.editor
                      .chain()
                      .focus()
                      .deleteRange({ from: props.range.from, to: props.range.to })
                      .insertContent({ type: 'mention-node', attrs: { id, label: name } })
                      .insertContent(' ')
                      .run()
                  },
                })
              } catch (error) {
                console.error('Error fetching mention suggestions:', error)
                isLoading = false
                currentItems = []

                component?.updateProps({
                  ...props,
                  isLoading: false,
                  items: [],
                  command: ({ id, name }: MentionItem) => {
                    props.editor
                      .chain()
                      .focus()
                      .deleteRange({ from: props.range.from, to: props.range.to })
                      .insertContent({ type: 'mention-node', attrs: { id, label: name } })
                      .insertContent(' ')
                      .run()
                  },
                })
              }
            } else {
              // Just update props without refetching
              component?.updateProps({
                ...props,
                isLoading,
                items: currentItems,
                command: ({ id, name }: MentionItem) => {
                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent({ type: 'mention-node', attrs: { id, label: name } })
                    .insertContent(' ')
                    .run()
                },
              })
            }

            if (!props.clientRect) {
              return
            }

            popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
          },

          onKeyDown(props: any) {
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide()
              return true
            }

            if (!component?.ref) {
              return false
            }

            return component.ref.onKeyDown(props.event)
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
