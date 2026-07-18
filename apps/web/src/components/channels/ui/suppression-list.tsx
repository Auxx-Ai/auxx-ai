// apps/web/src/components/channels/ui/suppression-list.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { toastError } from '@auxx/ui/components/toast'
import {
  TREE_SECONDARY_NOTRUNCATE,
  TreeRow,
  TreeRowButton,
  TreeRowSkeleton,
} from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { MailX, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useDeferredValue, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Email-only — suppression matches exact addresses, domains would silently do nothing. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Org-wide sequence suppression list (Suppressions tab on Channels settings).
 * Flat TreeRow list of `SequenceSuppression` rows with search, manual add, and
 * per-row remove (= resubscribe) behind a destructive confirm.
 */
export function SuppressionList() {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [addValue, setAddValue] = useState('')
  const [addError, setAddError] = useState('')

  const listQuery = api.suppression.list.useInfiniteQuery(
    { search: deferredSearch || undefined },
    { getNextPageParam: (last) => last.nextCursor }
  )
  const rows = listQuery.data?.pages.flatMap((page) => page.rows) ?? []

  const addSuppression = api.suppression.add.useMutation({
    onSuccess: () => {
      setAddValue('')
      utils.suppression.list.invalidate()
    },
    onError: (error) =>
      toastError({ title: 'Error suppressing address', description: error.message }),
  })
  const removeSuppression = api.suppression.remove.useMutation({
    onSuccess: () => utils.suppression.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error removing suppression', description: error.message }),
  })

  const handleAdd = () => {
    const normalized = addValue.trim().toLowerCase()
    if (!normalized) return
    if (!EMAIL_RE.test(normalized)) {
      setAddError('Enter a valid email address')
      return
    }
    setAddError('')
    addSuppression.mutate({ email: normalized })
  }

  const handleRemove = async (row: { id: string; email: string; reason: string }) => {
    const confirmed = await confirm({
      title: `Remove ${row.email}?`,
      description:
        row.reason === 'bounce'
          ? 'This address hard-bounced — future sends may fail. Removing the suppression allows sequences to email it again.'
          : 'Removing the suppression allows sequences to email this address again.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeSuppression.mutate({ id: row.id })
  }

  return (
    <SettingsSection
      icon={MailX}
      title='Suppressed addresses'
      description='Addresses sequences will never email — collected from unsubscribes, hard bounces, and manual adds. Removing an entry resubscribes the address.'>
      <div className='space-y-3'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
          <InputGroup className='sm:max-w-xs'>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder='Search by email'
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
            />
          </InputGroup>
          <div className='space-y-1'>
            <InputGroup className='sm:w-80'>
              <InputGroupInput
                placeholder='Suppress an address, e.g. user@example.com'
                value={addValue}
                onChange={(e) => {
                  setAddValue((e.target as HTMLInputElement).value)
                  setAddError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
              />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='xs'
                  onClick={handleAdd}
                  disabled={!addValue.trim() || addSuppression.isPending}>
                  <Plus />
                  Add
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {addError && <p className='text-xs text-destructive'>{addError}</p>}
          </div>
        </div>

        {listQuery.isLoading ? (
          <div className='flex flex-col'>
            {[0, 1, 2].map((i) => (
              <TreeRowSkeleton key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MailX}
            title={deferredSearch ? 'No matches' : 'No suppressed addresses'}
            description={
              deferredSearch
                ? 'No suppressed addresses match your search.'
                : 'Unsubscribes and hard bounces will show up here automatically.'
            }
          />
        ) : (
          <div className={cn('flex flex-col', TREE_SECONDARY_NOTRUNCATE)}>
            {rows.map((row) => (
              <TreeRow
                key={row.id}
                rowClassName='hover:bg-primary-100'
                icon={<MailX className='size-4 text-muted-foreground/60' />}
                title={<span className='font-mono text-sm'>{row.email}</span>}
                secondary={
                  <span className='flex items-center gap-1.5'>
                    <Badge variant='secondary' size='sm'>
                      {row.reason}
                    </Badge>
                    <span className='text-xs text-muted-foreground'>
                      {formatRelativeTime(row.createdAt, true)}
                    </span>
                  </span>
                }
                actions={
                  <>
                    {row.contactEntityInstanceId && (
                      <TreeRowButton
                        tooltipText='View contact'
                        onClick={() => router.push(`/app/contacts/${row.contactEntityInstanceId}`)}>
                        <UserRound />
                      </TreeRowButton>
                    )}
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Remove suppression'
                      onClick={() => void handleRemove(row)}>
                      <Trash2 />
                    </TreeRowButton>
                  </>
                }
              />
            ))}
            {listQuery.hasNextPage && (
              <Button
                variant='ghost'
                size='xs'
                className='mt-1 self-center text-muted-foreground'
                loading={listQuery.isFetchingNextPage}
                onClick={() => void listQuery.fetchNextPage()}>
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog />
    </SettingsSection>
  )
}
