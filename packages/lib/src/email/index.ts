export { MessageService } from './message-service'

import { IntegrationProviderType } from '../providers/types'

export { IntegrationProviderType }

export type { EmailAttachment, MessageData, ParticipantInputData } from './email-storage'
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
export { LabelRepo } from './labels/label-repo'
export { LabelService } from './labels/label-service'
export { getUserOrganizationId, requireAdminAccess } from './permissions'
