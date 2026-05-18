// apps/web/src/components/kopilot/options/kopilot-chat-provider.tsx

'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { KopilotChatOptions } from './types'

const KopilotChatOptionsContext = createContext<KopilotChatOptions | null>(null)

const DEFAULTS: Required<
  Pick<
    KopilotChatOptions,
    | 'allowModelPicker'
    | 'allowSenderPicker'
    | 'allowSlashCommands'
    | 'allowReferencePicker'
    | 'showSessionPicker'
    | 'showNewChatButton'
    | 'hideSuggestions'
  >
> = {
  allowModelPicker: true,
  allowSenderPicker: true,
  allowSlashCommands: true,
  allowReferencePicker: true,
  showSessionPicker: true,
  showNewChatButton: true,
  hideSuggestions: false,
}

interface KopilotChatProviderProps {
  children: ReactNode
  options: KopilotChatOptions
}

export function KopilotChatProvider({ children, options }: KopilotChatProviderProps) {
  const {
    placeholder,
    allowModelPicker,
    allowSenderPicker,
    allowSlashCommands,
    allowReferencePicker,
    renderEmptyState,
    showSessionPicker,
    showNewChatButton,
    hideSuggestions,
    emptyStateDescription,
  } = options
  // Each field listed explicitly so callers don't need to memoize the options
  // object they pass in.
  const merged = useMemo<KopilotChatOptions>(
    () => ({
      ...DEFAULTS,
      placeholder,
      ...(allowModelPicker !== undefined && { allowModelPicker }),
      ...(allowSenderPicker !== undefined && { allowSenderPicker }),
      ...(allowSlashCommands !== undefined && { allowSlashCommands }),
      ...(allowReferencePicker !== undefined && { allowReferencePicker }),
      renderEmptyState,
      ...(showSessionPicker !== undefined && { showSessionPicker }),
      ...(showNewChatButton !== undefined && { showNewChatButton }),
      ...(hideSuggestions !== undefined && { hideSuggestions }),
      emptyStateDescription,
    }),
    [
      placeholder,
      allowModelPicker,
      allowSenderPicker,
      allowSlashCommands,
      allowReferencePicker,
      renderEmptyState,
      showSessionPicker,
      showNewChatButton,
      hideSuggestions,
      emptyStateDescription,
    ]
  )
  return (
    <KopilotChatOptionsContext.Provider value={merged}>
      {children}
    </KopilotChatOptionsContext.Provider>
  )
}

type ResolvedKopilotChatOptions = Required<
  Omit<KopilotChatOptions, 'placeholder' | 'renderEmptyState' | 'emptyStateDescription'>
> &
  Pick<KopilotChatOptions, 'placeholder' | 'renderEmptyState' | 'emptyStateDescription'>

/**
 * Read the merged `KopilotChatOptions` for the surrounding chat embed. Callable
 * without a provider — every existing caller of `<KopilotChat>` continues to
 * work and receives `DEFAULTS`.
 */
export function useKopilotChatOptions(): ResolvedKopilotChatOptions {
  const ctx = useContext(KopilotChatOptionsContext)
  return ctx ? { ...DEFAULTS, ...ctx } : { ...DEFAULTS }
}
