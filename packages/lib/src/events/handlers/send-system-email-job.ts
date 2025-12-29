import { type MembershipCreatedEvent } from '../types'

export const sendSystemEmail = async ({ data: event }: { data: MembershipCreatedEvent }) => {
  // TODO: This job handler is not currently in use. If needed in future, use sendSystemEmail from '@auxx/email'
  console.log('sendSystemEmail', event)
}
