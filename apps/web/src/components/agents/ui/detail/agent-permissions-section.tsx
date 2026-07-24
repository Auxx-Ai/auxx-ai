// apps/web/src/components/agents/ui/detail/agent-permissions-section.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Globe, Lock, UserCog } from 'lucide-react'
import { useMemo } from 'react'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import { SettingsSection } from '~/components/global/settings-page'
import { getInitials } from '~/components/members/utils'
import { GranteeDefAccessSection } from '~/components/permissions/ui/grantee-def-access-section'
import { GranteeLevelsSection } from '~/components/permissions/ui/grantee-levels-section'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail } from '../../store/agent-store'

/** Select sentinel for "no delegation" — `runAsUserId = null`. */
const OWN_PERMISSIONS = '__own__'

/**
 * The agent builder's **Permissions** tab (capability layer v2 §4.2): the
 * grantee view transposed onto an agent, plus the run-as selector.
 *
 * Three stacked surfaces, in order:
 * 1. **Run as** — optional delegation. While set, the agent resolves the chosen
 *    member's capabilities at run time instead of its own profile, so the two
 *    grids below are shown read-only with a note (§0.6).
 * 2. **Access levels** — the Layer-2 area grid keyed by the agent's backing
 *    `userId`, in `agent` mode: agents compose by SET over an all-Full base, so
 *    an unset area is **Full** ("Default"), and `None` is the rung that locks an
 *    area down (§0.2/§0.3). Nothing here elevates — this surface only restricts.
 * 3. **Record access** — the Layer-3 per-record-type overlay on the same
 *    grantee, whose "Default" resolves to the def's workspace baseline when one
 *    is configured, else the agent's Records level (Full unless lowered above).
 *
 * **Editing is OWNER/ADMIN-only** (§0.9) — `agents.manage` does not confer
 * permission governance. In practice the whole agent detail page is already
 * hard-gated on `isAdminOrOwner`, so a non-admin never reaches this component;
 * the check is kept explicit so loosening the page gate can't silently hand a
 * non-admin the grants editor. Grant writes additionally require the
 * `granularPermissions` plan feature (`setGranteeLevels` enforces it), so
 * without it the grids render read-only behind an upgrade banner rather than
 * 500ing on save.
 */
export function AgentPermissionsSection({ agent }: { agent: AgentDetail }) {
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  const { updateAgent, isUpdating } = useAgentMutations()

  const hasGranularPermissions = hasAccess(FeatureKey.granularPermissions)
  /** Run-as is an agent field, not a grant — it needs no plan feature. */
  const canEditRunAs = isAdminOrOwner
  const isDelegated = agent.runAsUserId != null
  /** Grants are editable for admins on a plan with granular permissions… */
  const canEditGrants = isAdminOrOwner && hasGranularPermissions && !isDelegated

  const { data: memberData } = api.member.all.useQuery()
  // `member.all` already hard-filters to `userType: 'USER'`, so agents can
  // never appear here; ACTIVE is the remaining run-as requirement (§0.6).
  const members = useMemo(
    () => (memberData?.members ?? []).filter((m) => m.status === 'ACTIVE'),
    [memberData]
  )
  const runAsMember = members.find((m) => m.userId === agent.runAsUserId)
  const runAsName = runAsMember?.user.name || runAsMember?.user.email || 'another member'

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
      description='What this agent can reach when it runs. Agents start with full access — this tab is where you restrict it.'>
      <div className='space-y-6'>
        {agent.kind === 'chat' && (
          <Alert variant='warning'>
            <Globe className='size-4' />
            <AlertDescription>
              This agent is public-facing — consider restricting what it can access.
            </AlertDescription>
          </Alert>
        )}

        {!hasGranularPermissions && (
          <UpgradeBanner
            title='Upgrade to restrict agents'
            description='Granular permissions let you scope what an agent can read and change across the workspace and per record type.'
          />
        )}

        <SettingsSection
          icon={UserCog}
          title='Run as'
          description="By default an agent runs with its own permissions, set below. Point it at a member instead and every run resolves that member's access — the agent still acts as itself in history and attribution.">
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
                      Uses this agent&apos;s own profile
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
                This agent acts with {runAsName}&apos;s permissions. Its own profile below is kept
                but not used — clear the delegation to edit it. Runs fail if that member is
                deactivated or removed.
              </p>
            )}
          </div>
        </SettingsSection>

        {agent.userId ? (
          <>
            <GranteeLevelsSection
              mode='agent'
              granteeKind='user'
              granteeId={agent.userId}
              canEdit={canEditGrants}
            />
            <GranteeDefAccessSection
              principal='agent'
              granteeKind='user'
              granteeId={agent.userId}
              canEdit={canEditGrants}
            />
          </>
        ) : (
          // Pre-`completeAgentSetup` drafts have no backing User, so there is no
          // grantee to write grants against yet.
          <EmptySection
            icon={<Lock />}
            title='Permissions unavailable'
            description='This agent is still being set up. Finish setup to give it a workspace identity, then restrict what it can access here.'
          />
        )}
      </div>
    </Section>
  )
}
