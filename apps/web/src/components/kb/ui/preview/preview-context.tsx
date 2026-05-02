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

const COOKIE_PREFIX = 'kb-mode-'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function PreviewProvider({ children, knowledgeBase }: PreviewProviderProps) {
  const [device, setDevice] = React.useState<Device>('desktop')
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

  // Initialize from the live cookie so admins see the same mode they last picked
  // (preview and live share the `kb-mode-<id>` cookie). Falls back to the KB's
  // default when no cookie is set.
  const [override, setOverrideState] = React.useState<Theme | null>(() => readModeCookie(kbId))

  // Re-sync the override when the active KB changes (cookies are scoped per id).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `kbId` is intentional — switching KBs must re-read the cookie under the new id.
  React.useEffect(() => {
    setOverrideState(readModeCookie(kbId))
  }, [kbId])

  const setOverride = React.useCallback(
    (next: Theme | null) => {
      setOverrideState(next)
      if (!kbId) return
      if (next === null) {
        document.cookie = `${COOKIE_PREFIX}${kbId}=; path=/; max-age=0; SameSite=Lax`
      } else {
        document.cookie = `${COOKIE_PREFIX}${kbId}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
      }
    },
    [kbId]
  )

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
    [merged, isLoading, defaultMode, override, effectiveMode, device, previewMode, setOverride]
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

function readModeCookie(kbId: string | undefined): Theme | null {
  if (!kbId || typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_PREFIX}${escapeRegex(kbId)}=([^;]+)`)
  )
  if (!match) return null
  return match[1] === 'dark' ? 'dark' : match[1] === 'light' ? 'light' : null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function usePreview(): PreviewContextValue {
  const ctx = React.useContext(PreviewContext)
  if (!ctx) throw new Error('usePreview must be used within a <PreviewProvider />')
  return ctx
}
