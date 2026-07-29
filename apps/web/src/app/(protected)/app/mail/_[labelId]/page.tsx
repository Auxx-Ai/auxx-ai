import { api } from '~/trpc/server'
import { Mailbox } from '../_components/mail'

// import { api } from '~/trpc/ser'

type Props = { params: Promise<{ labelId: string }> }

export default async function MailPage({ params }: Props) {
  const { labelId } = await params
  console.log(labelId)

  // `label.all` was renamed to `label.list`. NOTE: `list` is scoped to channels
  // the caller may MANAGE — a settings-surface scope. Reviving this sidebar needs
  // a mail-lens scope instead ("channels whose inbox I can view", plan D2).
  const labels = await api.label.list()
  // const labels = []
  return <Mailbox labelId={labelId} labels={labels} />
}
