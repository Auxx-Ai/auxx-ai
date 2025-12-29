import { InboxStatus } from '@auxx/database/enums'
import type {
  Inbox,
  InboxIntegration,
  InboxMemberAccess,
  InboxGroupAccess,
} from '@auxx/database/types'
export type BaseIntegration = {
  provider: string
  email?: string
  name?: string
}
type InboxWithIntegrations = InboxIntegration & {
  integration: BaseIntegration
}
export type InboxWithRelations = Inbox & {
  integrations: InboxWithIntegrations[]
  memberAccess: InboxMemberAccess[]
  groupAccess: InboxGroupAccess[]
}
export type CreateInboxInput = {
  name: string
  description?: string
  color?: string
  status?: InboxStatus
  settings?: Record<string, any>
  allowAllMembers?: boolean
  enableMemberAccess?: boolean
  enableGroupAccess?: boolean
}
export type UpdateInboxInput = Partial<{
  name: string
  description: string
  color: string
  status: InboxStatus
  settings: Record<string, any>
}>
export type InboxAccessInput = {
  allowAllMembers?: boolean
  memberIds?: string[]
  groupIds?: string[]
}
