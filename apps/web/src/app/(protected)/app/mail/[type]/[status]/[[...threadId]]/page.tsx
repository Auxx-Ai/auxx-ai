import { Mailbox } from '../../../_components/mail-box'

// Define expected context type string matching backend router input enum keys
type ContextType = 'personal_assigned' | 'personal_inbox'

interface PageProps {
  params: Promise<{
    type: string
    status: string // From URL segment, e.g., "open", "done"
  }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function InboxOrAssignedPage({ params, searchParams }: PageProps) {
  const { type, status } = await params
  const query = await searchParams

  // await new Promise((resolve) => setTimeout(resolve, 2000))

  const contextType: ContextType = type == 'inbox' ? 'personal_inbox' : 'personal_assigned' // Hardcoded based on route
  const key = type == 'inbox' ? `personal-inbox-${status}` : `assigned-${status}`

  return (
    <Mailbox
      // Key ensures component remounts if status changes significantly
      key={key}
      contextType={contextType}
      initialStatusSlug={status} // Pass the raw slug
      // initialSearchQuery={searchParams?.q as string} // Example: handle search query
    />
  )
}
