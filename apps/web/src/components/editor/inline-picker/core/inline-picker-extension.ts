// apps/web/src/components/editor/inline-picker/core/inline-picker-extension.ts

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import type { InlinePickerExtensionConfig, InlinePickerState } from '../types'

/** Initial state when picker is closed */
const closedState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * Creates a TipTap extension that triggers a picker UI on a specific character.
 * The extension emits state changes via callback, allowing React to handle the UI.
 *
 * @param config - Extension configuration
 * @returns Configured TipTap extension
 */
export function createInlinePickerExtension(config: InlinePickerExtensionConfig) {
  const { type, trigger, allowSpaces = false, onStateChange } = config
  const pluginKey = new PluginKey(`${type}-suggestion`)

  return Extension.create({
    name: `${type}-picker`,

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: trigger,
          allowSpaces,
          startOfLine: false,
          allowedPrefixes: null,
          pluginKey,
          // Items are handled externally - return empty array
          items: () => [],
          render: () => ({
            onStart: (props) => {
              onStateChange({
                isOpen: true,
                query: props.query,
                range: props.range,
                clientRect: props.clientRect?.() ?? null,
              })
            },
            onUpdate: (props) => {
              onStateChange({
                isOpen: true,
                query: props.query,
                range: props.range,
                clientRect: props.clientRect?.() ?? null,
              })
            },
            onKeyDown: ({ event }) => {
              // Handle Escape to close picker
              if (event.key === 'Escape') {
                onStateChange(closedState)
                return true
              }
              // Let parent handle other keys (arrows, enter)
              return false
            },
            onExit: () => {
              onStateChange(closedState)
            },
          }),
        }),
      ]
    },
  })
}
