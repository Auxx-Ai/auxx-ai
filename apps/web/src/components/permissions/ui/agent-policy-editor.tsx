// apps/web/src/components/permissions/ui/agent-policy-editor.tsx
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import {
  Area,
  FeatureKey,
  type InstanceAccessKey,
  type Level,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Bot, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useAgentPolicy } from '../hooks/use-agent-policy'
import { useAgentPolicyClamp } from '../hooks/use-agent-policy-clamp'
import { useAgentPolicyDefinitions } from '../hooks/use-agent-policy-definitions'
import { useAgentPolicySave } from '../hooks/use-agent-policy-save'
import {
  type OpenInstanceTypes,
  useInstanceResourceLists,
} from '../hooks/use-instance-resource-lists'
import { AgentPolicyClampPreview } from './agent-policy-clamp-preview'
import {
  ADMIN_AREAS_NOTE,
  ALL_RECORD_TYPES_TITLE,
  allInstancesTitle,
  DEFINITION_FULL_IS_INERT,
  DEFINITIONS_EXCLUSIONS,
  MAIL_IS_OUTSIDE,
  UNPUBLISHED_TITLE,
  UNSAVED_TITLE,
  usesDefaultLabel,
} from './agent-policy-copy'
import { AgentPolicyDefRows } from './agent-policy-def-rows'
import { AgentPolicyInstanceRows, RESOURCE_TYPE_META } from './agent-policy-instance-rows'
import { BaseLevelSelect } from './base-level-select'
import { AREA_TO_INSTANCE_KEY } from './instance-share-copy'
import { clampToArea } from './level-control'
import { LEVEL_OF_PERMISSION, permissionOfLevel } from './level-labels'
import type { AreaChildFilter, AreaChildren } from './leveled-area-grid'
import { ProfileAreaGrid } from './profile-area-grid'
import { AGENT_POLICY_AREA_GROUPS, AGENT_POLICY_AREAS } from './profile-copy'

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
 *    tomorrow has a deterministic posture (§0.5/§2.3). Three of them are child
 *    rows ("All record types", "All datasets", …); the two that answer for keys
 *    with no row at all — `areas.default` and `resourceDefault` — are the header
 *    dropdowns (plan 29 §2.2/§4a). Neither offers the human `Member default`
 *    sentinel: an agent's defaults are mandatory and fail closed at `none`.
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
    setResourceDefault,
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
    async (type: InstanceAccessKey, level: ResourcePermission | undefined) => {
      if (level !== undefined) {
        setResourceTypeDefault(type, level)
        return
      }
      const overrideCount = Object.keys(policy.resources[type]?.overrides ?? {}).length
      if (overrideCount > 0) {
        const confirmed = await confirm({
          title: `Follow the resource default for ${RESOURCE_TYPE_META[type].label.toLowerCase()}?`,
          description: `This removes the ${overrideCount} per-item rule${overrideCount === 1 ? '' : 's'} on this type as well. The shape has nowhere to keep them once the type follows the default.`,
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

        return {
          // While the list is loading, every override looks like an orphan
          // (nothing is "known" yet) — count none of them rather than reporting
          // a number that changes under the reader when the fetch lands.
          matchCount:
            (definitionsLoading ? 0 : rows.length + orphans.length) + (allRowCounts ? 1 : 0),
          rows: (
            <AgentPolicyDefRows
              collectionDefault={policy.definitions.default}
              overrides={overrides}
              rows={rows}
              orphans={orphans}
              isLoading={definitionsLoading}
              onDefaultChange={setDefinitionsDefault}
              onOverrideChange={setDefinitionOverride}
              disabled={disabled}
            />
          ),
        }
      }

      const type = AREA_TO_INSTANCE_KEY[area]
      if (!type) return undefined

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
      // departure from `resourceDefault` — so it is a rule of its own and does
      // rescue its area under "Set areas only".
      const allRowCounts =
        (!filter.overridesOnly || entry !== undefined) &&
        matches(allInstancesTitle(RESOURCE_TYPE_META[type].label), filter.query)

      return {
        matchCount: (list.isLoading ? 0 : items.length + orphans.length) + (allRowCounts ? 1 : 0),
        rows: (
          <AgentPolicyInstanceRows
            type={type}
            typeDefault={entry?.default}
            resourceDefault={policy.resourceDefault}
            overrides={overrides}
            items={items}
            orphans={orphans}
            isLoading={list.isLoading}
            truncated={list.truncated}
            onTypeDefaultChange={(level) => void handleTypeChange(type, level)}
            onInstanceChange={(instanceId, level) => setInstanceOverride(type, instanceId, level)}
            disabled={disabled}
          />
        ),
      }
    },
    [
      policy.definitions,
      policy.resources,
      policy.resourceDefault,
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
          <div className='flex flex-wrap items-center justify-end gap-3'>
            <BaseLevelSelect
              label='Unset areas fall through to'
              value={LEVEL_OF_PERMISSION[policy.areas.default]}
              disabled={disabled}
              onChange={(level) => setAreasDefault(permissionOfLevel(level))}
            />
            <BaseLevelSelect
              label='New resource types fall through to'
              value={LEVEL_OF_PERMISSION[policy.resourceDefault]}
              disabled={disabled}
              onChange={(level) => setResourceDefault(permissionOfLevel(level))}
            />
          </div>
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
