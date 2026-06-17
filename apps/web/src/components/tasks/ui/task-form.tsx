// apps/web/src/components/tasks/ui/task-form.tsx

'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
import type { CreateTaskInput, TaskWithRelations, UpdateTaskInput } from '@auxx/lib/tasks'
import { DateLanguageModule, TextDateParser } from '@auxx/lib/tasks/client'
import type { ActorId } from '@auxx/types/actor'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd } from '@auxx/ui/components/kbd'
import { Switch } from '@auxx/ui/components/switch'
import { toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { EditorContent } from '@tiptap/react'
import { Calendar, Link2, User, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InlinePickerPopover, useMentionEditor } from '~/components/editor/inline-picker'
import { SubmitOnEnter } from '~/components/global/comments/comment-composer'
import { ActorPicker } from '~/components/pickers/actor-picker/actor-picker'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { RecordPicker } from '~/components/pickers/record-picker'
import { useTaskMutations } from '../hooks/use-task-mutations'
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'

/**
 * Swallow Esc when it originates inside a cmdk picker (the @mention popover) so
 * Esc closes the picker, not the host (dialog or palette). Shared by
 * `TaskDialog` (`DialogContent onEscapeKeyDown`) and the command palette shell.
 */
export function preventTaskPickerEscape(event: KeyboardEvent): void {
  if (event.target instanceof HTMLElement && event.target.closest('[cmdk-root]')) {
    event.preventDefault()
  }
}

/** Check if editor content is empty (just empty paragraph tags) */
function isEmptyContent(html: string): boolean {
  if (!html) return true
  const stripped = html
    .replace(/<p[^>]*>/g, '')
    .replace(/<\/p>/g, '')
    .trim()
  return stripped === ''
}

/** Props for the shell-free task form core. */
export interface TaskFormProps {
  /** Whether the form is "open" — drives the reset/focus cycle. In a dialog this is
   *  the dialog's open state; in the palette it's `page === 'create-task'`. */
  open: boolean
  /** Create or edit mode */
  mode: 'create' | 'edit'
  /** Task to edit (required for edit mode) */
  task?: TaskWithRelations
  /** Default entity reference when creating from an entity drawer / record action */
  defaultReferencedEntity?: RecordId
  /** Dismiss after a successful save (dialog closes; palette closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it back
   *  to the root action list instead of closing outright. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it. */
  header?: (ctx: { title: string }) => ReactNode
}

/**
 * Shell-free task create/edit form: the mention editor, footer pickers
 * (date/actor/record), the "Create more" toggle, and Save/Cancel. The only host
 * seams are the `header` slot and `onClose`/`onCancel`. `task-dialog.tsx` wraps
 * this in a `Dialog`; the command palette hosts it as a page. Behavior (including
 * "Create more") is unchanged from the original dialog.
 */
export function TaskForm({
  open,
  mode,
  task,
  defaultReferencedEntity,
  onClose,
  onCancel,
  header,
}: TaskFormProps) {
  const cancel = onCancel ?? onClose

  // Form state
  const [deadline, setDeadline] = useState<Date | undefined>(undefined)
  const [deadlineManuallySet, setDeadlineManuallySet] = useState(false)
  const [assigneeActorIds, setAssigneeActorIds] = useState<ActorId[]>([])
  const [linkedRecords, setLinkedRecords] = useState<RecordId[]>([])
  const [createMore, setCreateMore] = useState(false)

  // Mutations
  const { createTask, updateTask, isCreating, isUpdating } = useTaskMutations()
  const isSaving = isCreating || isUpdating

  // Container ref for popover positioning
  const containerRef = useRef<HTMLDivElement>(null)

  // Create parser and date module (memoized)
  const textDateParser = useMemo(() => new TextDateParser(), [])
  const dateModule = useMemo(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return new DateLanguageModule(timezone)
  }, [])

  // Ref to track handleSave for SubmitOnEnter extension (updated after handleSave is defined)
  const handleSaveRef = useRef<() => void>(() => {})

  // Build initial content from task
  const initialContent = useMemo(() => {
    if (!task) return ''
    return `<p>${task.title}</p>`
  }, [task])

  // Initialize mention editor using the inline-picker system
  const mentionEditor = useMentionEditor({
    initialContent,
    placeholder: 'What needs to be done? Use @ to assign members...',
    editable: true,
    className: cn(
      'prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none',
      'dark:prose-invert'
    ),
    extensions: [
      SubmitOnEnter.configure({
        isExpanded: () => false,
        onSubmit: () => {
          handleSaveRef.current()
        },
      }),
    ],
  })
  const { editor, suggestionState, insertMention, closePicker } = mentionEditor

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: mentionEditor.setContent is stable
  useEffect(() => {
    if (open) {
      if (task) {
        // Edit mode: populate from existing task
        setDeadline(task.deadline ? new Date(task.deadline) : undefined)
        setDeadlineManuallySet(!!task.deadline)
        setAssigneeActorIds(task.assignments ?? [])
        setLinkedRecords(task.references ?? [])
      } else {
        // Create mode: start fresh
        setDeadline(undefined)
        setDeadlineManuallySet(false)
        setAssigneeActorIds([])
        setLinkedRecords(defaultReferencedEntity ? [defaultReferencedEntity] : [])
      }
      // Defer editor operations using double requestAnimationFrame to ensure
      // we're outside React's render cycle and avoid flushSync errors
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (task) {
            mentionEditor.setContent(`<p>${task.title}</p>`)
          } else {
            editor?.commands.clearContent()
          }
          editor?.commands.focus()
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, open, editor, defaultReferencedEntity])

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
  }, [])

  /**
   * Reset form state for creating another task
   */
  const resetForm = useCallback(() => {
    editor?.commands.clearContent()
    setDeadline(undefined)
    setDeadlineManuallySet(false)
    setAssigneeActorIds([])
    setLinkedRecords(defaultReferencedEntity ? [defaultReferencedEntity] : [])
    // Use double requestAnimationFrame to avoid flushSync errors
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editor?.commands.focus()
      })
    })
  }, [editor, defaultReferencedEntity])

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
        assigneeActorIds,
        referencedEntities: linkedRecords.length > 0 ? linkedRecords : undefined,
      }
      createTask.mutate(input)
      toastSuccess({ title: 'Task created' })
    } else if (task) {
      const input: UpdateTaskInput = {
        id: task.id,
        title,
        description,
        deadline: deadline ? { type: 'static', value: deadline.toISOString() } : null,
        assigneeActorIds,
        referencedEntities: linkedRecords,
      }
      updateTask.mutate(input)
    }

    // If createMore is enabled and we're in create mode, reset form instead of closing
    if (createMore && mode === 'create') {
      resetForm()
    } else {
      onClose()
    }
  }, [
    editor,
    mode,
    task,
    deadline,
    assigneeActorIds,
    linkedRecords,
    createTask,
    updateTask,
    onClose,
    createMore,
    resetForm,
  ])

  // Update handleSaveRef with current handleSave function
  handleSaveRef.current = handleSave

  const title = mode === 'create' ? 'Create task' : 'Edit task'

  return (
    <>
      {header?.({ title })}

      {/* Editor Area */}
      <div ref={containerRef} className='p-4 relative'>
        <EditorContent editor={editor} className='w-full bg-transparent text-sm outline-hidden' />

        {/* Mention Picker Popover */}
        <InlinePickerPopover
          state={suggestionState}
          containerRef={containerRef}
          width={280}
          onClose={closePicker}>
          <ActorPickerContent
            value={[]}
            onChange={() => {}}
            target='user'
            multi={false}
            onSelectSingle={(actorId) => {
              insertMention(actorId)
              // Add to assignees if not already present
              setAssigneeActorIds((prev) => (prev.includes(actorId) ? prev : [...prev, actorId]))
            }}
            placeholder='Search team members...'
          />
        </InlinePickerPopover>
      </div>

      {/* Footer with pickers and actions (merged inline) */}
      <DialogFooter className='border-t py-1 px-4'>
        <div className='flex items-center justify-between w-full flex-col sm:flex-row gap-2 sm:gap-0'>
          {/* Left side: Pickers */}
          <div className='flex items-center gap-1'>
            {/* Date Picker with clear button */}
            <DateTimePicker
              value={deadline}
              onChange={handleDeadlineChange}
              mode='date'
              noConfirm
              placeholder='Due date'>
              <Button variant='ghost' size='sm'>
                <Calendar />
                {deadline ? formatTaskDeadlineDisplay(deadline) : 'Due date'}
              </Button>
            </DateTimePicker>

            {/* Clear deadline button (shown when deadline is set) */}
            {deadline && (
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6'
                onClick={handleDeadlineClear}
                title='Clear deadline'>
                <X className='h-3 w-3' />
              </Button>
            )}

            {/* Assignee Picker */}
            <ActorPicker
              value={assigneeActorIds}
              onChange={setAssigneeActorIds}
              multi
              target='user'
              emptyLabel='Assignee'>
              <Button variant='ghost' size='sm'>
                <User />
                {assigneeActorIds.length > 0 ? `${assigneeActorIds.length} assigned` : 'Assignee'}
              </Button>
            </ActorPicker>

            {/* Record Linking */}
            <RecordPicker
              value={linkedRecords}
              onChange={setLinkedRecords}
              multi
              emptyLabel='Link record'>
              <Button variant='ghost' size='sm'>
                <Link2 />
                {linkedRecords.length > 0
                  ? `${linkedRecords.length} linked record${linkedRecords.length > 1 ? 's' : ''}`
                  : 'Link record'}
              </Button>
            </RecordPicker>
          </div>

          {/* Right side: Actions */}
          <div className='flex items-center gap-2'>
            {/* Create more toggle - only shown in create mode */}
            {mode === 'create' && (
              <label
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'gap-2 cursor-pointer'
                )}>
                <span className='text-muted-foreground text-xs'>Create more</span>
                <Switch
                  size='sm'
                  checked={createMore}
                  onCheckedChange={setCreateMore}
                  disabled={isSaving}
                />
              </label>
            )}
            <Button variant='outline' size='sm' onClick={cancel} disabled={isSaving && !createMore}>
              Cancel <Kbd shortcut='esc' size='sm' variant='outline' />
            </Button>
            <Button
              size='sm'
              onClick={handleSave}
              loading={isSaving && !createMore}
              loadingText='Saving...'>
              Save <Kbd shortcut='enter' size='sm' variant='default' />
            </Button>
          </div>
        </div>
      </DialogFooter>
    </>
  )
}
