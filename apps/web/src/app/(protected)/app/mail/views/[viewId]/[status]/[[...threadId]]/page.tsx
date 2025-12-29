import React from 'react'
import { Mailbox } from '../../../../_components/mail-box'

type ContextType = 'view'

interface PageProps {
  params: Promise<{ viewId: string; status: string; threadId: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function ViewStatusPage({ params }: PageProps) {
  const { viewId, status } = await params

  const contextType: ContextType = 'view' // Hardcoded based on route

  return (
    <Mailbox
      key={`view-${viewId}-${status}`}
      contextType={contextType}
      contextId={viewId} // Pass viewId as contextId
      initialStatusSlug={status} // Pass status slug to potentially refine view
    />
  )
}
