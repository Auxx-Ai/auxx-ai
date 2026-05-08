// apps/web/src/components/kb/ui/preview/preview-hint-context.tsx
'use client'

import * as React from 'react'

interface KBPreviewHintContextValue {
  isVisible: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
  hide: () => void
}

const KBPreviewHintContext = React.createContext<KBPreviewHintContextValue | undefined>(undefined)

const STORAGE_KEY = 'kb-preview-edit-hint-shown-count'
const MAX_SHOWS = 3
const AUTO_DISMISS_MS = 4000
// A "qualifying" show — visible long enough to be read. Below this, we treat
// the hover as a flyover and don't burn a counter.
const CONSUME_AFTER_MS = 1500

function readShownCount(): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function writeShownCount(count: number) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, String(count))
}

interface KBPreviewHintProviderProps {
  children: React.ReactNode
}

export function KBPreviewHintProvider({ children }: KBPreviewHintProviderProps) {
  const [isVisible, setIsVisible] = React.useState(false)
  // Locked-out for the rest of the session once the user has seen the hint
  // enough times or proven they know about Articles. Starts pessimistic — we
  // re-check localStorage on mount to avoid SSR mismatch.
  const [locked, setLocked] = React.useState(true)
  const shownCountRef = React.useRef(0)
  const visibleSinceRef = React.useRef<number | null>(null)
  const autoDismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    shownCountRef.current = readShownCount()
    setLocked(shownCountRef.current >= MAX_SHOWS)
  }, [])

  const clearAutoDismiss = React.useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
  }, [])

  const consumeIfQualifying = React.useCallback(() => {
    const since = visibleSinceRef.current
    visibleSinceRef.current = null
    if (since === null) return
    const elapsed = Date.now() - since
    if (elapsed < CONSUME_AFTER_MS) return
    const next = shownCountRef.current + 1
    shownCountRef.current = next
    writeShownCount(next)
    if (next >= MAX_SHOWS) setLocked(true)
  }, [])

  const hide = React.useCallback(() => {
    clearAutoDismiss()
    setIsVisible((wasVisible) => {
      if (wasVisible) consumeIfQualifying()
      return false
    })
  }, [clearAutoDismiss, consumeIfQualifying])

  const onPointerEnter = React.useCallback(() => {
    if (locked) return
    setIsVisible(true)
    visibleSinceRef.current = Date.now()
    clearAutoDismiss()
    autoDismissTimerRef.current = setTimeout(() => {
      consumeIfQualifying()
      setIsVisible(false)
    }, AUTO_DISMISS_MS)
  }, [locked, clearAutoDismiss, consumeIfQualifying])

  const onPointerLeave = React.useCallback(() => {
    hide()
  }, [hide])

  // Lock for good once the user clicks Articles (or when mount happens already
  // on Articles): the dismiss path runs through hide() so any in-flight show
  // is consumed correctly.
  const lockSession = React.useCallback(() => {
    hide()
    setLocked(true)
  }, [hide])

  React.useEffect(() => {
    return () => {
      clearAutoDismiss()
    }
  }, [clearAutoDismiss])

  const value = React.useMemo<KBPreviewHintContextValue & { lockSession: () => void }>(
    () => ({ isVisible, onPointerEnter, onPointerLeave, hide, lockSession }),
    [isVisible, onPointerEnter, onPointerLeave, hide, lockSession]
  )

  return <KBPreviewHintContext.Provider value={value}>{children}</KBPreviewHintContext.Provider>
}

export function useKBPreviewHint(): KBPreviewHintContextValue & { lockSession: () => void } {
  const ctx = React.useContext(KBPreviewHintContext) as
    | (KBPreviewHintContextValue & { lockSession: () => void })
    | undefined
  if (!ctx) {
    // Outside the provider (e.g. used somewhere unexpected) — degrade to no-op
    // rather than throw, so a missing wrapper doesn't crash the editor.
    return {
      isVisible: false,
      onPointerEnter: () => {},
      onPointerLeave: () => {},
      hide: () => {},
      lockSession: () => {},
    }
  }
  return ctx
}
