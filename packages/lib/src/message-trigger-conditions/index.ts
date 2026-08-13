// packages/lib/src/message-trigger-conditions/index.ts

// Client-safe catalog (also importable as `@auxx/lib/message-trigger-conditions/client`)
export {
  getMessageConditionField,
  getMessageConditionFields,
  MESSAGE_CONDITION_FIELD_DEFINITIONS,
  type MessageConditionFieldDefinition,
} from './client'
// The evaluator — one message against a MESSAGE_RECEIVED trigger's condition groups
export { evaluateMessageConditions, type MessageConditionEvaluation } from './evaluate'
export type {
  MessageConditionInput,
  MessageConditionMessageParticipant,
  MessageConditionParticipant,
} from './types'
