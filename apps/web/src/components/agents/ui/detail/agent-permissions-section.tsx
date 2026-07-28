// apps/web/src/components/agents/ui/detail/agent-permissions-section.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { type Actor, type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  CircleHelp,
  ExternalLink,
  Lock,
  ScrollText,
  ShieldCheck,
  UserCog,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { ProfilePicker } from '~/components/pickers/profile-picker'
import { useActor } from '~/components/resources/hooks/use-actor'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useAgentAccess } from '../../hooks/use-agent-access'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import {
  useAgentPermissionProfiles,
  useAgentProfileBinding,
  useAgentProfilePolicy,
} from '../../hooks/use-agent-permission-profiles'
import type { AgentDetail } from '../../store/agent-store'
import { AgentGuideDialog } from './agent-guide-dialog'
import { AgentPolicySummary, AgentResolvedPolicyDialog } from './permissions/agent-policy-view'
import { AuthorClampNotice } from './permissions/author-clamp-notice'

/**
 * Picker sentinel for "no delegation" — `runAsUserId = null`. Shaped like the
 * actor picker's own `placeholder:currentUser`: it flows through the picker as
 * an ordinary ActorId and is translated back to `null` on save.
 */
const OWN_PERMISSIONS_ACTOR_ID = 'placeholder:ownPermissions' as ActorId

/** Synthetic actor so the sentinel renders through the shared `ActorItem` row. */
const OWN_PERMISSIONS_ACTOR: Actor = {
  actorId: OWN_PERMISSIONS_ACTOR_ID,
  type: 'system',
  name: 'Own permissions (default)',
  avatarUrl: null,
}

interface AgentPermissionsSectionProps {
  agent: AgentDetail
  /** Jump to another builder tab — used by the Tools ⇄ Permissions cross-link. */
  onNavigate?: (tab: string) => void
}

/**
 * The agent builder's **Permissions** tab (plan 19 §7, step 8): one profile, one
 * resolved policy, optional run-as delegation.
 *
 * Everything here edits the **draft** — the builder Chat tab and draft eval runs.
 * Production runs the immutable `AgentVersion.permissionPolicy` snapshot taken at
 * publish. Run-as *intersects* with that snapshot (`min(published, runAs,
 * invoker)`); it never widens it. Editing is **OWNER/ADMIN-only** (doc 14 §0.9);
 * everyone else sees the resolved policy read-only.
 *
 * The concepts behind all of that live in the guide's Permissions page, reachable
 * from this section's header — the tab itself shows values, not explanations.
 */
export function AgentPermissionsSection({ agent, onNavigate }: AgentPermissionsSectionProps) {
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  // `permissionProfileId` and `runAsUserId` are `ADMIN_ONLY_UPDATE_FIELDS` on
  // `agent.update` (plan 25 §4.2) — they decide whose capabilities a run
  // resolves against. Org rank alone is no longer enough: an OWNER/ADMIN who
  // has been restricted to `edit` on THIS agent would otherwise get an enabled
  // control that 403s. Both conditions must hold.
  const { canAdmin } = useAgentAccess(agent.id)
  const { updateAgent, isUpdating } = useAgentMutations()
  const { profiles, byId, isLoading: profilesLoading, fallbackFor } = useAgentPermissionProfiles()
  const { setProfile, isSaving } = useAgentProfileBinding()
  const [guideOpen, setGuideOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  const hasGranularPermissions = hasAccess(FeatureKey.granularPermissions)
  /** Run-as is an agent field, not a policy — it needs no plan feature. */
  const canEditRunAs = isAdminOrOwner && canAdmin
  const canEditProfile = isAdminOrOwner && canAdmin
  const isDelegated = agent.runAsUserId != null

  const boundProfileId = agent.permissionProfileId
  // An unbound draft is not unrestricted — §1.3 resolves it to the system
  // profile for its kind (`internal → agent`, `chat → chat_agent`), so that is
  // the policy the tab must show.
  const resolvedProfile = boundProfileId
    ? (byId.get(boundProfileId) ?? null)
    : fallbackFor(agent.kind)
  const { policy } = useAgentProfilePolicy(resolvedProfile?.id ?? null)

  // Every profile the agent may bind, as picker options. The hook already
  // filters to `appliesTo: 'agent' | 'any'`, so nothing here is unbindable and
  // no option carries a disabled reason.
  const profileOptions = useMemo(() => profiles.map((profile) => ({ profile })), [profiles])

  // `target: 'user'` is exactly the run-as candidate set — the actor service
  // lists only ACTIVE members with `userType: 'USER'`, which is the §0.6
  // requirement, so no client-side filtering is left to do.
  const runAsActorId = agent.runAsUserId
    ? toActorId('user', agent.runAsUserId)
    : OWN_PERMISSIONS_ACTOR_ID
  const { actor: runAsActor } = useActor({ actorId: runAsActorId, enabled: isDelegated })
  const runAsName = runAsActor?.name || 'that member'

  const handleRunAsChange = (actorId: ActorId) => {
    // Re-picking the current row (or deselecting it, which the picker reports as
    // an empty selection and this maps back to the sentinel) is not a change —
    // don't spend a mutation, and don't mark the draft unpublished, on a no-op.
    if (actorId === runAsActorId) return
    void updateAgent(agent.id, {
      runAsUserId: actorId === OWN_PERMISSIONS_ACTOR_ID ? null : getActorRawId(actorId),
    })
  }

  return (
    <Section
      title='Permissions'
      icon={<Lock className='size-4' />}
      initialOpen
      collapsible={false}
      description='What this agent can do when it runs.'
      actions={
        <Button
          variant='ghost'
          size='icon-xs'
          title='How permissions work'
          aria-label='How permissions work'
          onClick={() => setGuideOpen(true)}>
          <CircleHelp />
        </Button>
      }>
      <div className='space-y-6'>
        <DraftVersusPublished agent={agent} />

        {!canEditProfile && (
          <Alert>
            <ShieldCheck className='size-4' />
            <AlertDescription>
              {isAdminOrOwner
                ? 'You do not administer this agent, so these are read-only. Ask someone with full access to this agent to change them.'
                : 'Only an owner or admin can change these. The resolved policy is read-only.'}
            </AlertDescription>
          </Alert>
        )}

        {!hasGranularPermissions && (
          <UpgradeBanner
            title='Upgrade to author your own profiles'
            description='Built-in profiles stay on every plan. Granular permissions let you author your own.'
          />
        )}

        <SettingsSection
          icon={ShieldCheck}
          title='Access'
          description='The profile this draft resolves its policy from, and who it runs as.'
          action={
            <Button variant='ghost' size='xs' asChild>
              <Link href='/app/settings/permissions'>
                Edit in Settings
                <ExternalLink />
              </Link>
            </Button>
          }>
          <div className='flex flex-col gap-2'>
            <FieldPanel orientation='responsive' breakpoint='sm' resizeId='agent-permissions'>
              <FieldPanelRow
                title='Profile'
                description='Supplies this draft its exact policy.'
                icon={<ShieldCheck />}
                showIcon>
                {profilesLoading ? (
                  <Skeleton className='my-1 h-7 w-56' />
                ) : (
                  <ProfilePicker
                    value={resolvedProfile?.id}
                    options={profileOptions}
                    onChange={(profileId) => void setProfile(agent.id, profileId)}
                    disabled={!canEditProfile || isSaving}
                    emptyLabel='Select a permission profile'
                    // An unbound draft is not unrestricted — §1.3 resolves it to
                    // the system profile for its kind, so the trigger shows that
                    // profile and labels it as inherited rather than sitting empty.
                    hint={
                      boundProfileId === null ? `· default for ${agent.kind} agents` : undefined
                    }
                  />
                )}
              </FieldPanelRow>

              <FieldPanelRow
                title='Run as'
                description='Delegate to a member. Runs resolve whichever of the two is narrower.'
                icon={<UserCog />}
                showIcon>
                <ActorPicker
                  target='user'
                  multi={false}
                  value={[runAsActorId]}
                  onChange={(next) => handleRunAsChange(next[0] ?? OWN_PERMISSIONS_ACTOR_ID)}
                  pinnedItem={OWN_PERMISSIONS_ACTOR}
                  disabled={!canEditRunAs || isUpdating}
                  emptyLabel='Own permissions (default)'
                  placeholder='Search members...'
                />
              </FieldPanelRow>
            </FieldPanel>

            {isDelegated && (
              <p className='text-xs text-muted-foreground'>
                Runs fail if {runAsName} is deactivated or removed.
              </p>
            )}
          </div>
        </SettingsSection>

        <AuthorClampNotice policy={policy} />

        <SettingsSection
          icon={ScrollText}
          title='Resolved policy'
          action={
            <Button variant='outline' size='xs' onClick={() => setPolicyOpen(true)}>
              View resolved policy
            </Button>
          }>
          <AgentPolicySummary policy={policy} />
        </SettingsSection>

        <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
          <span>A call needs both: the tool enabled, and this policy allowing its target.</span>
          {onNavigate && (
            <Button variant='ghost' size='xs' onClick={() => onNavigate('tools')}>
              <Wrench />
              Go to Tools
            </Button>
          )}
        </div>
      </div>

      {policyOpen && (
        <AgentResolvedPolicyDialog policy={policy} open={policyOpen} onOpenChange={setPolicyOpen} />
      )}

      {guideOpen && (
        <AgentGuideDialog
          open={guideOpen}
          onOpenChange={setGuideOpen}
          initialPage='permissions'
          canProcedures={hasAccess(FeatureKey.agentProcedures)}
          isChat={agent.kind === 'chat'}
        />
      )}
    </Section>
  )
}

/**
 * Which policy is live: the draft's (Chat + eval runs) or a published version's.
 * Every control on this tab edits the draft (§0.3 / §0.16).
 */
function DraftVersusPublished({ agent }: { agent: AgentDetail }) {
  const version = agent.activeVersionNumber

  if (agent.hasUnpublishedChanges) {
    return (
      <Alert variant='warning'>
        <ShieldCheck className='size-4' />
        <AlertTitle>Unpublished changes</AlertTitle>
        <AlertDescription>
          This policy applies to draft Chat and eval runs only.
          {version ? ` Production runs version ${version}.` : ''}
        </AlertDescription>
      </Alert>
    )
  }

  if (!agent.activeVersionId) {
    return (
      <Alert>
        <ShieldCheck className='size-4' />
        <AlertTitle>Not published yet</AlertTitle>
        <AlertDescription>This policy applies to draft Chat and eval runs.</AlertDescription>
      </Alert>
    )
  }

  return (
    <p className='text-xs text-muted-foreground'>
      Production runs version {version}&apos;s published policy.
    </p>
  )
}
