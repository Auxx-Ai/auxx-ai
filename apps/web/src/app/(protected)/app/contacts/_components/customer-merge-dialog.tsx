// apps/web/src/app/(protected)/app/contacts/_components/customer-merge-dialog.tsx
import { useState, useEffect } from 'react'
import { api } from '~/trpc/react'
import { useContactMutations } from './use-contact-mutations'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Search, UserCog, AlertCircle, Lock } from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'

interface CustomerMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** IDs of customers to pre-select for merging */
  customerIds?: string[]
  /** ID of the contact to merge others into (locked, cannot be unchecked, primary by default) */
  mergeWithId?: string
  onSuccess: () => void
}

/**
 * CustomerMergeDialog allows merging multiple customer records into one.
 * When mergeWithId is provided, that contact is locked as primary and cannot be unchecked.
 */
export default function CustomerMergeDialog({
  open,
  onOpenChange,
  customerIds = [],
  mergeWithId,
  onSuccess,
}: CustomerMergeDialogProps) {
  const [search, setSearch] = useState('')
  const [selectedCustomers, setSelectedCustomers] = useState<Record<string, boolean>>({})
  const [primaryContactId, setPrimaryContactId] = useState<string>('')

  // Stringify customerIds for stable dependency comparison
  const customerIdsKey = customerIds.join(',')

  // Clear selections when dialog opens/closes
  useEffect(() => {
    if (open) {
      // Pre-select the passed in customer IDs
      const initialSelection: Record<string, boolean> = {}

      // If mergeWithId is provided, always include it
      if (mergeWithId) {
        initialSelection[mergeWithId] = true
      }

      // Add any additional customerIds
      customerIds.forEach((id) => {
        initialSelection[id] = true
      })

      setSelectedCustomers(initialSelection)

      // Set primary: mergeWithId takes priority, otherwise first customerIds
      if (mergeWithId) {
        setPrimaryContactId(mergeWithId)
      } else if (customerIds.length > 0) {
        setPrimaryContactId(customerIds[0])
      }
    } else {
      setSearch('')
      setSelectedCustomers({})
      setPrimaryContactId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerIdsKey, mergeWithId])

  // Query customers for merging
  const { data: searchResults } = api.contact.getAll.useQuery(
    { search: search || undefined, limit: 10, status: 'ACTIVE' },
    { enabled: open && search.length > 2 }
  )

  // Query customer details for selected IDs
  const { data: customerDetails } = api.contact.getCustomersByIds.useQuery(
    { ids: Object.keys(selectedCustomers).filter((id) => selectedCustomers[id]) },
    { enabled: open && Object.keys(selectedCustomers).some((id) => selectedCustomers[id]) }
  )

  // Merge mutation
  const mutations = useContactMutations({
    onSuccess: () => {
      onSuccess()
      onOpenChange(false)
    },
  })

  const handleSelectCustomer = (id: string, checked: boolean) => {
    // Prevent unchecking the mergeWithId - it's locked
    if (id === mergeWithId && !checked) {
      return
    }

    setSelectedCustomers((prev) => ({ ...prev, [id]: checked }))

    // Set as primary if it's the first one selected (and not mergeWithId which is already primary)
    if (checked && !primaryContactId) {
      setPrimaryContactId(id)
    }

    // If current primary is deselected, pick another (but mergeWithId stays primary if it exists)
    if (!checked && id === primaryContactId) {
      if (mergeWithId) {
        setPrimaryContactId(mergeWithId)
      } else {
        const nextPrimary = Object.keys(selectedCustomers).find(
          (custId) => custId !== id && selectedCustomers[custId]
        )
        setPrimaryContactId(nextPrimary || '')
      }
    }
  }

  const handleSetPrimary = (id: string) => {
    setPrimaryContactId(id)
  }

  const handleMerge = () => {
    const customerIdsToMerge = Object.keys(selectedCustomers).filter(
      (id) => selectedCustomers[id] && id !== primaryContactId
    )

    if (!primaryContactId || customerIdsToMerge.length === 0) {
      toastError({
        title: 'Cannot merge',
        description: 'Please select a primary customer and at least one other customer to merge',
      })
      return
    }

    mutations.mergeContacts.mutate({ primaryContactId, customerIdsToMerge })
  }

  const selectedCount = Object.values(selectedCustomers).filter(Boolean).length
  const canMerge = primaryContactId && selectedCount >= 2

  // Check if a customer is the locked mergeWithId
  const isLocked = (id: string) => id === mergeWithId

  // Register Meta+Enter submit handler
  useDialogSubmit({
    onSubmit: handleMerge,
    disabled: !canMerge || mutations.mergeContacts.isPending,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md md:max-w-lg" position="tc">
        <DialogHeader>
          <DialogTitle>Merge Customers</DialogTitle>
          <DialogDescription>
            Combine multiple customer records into a single contact record. All data including
            tickets, orders, and sources will be merged.
          </DialogDescription>
        </DialogHeader>

        <div className=" space-y-4">
          {/* Search for customers */}
          <div className="space-y-2">
            <Label htmlFor="search">Search Customers</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search by name or email..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Search results */}
          {search.length > 2 && searchResults?.items && (
            <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
              {searchResults.items.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">No customers found</p>
              ) : (
                searchResults.items.map((customer) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between p-2 hover:bg-muted/50">
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {customer.firstName || customer.lastName
                          ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
                          : 'Unnamed Customer'}
                      </p>
                      <p className="text-xs text-muted-foreground">{customer.email}</p>
                    </div>
                    <Checkbox
                      checked={!!selectedCustomers[customer.id]}
                      disabled={isLocked(customer.id)}
                      onCheckedChange={(checked) =>
                        handleSelectCustomer(customer.id, checked === true)
                      }
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* Selected customers */}
          <div className="space-y-2">
            <Label>Selected Customers ({selectedCount})</Label>
            {customerDetails?.length ? (
              <div className="max-h-60 divide-y overflow-y-auto rounded-md border">
                {customerDetails.map((customer) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {customer.firstName || customer.lastName
                            ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
                            : 'Unnamed Customer'}
                        </p>
                        {primaryContactId === customer.id && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                            Primary
                          </span>
                        )}
                        {isLocked(customer.id) && (
                          <Lock className="size-3 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{customer.email}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {customer.customerSources?.length || 0} sources
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {customer._count?.tickets || 0} tickets
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {customer.shopifyCustomers?.length || 0} shop accounts
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedCount >= 2 && !isLocked(customer.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(customer.id)}
                          disabled={primaryContactId === customer.id}>
                          <UserCog />
                          <span className="sr-only">Set as primary</span>
                        </Button>
                      )}
                      <Checkbox
                        checked={!!selectedCustomers[customer.id]}
                        disabled={isLocked(customer.id)}
                        onCheckedChange={(checked) =>
                          handleSelectCustomer(customer.id, checked === true)
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No customers selected</p>
            )}
          </div>

          {/* Warning */}
          {selectedCount >= 2 && (
            <div className="flex items-start rounded-md bg-amber-50 p-3 text-amber-800">
              <AlertCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Important</p>
                <p>
                  After merging, all data will be consolidated into the primary customer record.
                  Other customer records will be marked as "merged" and remain in the system as
                  references but will no longer be active.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutations.mergeContacts.isPending}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            onClick={handleMerge}
            size="sm"
            variant="outline"
            disabled={!canMerge || mutations.mergeContacts.isPending}
            loading={mutations.mergeContacts.isPending}
            loadingText="Merging...">
            Merge Customers <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
