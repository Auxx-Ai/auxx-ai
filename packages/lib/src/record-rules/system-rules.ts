// packages/lib/src/record-rules/system-rules.ts
// Server-declared system rules: RecordRule-shaped declarations (all-native actions)
// unioned into the org rule cache at compute time. NOT DB rows — no dual-write, no
// migration. Each declaration is resolved per-org to a concrete field row id (field
// rules) / entity def id (lifecycle rules) via the customFields / entityDefs caches;
// orgs missing the field or def drop the rule. See B2 plan §7c / D11.

import type { ConditionGroup } from '../conditions/types'
import type { CachedRecordRule, RecordRuleAction, RecordRuleOn } from './types'

/** A code-registered system-rule declaration (not tied to any org). */
export interface SystemRuleDeclaration {
  /** Stable key — becomes the cached rule id (`system:<key>`). Must be unique. */
  key: string
  name: string
  /** Entity definition slug (apiSlug / entityType) this rule targets. */
  defSlug: string
  /**
   * Field rules reference the field by systemAttribute (resolved within `defSlug`).
   * Omit for lifecycle rules (`on: created|deleted`).
   */
  fieldRef?: { systemAttribute: string }
  on: RecordRuleOn
  condition?: ConditionGroup[]
  /** Ordered actions — ALL native (server-declared). */
  actions: RecordRuleAction[]
}

const declarations: SystemRuleDeclaration[] = []

/** Validate that a declaration is all-native and lifecycle/field-shaped correctly. */
function assertSystemRuleShape(decl: SystemRuleDeclaration): void {
  if (!Array.isArray(decl.actions) || decl.actions.length === 0) {
    throw new Error(`System rule '${decl.key}' needs at least one action`)
  }
  if (!decl.actions.every((a) => a.type === 'native')) {
    throw new Error(`System rule '${decl.key}' must declare only native actions`)
  }
  const isLifecycle = decl.on === 'created' || decl.on === 'deleted'
  if (isLifecycle && decl.fieldRef) {
    throw new Error(`Lifecycle system rule '${decl.key}' must not declare a fieldRef`)
  }
  if (!isLifecycle && !decl.fieldRef) {
    throw new Error(`Field system rule '${decl.key}' requires a fieldRef`)
  }
}

/**
 * Register system-rule declarations. Idempotent per key — re-declaring a key replaces
 * the prior declaration (safe under HMR / repeated module init).
 */
export function declareSystemRules(decls: SystemRuleDeclaration[]): void {
  for (const decl of decls) {
    assertSystemRuleShape(decl)
    const existing = declarations.findIndex((d) => d.key === decl.key)
    if (existing >= 0) declarations[existing] = decl
    else declarations.push(decl)
  }
}

/** All registered declarations (read-only). */
export function getSystemRuleDeclarations(): readonly SystemRuleDeclaration[] {
  return declarations
}

/** Test-only: clear the declaration registry. */
export function __clearSystemRules(): void {
  declarations.length = 0
}

/** Lookup surface the resolver needs — supplied by the cache provider per org. */
export interface SystemRuleLookup {
  /** Resolve an entity def slug to its id for this org; `undefined` when absent. */
  defIdBySlug: (slug: string) => string | undefined
  /** Resolve a systemAttribute to its CustomField row id within a def; `undefined` when absent. */
  fieldIdBySystemAttribute: (defId: string, systemAttribute: string) => string | undefined
}

/**
 * Resolve declarations to concrete cached rules for one org. Pure — the cache provider
 * builds `lookup` from the org's cached custom fields / entity defs. Declarations whose
 * def or field the org lacks are dropped.
 */
export function resolveSystemRules(
  organizationId: string,
  decls: readonly SystemRuleDeclaration[],
  lookup: SystemRuleLookup
): CachedRecordRule[] {
  const resolved: CachedRecordRule[] = []
  for (const decl of decls) {
    const entityDefinitionId = lookup.defIdBySlug(decl.defSlug)
    if (!entityDefinitionId) continue // org lacks the def → drop

    let fieldId: string | null = null
    if (decl.fieldRef) {
      const fid = lookup.fieldIdBySystemAttribute(entityDefinitionId, decl.fieldRef.systemAttribute)
      if (!fid) continue // org lacks the field → drop
      fieldId = fid
    }

    resolved.push({
      id: `system:${decl.key}`,
      organizationId,
      entityDefinitionId,
      fieldId,
      name: decl.name,
      on: decl.on,
      condition: decl.condition ?? [],
      actions: decl.actions,
      enabled: true,
      isSystem: true,
    })
  }
  return resolved
}
