// packages/lib/src/resources/aggregate/group-labels.ts
//
// Post-query, batched label resolution for group keys. Keys stay RAW in the
// result (drill-down rebuilds segment conditions from them); labels are
// display-only. `null` keys label as '(empty)'.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedAgents, getCachedGroups, getCachedMembers } from '../../cache'
import { getFieldOptions } from '../registry/option-helpers'
import { formatBucketLabel } from './date-buckets'
import type { ResolvedGroupBy } from './types'

export const EMPTY_LABEL = '(empty)'

/**
 * Resolve display labels for a group-by's raw keys. One batch per lookup kind:
 * option ids resolve from the field's own options, related-entity ids via one
 * EntityInstance IN-query (by id + org — the targets may span defs), actor ids
 * via cached members/agents/groups, date buckets via the shared formatter.
 */
export async function resolveGroupLabels(params: {
  db: Database
  organizationId: string
  groupBy: ResolvedGroupBy
  keys: Array<string | null>
}): Promise<Map<string | null, string>> {
  const { db, organizationId, groupBy, keys } = params
  const labels = new Map<string | null, string>()
  labels.set(null, EMPTY_LABEL)

  const realKeys = [...new Set(keys.filter((k): k is string => k !== null))]
  if (realKeys.length === 0) return labels

  if (groupBy.dateGranularity) {
    for (const key of realKeys) {
      labels.set(key, formatBucketLabel(key, groupBy.dateGranularity))
    }
    return labels
  }

  const { fieldType, field } = groupBy.field

  if (fieldType === 'SINGLE_SELECT' || fieldType === 'MULTI_SELECT' || fieldType === 'TAGS') {
    const options = getFieldOptions(field)
    const byId = new Map<string, string>()
    for (const opt of options) {
      if (opt.id) byId.set(String(opt.id), opt.label ?? String(opt.value))
      if (opt.value !== undefined) byId.set(String(opt.value), opt.label ?? String(opt.value))
    }
    for (const key of realKeys) labels.set(key, byId.get(key) ?? key)
    return labels
  }

  if (fieldType === 'RELATIONSHIP') {
    const rows = await db
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          inArray(schema.EntityInstance.id, realKeys),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
    const byId = new Map(rows.map((r) => [r.id, r.displayName]))
    for (const key of realKeys) labels.set(key, byId.get(key) || key)
    return labels
  }

  if (fieldType === 'ACTOR') {
    // Split storage: user/agent ids from `actorId`, group ids from `relatedEntityId`.
    const [members, agents, groups] = await Promise.all([
      getCachedMembers(organizationId),
      getCachedAgents(organizationId),
      getCachedGroups(organizationId),
    ])
    const byId = new Map<string, string>()
    for (const group of groups) {
      if (group.displayName) byId.set(group.id, group.displayName)
    }
    for (const agent of agents) {
      if (agent.name) {
        byId.set(agent.id, agent.name)
        if (agent.userId) byId.set(agent.userId, agent.name)
      }
    }
    for (const member of members) {
      const name = member.user?.name || member.user?.email
      if (member.user?.id && name) byId.set(member.user.id, name)
    }
    for (const key of realKeys) labels.set(key, byId.get(key) ?? key)
    return labels
  }

  if (fieldType === 'CHECKBOX') {
    for (const key of realKeys) {
      labels.set(key, key === 'true' ? 'True' : key === 'false' ? 'False' : key)
    }
    return labels
  }

  // Scalar text/number keys label as themselves.
  for (const key of realKeys) labels.set(key, key)
  return labels
}
