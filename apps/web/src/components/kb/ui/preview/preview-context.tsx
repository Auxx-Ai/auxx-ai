// apps/web/src/components/kb/ui/preview/preview-context.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import React from 'react'
import type { PreviewMode } from '../../hooks/use-article-content'
import type { KnowledgeBase } from '../../store/knowledge-base-store'

export type Theme = 'light' | 'dark'
export type Device = 'desktop' | 'mobile'

interface PreviewContextValue {
  knowledgeBase?: KnowledgeBase
  isLoading: boolean
  /** What a fresh visitor sees on first load (from `kb.defaultMode`). */
  defaultMode: Theme
  /** Author's transient override; null when following `defaultMode`. */
  override: Theme | null
  /** Mode the preview is currently rendering: `override ?? defaultMode`. */
  effectiveMode: Theme
  isMobile: boolean
  /** Which slice of the article body the in-editor preview pane renders. */
  previewMode: PreviewMode
  setOverride: (t: Theme | null) => void
  setDevice: (d: Device) => void
  setPreviewMode: (m: PreviewMode) => void
}

const PreviewContext = React.createContext<PreviewContextValue | undefined>(undefined)

interface PreviewProviderProps {
  children: React.ReactNode
  knowledgeBase?: KnowledgeBase
}

export function PreviewProvider({ children, knowledgeBase }: PreviewProviderProps) {
  const [device, setDevice] = React.useState<Device>('desktop')
  const [override, setOverride] = React.useState<Theme | null>(null)
  const [previewMode, setPreviewMode] = React.useState<PreviewMode>('draft')
  const [isLoading, setIsLoading] = React.useState(!knowledgeBase)

  React.useEffect(() => {
    setIsLoading(!knowledgeBase)
  }, [knowledgeBase])

  // Merge pending draft on top of live columns so the preview iframe reflects
  // unpublished settings while the public site stays untouched.
  const merged = React.useMemo(
    () =>
      knowledgeBase
        ? (mergeDraftOverLive(knowledgeBase as Record<string, unknown>) as KnowledgeBase)
        : knowledgeBase,
    [knowledgeBase]
  )

  const defaultMode: Theme = merged?.defaultMode === 'dark' ? 'dark' : 'light'
  const kbId = merged?.id

  // Settings are the source of truth — reset the override whenever the active KB
  // changes or its default mode is edited so the new default propagates.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `kbId` is intentional — switching KBs must clear any author override even if both KBs share the same defaultMode.
  React.useEffect(() => {
    setOverride(null)
  }, [defaultMode, kbId])

  const effectiveMode: Theme = override ?? defaultMode

  const value = React.useMemo<PreviewContextValue>(
    () => ({
      knowledgeBase: merged,
      isLoading,
      defaultMode,
      override,
      effectiveMode,
      isMobile: device === 'mobile',
      previewMode,
      setOverride,
      setDevice,
      setPreviewMode,
    }),
    [merged, isLoading, defaultMode, override, effectiveMode, device, previewMode]
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function usePreview(): PreviewContextValue {
  const ctx = React.useContext(PreviewContext)
  if (!ctx) throw new Error('usePreview must be used within a <PreviewProvider />')
  return ctx
}
