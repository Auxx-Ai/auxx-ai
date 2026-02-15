// apps/web/src/components/workflow/nodes/shared/node-inputs/index.ts

export { ScheduledTriggerInput } from '../scheduled-trigger-input'
// Export trigger inputs
export { WebhookTriggerInput } from '../webhook-trigger-input'
export { AddressInput } from './address-input'
// export { ContactInput } from './contact-input' // TODO: Implement
// export { OrderInput } from './order-input' // TODO: Implement
export { ArrayInput } from './array-input'
export type { NodeInputProps } from './base-node-input'
// Export base components
export { BaseNodeInput, createNodeInput } from './base-node-input'
export { BooleanInput } from './boolean-input'
export { CurrencyInput } from './currency-input'
export { DateTimeInput } from './datetime-input'
export { EnumInput } from './enum-input'
export { FileInput } from './file-input'
export { MultiSelectInput } from './multi-select-input'
export { NumberInput } from './number-input'
export { ObjectInput } from './object-input'
// Export complex input components
export { ParticipantInput } from './participant-input'
export { PhoneInput } from './phone-input'
export { RelationInput } from './relation-input'
// Export input components
export { StringInput } from './string-input'
export { TagsInput } from './tags-input'
export { ThreadInput, transformThreadToWorkflowInput } from './thread-input'
