// import { Mailbox } from '~/components/mail/mail-box'

import { Mailbox } from '../../../_components/mail-box'

type ContextType = 'tag'

interface PageProps {
  params: Promise<{ tagId: string; status: string; threadId: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function TagStatusPage({ params, searchParams }: PageProps) {
  const { tagId, status, threadId } = await params
  const query = await searchParams

  const contextType: ContextType = 'tag' // Hardcoded based on route

  return (
    <Mailbox
      key={`tag-${tagId}-${status}`}
      contextType={contextType}
      contextId={tagId} // Pass tagId as contextId
      initialStatusSlug={status}
    />
  )
}
