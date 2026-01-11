// apps/web/src/components/tasks/ui/task-dialog.tsx

'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Calendar, Link2, User, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@auxx/ui/components/dialog'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { Kbd } from '@auxx/ui/components/kbd'
import { cn } from '@auxx/ui/lib/utils'
import { MentionNode } from '~/components/editor/extensions/mention-node'
import { createMentionExtension } from '~/components/editor/extensions/mention-extension'
import { type MentionItem } from '~/components/editor/mention-popover'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { AssigneePicker, type TeamMember } from '~/components/pickers/assignee-picker'
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'
import { useTaskMutations } from '../hooks/use-task-mutations'
import { api } from '~/trpc/react'
import { TextDateParser, DateLanguageModule } from '@auxx/lib/tasks/client'
import type { TaskWithRelations, CreateTaskInput, UpdateTaskInput } from '@auxx/lib/tasks'
import { Tooltip } from '~/components/global/tooltip'
import { SubmitOnEnter } from '~/components/global/comments/comment-composer'
import { toastSuccess } from '@auxx/ui/components/toast'

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
 * Auto-parses date expressions from text and sets deadline automatically.
 */
export function TaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  defaultReferencedEntity,
}: TaskDialogProps) {
  // Form state
  const [deadline, setDeadline] = useState<Date | undefined>(undefined)
  const [deadlineManuallySet, setDeadlineManuallySet] = useState(false)
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([])
  const [createMore, setCreateMore] = useState(false)

  // Mutations
  const { createTask, updateTask, isCreating, isUpdating } = useTaskMutations()
  const isSaving = isCreating || isUpdating

  // Create parser and date module (memoized)
  const textDateParser = useMemo(() => new TextDateParser(), [])
  const dateModule = useMemo(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return new DateLanguageModule(timezone)
  }, [])

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
    return `<p>${task.title}</p>`
  }, [task])

  // Ref to track handleSave for SubmitOnEnter extension (updated after handleSave is defined)
  const handleSaveRef = useRef<() => void>(() => {})

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
        SubmitOnEnter.configure({
          isExpanded: () => false,
          onSubmit: () => {
            handleSaveRef.current()
          },
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none',
            'dark:prose-invert'
          ),
        },
      },
    },
    [teamMembers, fetchMentionItems]
  )

  /**
   * Handle editor text change - auto-set deadline if not manually set
   */
  const handleEditorUpdate = useCallback(() => {
    if (!editor || deadlineManuallySet) {
      return
    }

    const text = editor.getText().trim()
    const result = textDateParser.parse(text)

    if (result.found && result.duration && result.confidence >= 0.7) {
      const calculatedDate = dateModule.calculateTargetDate(result.duration)
      setDeadline(calculatedDate)
    } else {
      setDeadline(undefined)
    }
  }, [editor, textDateParser, dateModule, deadlineManuallySet])

  // Add editor update listener
  useEffect(() => {
    if (!editor) return

    editor.on('update', handleEditorUpdate)
    return () => {
      editor.off('update', handleEditorUpdate)
    }
  }, [editor, handleEditorUpdate])

  // Reset form when task changes or dialog opens
  useEffect(() => {
    if (open) {
      if (task) {
        const content = `<p>${task.title}</p>`
        editor?.commands.setContent(content)
        setDeadline(task.deadline ? new Date(task.deadline) : undefined)
        setDeadlineManuallySet(!!task.deadline)
        setAssignedUserIds(
          (task.assignments?.map((a) => a.assignedTo?.id).filter(Boolean) as string[]) ?? []
        )
      } else {
        editor?.commands.clearContent()
        setDeadline(undefined)
        setDeadlineManuallySet(false)
        setAssignedUserIds([])
      }
      setTimeout(() => editor?.commands.focus(), 100)
    }
  }, [task, open, editor])

  /**
   * Handle manual deadline change from date picker
   * This marks the deadline as "manually set" and stops auto-parsing
   */
  const handleDeadlineChange = useCallback((date: Date | undefined) => {
    setDeadline(date)
    if (date !== undefined) {
      setDeadlineManuallySet(true)
    }
  }, [])

  /**
   * Handle clearing the deadline - re-enables auto-parsing
   */
  const handleDeadlineClear = useCallback(() => {
    setDeadline(undefined)
    setDeadlineManuallySet(false)
    // Trigger re-parse after state update
    // setTimeout(() => {
    //   if (editor) {
    //     const text = editor.getText().trim()
    //     const result = textDateParser.parse(text)
    //     if (result.found && result.duration && result.confidence >= 0.7) {
    //       const calculatedDate = dateModule.calculateTargetDate(result.duration)
    //       setDeadline(calculatedDate)
    //     }
    //   }
    // }, 0)
  }, [editor, textDateParser, dateModule])

  /**
   * Reset form state for creating another task
   */
  const resetForm = useCallback(() => {
    editor?.commands.clearContent()
    setDeadline(undefined)
    setDeadlineManuallySet(false)
    setAssignedUserIds([])
    setTimeout(() => editor?.commands.focus(), 100)
  }, [editor])

  /**
   * Handle save button click
   */
  const handleSave = useCallback(async () => {
    if (!editor) return

    const html = editor.getHTML()
    if (isEmptyContent(html)) return

    const text = editor.getText().trim()
    const lines = text.split('\n')
    const title = lines[0]?.trim() || ''
    const description = html

    if (!title) return

    if (mode === 'create') {
      const input: CreateTaskInput = {
        title,
        description,
        deadline: deadline ? { type: 'static', value: deadline.toISOString() } : undefined,
        assignedUserIds,
        referencedEntities: defaultReferencedEntity ? [defaultReferencedEntity] : undefined,
      }
      createTask.mutate(input)
      toastSuccess({ title: 'Task created' })
    } else if (task) {
      const input: UpdateTaskInput = {
        id: task.id,
        title,
        description,
        deadline: deadline ? { type: 'static', value: deadline.toISOString() } : null,
        assignedUserIds,
      }
      updateTask.mutate(input)
    }

    // If createMore is enabled and we're in create mode, reset form instead of closing
    if (createMore && mode === 'create') {
      resetForm()
    } else {
      onOpenChange(false)
    }
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
    createMore,
    resetForm,
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

  // Update handleSaveRef with current handleSave function
  handleSaveRef.current = handleSave

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
          <EditorContent editor={editor} className="w-full bg-transparent text-sm outline-hidden" />
        </div>

        {/* Footer with pickers and actions (merged inline) */}
        <DialogFooter className="border-t py-1 px-4">
          <div className="flex items-center justify-between w-full">
            {/* Left side: Pickers */}
            <div className="flex items-center gap-1">
              {/* Date Picker with clear button */}
              <DateTimePicker
                value={deadline}
                onChange={handleDeadlineChange}
                mode="date"
                noConfirm
                placeholder="Due date">
                <Button variant="ghost" size="sm">
                  <Calendar />
                  {deadline ? formatTaskDeadlineDisplay(deadline) : 'Due date'}
                </Button>
              </DateTimePicker>

              {/* Clear deadline button (shown when deadline is set) */}
              {deadline && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleDeadlineClear}
                  title="Clear deadline">
                  <X className="h-3 w-3" />
                </Button>
              )}

              {/* Assignee Picker */}
              <AssigneePicker
                selected={assignedUserIds}
                onChange={handleAssigneeChange}
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
              {/* Create more toggle - only shown in create mode */}
              {mode === 'create' && (
                <label
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'gap-2 cursor-pointer'
                  )}>
                  <span className="text-muted-foreground text-xs">Create more</span>
                  <Switch
                    size="sm"
                    checked={createMore}
                    onCheckedChange={setCreateMore}
                    disabled={isSaving}
                  />
                </label>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving && !createMore}>
                Cancel <Kbd shortcut="esc" size="sm" variant="outline" />
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                loading={isSaving && !createMore}
                loadingText="Saving...">
                Save <Kbd shortcut="enter" size="sm" variant="default" />
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
