import { Mailbox } from '../../_components/mail-box'

type Props = { params: Promise<{ threadId: string }> }

type ContextType = 'sent'

export default async function SentPage({ params }: Props) {
  const { threadId } = await params
  const contextType: ContextType = 'sent'

  return <Mailbox key='sent' contextType={contextType} />
}
