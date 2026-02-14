// packages/lib/src/resources/resource-id.ts

export type { RecordId } from '@auxx/types/resource'
// Re-export all resource utilities from @auxx/types/resource
export {
  getDefinitionId,
  getInstanceId,
  getModelType,
  isRecordId,
  isSystemModelType,
  parseRecordId,
  toRecordId,
  toRecordIds,
} from '@auxx/types/resource'
