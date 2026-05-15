// apps/web/src/components/kopilot/options/types.ts

import type { ReactNode } from 'react'

/**
 * UI knobs for a `<KopilotChat>` embed. Carried via `<KopilotChatProvider>` and
 * read with `useKopilotChatOptions()`. Parallel to React form providers — this
 * varies how the chat renders, NOT what data it carries. Data lives on the
 * existing `<KopilotContext>` slice contributor.
 */
export interface KopilotChatOptions {
  /**
   * Composer placeholder. Defaults to 'Ask Kopilot…'. Computed lazily so callers
   * can inject `{{agent.name}}` etc.
   */
  placeholder?: string

  /** Show the model picker in the composer toolbar. Default: true. */
  allowModelPicker?: boolean

  /**
   * Allow the `/` slash-command picker (prompt templates) in the composer.
   * Default: true.
   */
  allowSlashCommands?: boolean

  /**
   * Allow `@`-mention picker (reference picker) in the composer.
   * Default: true. Builder leaves this on — admins still want to reference
   * threads / contacts while building.
   */
  allowReferencePicker?: boolean

  /**
   * Render override for the empty state. Receives the same props the default
   * `KopilotEmptyState` does. Return `null` to suppress the empty state
   * entirely.
   */
  renderEmptyState?: (props: {
    onSuggestionClick?: (text: string, autoSubmit: boolean) => void
  }) => ReactNode

  /** Show the session-history dropdown above the chat. Default: true. */
  showSessionPicker?: boolean

  /** Show the "New chat" button in the chat header. Default: true. */
  showNewChatButton?: boolean

  /** Hide the suggestion chips in the empty state. Default: false. */
  hideSuggestions?: boolean

  /**
   * Custom description rendered below the Kopilot label in the empty state.
   * Replaces the default "Ask about tickets…" line. The default has
   * `max-w-[200px]`; use `data-slot="description"` in CSS to override width
   * when the description is longer.
   */
  emptyStateDescription?: ReactNode
}
