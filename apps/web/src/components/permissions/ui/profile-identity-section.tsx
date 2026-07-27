// apps/web/src/components/permissions/ui/profile-identity-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Lock, Tag } from 'lucide-react'
import type { ReactNode } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { APPLIES_TO_COPY, DEFAULT_PROFILE_ICON, type ProfileAppliesTo } from './profile-copy'
import { SeatTypeBadge } from './seat-type-badge'

interface ProfileIdentitySectionProps {
  name: string
  description: string
  icon: { iconId: string; color: string } | null
  /** Immutable after creation (§0.18) — rendered read-only. */
  slug: string
  seat: SeatType
  appliesTo: ProfileAppliesTo
  isSystem: boolean
  disabled: boolean
  onChange: (values: {
    name?: string
    description?: string
    icon?: { iconId: string; color: string } | null
  }) => void
}

/**
 * Name, description and the icon/colour picker backed by `PermissionProfile.icon`,
 * plus the four facts that are **immutable after creation** (§0.18) rendered
 * read-only: `slug`, `seat`, `appliesTo`, `isSystem`.
 *
 * They are not merely "disabled while system" — no profile may change them ever.
 * Editing `seat` under existing holders would leave those members on a profile
 * whose declared class no longer matches their billed `seatType`, bypassing the
 * core seat invariant, so changing seat class is *clone the profile and reassign*
 * (which re-runs the per-holder cap check). The read-only rows say so rather than
 * offering a control the server would refuse.
 */
export function ProfileIdentitySection({
  name,
  description,
  icon,
  slug,
  seat,
  appliesTo,
  isSystem,
  disabled,
  onChange,
}: ProfileIdentitySectionProps) {
  const shownIcon = icon ?? DEFAULT_PROFILE_ICON

  return (
    <SettingsSection
      icon={Tag}
      title='Profile'
      description='How this profile is named and recognised across assignment surfaces.'>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='permission-profile-form'
        defaultLabelWidth={200}
        className='p-0'>
        <FieldPanelRow title='Icon' type={BaseType.STRING} showIcon>
          <div className='flex items-center gap-2 py-1'>
            {disabled ? (
              <EntityIcon
                iconId={shownIcon.iconId}
                color={shownIcon.color}
                className='size-9! rounded-md border'
              />
            ) : (
              <IconPicker
                value={{ icon: shownIcon.iconId, color: shownIcon.color }}
                onChange={(value) => onChange({ icon: { iconId: value.icon, color: value.color } })}
                modal={false}>
                <button type='button' aria-label='Pick profile icon'>
                  <EntityIcon
                    iconId={shownIcon.iconId}
                    color={shownIcon.color}
                    className='size-9! rounded-md border'
                  />
                </button>
              </IconPicker>
            )}
            <span className='text-xs text-muted-foreground'>
              Shown wherever this profile is picked or listed.
            </span>
          </div>
        </FieldPanelRow>

        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            onChange={(value) => onChange({ name: String(value ?? '') })}
            placeholder='e.g. Support rep'
            disabled={disabled}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={description}
            onChange={(value) => onChange({ description: String(value ?? '') })}
            placeholder='What this profile is for'
            disabled={disabled}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Seat class'
          type={BaseType.STRING}
          showIcon
          description='Fixed at creation. Change it by cloning this profile onto the other seat class and reassigning. Assignment is never a billing event.'>
          <ReadOnlyRow>
            <SeatTypeBadge seatType={seat} showFull />
          </ReadOnlyRow>
        </FieldPanelRow>

        <FieldPanelRow
          title='Applies to'
          type={BaseType.STRING}
          showIcon
          description={APPLIES_TO_COPY[appliesTo].description}>
          <ReadOnlyRow>
            <Badge variant='secondary' size='xs'>
              {APPLIES_TO_COPY[appliesTo].label}
            </Badge>
          </ReadOnlyRow>
        </FieldPanelRow>

        <FieldPanelRow
          title='Identifier'
          type={BaseType.STRING}
          showIcon
          description='The stable slug other systems refer to. Fixed at creation.'>
          <ReadOnlyRow>
            <code className='rounded bg-muted px-1.5 py-0.5 text-xs'>{slug}</code>
            {isSystem && (
              <Badge variant='secondary' size='xs'>
                System profile
              </Badge>
            )}
          </ReadOnlyRow>
        </FieldPanelRow>
      </FieldPanel>
    </SettingsSection>
  )
}

/** A read-only immutable fact: a small lock plus whatever renders the value. */
function ReadOnlyRow({ children }: { children: ReactNode }) {
  return (
    <div className='flex items-center gap-2 py-2 text-sm text-muted-foreground'>
      <Lock className='size-3' />
      {children}
    </div>
  )
}
