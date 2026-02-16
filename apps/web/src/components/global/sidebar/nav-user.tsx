'use client'

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
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@auxx/ui/components/sidebar'
import { getInitialsFromName } from '@auxx/utils'
import {
  BadgeCheck,
  Building2,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Moon,
  Plus,
  Sparkles,
  Sun,
  SunMoon,
} from 'lucide-react'
// import { auth, signOut } from "~/server/auth";
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
// import { signOut } from 'next-auth/react'
import { client } from '~/auth/auth-client' // Use the correct import for your auth library
import { useAnalytics } from '~/hooks/use-analytics'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useUser } from '~/hooks/use-user'
import { CreateOrganizationDialog } from '../create-org-dialog'

type Prop = {
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean | null
    image: string | null
  }
}

export function NavUser({ user }: Prop) {
  const { isMobile } = useSidebar()
  const [showNewOrgDialog, setShowNewOrgDialog] = useState(false)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const router = useRouter()
  const posthog = useAnalytics()
  const selfHosted = useIsSelfHosted()
  // const session = await auth();
  const {
    user: userData, // Full user data
    organizationId, // Active organization ID
    isLoading, // Whether data is still loading
    switchOrganization, // Function to switch organizations
  } = useUser({
    requireOrganization: true, // Require organization membership
    //requireRoles: ['ADMIN', 'OWNER'], // Require specific roles (optional)
  })
  // const handleLogout = async () => {
  //   "use server";
  // };

  const initials = getInitialsFromName(user.name, 'U')

  useEffect(() => {
    if (organizationId !== activeOrgId) {
      setActiveOrgId(organizationId)
    }
  }, [organizationId, activeOrgId])
  const handleClickOrganization = (organizationId: string) => {
    if (organizationId !== activeOrgId) {
      setActiveOrgId(organizationId)
      // setDefaultOrg.mutate({ organizationId })
      switchOrganization(organizationId) // Update the active organization
    }
  }
  const { theme, setTheme } = useTheme()
  return (
    <>
      <CreateOrganizationDialog open={showNewOrgDialog} onOpenChange={setShowNewOrgDialog} />

      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size='lg'
                className='ps-1 pe-1.5  h-10 rounded-2xl ring-1 ring-ring/20  data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'>
                <Avatar className='size-7 rounded-full ring-1 ring-ring/20'>
                  <AvatarImage src={user.image!} alt={user.name} />
                  <AvatarFallback className='rounded-lg'>{initials}</AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user.name}</span>
                  <span className='truncate text-xs'>{user.email}</span>
                </div>
                <ChevronsUpDown className='ml-auto size-4' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
              // side={isMobile ? 'bottom' : 'right'}
              align='start'
              sideOffset={-42}>
              <DropdownMenuLabel className='p-0 font-normal'>
                <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                  <Avatar className='size-7 rounded-full ring-1 ring-ring/20'>
                    <AvatarImage src={user.image!} alt={user.name} />
                    <AvatarFallback className='rounded-lg'>{initials}</AvatarFallback>
                  </Avatar>
                  <div className='grid flex-1 text-left text-sm leading-tight'>
                    <span className='truncate font-semibold'>{user.name}</span>
                    <span className='truncate text-xs'>{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!selfHosted && (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <Link href='/app/settings/plans'>
                        <Sparkles className='text-comparison-500' />
                        Upgrade to Pro
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Building2 />
                    Switch Organization
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className='min-w-56'>
                      <DropdownMenuLabel className='text-xs text-muted-foreground'>
                        Organizations
                      </DropdownMenuLabel>

                      <DropdownMenuRadioGroup
                        value={activeOrgId!}
                        onValueChange={handleClickOrganization}>
                        {isLoading
                          ? ''
                          : userData?.memberships.map((membership) => (
                              <DropdownMenuRadioItem
                                value={membership.organization.id}
                                key={membership.organization.id}
                                className='gap-2 p-1 pr-3'>
                                <div className='flex size-5 items-center justify-center rounded-full border'>
                                  <Building2 className='size-3 shrink-0' />
                                </div>
                                {membership.organization.name}
                              </DropdownMenuRadioItem>
                            ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <Link href='/app/settings/organization'>
                        <DropdownMenuItem>
                          <div className='flex size-5 -ml-1 items-center justify-center rounded-full border bg-background'>
                            <Building2 className='size-3' />
                          </div>
                          <div className=''>View all</div>
                        </DropdownMenuItem>
                      </Link>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowNewOrgDialog(true)}>
                        <div className='flex size-5 -ml-1 items-center justify-center rounded-full border bg-background'>
                          <Plus className='size-3' />
                        </div>
                        <div className='font-medium text-muted-foreground'>Add Organization</div>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <Link href='/app/settings/general'>
                  <DropdownMenuItem>
                    <BadgeCheck />
                    Account
                  </DropdownMenuItem>
                </Link>
                {!selfHosted && (
                  <DropdownMenuItem asChild>
                    <Link href='/app/settings/plans'>
                      <CreditCard />
                      Billing
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <SunMoon />
                  Theme
                  <RadioTab
                    value={theme}
                    onValueChange={setTheme}
                    size='sm'
                    radioGroupClassName='grid w-16'
                    className='border h-6 border-primary-200 flex ml-auto '>
                    <RadioTabItem value='light' size='sm' className=''>
                      <Sun />
                    </RadioTabItem>
                    <RadioTabItem value='dark' size='sm' className=''>
                      <Moon />
                    </RadioTabItem>
                  </RadioTab>
                </DropdownMenuItem>

                {/* <DropdownMenuItem>
                  <Bell />
                  Notifications
                </DropdownMenuItem> */}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  client.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        posthog?.reset()
                        router.push('/') // redirect to login page
                      },
                    },
                  })
                }}>
                <LogOut />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
