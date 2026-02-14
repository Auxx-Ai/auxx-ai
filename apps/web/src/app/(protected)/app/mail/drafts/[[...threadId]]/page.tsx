import { Mailbox } from '../../_components/mail-box'

type ContextType = 'drafts'
// type Props = { params: Promise<{ threadId?: string[] }> }

// No params needed for this page
export default async function DraftsPage() {
  // const { threadId } = await params

  const contextType: ContextType = 'drafts'

  return (
    <Mailbox
      key='drafts'
      contextType={contextType}
      // statusSlug is implicitly 'all' for drafts view
    />
  )
}
