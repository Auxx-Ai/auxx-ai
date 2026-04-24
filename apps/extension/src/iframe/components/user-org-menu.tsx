// apps/extension/src/iframe/components/user-org-menu.tsx

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { getInitialsFromName } from '@auxx/utils'
import { Building2, ChevronsUpDown, LogOut } from 'lucide-react'
import { useState } from 'react'
import type { DehydratedState } from '../trpc'
import { BASE_URL, setDefaultOrganization, signOut } from '../trpc'

type Props = {
  state: DehydratedState
  onOrgSwitched: () => Promise<void> | void
  onSignedOut: () => Promise<void> | void
}

/**
 * Cloned-and-trimmed version of apps/web's NavUser dropdown — header-sized,
 * no sidebar chrome. Drops items that only make sense inside auxx.ai
 * (Upgrade, Account, Billing, Developer Portal, Admin, Theme, Kopilot, Create
 * Organization) and keeps avatar + name + email label, organizations radio
 * group, "View all organizations" deep link, and Sign out.
 */
export function UserOrgMenu({ state, onOrgSwitched, onSignedOut }: Props) {
  const user = state.user as
    | { id: string; name?: string | null; email?: string | null; image?: string | null }
    | null
    | undefined

  const displayName = user?.name ?? 'You'
  const displayEmail = user?.email ?? ''
  const displayImage = user?.image ?? null
  const initials = getInitialsFromName(displayName, 'U')

  const [activeOrgId, setActiveOrgId] = useState(state.organizationId ?? '')
  const [switching, setSwitching] = useState(false)

  const handleSwitch = async (organizationId: string) => {
    if (switching || organizationId === activeOrgId) return
    const prev = activeOrgId
    setActiveOrgId(organizationId) // optimistic
    setSwitching(true)
    try {
      await setDefaultOrganization(organizationId)
      await onOrgSwitched()
    } catch {
      setActiveOrgId(prev) // rollback
    } finally {
      setSwitching(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    await onSignedOut()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='flex h-8 max-w-full items-center gap-2 rounded-2xl border border-transparent px-1 pe-2 text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'>
          <Avatar className='size-6 rounded-full ring-1 ring-ring/20'>
            {displayImage ? <AvatarImage src={displayImage} alt={displayName} /> : null}
            <AvatarFallback className='rounded-full text-[10px]'>{initials}</AvatarFallback>
          </Avatar>
          <span className='min-w-0 truncate font-medium'>{displayName}</span>
          <ChevronsUpDown className='size-3 shrink-0 opacity-60' />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align='start'
        sideOffset={4}
        className='w-(--radix-dropdown-menu-trigger-width) min-w-64'>
        <DropdownMenuLabel className='p-0 font-normal'>
          <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
            <Avatar className='size-7 rounded-full ring-1 ring-ring/20'>
              {displayImage ? <AvatarImage src={displayImage} alt={displayName} /> : null}
              <AvatarFallback className='rounded-full text-[10px]'>{initials}</AvatarFallback>
            </Avatar>
            <div className='grid min-w-0 flex-1 text-left text-sm leading-tight'>
              <span className='truncate font-semibold'>{displayName}</span>
              {displayEmail ? <span className='truncate text-xs'>{displayEmail}</span> : null}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Building2 />
              Switch organization
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className='min-w-56'>
                <DropdownMenuLabel className='text-xs text-muted-foreground'>
                  Organizations
                </DropdownMenuLabel>

                <DropdownMenuRadioGroup value={activeOrgId} onValueChange={handleSwitch}>
                  {state.organizations.map((org) => (
                    <DropdownMenuRadioItem value={org.id} key={org.id} className='gap-2 p-1 pr-3'>
                      <div className='flex size-5 items-center justify-center rounded-full border'>
                        <Building2 className='size-3 shrink-0' />
                      </div>
                      {org.name ?? org.handle ?? org.id}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                  <a
                    href={`${BASE_URL}/app/settings/organization`}
                    target='_blank'
                    rel='noreferrer'
                    className='flex items-center gap-2'>
                    <div className='-ml-1 flex size-5 items-center justify-center rounded-full border bg-background'>
                      <Building2 className='size-3' />
                    </div>
                    View all
                  </a>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
