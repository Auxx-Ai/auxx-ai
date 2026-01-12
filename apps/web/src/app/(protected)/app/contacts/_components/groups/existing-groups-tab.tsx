// ~/app/(protected)/app/contacts/_components/groups/existing-groups-tab.tsx
import { useState, useEffect } from 'react'
import { api } from '~/trpc/react'
import { useContactMutations } from '../use-contact-mutations'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Users, Plus } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import GroupItem from './group-item'

interface ExistingGroupsTabProps {
  groups: any[] // Replace with proper type
  customerGroups: any[] // Replace with proper type
  customerIds: string[]
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  onCreateGroupClick: () => void
}

export default function ExistingGroupsTab({
  groups,
  customerGroups,
  customerIds,
  onOpenChange,
  onSuccess,
  onCreateGroupClick,
}: ExistingGroupsTabProps) {
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({})

  // Pre-select groups that all customers belong to
  useEffect(() => {
    if (customerGroups && customerIds.length > 0) {
      const commonGroups: Record<string, boolean> = {}
      customerGroups.forEach((group) => {
        // Check if all customers belong to this group
        const allBelong = customerIds.every(
          (customerId) => group.members?.some((member) => member.contactId === customerId) ?? false
        )

        if (allBelong) {
          commonGroups[group.id] = true
        }
      })
      setSelectedGroups(commonGroups)
    }
  }, [customerGroups, customerIds])

  // Use contact mutations hook
  const mutations = useContactMutations({
    onSuccess: () => {
      onSuccess()
      onOpenChange(false)
    },
  })

  const handleToggleGroup = (groupId: string, checked: boolean) => {
    setSelectedGroups((prev) => ({ ...prev, [groupId]: checked }))
  }

  const handleSaveGroups = async () => {
    if (customerIds.length === 0) {
      toastError({
        title: 'No customers selected',
        description: 'Please select at least one customer to manage groups',
      })
      return
    }

    // Get groups to add/remove
    const groupsToAdd: string[] = []
    const groupsToRemove: string[] = []

    if (groups) {
      groups.forEach((group) => {
        // Get current membership status for this group
        const allInGroup = customerIds.every((customerId) =>
          customerGroups
            ?.find((g) => g.id === group.id)
            ?.members?.some((member) => member.contactId === customerId)
        )

        // Selected but not all customers in group -> add missing ones
        if (selectedGroups[group.id] && !allInGroup) {
          groupsToAdd.push(group.id)
        }

        // Not selected but some/all customers in group -> remove them
        if (
          !selectedGroups[group.id] &&
          customerGroups?.find((g) => g.id === group.id)?.members?.length
        ) {
          groupsToRemove.push(group.id)
        }
      })
    }

    // Perform mutations sequentially
    try {
      if (groupsToAdd.length > 0) {
        for (const groupId of groupsToAdd) {
          await mutations.addToGroup.mutateAsync({ groupId, customerIds })
        }
      }

      if (groupsToRemove.length > 0) {
        for (const groupId of groupsToRemove) {
          await mutations.removeFromGroup.mutateAsync({ groupId, customerIds })
        }
      }

      // If no changes were made, just close the dialog
      if (groupsToAdd.length === 0 && groupsToRemove.length === 0) {
        onOpenChange(false)
      }
    } catch (error) {
      // Error handling is done in the mutation callbacks
    }
  }

  return (
    <>
      {groups && groups.length > 0 ? (
        <div className="max-h-60 divide-y overflow-y-auto rounded-2xl border">
          {groups.map((group) => {
            // Get current membership count for this group
            const memberCount =
              customerGroups
                ?.find((g) => g.id === group.id)
                ?.members?.filter((member) => customerIds.includes(member.contactId)).length ?? 0

            // Status text
            let statusText = ''
            if (memberCount > 0) {
              statusText =
                memberCount === customerIds.length
                  ? 'All selected customers in group'
                  : `${memberCount}/${customerIds.length} in group`
            }

            return (
              <GroupItem
                key={group.id}
                group={group}
                isSelected={!!selectedGroups[group.id]}
                statusText={statusText}
                onToggle={(checked) => handleToggleGroup(group.id, checked)}
              />
            )
          })}
        </div>
      ) : (
        <EmptyGroupsState onCreateClick={onCreateGroupClick} />
      )}

      {groups && groups.length > 0 && (
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={mutations.addToGroup.isPending || mutations.removeFromGroup.isPending}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            data-dialog-submit
            onClick={handleSaveGroups}
            size="sm"
            variant="outline"
            loading={mutations.addToGroup.isPending || mutations.removeFromGroup.isPending}
            loadingText="Saving...">
            Save Changes <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      )}
    </>
  )
}

// Empty state component
function EmptyGroupsState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="py-8 text-center">
      <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-medium">No groups found</h3>
      <p className="mb-4 text-muted-foreground">
        Create your first customer group to organize your customers.
      </p>
      <Button variant="outline" onClick={onCreateClick}>
        <Plus /> Create Group
      </Button>
    </div>
  )
}
