// apps/web/src/components/workflow/share/share-gate.tsx
'use client'

import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useWorkflowPassport } from './hooks/use-workflow-passport'
import { useWorkflowShare } from './hooks/use-workflow-share'
import { useWorkflowShareStore } from './workflow-share-provider'

/**
 * Props for ShareGate component
 */
interface ShareGateProps {
  shareToken: string
  children: ReactNode
}

/**
 * Gate component that handles loading site info and passport
 * before rendering children
 */
export function ShareGate({ shareToken, children }: ShareGateProps) {
  const setShareToken = useWorkflowShareStore((s) => s.setShareToken)
  const setSiteInfo = useWorkflowShareStore((s) => s.setSiteInfo)
  const setLoading = useWorkflowShareStore((s) => s.setLoading)
  const setError = useWorkflowShareStore((s) => s.setError)

  const isLoadingSite = useWorkflowShareStore((s) => s.isLoadingSite)
  const isLoadingPassport = useWorkflowShareStore((s) => s.isLoadingPassport)
  const siteInfo = useWorkflowShareStore((s) => s.siteInfo)
  const passport = useWorkflowShareStore((s) => s.passport)
  const siteError = useWorkflowShareStore((s) => s.siteError)
  const passportError = useWorkflowShareStore((s) => s.passportError)

  const { fetchSiteInfo } = useWorkflowShare(shareToken)
  const { initializePassport } = useWorkflowPassport(shareToken)

  // Track initialization to prevent duplicate calls
  const initRef = useRef({ siteLoaded: false, passportLoaded: false })

  // Load site info on mount (only once per shareToken)
  useEffect(() => {
    // Reset init state when shareToken changes
    initRef.current = { siteLoaded: false, passportLoaded: false }
    setShareToken(shareToken)

    const loadSiteInfo = async () => {
      if (initRef.current.siteLoaded) return
      initRef.current.siteLoaded = true

      setLoading('site', true)
      try {
        const info = await fetchSiteInfo()
        setSiteInfo(info)
      } catch (err) {
        setError('site', (err as Error).message)
      } finally {
        setLoading('site', false)
      }
    }

    loadSiteInfo()
  }, [shareToken, setShareToken, setLoading, setSiteInfo, setError, fetchSiteInfo])

  // Load passport after site info is loaded (only once)
  useEffect(() => {
    if (!siteInfo) return
    if (initRef.current.passportLoaded) return
    initRef.current.passportLoaded = true

    initializePassport()
  }, [siteInfo, initializePassport])

  // Loading state
  if (isLoadingSite || isLoadingPassport) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    )
  }

  // Site error state
  if (siteError) {
    return (
      <div className='flex h-screen flex-col items-center justify-center gap-4'>
        <h1 className='text-2xl font-bold'>Workflow Not Found</h1>
        <p className='text-muted-foreground'>{siteError}</p>
      </div>
    )
  }

  // Passport error state
  if (passportError) {
    return (
      <div className='flex h-screen flex-col items-center justify-center gap-4'>
        <h1 className='text-2xl font-bold'>Access Denied</h1>
        <p className='text-muted-foreground'>{passportError}</p>
      </div>
    )
  }

  // Ready - render children
  if (siteInfo && passport) {
    return <>{children}</>
  }

  return null
}
