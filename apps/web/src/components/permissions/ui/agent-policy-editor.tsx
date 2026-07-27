// apps/web/src/components/permissions/ui/agent-policy-editor.tsx
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Bot, Library, SlidersHorizontal, Table2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useAgentPolicy } from '../hooks/use-agent-policy'
import { useAgentPolicyClamp } from '../hooks/use-agent-policy-clamp'
import { useAgentPolicyDefinitions } from '../hooks/use-agent-policy-definitions'
import { useAgentPolicySave } from '../hooks/use-agent-policy-save'
import { AGENT_POLICY_AREAS, AgentPolicyAreasGrid } from './agent-policy-areas-grid'
import { AgentPolicyClampPreview } from './agent-policy-clamp-preview'
import { UNPUBLISHED_TITLE, UNSAVED_TITLE } from './agent-policy-copy'
import { AgentPolicyDefinitionsGrid } from './agent-policy-definitions-grid'
import { AgentPolicyResourcesGrid } from './agent-policy-resources-grid'

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

/**
 * The agent half of the permission-profile editor (plan 19 §7): three exact-policy
 * grids — **Areas**, **Record types**, **Resources** — each with an explicit
 * default plus sparse overrides at `None / Read / Read + Write / Full`.
 *
 * What this surface is careful about, in the order it is easy to get wrong:
 *
 *  - **Not three-state.** Every effective value is one of four exact rungs. A row
 *    with no rule of its own reads *"Default · Read"* — the word *default* never
 *    appears without the concrete rung it stands for — and `None` is always
 *    labelled **None**, because for an agent it is a deliberate deny (§7).
 *  - **Not the additive def control.** Human def grants compose max-wins with
 *    `'none'` skipped; this policy is a SET and must be able to remove authority,
 *    so it is authored here and saved onto `PermissionProfile.agentPolicy`
 *    (§0.5/§2.3) — never through `GranteeDefAccessSection`.
 *  - **Every collection has a default**, so a record type or resource created
 *    tomorrow has a deterministic posture (§0.5/§2.3).
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

  const { definitions, isLoading: definitionsLoading } = useAgentPolicyDefinitions()
  const { entries: clampEntries } = useAgentPolicyClamp(policy, AGENT_POLICY_AREAS, definitions)

  const draftCount = boundDrafts?.length ?? 0

  return (
    <div className='flex flex-col gap-4'>
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

      <Section
        title='Areas'
        icon={<SlidersHorizontal className='size-4' />}
        description='What the agent may reach, feature by feature.'
        initialOpen>
        <AgentPolicyAreasGrid
          policy={policy}
          onDefaultChange={setAreasDefault}
          onOverrideChange={setAreaOverride}
          disabled={!canEdit || isSaving}
        />
      </Section>

      <Section
        title='Record types'
        icon={<Table2 className='size-4' />}
        description='Per entity definition, keyed by API slug so a rule survives a rename.'
        initialOpen>
        <AgentPolicyDefinitionsGrid
          policy={policy}
          definitions={definitions}
          isLoading={definitionsLoading}
          onDefaultChange={setDefinitionsDefault}
          onOverrideChange={setDefinitionOverride}
          disabled={!canEdit || isSaving}
        />
      </Section>

      <Section
        title='Resources'
        icon={<Library className='size-4' />}
        description='Datasets, knowledge bases and dashboards, per type and per item.'
        initialOpen>
        <AgentPolicyResourcesGrid
          policy={policy}
          onDefaultChange={setResourceDefault}
          onTypeDefaultChange={setResourceTypeDefault}
          onClearType={clearResourceType}
          onInstanceChange={setInstanceOverride}
          disabled={!canEdit || isSaving}
        />
      </Section>

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
