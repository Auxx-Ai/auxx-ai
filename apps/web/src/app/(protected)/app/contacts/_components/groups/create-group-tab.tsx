// ~/app/(protected)/app/contacts/_components/groups/create-group-tab.tsx
import { useState } from 'react'
import { useContactMutations } from '../use-contact-mutations'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Info } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

interface CreateGroupTabProps {
  customerIds: string[]
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function CreateGroupTab({
  customerIds,
  onOpenChange,
  onSuccess,
}: CreateGroupTabProps) {
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')

  // Use contact mutations hook
  const mutations = useContactMutations({
    onSuccess: () => {
      onSuccess()
      onOpenChange(false)
    },
  })

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) {
      toastError({
        title: 'Group name required',
        description: 'Please enter a name for the new group',
      })
      return
    }

    mutations.createGroup.mutate({
      name: newGroupName.trim(),
      description: newGroupDescription.trim() || undefined,
      initialMemberIds: customerIds,
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="groupName">Group Name*</Label>
          <Input
            id="groupName"
            placeholder="Enter group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="groupDescription">Description (optional)</Label>
          <Input
            id="groupDescription"
            placeholder="Enter group description"
            value={newGroupDescription}
            onChange={(e) => setNewGroupDescription(e.target.value)}
          />
        </div>

        <div className="flex items-start rounded-md bg-blue-50 p-3 text-blue-800">
          <Info className="mr-2 mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p>
              This will create a new group and add{' '}
              {customerIds.length === 1
                ? 'the selected customer'
                : `all ${customerIds.length} selected customers`}{' '}
              to it.
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleCreateGroup}
          variant="outline"
          disabled={!newGroupName.trim() || mutations.createGroup.isPending}
          loading={mutations.createGroup.isPending}
          loadingText="Creating...">
          Create Group
        </Button>
      </DialogFooter>
    </>
  )
}
