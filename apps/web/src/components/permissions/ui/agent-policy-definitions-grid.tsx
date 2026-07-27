// apps/web/src/components/permissions/ui/agent-policy-definitions-grid.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { EntityIcon } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NormalizedAgentPolicy } from '../hooks/use-agent-policy'
import type { AgentPolicyDefinition } from '../hooks/use-agent-policy-definitions'
import { DEFINITION_FULL_IS_INERT, DEFINITIONS_EXCLUSIONS } from './agent-policy-copy'
import { AgentPolicyDefaultRow, AgentPolicyLevelControl } from './agent-policy-level-control'

/**
 * The exact per-definition grid — one explicit default plus sparse `apiSlug`
 * overrides.
 *
 * The default carries the weight here: a record type created next month resolves
 * through it, so "definitions default = None" is what makes a customer-facing
 * chat agent stay fail-closed as the workspace grows (plan 19 §0.5/§5.1).
 *
 * This grid is NOT the additive def-access control the human surfaces use
 * (`GranteeDefAccessSection`). Those write `ResourceAccess` rows that compose
 * max-wins with `'none'` skipped; a `None` authored here must *remove* authority,
 * which that reducer cannot express (§2.3/§7).
 */
export function AgentPolicyDefinitionsGrid({
  policy,
  definitions,
  isLoading = false,
  onDefaultChange,
  onOverrideChange,
  disabled = false,
}: {
  policy: NormalizedAgentPolicy
  definitions: AgentPolicyDefinition[]
  isLoading?: boolean
  onDefaultChange: (level: AgentAccessLevel) => void
  onOverrideChange: (apiSlug: string, level: AgentAccessLevel | undefined) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [rulesOnly, setRulesOnly] = useState(false)
  const query = search.trim().toLowerCase()

  const rows = useMemo(
    () =>
      definitions.filter((def) => {
        if (rulesOnly && policy.definitions.overrides[def.apiSlug] === undefined) return false
        if (!query) return true
        return def.label.toLowerCase().includes(query) || def.apiSlug.toLowerCase().includes(query)
      }),
    [definitions, query, rulesOnly, policy.definitions.overrides]
  )

  /**
   * Overrides naming a definition that no longer exists (renamed or deleted).
   * Shown so a stale rule can be cleared — it is otherwise invisible, and the
   * default silently answers for the record type that replaced it.
   */
  const orphans = useMemo(() => {
    const known = new Set(definitions.map((d) => d.apiSlug))
    return Object.keys(policy.definitions.overrides)
      .filter((slug) => !known.has(slug))
      .sort()
  }, [definitions, policy.definitions.overrides])

  return (
    <div className='flex flex-col gap-3'>
      <AgentPolicyDefaultRow
        title='Default for every record type'
        description='What a record type with no rule below resolves to, including types created later.'
        value={policy.definitions.default}
        onChange={onDefaultChange}
        disabled={disabled}
      />

      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search record types...'
        />
        <ButtonSwitch
          label='Rules only'
          checked={rulesOnly}
          onCheckedChange={setRulesOnly}
          disabled={disabled}
        />
      </div>

      {isLoading ? (
        <div className='flex flex-col gap-0.5'>
          <TreeRowSkeleton />
          <TreeRowSkeleton />
          <TreeRowSkeleton />
        </div>
      ) : rows.length === 0 && orphans.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<Table2 />}
          title='No matches'
          description='No record types match your search.'
        />
      ) : (
        <div className='flex flex-col gap-0.5'>
          {rows.map((def) => (
            <TreeRow
              key={def.apiSlug}
              rowClassName='bg-primary-50 hover:bg-primary-100'
              icon={<EntityIcon iconId={def.icon} color={def.color} size='xs' />}
              title={<span className='truncate'>{def.label}</span>}
              description={`Policy key: ${def.apiSlug}`}
              trailing={
                <AgentPolicyLevelControl
                  label={def.label}
                  value={policy.definitions.overrides[def.apiSlug]}
                  fallback={policy.definitions.default}
                  onChange={(level) => onOverrideChange(def.apiSlug, level)}
                  disabled={disabled}
                />
              }
            />
          ))}

          {orphans.map((slug) => (
            <TreeRow
              key={slug}
              rowClassName='bg-primary-50 hover:bg-primary-100'
              icon={<Table2 className='size-4 text-muted-foreground' />}
              title={<span className='truncate text-muted-foreground'>{slug}</span>}
              description='This rule names a record type that no longer exists in this workspace. It is kept until you clear it, and does nothing meanwhile.'
              secondary={<span className='text-xs text-muted-foreground'>Unknown type</span>}
              trailing={
                <AgentPolicyLevelControl
                  label={slug}
                  value={policy.definitions.overrides[slug]}
                  fallback={policy.definitions.default}
                  onChange={(level) => onOverrideChange(slug, level)}
                  disabled={disabled}
                />
              }
            />
          ))}
        </div>
      )}

      <div className='flex flex-col gap-1 px-1 text-xs text-muted-foreground'>
        <p>{DEFINITION_FULL_IS_INERT}</p>
        <p>{DEFINITIONS_EXCLUSIONS}</p>
      </div>
    </div>
  )
}
