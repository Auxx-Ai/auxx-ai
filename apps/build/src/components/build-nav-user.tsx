// apps/build/src/components/build-nav-user.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@auxx/ui/components/sidebar'
import { getInitialsFromName } from '@auxx/utils'
import {
  Building2,
  ChevronsUpDown,
  LogOut,
  Moon,
  Sun,
  SunMoon,
  User as UserIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { DehydratedBuildUser } from '~/lib/dehydration'
import { useDeveloperAccount, useDeveloperAccounts } from './providers/dehydrated-state-provider'

type Props = {
  user: DehydratedBuildUser
  accountSlug: string
}

/**
 * BuildNavUser - user dropdown in sidebar
 * Shows user info and list of developer accounts
 */
export function BuildNavUser({ user, accountSlug }: Props) {
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const accounts = useDeveloperAccounts()
  const currentAccount = useDeveloperAccount(accountSlug)

  const initials = getInitialsFromName(user.name || user.email || '', 'U')

  const handleLogout = () => {
    window.location.href = '/api/auth/logout'
  }

  const handleSelectAccount = (slug: string) => {
    router.push(`/${slug}`)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'>
              <Avatar className='h-8 w-8 rounded-lg'>
                <AvatarImage src={user.image || ''} alt={user.name || ''} />
                <AvatarFallback className='rounded-lg'>{initials}</AvatarFallback>
              </Avatar>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>
                  {currentAccount?.title || 'Developer Portal'}
                </span>
                <span className='truncate text-xs'>{user.email}</span>
              </div>
              <ChevronsUpDown className='ml-auto size-4' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg'
            align='start'
            sideOffset={-52}>
            <DropdownMenuLabel className='p-0 font-normal'>
              <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                <Avatar className='h-8 w-8 rounded-lg'>
                  <AvatarImage src={user.image || ''} alt={user.name || ''} />
                  <AvatarFallback className='rounded-lg'>{initials}</AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user.name}</span>
                  <span className='truncate text-xs'>{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Developer Accounts Group */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-xs text-muted-foreground px-2 py-1.5'>
                Accounts
              </DropdownMenuLabel>
              {accounts.map((acc) => (
                <DropdownMenuItem
                  key={acc.id}
                  onClick={() => handleSelectAccount(acc.slug)}
                  className={acc.slug === accountSlug ? 'bg-accent text-accent-foreground' : ''}>
                  <Building2 />
                  {acc.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem>
                <UserIcon />
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SunMoon />
                Theme
                <RadioTab
                  value={theme}
                  onValueChange={setTheme}
                  size='sm'
                  radioGroupClassName='grid w-16'
                  className='border h-6 border-primary-200 flex ml-auto'>
                  <RadioTabItem value='light' size='sm'>
                    <Sun />
                  </RadioTabItem>
                  <RadioTabItem value='dark' size='sm'>
                    <Moon />
                  </RadioTabItem>
                </RadioTab>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
