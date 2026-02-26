// packages/credentials/src/config/index.ts
// Barrel export for the config variable system

export { ConfigCache } from './config-cache'
export {
  CONFIG_GROUP_META,
  CONFIG_VARIABLES,
  type ConfigKey,
  getAllConfigDefinitions,
  getConfigDefinition,
  getConfigDefinitionsByGroup,
} from './config-registry'
export { ConfigService } from './config-service'
export { ConfigStorage } from './config-storage'
export { convertEnvValue, valueToString } from './config-value-converter'
export type {
  ConfigVariableDefinition,
  ConfigVariableGroupData,
  ResolvedConfigVariable,
} from './types'

import { ConfigService } from './config-service'

/** Singleton config service instance */
export const configService = new ConfigService()
