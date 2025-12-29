// packages/lib/src/import/resolution/resolver-registry.ts

import type { ResolvedValue, ResolutionConfig, ResolutionType } from '../types/resolution'

import { resolveTextValue, resolveTextCuid } from './resolvers/text'
import { resolveInteger, resolveDecimal } from './resolvers/number'
import {
  resolveDateIso,
  resolveDateCustom,
  resolveDatetimeIso,
  resolveDatetimeCustom,
} from './resolvers/date'
import { resolveBoolean } from './resolvers/boolean'
import { resolveEmail } from './resolvers/email'
import { resolvePhone } from './resolvers/phone'
import { resolveSelectValue, resolveSelectCreate } from './resolvers/select'
import { resolveMultiselectSplit } from './resolvers/multiselect'
import { resolveDomain } from './resolvers/domain'
import { resolveArraySplit } from './resolvers/array'
import { resolveRelationId, resolveRelationMatch, resolveRelationCreate } from './resolvers/relation'

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
