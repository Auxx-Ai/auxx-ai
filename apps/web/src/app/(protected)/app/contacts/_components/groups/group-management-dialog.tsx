// ~/components/customers/group-management-dialog.tsx
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { api } from '~/trpc/react'
import ExistingGroupsTab from './existing-groups-tab'
import CreateGroupTab from './create-group-tab'

interface GroupManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerIds: string[]
  onSuccess: () => void
}

export default function GroupManagementDialog({
  open,
  onOpenChange,
  customerIds,
  onSuccess,
}: GroupManagementDialogProps) {
  const [activeTab, setActiveTab] = useState<string>('existing')

  // Clear state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setActiveTab('existing')
    }
  }, [open])

  // Query all groups
  const { data: groups, refetch: refetchGroups } = api.contact.getGroups.useQuery(
    {},
    { enabled: open }
  )

  // Query existing groups for these customers
  const { data: customerGroups } = api.contact.getCustomerGroupsByIds.useQuery(
    { customerIds },
    { enabled: open && customerIds.length > 0 }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" position="tc">
        <DialogHeader>
          <DialogTitle>Manage Customer Groups</DialogTitle>
          <DialogDescription>
            {customerIds.length === 1
              ? 'Add or remove this customer from groups'
              : `Add or remove ${customerIds.length} customers from groups`}
          </DialogDescription>
        </DialogHeader>

        <RadioTab
          value={activeTab}
          onValueChange={setActiveTab}
          className="mb-4 w-full p-0.5 border"
          radioGroupClassName="w-full">
          <RadioTabItem value="existing">Existing Groups</RadioTabItem>
          <RadioTabItem value="new">Create New Group</RadioTabItem>
        </RadioTab>

        {activeTab === 'existing' && (
          <ExistingGroupsTab
            groups={groups || []}
            customerGroups={customerGroups || []}
            customerIds={customerIds}
            onOpenChange={onOpenChange}
            onSuccess={() => {
              refetchGroups()
              onSuccess()
            }}
            onCreateGroupClick={() => setActiveTab('new')}
          />
        )}

        {activeTab === 'new' && (
          <CreateGroupTab
            customerIds={customerIds}
            onOpenChange={onOpenChange}
            onSuccess={() => {
              refetchGroups()
              onSuccess()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
