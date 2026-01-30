// apps/web/src/components/workflow/nodes/shared/node-inputs/index.ts

// Export base components
export { BaseNodeInput, createNodeInput } from './base-node-input'
export type { NodeInputProps } from './base-node-input'

// Export input components
export { StringInput } from './string-input'
export { BooleanInput } from './boolean-input'
export { NumberInput } from './number-input'
export { EnumInput } from './enum-input'
export { DateTimeInput } from './datetime-input'
export { FileInput } from './file-input'
export { RelationInput } from './relation-input'
export { ThreadInput, transformThreadToWorkflowInput } from './thread-input'
export { CurrencyInput } from './currency-input'
export { AddressInput } from './address-input'
export { TagsInput } from './tags-input'
export { PhoneInput } from './phone-input'

// Export complex input components
export { ParticipantInput } from './participant-input'
// export { ContactInput } from './contact-input' // TODO: Implement
// export { OrderInput } from './order-input' // TODO: Implement
export { ArrayInput } from './array-input'
export { ObjectInput } from './object-input'

// Export trigger inputs
export { WebhookTriggerInput } from '../webhook-trigger-input'
export { ScheduledTriggerInput } from '../scheduled-trigger-input'
