// apps/web/src/components/permissions/ui/agent-policy-def-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Table2 } from 'lucide-react'
import type { AgentPolicyDefinition } from '../hooks/use-agent-policy-definitions'
import { AccessLevelSelect } from './access-level-select'
import { ALL_RECORD_TYPES_TITLE } from './agent-policy-copy'

/** Indent of every agent-policy child row under its area row. */
const CHILD_DEPTH = 1

interface AgentPolicyDefRowsProps {
  /** `definitions.default` — mandatory, so this row offers no `Default` option. */
  collectionDefault: ResourcePermission
  /** The sparse per-`apiSlug` rules. */
  overrides: Partial<Record<string, ResourcePermission>>
  /** Definition rows that survived the host's filter. */
  rows: AgentPolicyDefinition[]
  /** Override slugs naming a definition this workspace no longer has. */
  orphans: string[]
  isLoading?: boolean
  onDefaultChange: (level: ResourcePermission) => void
  onOverrideChange: (apiSlug: string, level: ResourcePermission | undefined) => void
  disabled?: boolean
}

/**
 * The child block under `Area.records` in the unified agent-policy tree
 * (plan 29 §1.1): the **"All record types"** collection-default row, then one
 * row per rule-able entity definition, then the orphan rows.
 *
 * Two things the nesting itself now states, which used to need a badge:
 *  - the runtime is `min(Records area rung, this rule)`, and a child under a
 *    parent is the natural rendering of a `min` (§1.2 — the *"Clamped by
 *    Records"* badge is deleted, not relocated);
 *  - **"All record types" is the first child, not a header card.** It is the rule
 *    a record type created tomorrow resolves through (§0.5/§2.3), so it belongs
 *    in the same list as its siblings, reading in the same vocabulary.
 *
 * These are NOT the additive human per-def rows (`GranteeDefAccessRows`), which
 * write `ResourceAccess` and compose max-wins with `'none'` skipped. A `None`
 * authored here must REMOVE authority, which that reducer cannot express
 * (plan 19 §2.3/§7).
 */
export function AgentPolicyDefRows({
  collectionDefault,
  overrides,
  rows,
  orphans,
  isLoading = false,
  onDefaultChange,
  onOverrideChange,
  disabled = false,
}: AgentPolicyDefRowsProps) {
  return (
    <div className='flex flex-col gap-0.5'>
      <TreeRow
        depth={CHILD_DEPTH}
        rowClassName='bg-primary-50 hover:bg-primary-100'
        icon={<Table2 className='size-4' />}
        title={ALL_RECORD_TYPES_TITLE}
        description='What a record type with no rule of its own resolves to, including types created later.'
        trailing={
          <AccessLevelSelect
            value={collectionDefault}
            includeNone
            onChange={onDefaultChange}
            disabled={disabled}
            size='sm'
            variant='transparent'
            className='h-7 w-44'
          />
        }
      />

      {isLoading ? (
        <>
          <TreeRowSkeleton depth={CHILD_DEPTH} />
          <TreeRowSkeleton depth={CHILD_DEPTH} />
          <TreeRowSkeleton depth={CHILD_DEPTH} />
        </>
      ) : rows.length === 0 && orphans.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<Table2 />}
          title='No record types'
          description='Nothing to rule on beyond the default above.'
        />
      ) : (
        <>
          {rows.map((def) => (
            <TreeRow
              key={def.apiSlug}
              depth={CHILD_DEPTH}
              rowClassName='bg-primary-50 hover:bg-primary-100'
              icon={<EntityIcon iconId={def.icon} color={def.color} size='xs' />}
              title={<span className='truncate'>{def.label}</span>}
              description={`Policy key: ${def.apiSlug}`}
              trailing={
                <AccessLevelSelect
                  value={overrides[def.apiSlug]}
                  includeInherit
                  includeNone
                  inheritLabelText='Default'
                  inheritedLevel={collectionDefault}
                  onInherit={() => onOverrideChange(def.apiSlug, undefined)}
                  onChange={(level) => onOverrideChange(def.apiSlug, level)}
                  disabled={disabled}
                  size='sm'
                  variant='transparent'
                  className='h-7 w-44'
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
                <AccessLevelSelect
                  value={overrides[slug]}
                  includeInherit
                  includeNone
                  inheritLabelText='Default'
                  inheritedLevel={collectionDefault}
                  onInherit={() => onOverrideChange(slug, undefined)}
                  onChange={(level) => onOverrideChange(slug, level)}
                  disabled={disabled}
                  size='sm'
                  variant='transparent'
                  className='h-7 w-44'
                />
              }
            />
          ))}
        </>
      )}
    </div>
  )
}
