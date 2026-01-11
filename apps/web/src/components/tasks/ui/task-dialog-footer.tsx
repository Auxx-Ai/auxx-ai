// apps/web/src/components/tasks/ui/task-dialog-footer.tsx

'use client'

import { Calendar, Link2, User } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { AssigneePicker, type TeamMember } from '~/components/pickers/assignee-picker'
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'

/**
 * Props for TaskDialogFooter component
 */
interface TaskDialogFooterProps {
  /** Current deadline value */
  deadline: Date | undefined
  /** Callback when deadline changes */
  onDeadlineChange: (date: Date | undefined) => void
  /** Currently assigned user IDs */
  assignedUserIds: string[]
  /** Callback when assignees change */
  onAssigneeChange: (members: TeamMember[]) => void
  /** Cancel button handler */
  onCancel: () => void
  /** Save button handler */
  onSave: () => void
  /** Whether save is in progress */
  isSaving: boolean
}

/**
 * TaskDialogFooter renders the footer of the task dialog.
 * Contains date picker, assignee picker, record linking placeholder, and action buttons.
 */
export function TaskDialogFooter({
  deadline,
  onDeadlineChange,
  assignedUserIds,
  onAssigneeChange,
  onCancel,
  onSave,
  isSaving,
}: TaskDialogFooterProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Left side: Pickers */}
      <div className="flex items-center gap-1">
        {/* Date Picker */}
        <DateTimePicker
          value={deadline}
          onChange={onDeadlineChange}
          mode="date"
          placeholder="Due date">
          <Button variant="ghost" size="sm">
            <Calendar />
            {deadline ? formatTaskDeadlineDisplay(deadline) : 'Due date'}
          </Button>
        </DateTimePicker>

        {/* Assignee Picker */}
        <AssigneePicker
          selected={assignedUserIds}
          onChange={onAssigneeChange}
          allowMultiple
          placeholder="Assignee"
          size="sm">
          <Button variant="ghost" size="sm">
            <User />
            {assignedUserIds.length > 0 ? `${assignedUserIds.length} assigned` : 'Assignee'}
          </Button>
        </AssigneePicker>

        {/* Record Linking (placeholder) */}
        <Button variant="ghost" size="sm" disabled>
          <Link2 />
          Link record
        </Button>
      </div>

      {/* Right side: Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} loading={isSaving} loadingText="Saving...">
          Save
        </Button>
      </div>
    </div>
  )
}
