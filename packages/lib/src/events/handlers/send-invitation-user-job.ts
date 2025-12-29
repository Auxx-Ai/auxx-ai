import { type MembershipCreatedEvent } from '../types'

export const sendInvitationUserJob = async ({ data: event }: { data: MembershipCreatedEvent }) => {
  // TODO: This job handler is not currently in use. If needed in future, use the new mailer functions from '@auxx/email'
  console.log('sendInvitationUserJob', event)
}
