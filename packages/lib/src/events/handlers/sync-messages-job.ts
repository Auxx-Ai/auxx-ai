import type { MembershipCreatedEvent } from '../types'

export const syncMessagesJob = async ({ data: event }: { data: MembershipCreatedEvent }) => {
  // TODO: This job handler is not currently in use. If needed in future, use the new mailer functions from '@auxx/email'
  console.log('sendSystemEmail', event)
}
