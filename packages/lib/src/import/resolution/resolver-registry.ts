// packages/lib/src/import/resolution/resolver-registry.ts

import type { ResolutionConfig, ResolutionType, ResolvedValue } from '../types/resolution'
import { resolveArraySplit } from './resolvers/array'
import { resolveBoolean } from './resolvers/boolean'
import {
  resolveDateCustom,
  resolveDateIso,
  resolveDatetimeCustom,
  resolveDatetimeIso,
} from './resolvers/date'
import { resolveDomain } from './resolvers/domain'
import { resolveEmail } from './resolvers/email'
import { resolveMultiselectSplit } from './resolvers/multiselect'
import { resolveDecimal, resolveInteger } from './resolvers/number'
import { resolvePhone } from './resolvers/phone'
import {
  resolveRelationCreate,
  resolveRelationId,
  resolveRelationMatch,
} from './resolvers/relation'
import { resolveSelectCreate, resolveSelectValue } from './resolvers/select'
import { resolveTextCuid, resolveTextValue } from './resolvers/text'

/** Resolver function type */
type ResolverFn = (rawValue: string, config: ResolutionConfig) => ResolvedValue

/** Registry mapping resolution types to resolver functions */
const RESOLVER_REGISTRY: Record<ResolutionType, ResolverFn> = {
  'text:value': resolveTextValue,
  'text:cuid': resolveTextCuid,
  'number:integer': resolveInteger,
  'number:decimal': resolveDecimal,
  'date:iso': resolveDateIso,
  'date:custom': resolveDateCustom,
  'datetime:iso': resolveDatetimeIso,
  'datetime:custom': resolveDatetimeCustom,
  'boolean:truthy': resolveBoolean,
  'email:value': resolveEmail,
  'phone:value': resolvePhone,
  'select:value': resolveSelectValue,
  'select:create': resolveSelectCreate,
  'multiselect:split': resolveMultiselectSplit,
  'relation:id': resolveRelationId,
  'relation:match': resolveRelationMatch,
  'relation:create': resolveRelationCreate,
  'domain:value': resolveDomain,
  'array:split': resolveArraySplit,
}

/**
 * Get the resolver function for a resolution type.
 */
export function getResolver(resolutionType: ResolutionType): ResolverFn | undefined {
  return RESOLVER_REGISTRY[resolutionType]
}

/**
 * Check if a resolution type is valid.
 */
export function isValidResolutionType(type: string): type is ResolutionType {
  return type in RESOLVER_REGISTRY
}

/**
 * Get all available resolution types.
 */
export function getAvailableResolutionTypes(): ResolutionType[] {
  return Object.keys(RESOLVER_REGISTRY) as ResolutionType[]
}
