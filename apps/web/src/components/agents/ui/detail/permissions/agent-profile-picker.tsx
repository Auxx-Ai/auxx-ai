// apps/web/src/components/agents/ui/detail/permissions/agent-profile-picker.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ShieldCheck } from 'lucide-react'
import type { AgentProfileOption } from '../../../hooks/use-agent-permission-profiles'

interface AgentProfilePickerProps {
  /** The explicitly bound profile id, or `null` for an unbound draft. */
  boundProfileId: string | null
  /** The profile the policy actually resolves through (binding, else fallback). */
  resolvedProfile: AgentProfileOption | null
  /** Agent kind, so an unbound draft's hint can name whose default it took. */
  agentKind?: string
  profiles: AgentProfileOption[]
  isLoading: boolean
  disabled: boolean
  onChange: (profileId: string) => void
  className?: string
}

/**
 * The ONE profile picker on the agent builder's Permissions tab (§0.16 / §7).
 *
 * It writes the **draft** binding `Agent.permissionProfileId`: one profile
 * supplies the whole exact policy. An unbound draft still resolves a policy — the
 * system default for its kind — so the trigger labels that as a hint instead of
 * showing an empty picker.
 */
export function AgentProfilePicker({
  boundProfileId,
  resolvedProfile,
  agentKind,
  profiles,
  isLoading,
  disabled,
  onChange,
  className,
}: AgentProfilePickerProps) {
  if (isLoading) return <Skeleton className='h-8 w-full max-w-96' />

  return (
    <Select
      value={resolvedProfile?.id ?? ''}
      onValueChange={onChange}
      disabled={disabled || profiles.length === 0}>
      <SelectTrigger size='sm' className={className ?? 'w-full max-w-96'}>
        <SelectValue placeholder='Select a permission profile'>
          {resolvedProfile ? (
            <span className='flex items-center gap-2'>
              <ProfileGlyph profile={resolvedProfile} />
              <span>{resolvedProfile.name}</span>
              {boundProfileId === null && (
                <span className='text-muted-foreground text-xs'>
                  · default for {agentKind ? `${agentKind} agents` : 'this kind'}
                </span>
              )}
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id} textValue={profile.name}>
            <div className='flex items-start gap-2'>
              <ProfileGlyph profile={profile} />
              <div className='flex flex-col items-start'>
                <span>{profile.name}</span>
                {profile.description && (
                  <span className='text-muted-foreground text-xs'>{profile.description}</span>
                )}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ProfileGlyph({ profile }: { profile: AgentProfileOption }) {
  if (profile.icon) {
    return <EntityIcon iconId={profile.icon.iconId} color={profile.icon.color} size='xs' />
  }
  return <ShieldCheck className='size-4 text-muted-foreground' />
}
