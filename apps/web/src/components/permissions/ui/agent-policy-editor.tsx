// apps/web/src/components/permissions/ui/agent-policy-editor.tsx
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import { Area, FeatureKey, type Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Bot, Library, SlidersHorizontal, Table2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { resourceTypeAreaLevel, useAgentPolicy } from '../hooks/use-agent-policy'
import { useAgentPolicyClamp } from '../hooks/use-agent-policy-clamp'
import { useAgentPolicyDefinitions } from '../hooks/use-agent-policy-definitions'
import { useAgentPolicySave } from '../hooks/use-agent-policy-save'
import {
  type OpenInstanceTypes,
  useInstanceResourceLists,
} from '../hooks/use-instance-resource-lists'
import { AccessRowSelect, AccessTreeRow } from './access-tree-row'
import { AgentPolicyClampPreview } from './agent-policy-clamp-preview'
import {
  ADMIN_AREAS_NOTE,
  AGENT_INHERIT_LABEL,
  ALL_RECORD_TYPES_TITLE,
  allInstancesTitle,
  DEFINITION_FULL_IS_INERT,
  DEFINITIONS_EXCLUSIONS,
  MAIL_IS_OUTSIDE,
  UNPUBLISHED_TITLE,
  UNSAVED_TITLE,
  usesDefaultLabel,
} from './agent-policy-copy'
import { BaseLevelSelect } from './base-level-select'
import {
  type AccessRowsEmptyState,
  type DefAccessRow,
  GranteeDefAccessRows,
} from './grantee-def-access-rows'
import { GranteeInstanceRows, type InstanceAccessRow } from './grantee-instance-rows'
import { AREA_TO_INSTANCE_KEY, INSTANCE_TYPE_META } from './instance-share-copy'
import { clampToArea } from './level-control'
import { LEVEL_OF_PERMISSION, permissionLabel, permissionOfLevel } from './level-labels'
import type { AreaChildFilter, AreaChildren } from './leveled-area-grid'
import { ProfileAreaGrid } from './profile-area-grid'
import {
  AGENT_POLICY_AREA_GROUPS,
  AGENT_POLICY_AREAS,
  type AgentPolicyInstanceKey,
} from './profile-copy'

/** A draft agent bound to this profile — what a save actually reaches. */
export interface BoundAgentDraft {
  id: string
  name: string
}

interface AgentPolicyEditorProps {
  /** The profile whose `agentPolicy` is being edited. */
  profileId: string
  /** The stored policy, or `null` for a profile that has never carried one. */
  savedPolicy: AgentPermissionPolicy | null | undefined
  /**
   * Drafts bound to this profile. Supplied by the host (the settings page or the
   * agent builder) — used to say *which* drafts a save marks unpublished, instead
   * of leaving the reader to guess whether a live agent just changed.
   */
  boundDrafts?: BoundAgentDraft[]
  /** Force read-only regardless of the viewer's authority (e.g. a locked profile). */
  readOnly?: boolean
}

/** Whether a query matches a row title, with an empty query matching everything. */
function matches(title: string, query: string): boolean {
  return !query || title.toLowerCase().includes(query)
}

/**
 * What an empty child list says. "Nothing matched your filter" and "this
 * workspace has nothing to rule on" are different statements, and the agent rows
 * used to make the second one in both cases — so typing `zzz` reported that the
 * workspace had no record types (plan 33 drift #2). The host is the only place
 * that knows which of the two happened, because the host owns the filter.
 */
function emptyStateFor(
  filter: AreaChildFilter,
  icon: ReactNode,
  empty: { title: string; description: string }
): AccessRowsEmptyState {
  if (filter.query)
    return { icon, title: 'No matches', description: 'Nothing matches your search.' }
  if (filter.overridesOnly)
    return { icon, title: 'No matches', description: 'Nothing here has a rule of its own.' }
  return { icon, ...empty }
}

/**
 * The agent half of the permission-profile editor (plan 19 §7, reshaped by plan
 * 29): **one area tree**, the same `ProfileAreaGrid` the human profile renders,
 * with every collection rule nested under the area row it is intersected with.
 * The three flat sections (Areas / Record types / Resources) are gone.
 *
 * ```
 * Knowledge bases            [None|Read|Full]      ← the L2 area rung
 *   ├ All knowledge bases    [Default · None  ▾]   ← resources.kb.default
 *   └ Returns Policy         [Read            ▾]   ← resources.kb.overrides[id]
 * ```
 *
 * What this surface is careful about, in the order it is easy to get wrong:
 *
 *  - **Not three-state.** Every effective value is one of four exact rungs. A row
 *    with no rule of its own reads *"Default · Read"* — the word *default* never
 *    appears without the concrete rung it stands for — and `None` is always
 *    labelled **None**, because for an agent it is a deliberate deny (§7).
 *  - **The nesting is the clamp.** Runtime access is `min(area rung, rule)`, and
 *    a child under a parent is the natural rendering of a `min` — which is why
 *    the *"Clamped by …"* badges are deleted rather than moved (plan 29 §1.2).
 *  - **Not the additive def control.** Human def grants compose max-wins with
 *    `'none'` skipped; this policy is a SET and must be able to remove authority,
 *    so it is authored here and saved onto `PermissionProfile.agentPolicy`
 *    (§0.5/§2.3) — never through the human per-def rows (`GranteeDefAccessRows`),
 *    which write `ResourceAccess`.
 *  - **Every collection has a default**, so a record type or resource created
 *    tomorrow has a deterministic posture (§0.5/§2.3). They are child rows ("All
 *    record types", "All datasets", …); the ONE default that answers for keys
 *    with no row at all — `areas.default` — is the header dropdown (plan 29
 *    §2.2/§4a). It does not offer the human `Member default` sentinel: an agent's
 *    default is mandatory and fails closed at `none`.
 *  - **A resource type with no rule falls through to its own area**, not to a
 *    second blanket default. The `New resource types fall through to` dropdown is
 *    gone with the `resourceDefault` field behind it: it answered the same
 *    question one level above the area rung it was then intersected with, so two
 *    header dropdowns sat side by side with no statable difference, and an
 *    `All datasets` row could read *"Default · None"* under a `Datasets: Read`
 *    parent. This is also the human rule verbatim — `INSTANCE_ACCESS_RESOURCES`
 *    says an absent instance row resolves to the base L2 area level.
 *  - **Permissions are not tools.** Effective ability is the intersection of the
 *    two (§0.5a/§2.4) — granting Full here enables no tool.
 *  - **Publication semantics.** A save reaches bound drafts only; production
 *    changes on publish, and the editor says so after a write (§0.3/§0.16).
 *  - **Author clamp.** Publishing lowers the policy to the publisher's own
 *    authority; the reduction is previewed here and disclosed at publish (§2.4a).
 *  - **OWNER/ADMIN only.** Agent-side profile editing is admin-gated (doc 14
 *    §0.9); the lib layer enforces it, this renders read-only rather than
 *    letting a member click into a 403.
 *
 * Saving is ONE atomic `permissions.saveProfile` call (§6.1.4) — never a request
 * per row.
 */
export function AgentPolicyEditor({
  profileId,
  savedPolicy,
  boundDrafts,
  readOnly = false,
}: AgentPolicyEditorProps) {
  const { isAdminOrOwner } = useUser()
  const { hasAccess } = useFeatureFlags()
  const planAllowsWrites = hasAccess(FeatureKey.granularPermissions)
  const canEdit = isAdminOrOwner && planAllowsWrites && !readOnly

  const {
    policy,
    isDirty,
    changeCount,
    reset,
    setAreasDefault,
    setAreaOverride,
    setDefinitionsDefault,
    setDefinitionOverride,
    setResourceTypeDefault,
    clearResourceType,
    setInstanceOverride,
  } = useAgentPolicy(savedPolicy)

  /** Set once a save lands: from then on the bound drafts differ from production. */
  const [savedThisSession, setSavedThisSession] = useState(false)
  const { savePolicy, isSaving } = useAgentPolicySave({
    profileId,
    onSaved: () => setSavedThisSession(true),
  })

  const [confirm, ConfirmDialog] = useConfirm()
  const { definitions, isLoading: definitionsLoading } = useAgentPolicyDefinitions()
  const { entries: clampEntries } = useAgentPolicyClamp(policy, AGENT_POLICY_AREAS, definitions)

  const disabled = !canEdit || isSaving

  /**
   * Which resource types are worth listing. `ProfileAreaGrid` owns the tree's
   * expand state and reports it through `onAreaOpenChange`; this mirrors it so
   * the four instance lists stay lazy — an admin who only sets type defaults
   * never pays for four list queries, which is exactly what the pre-plan-29
   * Resources grid did with its own per-row toggle.
   */
  const [openTypes, setOpenTypes] = useState<OpenInstanceTypes>({})
  const instances = useInstanceResourceLists(openTypes)

  const handleAreaOpenChange = useCallback((area: Area, isOpen: boolean) => {
    const key = AREA_TO_INSTANCE_KEY[area]
    if (!key) return
    setOpenTypes((prev) => ({ ...prev, [key]: isOpen }))
  }, [])

  /**
   * The "All X" row went back to `Default`, which drops the type's entry — and
   * its per-item rules with it, because the stored shape has nowhere to keep
   * them. Never silent (plan 29 §2.3).
   */
  const handleTypeChange = useCallback(
    async (type: AgentPolicyInstanceKey, level: ResourcePermission | undefined) => {
      if (level !== undefined) {
        setResourceTypeDefault(type, level)
        return
      }
      const overrideCount = Object.keys(policy.resources[type]?.overrides ?? {}).length
      if (overrideCount > 0) {
        const confirmed = await confirm({
          title: `Follow the area rung for ${INSTANCE_TYPE_META[type].label.toLowerCase()}?`,
          description: `This removes the ${overrideCount} per-item rule${overrideCount === 1 ? '' : 's'} on this type as well. The shape has nowhere to keep them once the type follows its area.`,
          confirmText: 'Remove rules',
          cancelText: 'Cancel',
          destructive: true,
        })
        if (!confirmed) return
      }
      clearResourceType(type)
    },
    [confirm, policy.resources, setResourceTypeDefault, clearResourceType]
  )

  /**
   * The area overrides in the grid's numeric `Level` spelling. This is the ONLY
   * conversion left at the grid edge: plan 26 Phase 2 collapsed the agent rung
   * strings into `ResourcePermission`, but `Level` stays numeric by design —
   * composition's max/min comparisons are arithmetic (§2.6).
   */
  const areaValues = useMemo(() => {
    const values: Partial<Record<Area, Level>> = {}
    for (const area of AGENT_POLICY_AREAS) {
      const level = policy.areas.overrides[area]
      if (level !== undefined) values[area] = LEVEL_OF_PERMISSION[level]
    }
    return values
  }, [policy.areas.overrides])

  /**
   * *"Default · Read"* for a row with no rule of its own. The blanket default is
   * one rung for EVERY area at once, so on an area that doesn't implement it
   * (most are on/off) it resolves downward — name the RESOLVED rung, because the
   * highlighted segment is clamped the same way and "Default · Read" beside a
   * highlighted None reads as a contradiction (#1342).
   */
  const unsetHintFor = useCallback(
    (area: Area) =>
      usesDefaultLabel(
        permissionOfLevel(
          clampToArea(PERMISSION_AREAS[area], LEVEL_OF_PERMISSION[policy.areas.default])
        )
      ),
    [policy.areas.default]
  )

  const definitionSlugs = useMemo(
    () => new Set(definitions.map((def) => def.apiSlug)),
    [definitions]
  )

  /**
   * Every child row of the tree, on `ProfileAreaGrid`'s `renderChildren`
   * contract (the same one the human profile editor uses).
   *
   * `matchCount` counts the rows that survive the filter, which is what keeps a
   * parent whose own label missed the query and auto-expands it. The "All X"
   * collection-default row is structural: it always renders, because a child
   * reading *"Default · None"* is unreadable without it, but it only COUNTS when
   * it survives the filter itself — otherwise "Set areas only" would rescue every
   * collection area unconditionally and the toggle would mean nothing.
   */
  const renderChildren = useCallback(
    (area: Area, filter: AreaChildFilter): AreaChildren | undefined => {
      if (area === Area.records) {
        const overrides = policy.definitions.overrides
        const rows = definitions.filter((def) => {
          if (filter.overridesOnly && overrides[def.apiSlug] === undefined) return false
          return matches(def.label, filter.query) || matches(def.apiSlug, filter.query)
        })
        const orphans = Object.keys(overrides)
          .filter((slug) => !definitionSlugs.has(slug) && matches(slug, filter.query))
          .sort()
        // `definitions.default` is mandatory, so it is never an override: counting
        // it would keep Records visible under "Set areas only" forever.
        const allRowCounts = !filter.overridesOnly && matches(ALL_RECORD_TYPES_TITLE, filter.query)

        // Both families are ordinary rows now — the orphan ones just carry the
        // flag, since the host is what knows which override ids have no def left.
        const defRows: DefAccessRow[] = [
          ...rows.map((def) => ({
            id: def.apiSlug,
            icon: { iconId: def.icon, color: def.color },
            title: def.label,
            description: `Policy key: ${def.apiSlug}`,
            grantLevel: overrides[def.apiSlug],
            inheritedLevel: policy.definitions.default,
            inheritLabelText: AGENT_INHERIT_LABEL,
          })),
          ...orphans.map((slug) => ({
            id: slug,
            icon: null,
            title: slug,
            grantLevel: overrides[slug],
            inheritedLevel: policy.definitions.default,
            inheritLabelText: AGENT_INHERIT_LABEL,
            isOrphan: true,
          })),
        ]

        return {
          // While the list is loading, every override looks like an orphan
          // (nothing is "known" yet) — count none of them rather than reporting
          // a number that changes under the reader when the fetch lands.
          matchCount:
            (definitionsLoading ? 0 : rows.length + orphans.length) + (allRowCounts ? 1 : 0),
          rows: (
            <GranteeDefAccessRows
              rows={defRows}
              isLoading={definitionsLoading}
              canEdit={!disabled}
              includeNone
              leadingRow={
                <AccessTreeRow
                  icon={<Table2 className='size-4' />}
                  title={ALL_RECORD_TYPES_TITLE}
                  description='What a record type with no rule of its own resolves to, including types created later.'
                  actions={
                    <AccessRowSelect
                      value={policy.definitions.default}
                      includeNone
                      onChange={setDefinitionsDefault}
                      disabled={disabled}
                    />
                  }
                />
              }
              emptyState={emptyStateFor(filter, <Table2 />, {
                title: 'No record types',
                description: 'Nothing to rule on beyond the default above.',
              })}
              onChange={(apiSlug, level) =>
                setDefinitionOverride(apiSlug, level === 'inherit' ? undefined : level)
              }
            />
          ),
        }
      }

      const type = AREA_TO_INSTANCE_KEY[area]
      // `agent`, `inbox` and `personal_inbox` are instance-access keys but NOT
      // agent-policy ones — an agent policy has nothing to say about which
      // agents an agent may reach, nor about mail, whose authority is the lens
      // layer (see `AgentPolicyInstanceKey`). `Area.agents` and `Area.inboxes`
      // are already excluded from `AGENT_POLICY_AREA_GROUPS`, so these branches
      // are unreachable in practice; narrowing here is what makes that exclusion
      // checkable rather than assumed, since `AREA_TO_INSTANCE_KEY` is derived
      // from the full registry.
      if (!type || type === 'agent' || type === 'inbox' || type === 'personal_inbox')
        return undefined

      const entry = policy.resources[type]
      const overrides = entry?.overrides ?? {}
      const list = instances[type]
      const knownIds = new Set(list.items.map((item) => item.id))

      const items = list.items.filter((item) => {
        if (filter.overridesOnly && overrides[item.id] === undefined) return false
        return matches(item.name, filter.query)
      })
      const orphans = Object.keys(overrides)
        .filter((id) => !knownIds.has(id) && matches(id, filter.query))
        .sort()
      // Unlike the record-type default, a resource TYPE entry is a deliberate
      // departure from the area rung it would otherwise follow — so it is a rule
      // of its own and does rescue its area under "Set areas only".
      const meta = INSTANCE_TYPE_META[type]
      const allRowCounts =
        (!filter.overridesOnly || entry !== undefined) &&
        matches(allInstancesTitle(meta.label), filter.query)

      /**
       * The type's fall-through: its own L2 area rung, which is the row directly
       * above this one in the tree. A child can no longer contradict its parent
       * the way a global resource default could.
       */
      const areaRung = resourceTypeAreaLevel(policy, type)
      /** What an instance with no rule of its own resolves to. */
      const typeLevel = entry?.default ?? areaRung
      const instanceRows: InstanceAccessRow[] = [
        ...items.map((item) => ({
          key: type,
          id: item.id,
          name: item.name,
          grantLevel: overrides[item.id],
          inheritedLevel: typeLevel,
          inheritLabelText: AGENT_INHERIT_LABEL,
        })),
        ...orphans.map((id) => ({
          key: type,
          id,
          name: id,
          grantLevel: overrides[id],
          inheritedLevel: typeLevel,
          inheritLabelText: AGENT_INHERIT_LABEL,
          isOrphan: true,
        })),
      ]

      const overrideCount = Object.keys(overrides).length
      const noun = meta.label.toLowerCase().replace(/s$/, '')

      return {
        matchCount: (list.isLoading ? 0 : items.length + orphans.length) + (allRowCounts ? 1 : 0),
        rows: (
          <GranteeInstanceRows
            rows={instanceRows}
            isLoading={list.isLoading}
            truncated={list.truncated}
            canEdit={!disabled}
            showSharing={false}
            leadingRow={
              <AccessTreeRow
                icon={<meta.icon className='size-4' />}
                title={allInstancesTitle(meta.label)}
                description={
                  overrideCount > 0
                    ? `What a ${noun} with no rule of its own resolves to, including ones created later. Choosing Default follows the ${meta.label.toLowerCase()} area above (${permissionLabel(areaRung)}) and removes the ${overrideCount} per-item rule${overrideCount === 1 ? '' : 's'} below with it.`
                    : `What a ${noun} with no rule of its own resolves to, including ones created later.`
                }
                actions={
                  <AccessRowSelect
                    value={entry?.default}
                    includeInherit
                    includeNone
                    inheritLabelText={AGENT_INHERIT_LABEL}
                    inheritedLevel={areaRung}
                    onInherit={() => void handleTypeChange(type, undefined)}
                    onChange={(level) => void handleTypeChange(type, level)}
                    disabled={disabled}
                  />
                }
              />
            }
            emptyState={emptyStateFor(filter, <Library />, {
              title: `No ${meta.label.toLowerCase()}`,
              description: `Nothing to rule on yet. Anything created later resolves to ${permissionLabel(typeLevel)}.`,
            })}
            onChange={(_key, instanceId, level) =>
              setInstanceOverride(type, instanceId, level === 'inherit' ? undefined : level)
            }
          />
        ),
      }
    },
    [
      policy,
      definitions,
      definitionSlugs,
      definitionsLoading,
      instances,
      setDefinitionsDefault,
      setDefinitionOverride,
      setInstanceOverride,
      handleTypeChange,
      disabled,
    ]
  )

  const draftCount = boundDrafts?.length ?? 0

  return (
    <div className='flex flex-col gap-4'>
      <ConfirmDialog />

      {savedThisSession ? (
        <Alert variant='warning' className='flex gap-3'>
          <Bot className='size-4 shrink-0' />
          <div className='flex min-w-0 flex-col gap-1'>
            <span className='font-medium'>{UNPUBLISHED_TITLE}</span>
            <span className='opacity-90'>
              {draftCount > 0
                ? `${draftCount} agent draft${draftCount === 1 ? '' : 's'} bound to this profile now run a policy that differs from what is published. Publish each one to move the change into production. No live agent changed when you saved.`
                : 'Agent drafts bound to this profile now run a policy that differs from what is published. Publish each one to move the change into production. No live agent changed when you saved.'}
            </span>
            {boundDrafts && boundDrafts.length > 0 ? (
              <ul className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5'>
                {boundDrafts.map((draft) => (
                  <li key={draft.id}>
                    <Link href={`/app/agents/${draft.id}`} className='underline'>
                      {draft.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <AgentPolicyClampPreview entries={clampEntries} />

      <SettingsSection
        icon={SlidersHorizontal}
        title='Agent policy'
        description='What the agent may reach, feature by feature. Expand a row to rule on individual record types or resources.'
        action={
          <BaseLevelSelect
            label='Unset areas fall through to'
            value={LEVEL_OF_PERMISSION[policy.areas.default]}
            disabled={disabled}
            onChange={(level) => setAreasDefault(permissionOfLevel(level))}
          />
        }>
        <ProfileAreaGrid
          values={areaValues}
          baseLevel={LEVEL_OF_PERMISSION[policy.areas.default]}
          areaGroups={AGENT_POLICY_AREA_GROUPS}
          unsetHintFor={unsetHintFor}
          disabled={disabled}
          onChange={(area, level) =>
            setAreaOverride(area, level === undefined ? undefined : permissionOfLevel(level))
          }
          renderChildren={renderChildren}
          onAreaOpenChange={handleAreaOpenChange}
        />

        <div className='flex flex-col gap-1 px-1 text-xs text-muted-foreground'>
          <p>{ADMIN_AREAS_NOTE}</p>
          <p>{MAIL_IS_OUTSIDE}</p>
          <p>{DEFINITIONS_EXCLUSIONS}</p>
          <p>{DEFINITION_FULL_IS_INERT}</p>
        </div>
      </SettingsSection>

      {canEdit && isDirty ? (
        <div className='sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/95 px-3 py-2 backdrop-blur-sm'>
          <span className='text-sm'>
            <span className='font-medium'>{UNSAVED_TITLE}</span>
            <span className='text-muted-foreground'>
              : {changeCount} rule{changeCount === 1 ? '' : 's'} differ from the saved policy.
            </span>
          </span>
          <div className='flex items-center gap-2'>
            <Button type='button' variant='ghost' size='sm' onClick={reset} disabled={isSaving}>
              Discard
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              loading={isSaving}
              loadingText='Saving...'
              onClick={() => savePolicy(policy)}>
              Save policy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
