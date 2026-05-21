// apps/web/src/components/workflow/share/share-gate.tsx
'use client'

import { usePassport } from '@auxx/ui/passport'
import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useWorkflowShare } from './hooks/use-workflow-share'
import { useWorkflowShareStore } from './workflow-share-provider'

interface ShareGateProps {
  children: ReactNode
}

/**
 * Gate component that handles loading site info and passport
 * before rendering children. Reads the active shareToken from the
 * surrounding {@link WorkflowShareProvider}.
 */
export function ShareGate({ children }: ShareGateProps) {
  const shareToken = useWorkflowShareStore((s) => s.shareToken)
  const setSiteInfo = useWorkflowShareStore((s) => s.setSiteInfo)
  const setLoading = useWorkflowShareStore((s) => s.setLoading)
  const setError = useWorkflowShareStore((s) => s.setError)
  const isLoadingSite = useWorkflowShareStore((s) => s.isLoadingSite)
  const siteInfo = useWorkflowShareStore((s) => s.siteInfo)
  const siteError = useWorkflowShareStore((s) => s.siteError)

  const { passport, isLoading: isLoadingPassport, error: passportError } = usePassport()

  const { fetchSiteInfo } = useWorkflowShare(shareToken ?? '')

  const siteLoadedRef = useRef(false)

  useEffect(() => {
    if (!shareToken) return
    siteLoadedRef.current = false
  }, [shareToken])

  useEffect(() => {
    if (!shareToken) return
    if (siteLoadedRef.current) return
    siteLoadedRef.current = true

    const loadSiteInfo = async () => {
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
  }, [shareToken, setLoading, setSiteInfo, setError, fetchSiteInfo])

  if (isLoadingSite || isLoadingPassport) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (siteError) {
    return (
      <div className='flex h-screen flex-col items-center justify-center gap-4'>
        <h1 className='text-2xl font-bold'>Workflow Not Found</h1>
        <p className='text-muted-foreground'>{siteError}</p>
      </div>
    )
  }

  if (passportError) {
    return (
      <div className='flex h-screen flex-col items-center justify-center gap-4'>
        <h1 className='text-2xl font-bold'>Access Denied</h1>
        <p className='text-muted-foreground'>{passportError}</p>
      </div>
    )
  }

  if (siteInfo && passport) {
    return <>{children}</>
  }

  return null
}
