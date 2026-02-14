// /app/settings/inbox/_components/member-group-form-field.tsx
'use client'

// import { MemberGroupPicker } from './member-group-popover'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { Plus, User, Users, X } from 'lucide-react'
import { type Control, useController } from 'react-hook-form'
import { useMembersGroups } from '~/hooks/use-members-groups'
// import { useMembersAndGroups } from '../_hooks/use-members-and-groups'
import { MemberGroupPicker } from './member-group-picker'

interface MemberGroupFormFieldProps {
  name: string
  control: Control<any>
  label: string
  description?: string
  disabled?: boolean
}

/**
 * Form field component for selecting members and groups with react-hook-form
 */
export function MemberGroupFormField({
  name,
  control,
  label,
  description,
  disabled = false,
}: MemberGroupFormFieldProps) {
  // Load all members and groups for reference (without search filter)
  const { members, groups } = useMembersGroups()

  // Get form field from react-hook-form
  const { field } = useController({ name, control, defaultValue: { memberIds: [], groupIds: [] } })

  // Find member and group objects by their IDs
  const selectedMembers = members.filter((m) => field.value?.memberIds?.includes(m.id))

  const selectedGroups = groups.filter((g) => field.value?.groupIds?.includes(g.id))

  // Handle selection changes
  const handleSelectionChange = (selection: { memberIds: string[]; groupIds: string[] }) => {
    field.onChange(selection)
  }

  // Handle removing a member
  const handleRemoveMember = (memberId: string) => {
    const newSelection = {
      ...field.value,
      memberIds: field.value.memberIds.filter((id: string) => id !== memberId),
    }
    field.onChange(newSelection)
  }

  // Handle removing a group
  const handleRemoveGroup = (groupId: string) => {
    const newSelection = {
      ...field.value,
      groupIds: field.value.groupIds.filter((id: string) => id !== groupId),
    }
    field.onChange(newSelection)
  }

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: formField }) => (
        <FormItem>
          {/* <FormLabel>{label}</FormLabel> */}
          <FormControl>
            <div className='space-y-3'>
              {/* Selection summary */}
              <div className='flex flex-wrap gap-2'>
                {selectedGroups.map((group) => (
                  <Badge
                    key={`group-${group.id}`}
                    variant='secondary'
                    className='flex items-center gap-1 py-1.5 pl-1.5'>
                    <Users className='h-3.5 w-3.5' />
                    <span>{group.name}</span>
                    <button
                      type='button'
                      onClick={() => handleRemoveGroup(group.id)}
                      className='ml-1 rounded-full hover:bg-muted-foreground/20'
                      disabled={disabled}>
                      <X className='h-3.5 w-3.5' />
                      <span className='sr-only'>Remove</span>
                    </button>
                  </Badge>
                ))}

                {selectedMembers.map((member) => (
                  <Badge
                    key={`member-${member.id}`}
                    variant='outline'
                    className='flex items-center gap-1 py-1.5'>
                    <User className='h-3.5 w-3.5' />
                    <span>{member.name}</span>
                    <button
                      type='button'
                      onClick={() => handleRemoveMember(member.id)}
                      className='ml-1 rounded-full hover:bg-muted-foreground/20'
                      disabled={disabled}>
                      <X className='h-3.5 w-3.5' />
                      <span className='sr-only'>Remove</span>
                    </button>
                  </Badge>
                ))}

                {selectedGroups.length === 0 && selectedMembers.length === 0 && (
                  <div className='text-sm text-muted-foreground'>No members or groups selected</div>
                )}
              </div>

              {/* Selection popover */}
              <MemberGroupPicker
                selectedMembers={field.value?.memberIds || []}
                selectedGroups={field.value?.groupIds || []}
                onChange={handleSelectionChange}
                disabled={disabled}>
                <Button type='button' variant='outline' size='sm' disabled={disabled}>
                  <Plus />
                  Add Members or Groups
                </Button>
              </MemberGroupPicker>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
