// apps/web/src/components/permissions/ui/agent-policy-definitions-grid.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { Area, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { EntityIcon } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { NormalizedAgentPolicy } from '../hooks/use-agent-policy'
import type { AgentPolicyDefinition } from '../hooks/use-agent-policy-definitions'
import {
  AGENT_LEVEL_RANK,
  DEFINITION_FULL_IS_INERT,
  DEFINITIONS_EXCLUSIONS,
} from './agent-policy-copy'
import { AgentPolicyDefaultRow } from './agent-policy-level-control'
import { AgentPolicyLevelSelect } from './agent-policy-level-select'
import { agentLevelLabel } from './level-labels'

/** Indent of the per-type rows under the Records parent row. */
const CHILD_DEPTH = 1

/**
 * The exact per-definition grid — one explicit default plus sparse `apiSlug`
 * overrides, nested under a Records parent row.
 *
 * The default carries the weight here: a record type created next month resolves
 * through it, so "definitions default = None" is what makes a customer-facing
 * chat agent stay fail-closed as the workspace grows (plan 19 §0.5/§5.1).
 *
 * Two structural choices, both matching what the human surfaces already do:
 *  - the rows hang off ONE parent row for the `records` area (plan 26 §2.4),
 *    because a per-type rule is intersected with that area — the parent is where
 *    that ceiling can be named once instead of per row;
 *  - each row picks its rung from a dropdown, like the human per-def rows, since
 *    there is one of them per record type (plan 26 §2.2).
 *
 * This grid is NOT the additive def-access control the human surfaces use (the
 * nested per-def rows of `GranteeDefAccessRows`). Those write `ResourceAccess`
 * rows that compose max-wins with `'none'` skipped; a `None` authored here must
 * *remove* authority, which that reducer cannot express (§2.3/§7).
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
  // Open on arrival: the rules live under this row, and a collapsed parent would
  // read as an empty grid.
  const [isOpen, setIsOpen] = useState(true)
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

  const recordsLabel = PERMISSION_AREAS[Area.records].label
  /** The Records rung every row below is min'd with at run time. */
  const areaLevel = policy.areas.overrides[Area.records] ?? policy.areas.default
  const clamped = AGENT_LEVEL_RANK[areaLevel] < AGENT_LEVEL_RANK[policy.definitions.default]

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

      <TreeRow
        rowClassName='bg-primary-50 hover:bg-primary-100'
        icon={<Table2 className='size-4' />}
        title={recordsLabel}
        description={`Per-type rules live under this row. Effective access is the lower of the rule and the ${recordsLabel} area.`}
        secondary={
          clamped ? (
            <Tooltip
              content={`The ${recordsLabel} area is set to ${agentLevelLabel(areaLevel)}, so every record type here resolves to at most ${agentLevelLabel(areaLevel)} whatever these rules say.`}>
              <span className='rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'>
                Clamped by {recordsLabel}
              </span>
            </Tooltip>
          ) : undefined
        }
        expandable
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((prev) => !prev)}>
        {isLoading ? (
          <div className='flex flex-col gap-0.5'>
            <TreeRowSkeleton depth={CHILD_DEPTH} />
            <TreeRowSkeleton depth={CHILD_DEPTH} />
            <TreeRowSkeleton depth={CHILD_DEPTH} />
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
                depth={CHILD_DEPTH}
                rowClassName='bg-primary-50 hover:bg-primary-100'
                icon={<EntityIcon iconId={def.icon} color={def.color} size='xs' />}
                title={<span className='truncate'>{def.label}</span>}
                description={`Policy key: ${def.apiSlug}`}
                trailing={
                  <AgentPolicyLevelSelect
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
                depth={CHILD_DEPTH}
                rowClassName='bg-primary-50 hover:bg-primary-100'
                icon={<Table2 className='size-4 text-muted-foreground' />}
                title={<span className='truncate text-muted-foreground'>{slug}</span>}
                description='This rule names a record type that no longer exists in this workspace. It is kept until you clear it, and does nothing meanwhile.'
                secondary={<span className='text-xs text-muted-foreground'>Unknown type</span>}
                trailing={
                  <AgentPolicyLevelSelect
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
      </TreeRow>

      <div className='flex flex-col gap-1 px-1 text-xs text-muted-foreground'>
        <p>{DEFINITION_FULL_IS_INERT}</p>
        <p>{DEFINITIONS_EXCLUSIONS}</p>
      </div>
    </div>
  )
}
