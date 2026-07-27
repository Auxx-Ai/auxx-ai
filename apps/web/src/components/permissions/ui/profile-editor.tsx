// apps/web/src/components/permissions/ui/profile-editor.tsx
'use client'

import { Level } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ChevronLeft, SlidersHorizontal } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useProfileEditor } from '../hooks/use-profile-editor'
import type { PermissionProfile } from '../hooks/use-profiles'
import { AgentPolicyEditor } from './agent-policy-editor'
import { LEVEL_LABELS } from './level-control'
import { ProfileAreaGrid } from './profile-area-grid'
import { APPLIES_TO_COPY, DEFAULT_PROFILE_ICON, type ProfileAppliesTo } from './profile-copy'
import { ProfileIdentitySection } from './profile-identity-section'
import { ProfileSeatReference } from './profile-seat-reference'
import { SeatTypeBadge } from './seat-type-badge'

/** Sentinel for "no blanket rung" in the `baseLevel` select (`null` is a real state). */
const NO_BASE_LEVEL = 'member_default'

interface ProfileEditorProps {
  profile: PermissionProfile
  /** The `granularPermissions` plan gate — reads are never gated, writes are. */
  canEdit: boolean
  onBack: () => void
}

/**
 * The human permission-profile editor (doc 19 §7, narrowed by plan 20 §2.a.1):
 * **identity + base access**, saved as **one** transactional mutation (§6.1.4),
 * because the server's escalation guard compares each affected holder's effective
 * state before and after inside a single transaction. A profile authors no cap of
 * its own — teams and personal grants only ever raise from the base.
 *
 * Two things this screen deliberately does not offer:
 * - **The `owner` profile is not editable** (§0.10). It is the recovery guarantee:
 *   OWNER short-circuits before any clamp is consulted, so a mis-shaped profile is
 *   always fixable. Everything renders read-only.
 * - **`seat`, `appliesTo`, `slug` and `isSystem` are immutable** (§0.18) — see
 *   `ProfileIdentitySection`.
 */
export function ProfileEditor({ profile, canEdit, onBack }: ProfileEditorProps) {
  const {
    draft,
    patch,
    setAreaLevel,
    reset,
    save,
    isDirty,
    isSaving,
    isLoading,
    roleDefaults,
    agentPolicy,
  } = useProfileEditor(profile)
  const [confirm, ConfirmDialog] = useConfirm()

  const isOwner = profile.slug === 'owner'
  const isAgentProfile = profile.appliesTo === 'agent'
  const editable = canEdit && !isOwner
  const icon = draft.icon ?? DEFAULT_PROFILE_ICON

  const handleDiscard = async () => {
    const confirmed = await confirm({
      title: 'Discard changes?',
      description: 'Your unsaved changes to this profile will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) reset()
  }

  return (
    <div className='flex flex-1 flex-col'>
      <ConfirmDialog />

      <div className='flex h-9 shrink-0 items-center gap-2 border-b bg-primary-150 px-2'>
        <Button
          variant='ghost'
          size='icon-xs'
          className='rounded-md'
          aria-label='Back to profiles'
          onClick={onBack}>
          <ChevronLeft />
        </Button>
        <EntityIcon iconId={icon.iconId} color={icon.color} size='sm' className='shrink-0' />
        <span className='truncate text-sm font-medium'>{draft.name || profile.name}</span>
        <Badge variant='secondary' size='xs' className='shrink-0'>
          {APPLIES_TO_COPY[profile.appliesTo as ProfileAppliesTo].label}
        </Badge>
        <SeatTypeBadge seatType={profile.seat} showFull />
        {profile.isSystem && (
          <Badge variant='secondary' size='xs' className='shrink-0'>
            System
          </Badge>
        )}

        <div className='ml-auto flex shrink-0 items-center gap-2'>
          {isDirty && (
            <Badge variant='secondary' size='xs' className='border-amber-300 text-amber-600'>
              Unsaved changes
            </Badge>
          )}
          <Button variant='ghost' size='xs' onClick={handleDiscard} disabled={!isDirty || isSaving}>
            Discard
          </Button>
          <Button
            variant='outline'
            size='xs'
            loading={isSaving}
            loadingText='Saving...'
            // Never savable mid-hydration: the payload carries the WHOLE profile
            // (§6.1.4), so submitting before `getProfile` lands would write a
            // half-loaded draft.
            disabled={!editable || !isDirty || isLoading}
            onClick={() => void save()}>
            Save profile
          </Button>
        </div>
      </div>

      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        {isOwner && (
          <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
            The Owner profile is fixed. Owners bypass every permission check by design. That bypass
            is what guarantees a mis-shaped profile can always be repaired, so this profile carries
            no levels of its own.
          </div>
        )}

        {!canEdit && !isOwner && (
          <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
            Profiles are read-only on your plan. Upgrade to granular permissions to edit them. The
            system profiles below still supply everyone's access in the meantime.
          </div>
        )}

        <ProfileIdentitySection
          name={draft.name}
          description={draft.description}
          icon={draft.icon}
          slug={profile.slug}
          seat={profile.seat}
          appliesTo={profile.appliesTo as ProfileAppliesTo}
          isSystem={profile.isSystem}
          disabled={!editable}
          onChange={patch}
        />

        {profile.seat === 'worker' && <ProfileSeatReference />}

        {isAgentProfile ? (
          // An agent profile has no additive base — its rules are exact (SET
          // semantics) and live in `agentPolicy`, with their own save path. Never
          // render the human base map for one.
          <AgentPolicyEditor profileId={profile.id} savedPolicy={agentPolicy} readOnly={!canEdit} />
        ) : isLoading || !roleDefaults ? (
          <div className='space-y-2'>
            <Skeleton className='h-16 w-full rounded-lg' />
            <Skeleton className='h-16 w-full rounded-lg' />
          </div>
        ) : (
          <SettingsSection
            icon={SlidersHorizontal}
            title='Base access'
            description='Where a holder starts. Teams and personal grants can raise from here, never lower it.'
            action={
              <BaseLevelSelect
                value={draft.baseLevel}
                disabled={!editable}
                onChange={(baseLevel) => patch({ baseLevel })}
              />
            }>
            <ProfileAreaGrid
              values={draft.levels}
              roleDefaults={roleDefaults}
              baseLevel={draft.baseLevel}
              seat={profile.seat}
              disabled={!editable}
              onChange={setAreaLevel}
            />
          </SettingsSection>
        )}
      </div>
    </div>
  )
}

/**
 * The profile's blanket rung for areas its base map does not set (§0.7). Keeping
 * it explicit is what makes the grid's "Not set" state readable: a row either
 * falls through to this profile default or, when there is none, to the member
 * default in code — which is also why a newly added area is automatically
 * reachable for Owner/Admin on deploy instead of needing a backfill.
 */
function BaseLevelSelect({
  value,
  disabled,
  onChange,
}: {
  value: Level | null
  disabled: boolean
  onChange: (level: Level | null) => void
}) {
  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-muted-foreground'>Unset areas fall through to</span>
      <Select
        value={value === null ? NO_BASE_LEVEL : String(value)}
        disabled={disabled}
        onValueChange={(next) => onChange(next === NO_BASE_LEVEL ? null : (Number(next) as Level))}>
        <SelectTrigger size='sm' className='w-44'>
          <SelectValue placeholder='Member default' />
        </SelectTrigger>
        <SelectContent align='end'>
          <SelectItem value={NO_BASE_LEVEL}>Member default</SelectItem>
          {[Level.None, Level.Read, Level.Edit, Level.Full].map((level) => (
            <SelectItem key={level} value={String(level)}>
              {LEVEL_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
