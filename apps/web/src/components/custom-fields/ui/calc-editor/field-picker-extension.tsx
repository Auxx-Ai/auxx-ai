// apps/web/src/components/custom-fields/ui/calc-editor/field-picker-extension.tsx
'use client'

import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

/** Suggestion state exposed to React for rendering the picker UI */
export interface SuggestionState {
  isOpen: boolean
  query: string
  range: { from: number; to: number } | null
  clientRect: DOMRect | null
}

/** Options for createFieldPickerExtension factory */
export interface CreateFieldPickerExtensionOptions {
  /** Entity definition ID to show fields for */
  entityDefinitionId: string
  /** Current field ID to exclude (prevent self-reference) */
  currentFieldId?: string
  /** Callback when suggestion state changes */
  onStateChange: (state: SuggestionState) => void
}

/** Suggestion handler props from TipTap */
interface SuggestionProps {
  query: string
  range: { from: number; to: number }
  clientRect?: (() => DOMRect | null) | null
  editor: any
}

/** Field picker extension options */
interface FieldPickerExtensionOptions {
  suggestion: {
    char: string
    allowSpaces: boolean
    startOfLine: boolean
    allowedPrefixes: null
    items: (query: string) => never[]
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
 * Triggers on "{" character to emit state for external picker UI.
 */
export const FieldPickerExtension = Extension.create<FieldPickerExtensionOptions>({
  name: 'field-picker',

  addOptions() {
    return {
      suggestion: {
        char: '{',
        allowSpaces: false,
        startOfLine: false,
        allowedPrefixes: null,
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

/**
 * Factory function to create a configured FieldPickerExtension.
 * Emits state changes via callback for external UI rendering.
 *
 * @param options - Configuration options including entityDefinitionId and onStateChange callback
 */
export function createFieldPickerExtension({
  onStateChange,
}: CreateFieldPickerExtensionOptions) {
  // Track current props for use in closeSuggestion
  let currentProps: SuggestionProps | null = null

  return FieldPickerExtension.configure({
    suggestion: {
      char: '{',
      allowSpaces: false,
      startOfLine: false,
      allowedPrefixes: null, // Allow trigger at any position, not just after space
      items: () => [], // Items handled externally by React component
      render: () => {
        return {
          onStart: (props: SuggestionProps) => {
            currentProps = props
            onStateChange({
              isOpen: true,
              query: props.query,
              range: props.range,
              clientRect: props.clientRect?.() ?? null,
            })
          },

          onUpdate: (props: SuggestionProps) => {
            currentProps = props
            onStateChange({
              isOpen: true,
              query: props.query,
              range: props.range,
              clientRect: props.clientRect?.() ?? null,
            })
          },

          onKeyDown: ({ event }: { event: KeyboardEvent }) => {
            // Let the external Command component handle keyboard navigation
            // Return false so the event propagates to our Popover/Command
            if (event.key === 'Escape') {
              onStateChange({
                isOpen: false,
                query: '',
                range: null,
                clientRect: null,
              })
              return true
            }
            return false
          },

          onExit: () => {
            currentProps = null
            onStateChange({
              isOpen: false,
              query: '',
              range: null,
              clientRect: null,
            })
          },
        }
      },
    },
  })
}
