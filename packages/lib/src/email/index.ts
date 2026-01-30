export { MessageService } from './message-service'
import { IntegrationProviderType } from '../providers/types'

export { IntegrationProviderType }

// Email storage: services, enums, and types
export {
  MessageStorageService,
  IntegrationType,
  MessageType,
  EmailLabel,
  IdentifierType,
  ParticipantRole,
  ThreadStatus,
} from './email-storage'
export type { MessageData, ParticipantInputData, EmailAttachment } from './email-storage'

export { getUserOrganizationId, requireAdminAccess } from './permissions'

export { LabelService } from './labels/label-service'

export { ReauthenticationRequiredError } from './errors-handlers'

export { EmailTemplateService } from './email-templates'

export { LabelRepo } from './labels/label-repo'
