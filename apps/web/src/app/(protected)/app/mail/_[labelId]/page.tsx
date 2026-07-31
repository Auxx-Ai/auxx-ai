// apps/web/src/app/(protected)/app/mail/_[labelId]/page.tsx

import { Mailbox } from '../_components/mail-box'

type Props = { params: Promise<{ labelId: string }> }

/**
 * Parked label mailbox. The folder is underscore-prefixed, so Next never routes
 * here — `tags/[tagId]/[status]` is the live successor and renders the same
 * `Mailbox` with `contextType='tag'`.
 *
 * The label SIDEBAR this page was written for is still parked: `label.all` was
 * renamed to `label.list`, and `list` is scoped to channels the caller may
 * MANAGE — a settings-surface scope. Reviving it needs a mail-lens scope
 * instead ("channels whose inbox I can view", plan D2). `Mailbox` has taken no
 * `labels` prop since it moved to `_components/mail-box`, so the pre-fetch is
 * gone until that scope exists.
 */
export default async function MailPage({ params }: Props) {
  const { labelId } = await params

  return <Mailbox key={`label-${labelId}`} contextType='tag' contextId={labelId} />
}
