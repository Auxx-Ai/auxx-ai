// apps/web/src/components/tasks/ui/task-dialog.tsx

'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@auxx/ui/components/dialog'
import { cn } from '@auxx/ui/lib/utils'
import { MentionNode } from '~/components/editor/extensions/mention-node'
import { createMentionExtension } from '~/components/editor/extensions/mention-extension'
import { type MentionItem } from '~/components/editor/mention-popover'
import { TaskDialogFooter } from './task-dialog-footer'
import { useTaskMutations } from '../hooks/use-task-mutations'
import { api } from '~/trpc/react'
import type { TaskWithRelations, CreateTaskInput, UpdateTaskInput } from '@auxx/lib/tasks'
import type { TeamMember } from '~/components/pickers/assignee-picker'

/**
 * Props for TaskDialog component
 */
interface TaskDialogProps {
  /** Whether dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Create or edit mode */
  mode: 'create' | 'edit'
  /** Task to edit (required for edit mode) */
  task?: TaskWithRelations
  /** Default entity reference when creating from entity drawer */
  defaultReferencedEntity?: {
    entityInstanceId: string
    entityDefinitionId: string
  }
}

/**
 * Check if editor content is empty (just empty paragraph tags)
 */
function isEmptyContent(html: string): boolean {
  if (!html) return true
  const stripped = html
    .replace(/<p[^>]*>/g, '')
    .replace(/<\/p>/g, '')
    .trim()
  return stripped === ''
}

/**
 * TaskDialog renders a dialog for creating or editing tasks.
 * Uses tiptap editor for rich text input with @mentions.
 */
export function TaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  defaultReferencedEntity,
}: TaskDialogProps) {
  // Form state
  const [deadline, setDeadline] = useState<Date | undefined>(
    task?.deadline ? new Date(task.deadline) : undefined
  )
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(
    (task?.assignments?.map((a) => a.assignedTo?.id).filter(Boolean) as string[]) ?? []
  )

  // Mutations
  const { createTask, updateTask, isCreating, isUpdating } = useTaskMutations()
  const isSaving = isCreating || isUpdating

  // Fetch team members for mentions
  const { data: teamMembers } = api.user.teamMembers.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  })

  /**
   * Fetch mention items for the editor
   */
  const fetchMentionItems = useCallback(
    async (query: string): Promise<MentionItem[]> => {
      if (!teamMembers) return []

      const filtered = teamMembers.filter((member) => {
        if (!query) return true
        const lowerQuery = query.toLowerCase()
        return (
          member.name?.toLowerCase().includes(lowerQuery) ||
          member.email?.toLowerCase().includes(lowerQuery)
        )
      })

      return filtered.map((member) => ({
        id: member.id,
        name: member.name || 'Unknown',
        email: member.email || undefined,
        avatar: (member as any).image || undefined,
      }))
    },
    [teamMembers]
  )

  // Build initial content from task
  const initialContent = useMemo(() => {
    if (!task) return ''
    // Combine title and description for editing
    return `<p>${task.title}</p>`
  }, [task])

  // Initialize tiptap editor
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: false, blockquote: false }),
        MentionNode.configure({}),
        createMentionExtension(fetchMentionItems),
        Placeholder.configure({
          placeholder: 'What needs to be done? Use @mention to notify team members...',
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none',
            'dark:prose-invert min-h-[30px]'
          ),
        },
      },
    },
    [teamMembers, fetchMentionItems]
  )

  // Reset form when task changes or dialog opens
  useEffect(() => {
    if (open) {
      if (task) {
        const content = `<p>${task.title}</p>`
        editor?.commands.setContent(content)
        setDeadline(task.deadline ? new Date(task.deadline) : undefined)
        setAssignedUserIds(
          (task.assignments?.map((a) => a.assignedTo?.id).filter(Boolean) as string[]) ?? []
        )
      } else {
        editor?.commands.clearContent()
        setDeadline(undefined)
        setAssignedUserIds([])
      }
      // Focus editor when dialog opens
      setTimeout(() => editor?.commands.focus(), 100)
    }
  }, [task, open, editor])

  /**
   * Handle save button click
   */
  const handleSave = useCallback(async () => {
    if (!editor) return

    const html = editor.getHTML()
    if (isEmptyContent(html)) return

    // Extract title from first line and description from rest
    const text = editor.getText().trim()
    const lines = text.split('\n')
    const title = lines[0]?.trim() || ''
    const description = html // Store full HTML as description

    if (!title) return

    if (mode === 'create') {
      const input: CreateTaskInput = {
        title,
        description,
        deadline: deadline ? { type: 'static', value: deadline.toISOString() } : undefined,
        assignedUserIds,
        referencedEntities: defaultReferencedEntity ? [defaultReferencedEntity] : undefined,
      }
      await createTask.mutateAsync(input)
    } else if (task) {
      const input: UpdateTaskInput = {
        id: task.id,
        title,
        description,
        deadline: deadline ? { type: 'static', value: deadline.toISOString() } : null,
        assignedUserIds,
      }
      await updateTask.mutateAsync(input)
    }

    onOpenChange(false)
  }, [
    editor,
    mode,
    task,
    deadline,
    assignedUserIds,
    defaultReferencedEntity,
    createTask,
    updateTask,
    onOpenChange,
  ])

  /**
   * Handle cancel button click
   */
  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  /**
   * Handle assignee change
   */
  const handleAssigneeChange = useCallback((members: TeamMember[]) => {
    setAssignedUserIds(members.map((m) => m.id))
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="tc" size="xl" innerClassName="p-0">
        <DialogHeader className="border-b px-3 py-2 mb-0 h-10 ">
          <DialogTitle className="text-base font-medium">
            {mode === 'create' ? 'Create task' : 'Edit task'}
          </DialogTitle>
          <DialogDescription className="sr-only">Template selector</DialogDescription>
        </DialogHeader>

        {/* Editor Area */}
        <div className="p-4">
          <EditorContent
            editor={editor}
            className="w-full bg-transparent text-sm outline-hidden min-h-[30px]"
          />
        </div>

        {/* Footer with pickers and actions */}
        <DialogFooter className="border-t py-1 px-4">
          <TaskDialogFooter
            deadline={deadline}
            onDeadlineChange={setDeadline}
            assignedUserIds={assignedUserIds}
            onAssigneeChange={handleAssigneeChange}
            onCancel={handleCancel}
            onSave={handleSave}
            isSaving={isSaving}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
