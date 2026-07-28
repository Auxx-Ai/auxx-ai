// apps/web/src/components/pickers/profile-picker/profile-picker-content.tsx

'use client'

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { Settings2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ProfileItem } from './profile-item'
import type { ProfilePickerContentProps } from './types'

/** Where profiles are authored — the one destination every picker points at. */
export const MANAGE_PROFILES_HREF = '/app/settings/permissions'

/**
 * ProfilePickerContent — the searchable permission-profile list, wrapped in its
 * own `Command` shell.
 *
 * Rows keep their list order (the seeded ladder, then custom alphabetically —
 * `listPermissionProfiles` sorts, the picker never reshuffles) and are grouped
 * System / Custom, the same split the resource picker uses. The selected row is
 * marked in place rather than hoisted to the top: a profile list is short, and
 * a list that reorders itself on open makes the current binding harder to find,
 * not easier.
 */
export function ProfilePickerContent({ className, ...props }: ProfilePickerContentProps) {
  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <ProfileCommandBody {...props} />
    </Command>
  )
}

/**
 * ProfileCommandBody — the input + grouped profile list WITHOUT a surrounding
 * `Command` shell. Exposed so it can be embedded inside a parent `Command` that
 * owns the shell; `ProfilePickerContent` is the standalone wrapper.
 */
export function ProfileCommandBody({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = 'Search profiles...',
  isLoading = false,
  showSeat = false,
  showManage = true,
  onManage,
  onSelectSingle,
  onCaptureChange,
}: Omit<ProfilePickerContentProps, 'className'>) {
  const [search, setSearch] = useState('')
  const router = useRouter()

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Matched on name, slug and description: an admin who knows a profile by the
  // sentence on it ("field seat, read-only") should find it without the name.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter(({ profile }) =>
      [profile.name, profile.slug, profile.description ?? ''].some((field) =>
        field.toLowerCase().includes(term)
      )
    )
  }, [options, search])

  const grouped = useMemo(
    () => ({
      system: filtered.filter((o) => o.profile.isSystem),
      custom: filtered.filter((o) => !o.profile.isSystem),
    }),
    [filtered]
  )

  const handleSelect = useCallback(
    (profileId: string) => {
      onChange(profileId)
      onSelectSingle?.(profileId)
    },
    [onChange, onSelectSingle]
  )

  const handleManage = useCallback(() => {
    // The wrapper closes first so the popover is gone before the route changes.
    onManage?.()
    router.push(MANAGE_PROFILES_HREF)
  }, [onManage, router])

  const hasSystemSection = grouped.system.length > 0
  const hasCustomSection = grouped.custom.length > 0
  // Headings only earn their space when both groups are on screen.
  const showGroupHeadings = hasSystemSection && hasCustomSection
  // `CommandEmpty` counts every rendered item, so the always-present Manage row
  // would keep it from ever firing. The list is filtered here anyway, so the
  // empty state is stated outright instead of inferred.
  const isEmpty = !hasSystemSection && !hasCustomSection

  return (
    <>
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
        loading={isLoading}
        autoFocus
      />
      <CommandList>
        {isEmpty && (
          <CommandPlaceholder>
            {isLoading ? 'Loading profiles...' : 'No profiles found'}
          </CommandPlaceholder>
        )}

        {hasSystemSection && (
          <CommandGroup
            heading={showGroupHeadings ? 'Built-in' : undefined}
            aria-label='Built-in profiles'>
            {grouped.system.map((option) => (
              <ProfileItem
                key={option.profile.id}
                option={option}
                isSelected={option.profile.id === value}
                onSelect={handleSelect}
                showSeat={showSeat}
              />
            ))}
          </CommandGroup>
        )}

        {hasSystemSection && hasCustomSection && <CommandSeparator />}

        {hasCustomSection && (
          <CommandGroup
            heading={showGroupHeadings ? 'Custom' : undefined}
            aria-label='Custom profiles'>
            {grouped.custom.map((option) => (
              <ProfileItem
                key={option.profile.id}
                option={option}
                isSelected={option.profile.id === value}
                onSelect={handleSelect}
                showSeat={showSeat}
              />
            ))}
          </CommandGroup>
        )}

        {showManage && (
          <>
            {!isEmpty && <CommandSeparator />}
            <CommandGroup aria-label='Profile settings'>
              <CommandItem value='__manage__' onSelect={handleManage}>
                <Settings2 className='size-4 text-muted-foreground' />
                <span>Manage profiles</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </>
  )
}
