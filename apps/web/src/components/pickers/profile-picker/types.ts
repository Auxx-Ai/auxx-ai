// apps/web/src/components/pickers/profile-picker/types.ts

import type { RefObject } from 'react'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import type { RouterOutputs } from '~/trpc/react'

/**
 * One permission profile as every picker surface needs it — the
 * `permissions.listProfiles` row. Identity plus `seat`/`role`/`isSystem`; the
 * policy blobs live on `permissions.getProfile` and no picker reads them.
 */
export type PickerProfile = RouterOutputs['permissions']['listProfiles'][number]

/**
 * A profile offered to one principal, with the caller's verdict on whether it
 * can actually be bound. `reason` is rendered inline on the row (and replaces
 * the profile's own description), never only as a tooltip — an option a member
 * cannot pick has to say why.
 */
export interface ProfilePickerOption {
  profile: PickerProfile
  /** True when this profile cannot be bound to the principal as it stands today. */
  disabled?: boolean
  /** Why it is disabled. Takes the description slot when set. */
  reason?: string
}

/**
 * Props for ProfilePickerContent — the `Command` body, without a popover.
 *
 * Single-valued by construction: a member and an agent each bind exactly one
 * profile, so there is no `multi` mode to model.
 */
export interface ProfilePickerContentProps {
  /** The bound (or pending) profile id. */
  value: string | undefined

  /** Called with the picked profile id. */
  onChange: (profileId: string) => void

  /** The bindable profiles, already filtered by the caller (seat, rank, `appliesTo`). */
  options: ProfilePickerOption[]

  /** Disabled state */
  disabled?: boolean

  /** Search placeholder */
  placeholder?: string

  /** Loading state */
  isLoading?: boolean

  /** Show each profile's seat class inline on its row (member surfaces). */
  showSeat?: boolean

  /** Called after a pick, so a popover wrapper can close itself. */
  onSelectSingle?: (profileId: string) => void

  /** Callback when arrow key capture state changes */
  onCaptureChange?: (capturing: boolean) => void

  /** Additional className */
  className?: string
}

/**
 * Props for ProfilePicker — the popover wrapper around ProfilePickerContent.
 */
export interface ProfilePickerProps
  extends Omit<ProfilePickerContentProps, 'onCaptureChange' | 'className' | 'onSelectSingle'> {
  /** Custom trigger element (if not provided, uses the default PickerTrigger) */
  children?: React.ReactNode

  /** Popover open state (controlled) */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void

  /** External anchor ref — popover anchors to this element instead of the trigger */
  anchorRef?: RefObject<HTMLElement | null>

  /** Default trigger: label when nothing is selected */
  emptyLabel?: string

  /**
   * Muted text appended after the selected profile's name in the trigger — e.g.
   * an agent draft's "· default for chat agents" when no profile is bound.
   */
  hint?: React.ReactNode

  /** Popover alignment */
  align?: 'start' | 'center' | 'end'

  /** Popover side */
  side?: 'top' | 'bottom' | 'left' | 'right'

  /** Popover side offset */
  sideOffset?: number

  /** Additional className for popover content */
  contentClassName?: string

  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
}
