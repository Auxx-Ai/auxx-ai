export { MessageService } from './message-service'

import { ChannelProviderType } from '../providers/types'

export { ChannelProviderType }

export type { MessageData, ParticipantInputData } from './email-storage'
// Email storage: services, enums, and types
export {
  EmailLabel,
  IdentifierType,
  MessageStorageService,
  MessageType,
  ParticipantRole,
  ThreadStatus,
} from './email-storage'
export { EmailTemplateService } from './email-templates'
export { ReauthenticationRequiredError } from './errors-handlers'
export * from './inbound'
// Labels live behind their own subpath, `@auxx/lib/email/labels` — see
// `labels/index.ts`. `FolderDiscoveryService`, `LabelRepo` and `LabelService`
// were re-exported here and are gone.
export { getUserOrganizationId } from './permissions'
