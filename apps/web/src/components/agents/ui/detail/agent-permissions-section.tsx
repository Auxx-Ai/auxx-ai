// apps/web/src/components/agents/ui/detail/agent-permissions-section.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
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
import { SettingsSection } from '~/components/global/settings-page'
import { getInitials } from '~/components/members/utils'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import {
  readDraftProfileId,
  useAgentPermissionProfiles,
  useAgentProfileBinding,
  useAgentProfilePolicy,
} from '../../hooks/use-agent-permission-profiles'
import type { AgentDetail } from '../../store/agent-store'
import { AgentGuideDialog } from './agent-guide-dialog'
import { AgentPolicySummary, AgentResolvedPolicyDialog } from './permissions/agent-policy-view'
import { AgentProfilePicker } from './permissions/agent-profile-picker'
import { AuthorClampNotice } from './permissions/author-clamp-notice'

/** Select sentinel for "no delegation" — `runAsUserId = null`. */
const OWN_PERMISSIONS = '__own__'

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
  const { updateAgent, isUpdating } = useAgentMutations()
  const { profiles, byId, isLoading: profilesLoading, fallbackFor } = useAgentPermissionProfiles()
  const { setProfile, isSaving } = useAgentProfileBinding()
  const [guideOpen, setGuideOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  const hasGranularPermissions = hasAccess(FeatureKey.granularPermissions)
  /** Run-as is an agent field, not a policy — it needs no plan feature. */
  const canEditRunAs = isAdminOrOwner
  const canEditProfile = isAdminOrOwner
  const isDelegated = agent.runAsUserId != null

  const boundProfileId = readDraftProfileId(agent)
  // An unbound draft is not unrestricted — §1.3 resolves it to the system
  // profile for its kind (`internal → agent`, `chat → chat_agent`), so that is
  // the policy the tab must show.
  const resolvedProfile = boundProfileId
    ? (byId.get(boundProfileId) ?? null)
    : fallbackFor(agent.kind)
  const { policy } = useAgentProfilePolicy(resolvedProfile?.id ?? null)

  const { data: memberData } = api.member.all.useQuery()
  // `member.all` already hard-filters to `userType: 'USER'`, so agents can
  // never appear here; ACTIVE is the remaining run-as requirement (§0.6).
  const members = useMemo(
    () => (memberData?.members ?? []).filter((m) => m.status === 'ACTIVE'),
    [memberData]
  )
  const runAsMember = members.find((m) => m.userId === agent.runAsUserId)
  const runAsName = runAsMember?.user.name || runAsMember?.user.email || 'that member'

  const handleRunAsChange = (value: string) => {
    void updateAgent(agent.id, {
      runAsUserId: value === OWN_PERMISSIONS ? null : value,
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

        {!isAdminOrOwner && (
          <Alert>
            <ShieldCheck className='size-4' />
            <AlertDescription>
              Only an owner or admin can change these. The resolved policy is read-only.
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
          title='Profile'
          description='Supplies this draft its exact policy.'
          action={
            <Button variant='ghost' size='xs' asChild>
              <Link href='/app/settings/permissions'>
                Edit in Settings
                <ExternalLink />
              </Link>
            </Button>
          }>
          <AgentProfilePicker
            boundProfileId={boundProfileId}
            resolvedProfile={resolvedProfile}
            agentKind={agent.kind}
            profiles={profiles}
            isLoading={profilesLoading}
            disabled={!canEditProfile || isSaving}
            onChange={(profileId) => void setProfile(agent.id, profileId)}
          />
        </SettingsSection>

        <SettingsSection
          icon={UserCog}
          title='Run as'
          description='Delegate to a member. Runs resolve whichever of the two is narrower.'>
          <div className='flex flex-col gap-2'>
            <Select
              value={agent.runAsUserId ?? OWN_PERMISSIONS}
              onValueChange={handleRunAsChange}
              disabled={!canEditRunAs || isUpdating}>
              <SelectTrigger size='sm' className='w-full max-w-96'>
                <SelectValue placeholder='Own permissions (default)' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWN_PERMISSIONS} textValue='Own permissions (default)'>
                  <div className='flex flex-col items-start'>
                    <span>Own permissions (default)</span>
                    <span className='text-muted-foreground text-xs'>
                      Uses this agent&apos;s published policy
                    </span>
                  </div>
                </SelectItem>
                {members.map((member) => {
                  const label = member.user.name || member.user.email || 'Unnamed member'
                  return (
                    <SelectItem key={member.userId} value={member.userId} textValue={label}>
                      <div className='flex items-center gap-2'>
                        <Avatar className='size-5 rounded-full'>
                          {member.user.image && (
                            <AvatarImage src={member.user.image} alt={member.user.name ?? ''} />
                          )}
                          <AvatarFallback className='text-[10px]'>
                            {getInitials(member.user.name, member.user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{label}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
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
