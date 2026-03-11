// apps/web/src/app/admin/developer-accounts/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { DeveloperAccountDrawer } from './_components/developer-account-drawer'

const PAGE_SIZE = 100

/**
 * Developer Accounts list page for admin
 */
export default function DeveloperAccountsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedAccountId, setSelectedAccountId] = useQueryState(
    'selectedAccountId',
    parseAsString.withDefault('')
  )

  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const { data: accounts, isLoading } = api.admin.getDeveloperAccounts.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
  })

  const selectedAccountFromList = accounts?.find((account) => account.id === selectedAccountId)

  const { data: selectedAccountFromQuery } = api.admin.getDeveloperAccount.useQuery(
    { id: selectedAccountId },
    { enabled: !!selectedAccountId && !selectedAccountFromList }
  )

  const selectedAccount = selectedAccountFromList ?? selectedAccountFromQuery ?? undefined
  const isDrawerOpen = !!selectedAccountId

  /** Handle search input change */
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  /** Handle row click - open drawer */
  const handleRowClick = (accountId: string) => {
    setSelectedAccountId(accountId)
  }

  /** Handle drawer open change */
  const handleDrawerOpenChange = (open: boolean) => {
    if (!open) setSelectedAccountId(null)
  }

  /** Docked panel content */
  const dockedPanel =
    isDocked && isDrawerOpen ? (
      <DeveloperAccountDrawer
        account={selectedAccount}
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    ) : undefined

  return (
    <>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem
              title='Developer Accounts'
              href='/admin/developer-accounts'
              last
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
          <MainPageSubheader>
            <div className='relative flex-1'>
              <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                placeholder='Search by name or slug...'
                value={search}
                size='sm'
                onChange={(e) => handleSearch(e.target.value)}
                className='pl-9'
              />
            </div>
          </MainPageSubheader>

          {isLoading ? (
            <div className='space-y-3'>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className='h-12 w-full' />
              ))}
            </div>
          ) : !accounts || accounts.length === 0 ? (
            <div className='flex h-40 items-center justify-center text-muted-foreground'>
              No developer accounts found
            </div>
          ) : (
            <>
              <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
                <div className='overflow-auto flex-1 relative'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className='text-right'>Members</TableHead>
                        <TableHead className='text-right'>Apps</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => (
                        <TableRow
                          key={account.id}
                          className='cursor-pointer'
                          onClick={() => handleRowClick(account.id)}>
                          <TableCell>
                            <div>
                              <div className='font-medium'>{account.title}</div>
                              <div className='text-sm text-muted-foreground'>@{account.slug}</div>
                            </div>
                          </TableCell>
                          <TableCell className='text-right'>{account.memberCount}</TableCell>
                          <TableCell className='text-right'>{account.appCount}</TableCell>
                          <TableCell className='text-muted-foreground'>
                            {formatDistanceToNow(new Date(account.createdAt), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className='border-t py-1 px-2 flex items-center justify-between'>
                <div className='text-sm text-muted-foreground'>
                  Showing {page * PAGE_SIZE + 1} to{' '}
                  {Math.min((page + 1) * PAGE_SIZE, page * PAGE_SIZE + accounts.length)} results
                </div>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}>
                    <ChevronLeft />
                    Previous
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!accounts || accounts.length < PAGE_SIZE}>
                    Next
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          )}
        </MainPageContent>
      </MainPage>

      {/* Drawer - overlay mode only (docked mode handled by dockedPanel above) */}
      {!isDocked && (
        <DeveloperAccountDrawer
          account={selectedAccount}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
        />
      )}
    </>
  )
}
