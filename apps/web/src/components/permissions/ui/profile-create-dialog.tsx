// apps/web/src/components/permissions/ui/profile-create-dialog.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import type { Area, Level } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Textarea } from '@auxx/ui/components/textarea'
import { Bot, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import type { PermissionProfile } from '../hooks/use-profiles'
import { useProfiles } from '../hooks/use-profiles'
import {
  APPLIES_TO_COPY,
  DEFAULT_PROFILE_ICON,
  type ProfileAppliesTo,
  uniqueProfileSlug,
} from './profile-copy'
import { SeatTypeSelect } from './seat-type-select'

interface ProfileCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Set → clone: seat and principal type are pinned to the source. */
  cloneFrom: PermissionProfile | null
  onCreated: (profileId: string) => void
}

/**
 * Create (or clone) a permission profile.
 *
 * `seat`, `appliesTo` and the derived `slug` are accepted **here and nowhere
 * else** — they are immutable once the row exists (§0.18), because editing `seat`
 * under existing holders would leave members on a profile whose declared class no
 * longer matches their billed seat. That is exactly why cloning exists: to move a
 * profile to another seat class you duplicate it and reassign, which re-runs the
 * per-holder cap check.
 *
 * A clone is `createProfile` (empty) followed by ONE `saveProfile` carrying the
 * source's levels and `baseLevel` together — the atomic-save rule (§6.1.4) is
 * about a single profile save being one transaction, and a brand-new profile has
 * no holders for the escalation guard to compare.
 */
export function ProfileCreateDialog({
  open,
  onOpenChange,
  cloneFrom,
  onCreated,
}: ProfileCreateDialogProps) {
  const { createProfile, saveProfile, takenSlugs, isCreating, isSaving } = useProfiles()
  const { profileGrants } = usePermissionGrants()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState(DEFAULT_PROFILE_ICON)
  const [seat, setSeat] = useState<SeatType>('full')
  const [appliesTo, setAppliesTo] = useState<ProfileAppliesTo>('member')

  // Dialogs never carry stale state into a fresh open.
  useEffect(() => {
    if (!open) return
    setName(cloneFrom ? `${cloneFrom.name} copy` : '')
    setDescription(cloneFrom?.description ?? '')
    setIcon(cloneFrom?.icon ?? DEFAULT_PROFILE_ICON)
    setSeat(cloneFrom?.seat ?? 'full')
    setAppliesTo((cloneFrom?.appliesTo as ProfileAppliesTo) ?? 'member')
  }, [open, cloneFrom])

  const isPending = isCreating || isSaving
  const trimmed = name.trim()

  const handleSubmit = async () => {
    if (!trimmed) return
    const created = await createProfile({
      slug: uniqueProfileSlug(trimmed, takenSlugs),
      name: trimmed,
      description: description.trim() || null,
      icon,
      seat,
      appliesTo,
      baseLevel: cloneFrom?.baseLevel ?? null,
    })
    if (!created) return

    if (cloneFrom) {
      // Every profile's area levels — the org's `member` profile included — live
      // in its own `PermissionGrant` row, keyed by profile id.
      const levels: Partial<Record<Area, Level>> =
        profileGrants.find((g) => g.granteeId === cloneFrom.id)?.levels ?? {}
      await saveProfile({
        profileId: created.id,
        levels,
        baseLevel: cloneFrom.baseLevel,
      })
    }

    onOpenChange(false)
    onCreated(created.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cloneFrom ? 'Duplicate profile' : 'New permission profile'}</DialogTitle>
          <DialogDescription>
            Seat class and principal type are fixed once the profile exists, so pick them now.
            Everything else is editable afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='profile-name'>Name</Label>
            <div className='flex items-center gap-2'>
              <IconPicker
                value={{ icon: icon.iconId, color: icon.color }}
                onChange={(value) => setIcon({ iconId: value.icon, color: value.color })}
                modal={false}>
                <button type='button' aria-label='Pick profile icon'>
                  <EntityIcon
                    iconId={icon.iconId}
                    color={icon.color}
                    className='size-9! rounded-md border'
                  />
                </button>
              </IconPicker>
              <Input
                id='profile-name'
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. Support rep'
                disabled={isPending}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='profile-description'>Description</Label>
            <Textarea
              id='profile-description'
              rows={2}
              className='resize-none'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='What this profile is for'
              disabled={isPending}
            />
          </div>

          <div className='space-y-2'>
            <Label>Applies to</Label>
            <RadioGroup
              value={appliesTo}
              onValueChange={(value) => setAppliesTo(value as ProfileAppliesTo)}
              disabled={isPending || !!cloneFrom}>
              <RadioGroupItemCard
                value='member'
                icon={<Users />}
                label={APPLIES_TO_COPY.member.label}
                description={APPLIES_TO_COPY.member.description}
              />
              <RadioGroupItemCard
                value='agent'
                icon={<Bot />}
                label={APPLIES_TO_COPY.agent.label}
                description={APPLIES_TO_COPY.agent.description}
              />
            </RadioGroup>
          </div>

          <div className='space-y-2'>
            <Label>Seat class</Label>
            <SeatTypeSelect
              value={seat}
              onChange={setSeat}
              disabled={isPending || !!cloneFrom || appliesTo === 'agent'}
            />
            <p className='text-xs text-muted-foreground'>
              A profile can only be assigned to members on the same seat class, and assignment is
              never a billing event. Field-seat profiles can only ever open the three field-seat
              areas.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText={cloneFrom ? 'Duplicating...' : 'Creating...'}
            disabled={!trimmed}
            data-dialog-submit
            onClick={() => void handleSubmit()}>
            {cloneFrom ? 'Duplicate' : 'Create profile'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
