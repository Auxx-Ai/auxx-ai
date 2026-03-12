import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import React, { useState } from 'react'
import type { SidebarProps } from '~/constants/menu'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useIsMobile } from '~/hooks/use-mobile'
import { useUser } from '~/hooks/use-user'

type Props = { items: SidebarProps[]; baseUrl: string; title: string; current: string | undefined }

function SidebarSecondary({ items, baseUrl, title, current }: Props) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const isMobile = useIsMobile()
  const selfHosted = useIsSelfHosted()

  const { isAdminOrOwner } = useUser({
    requireOrganization: true, // Require organization membership
  })
  const role = isAdminOrOwner ? 'ADMIN' : 'USER'

  return (
    // <div className='flex h-full min-h-screen w-[16rem] overflow-auto border-r bg-sidebar text-sidebar-foreground'>
    <div className='flex md:w-[16rem] overflow-auto md:border-r bg-neutral-50 dark:bg-sidebar text-sidebar-foreground'>
      <div className='flex w-full flex-col'>
        {/* Mobile toggle button */}
        {isMobile && (
          <div className='sticky top-0 z-10 bg-neutral-50 dark:bg-primary-50 border-b border-neutral-200 dark:border-primary-200 p-2'>
            <Button
              variant='ghost'
              className='w-full justify-between h-10 px-3'
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
              <span className='font-medium'>{title}</span>
              {isDropdownOpen ? (
                <ChevronUp className='h-4 w-4' />
              ) : (
                <ChevronDown className='h-4 w-4' />
              )}
            </Button>
          </div>
        )}

        <div
          id='dropdown'
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden transition-all duration-300 ease-in-out',
            // Mobile-specific classes
            isMobile && !isDropdownOpen && 'max-h-0 overflow-hidden',
            isMobile && isDropdownOpen && 'max-h-[70vh]',
            // Desktop always visible
            !isMobile && 'block'
          )}>
          {items.map((group) => (
            <React.Fragment key={group.id}>
              {createSidebarGroup(group, baseUrl, current, role, selfHosted)}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

function createSidebarGroup(
  group: SidebarProps,
  baseUrl: string,
  current: string | undefined,
  role: 'ADMIN' | 'USER',
  selfHosted: boolean
) {
  const title = group.label
  // Filter out cloud-only items in self-hosted mode
  const items = selfHosted ? group.items?.filter((item) => !item.cloudOnly) : group.items
  if (!items || items.length === 0) {
    return null
  }
  if (group.access && role !== group.access) {
    return null
  }

  return (
    <div className='relative flex w-full min-w-0 flex-col p-2 group-data-[collapsible=icon]:hidden'>
      <div
        className={cn(
          'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden',
          'ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2',
          'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 [&>svg]:size-4 [&>svg]:shrink-0'
        )}>
        {title}
      </div>
      <ul className='flex w-full min-w-0 flex-col gap-1'>
        {items.map((item) => (
          <li className='group/menu-item relative' key={item.id}>
            <Link
              prefetch={false}
              href={`${baseUrl}/${item.slug}`}
              data-active={item.slug == current}
              className={cn(
                'peer/menu-button flex h-7 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring text-neutral-500 dark:text-sidebar-foreground',
                'transition-[width,height,padding] hover:bg-black/5 dark:hover:bg-sidebar-accent hover:text-foreground dark:hover:text-sidebar-accent-foreground focus-visible:ring-2',
                'active:bg-black/5 dark:active:bg-sidebar-accent active:text-foreground disabled:pointer-events-none disabled:opacity-50',
                'group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50',
                'data-[active=true]:bg-black/5 dark:data-[active=true]:bg-sidebar-accent dark:data-[active=true]:hover:bg-sidebar-accent data-[active=true]:text-foreground',
                'data-[state=open]:hover:bg-black/5 data-[state=open]:hover:text-foreground ',
                'group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0'
              )}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default SidebarSecondary
