'use client'

// apps/web/src/components/global/comments/comment-composer.tsx

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'

import { useMentionEditor, InlinePickerPopover } from '~/components/editor/inline-picker'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { AtSign, Maximize2, Minimize2, Paperclip, Smile, Send, CornerDownLeft } from 'lucide-react'
import {
  type UseCommentsOptions,
  useComments,
  type CommentAttachmentInfo,
} from '~/hooks/use-comments'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { CommentFile } from './comment-file'
import { useDropzone } from 'react-dropzone'
import { ENTITY_TYPES } from '@auxx/lib/files/types'
import type { RecordId } from '@auxx/lib/field-values/client'

import { EmojiPicker } from '~/components/pickers/emoji-picker'
import { MetaIcon } from '~/constants/icons'

// Frontend file type distinction
interface FileAttachment {
  id: string
  name: string
  size?: bigint | number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}

/**
 * Props for the CommentComposer tiptap wrapper component.
 */
interface CommentComposerProps {
  recordId: RecordId
  parentId?: string
  onSubmitted?: () => void
  onCancel?: () => void
  placeholder?: string
  commentId?: string
  initialContent?: string
  initialAttachments?: CommentAttachmentInfo[]
  autoFocus?: boolean
  expanded?: boolean
  expandHeight?: string
  /** Incrementing value that will trigger the editor to focus when it changes. */
  focusTrigger?: number
}

export function stripParagraphTags(html: string, replacement: string = ''): string {
  if (!html) return ''

  // Replace opening <p> tags with any attributes
  let result = html.replace(/<p[^>]*>/g, replacement)
  // Replace closing </p> tags
  result = result.replace(/<\/p>/g, replacement)
  return result
}

/**
 * Transform CommentAttachmentInfo to FileItem format for editing
 */
const transformAttachmentsToFileSelectItems = (attachments: CommentAttachmentInfo[]) => {
  return attachments.map((attachment) => ({
    id: `existing-${attachment.id}`, // Prefix to distinguish from new uploads
    name: attachment.name,
    type: 'file' as const,
    size: attachment.size ? BigInt(attachment.size) : null,
    displaySize: Number(attachment.size || 0),
    mimeType: attachment.mimeType || null,
    ext: attachment.name.includes('.') ? `.${attachment.name.split('.').pop()}` : null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.createdAt,
    path: '/',
    parentId: null,
    source: (attachment.type === 'file' ? 'filesystem' : 'upload') as 'filesystem' | 'upload',
    serverFileId: attachment.fileId || (attachment as any).assetId, // This is the actual file/asset ID
    isUploading: false,
    status: 'completed' as const,
    // Custom properties for existing attachments
    isExistingAttachment: true, // Flag to identify existing attachments
    originalAttachmentId: attachment.id, // Keep track of the original attachment ID
    attachmentType: attachment.type, // Store original type
  }))
}

const isEmptyContent = (html: string) => {
  return stripParagraphTags(html).trim() === ''
}
export interface SubmitOnEnterOptions {
  /**
   * Function to call when Enter is pressed and isExpanded returns false
   */
  onSubmit: (editor: Editor) => void

  /**
   * Function that determines whether the editor content is expanded
   * If this returns true, pressing Enter will have its default behavior
   * If this returns false, pressing Enter will call onSubmit
   */
  isExpanded: (editor: Editor) => boolean
}

/**
 * Extension that adds a keyboard shortcut for the Enter key
 * When Enter is pressed, it checks if isExpanded returns false, and if so, calls onSubmit
 * If isExpanded returns true, the default Enter behavior is used
 */
export const SubmitOnEnter = Extension.create<SubmitOnEnterOptions>({
  name: 'submitOnEnter',

  addOptions() {
    return { onSubmit: () => {}, isExpanded: () => false }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        // Prevent submit if inline picker popover is open (Radix popover)
        if (
          typeof window !== 'undefined' &&
          document.querySelector('[data-radix-popper-content-wrapper]')
        ) {
          return false // Let the picker handle Enter
        }
        if (!this.options.isExpanded(editor)) {
          this.options.onSubmit(editor)
          return true // Prevents the default Enter behavior
        }
        return false
      },
      'Mod-Enter': ({ editor }) => {
        // Always submit on Cmd/Ctrl+Enter regardless of expanded state
        this.options.onSubmit(editor)
        return true // Prevents default behavior
      },
    }
  },
})

/**
 * CommentComposer renders the shared rich text composer used in drawers.
 */
const CommentComposer = ({
  recordId,
  parentId,
  commentId,
  onSubmitted,
  onCancel,
  placeholder = 'Add internal comment',
  initialContent = '',
  initialAttachments = [],
  expanded = false,
  expandHeight = '150px',
  autoFocus = false,
  focusTrigger,
}: CommentComposerProps) => {
  // States

  // Store initial expanded value to restore after submission
  const initialExpanded = expanded
  const [isExpanded, setIsExpanded] = useState(expanded)
  const isExpandedRef = useRef(isExpanded)
  isExpandedRef.current = isExpanded
  const handleSubmitRef = useRef<(editor: Editor | null) => void>(() => {})
  const [placeholderVisible, setPlaceholderVisible] = useState(isEmptyContent(initialContent))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // File selection hook with temporary entity ID for pre-comment uploads
  const tempEntityIdRef = useRef(`temp-comment-${crypto.randomUUID()}`)
  const fileSelect = useFileSelect({
    entityType: ENTITY_TYPES.COMMENT,
    entityId: tempEntityIdRef.current,
    allowMultiple: true,
    maxFiles: 10,
    autoStart: true,
    // autoCreateSession removed - sessions are created lazily when files are selected
  })

  // Refs (none needed currently)
  // Set up useComments hook
  const commentOptions: UseCommentsOptions = {
    recordId,
  }

  const {
    handleCreateComment,
    handleCreateReply,
    handleUpdateComment,
    isCreatingComment,
    isUpdatingComment,
    isCreatingReply,
  } = useComments(commentOptions)

  // Initialize mention editor using the inline-picker system
  const mentionEditor = useMentionEditor({
    initialContent,
    placeholder,
    editable: true,
    className: cn(
      'prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0',
      'focus:outline-hidden max-w-none dark:prose-invert'
    ),
    onUpdate: (html) => {
      setPlaceholderVisible(isEmptyContent(html))
    },
    extensions: [
      SubmitOnEnter.configure({
        isExpanded: () => isExpandedRef.current,
        onSubmit: (editor) => {
          console.log('SubmitOnEnter onSubmit called', {
            isExpanded: isExpandedRef.current,
            hasEditor: !!editor,
          })
          handleSubmitRef.current(editor)
        },
      }),
    ],
  })

  const { editor, suggestionState, insertMention, closePicker } = mentionEditor
  const focusEditor = useCallback(() => {
    if (editor) {
      editor.commands.focus()
    }
  }, [editor])

  // Auto-focus the editor if specified
  useEffect(() => {
    if (autoFocus && editor) {
      setTimeout(() => editor.commands.focus(), 0)
    }
  }, [autoFocus, editor])

  // Focus the editor when focusTrigger changes
  const lastFocusTriggerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (typeof focusTrigger === 'number' && focusTrigger !== lastFocusTriggerRef.current) {
      lastFocusTriggerRef.current = focusTrigger
      setTimeout(() => {
        focusEditor()
      }, 0)
    }
  }, [focusTrigger, focusEditor])

  // Track if we've already initialized attachments to prevent infinite loop
  const initializedRef = useRef(false)

  // Populate fileSelect with initial attachments when editing
  useEffect(() => {
    if (initialAttachments.length > 0 && commentId && !initializedRef.current) {
      // Only for edit mode and only once
      const fileSelectItems = transformAttachmentsToFileSelectItems(initialAttachments)
      fileSelect.addItems(fileSelectItems)
      initializedRef.current = true
    }
  }, [initialAttachments, commentId]) // Removed fileSelect from dependencies

  // Reset the initialized ref when commentId changes (switching between different edits)
  useEffect(() => {
    initializedRef.current = false
    // Clear existing items when switching to a different comment or starting fresh
    fileSelect.clearItems()
  }, [commentId])

  // Setup dropzone for drag and drop
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      fileSelect.addFiles(acceptedFiles)
    },
    noClick: true, // Prevent click from triggering file dialog
    noKeyboard: true,
    multiple: true,
  })

  // Handle attachment button click
  const handleAttachmentClick = () => {
    setPickerOpen(true)
  }

  // Handle file removal
  const handleRemoveFile = (fileId: string) => {
    const item = fileSelect.selectedItems.find((item) => item.id === fileId)

    // For both existing and new attachments, just remove from UI
    // The backend will handle the actual deletion when we submit
    fileSelect.removeItem(fileId)

    // Log for debugging
    if ((item as any)?.isExistingAttachment) {
      console.log('Removed existing attachment from edit:', fileId)
    }
  }

  // Handle @ button click
  const handleMentionClick = () => {
    if (editor) {
      editor.commands.insertContent('@')
      focusEditor()
    }
  }

  const handleSubmit = useCallback(
    async (editor: Editor | null) => {
      console.log('handleSubmit called', { hasEditor: !!editor })
      if (editor && !isSubmitting) {
        const content = editor.getHTML()
        // showPlaceholder()
        console.log('content', content)
        // console.log('content', content)
        if (isEmptyContent(content)) {
          return
        }
        // if (!content || content === '<p></p>' || content === '<p></p><p></p>')
        //   return

        setIsSubmitting(true)

        try {
          // Check if all attachments are ready
          const selected = fileSelect.selectedItems
          const notReady = selected.filter((i) => i.source !== 'filesystem' && !i.serverFileId)
          if (notReady.length) {
            // Still uploading files - don't submit yet
            setIsSubmitting(false)
            return
          }

          // Build typed file attachments for final submission
          const fileAttachments: FileAttachment[] = selected.map((item) => {
            // For existing attachments, use the original attachment data
            if ((item as any).isExistingAttachment) {
              return {
                id: (item as any).originalAttachmentId, // Use original attachment ID
                name: item.name,
                size: item.displaySize,
                mimeType: item.mimeType || undefined,
                type: (item as any).attachmentType || 'file', // Use stored original type
              }
            }

            // For new uploads, use the uploaded file data
            return {
              id: item.serverFileId || item.id,
              name: item.name,
              size: item.displaySize,
              mimeType: item.mimeType || undefined,
              type: item.source === 'filesystem' ? 'file' : 'asset',
            }
          })

          // Submit the comment with typed attachments
          if (commentId) {
            console.log('handleUpdateComment')
            // Always send fileAttachments for updates to handle removal of all attachments
            await handleUpdateComment(commentId, content, fileAttachments)
          } else if (parentId) {
            // Only send attachments if there are any for new replies
            console.log('handleCreateReply')
            await handleCreateReply(
              content,
              parentId,
              fileAttachments.length > 0 ? fileAttachments : undefined
            )
          } else {
            console.log('new comment')
            // Only send attachments if there are any for new comments
            await handleCreateComment(
              content,
              fileAttachments.length > 0 ? fileAttachments : undefined
            )
          }

          // Reset the editor and files
          editor.commands.clearContent()
          fileSelect.clearItems()
          // Reset to initial expanded state instead of always collapsing
          setIsExpanded(initialExpanded || false)

          if (onSubmitted) {
            onSubmitted()
          }
        } catch (error) {
        } finally {
          setIsSubmitting(false)
        }
      }
    },
    [
      fileSelect,
      isSubmitting,
      commentId,
      parentId,
      handleUpdateComment,
      handleCreateReply,
      handleCreateComment,
      onSubmitted,
    ]
  )

  // Update the ref with current handleSubmit function
  handleSubmitRef.current = handleSubmit

  // Handle emoji selection
  const handleEmojiSelect = (emoji: any) => {
    if (editor) {
      editor.commands.insertContent(emoji)
      focusEditor()
    }
  }

  // Handle expand/collapse button click
  const handleExpandClick = () => {
    setIsExpanded(!isExpanded)
  }

  // flex flex-1 flex-row overflow-hidden rounded-[17px] focus-within:border-blue-500 focus-within:bg-background focus-within:ring-1 focus-within:ring-blue-500 hover:border-gray-400 hover:bg-gray-200 hover:focus-within:bg-background
  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-[17px] border border-gray-300 bg-background/90 transition-all duration-200 dark:border-foreground/10 dark:bg-background/90',
        'focus-within:border-blue-500 focus-within:bg-background focus-within:ring-1 focus-within:ring-blue-500',
        'hover:border-gray-400 hover:bg-gray-200 hover:focus-within:bg-background',
        isDragActive && 'border-blue-500 bg-blue-50',
        isSubmitting && 'pointer-events-none opacity-50'
      )}>
      <input {...getInputProps()} />

      {/* File attachments preview */}
      {fileSelect.selectedItems.length > 0 && (
        <div className="flex w-full flex-col gap-2 border-b border-gray-300 dark:border-foreground/10 p-3">
          <div className="text-xs text-gray-600 font-medium">Attachments</div>
          <div className="flex flex-col gap-1 group">
            {fileSelect.selectedItems.map((file) => (
              <CommentFile
                key={file.id}
                file={{
                  id: file.id,
                  name: file.name,
                  mimeType: file.mimeType || undefined,
                  size: file.size || undefined,
                  source: (file as any).isExistingAttachment ? 'existing' : 'upload',
                }}
                onRemove={handleRemoveFile}
                className="group-hover:opacity-100"
              />
            ))}
          </div>
        </div>
      )}

      {/* Main editor area wrapper */}
      <div className="flex w-full flex-row overflow-hidden">
        {/* Main editor area */}
        <div className="flex flex-1 flex-row overflow-hidden">
          {/* Editor */}
          <div className="flex flex-1 flex-col overflow-auto leading-5">
            <div className="relative flex flex-1 flex-col">
              {/* {placeholderVisible && (
                <div className="pointer-events-none absolute left-0 top-0 px-[12px] py-[8px] text-sm text-muted-foreground">
                  {placeholder}
                </div>
              )} */}
              <EditorContent
                editor={editor}
                className={cn(
                  'w-full bg-transparent px-[10px] py-[5px] text-[15px] leading-relaxed text-foreground outline-hidden ring-0 *:outline-hidden [&>.prose]:h-full'
                )}
                style={isExpanded ? { minHeight: expandHeight } : {}}
              />

              {/* Mention Picker Popover */}
              <InlinePickerPopover state={suggestionState} width={280} onClose={closePicker}>
                <ActorPickerContent
                  value={[]}
                  onChange={() => {}}
                  target="user"
                  multi={false}
                  onSelectSingle={(actorId) => insertMention(actorId)}
                  placeholder="Search team members..."
                />
              </InlinePickerPopover>
            </div>
          </div>

          {/* Sidebar controls */}
          <div className="relative flex flex-col items-end justify-between overflow-hidden pr-[2px]">
            <div className="flex flex-1 flex-row px-[2px] py-[4px]">
              {/* Attachment button with file picker */}
              <div className="min-w-0">
                <FileSelectPicker
                  fileSelect={fileSelect}
                  allowMultiple={true}
                  onSelect={() => {
                    // Files are already in fileSelect.selectedItems via shared state
                    setPickerOpen(false)
                  }}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  align="end"
                  className="w-80">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/80 outline-hidden transition-[color,box-shadow] hover:bg-gray-300 hover:text-foreground dark:hover:bg-gray-700"
                    onClick={handleAttachmentClick}>
                    <Paperclip size={15} />
                  </Button>
                </FileSelectPicker>
              </div>

              {/* Mention button */}
              <div className="min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/80 outline-hidden transition-[color,box-shadow] hover:bg-gray-300 hover:text-foreground dark:hover:bg-gray-700"
                  onMouseDown={(e) => {
                    // Prevent editor blur when clicking mention button
                    e.preventDefault()
                    handleMentionClick()
                  }}>
                  <AtSign size={15} />
                </Button>
              </div>

              {/* Emoji button with popover */}
              <div className="min-w-0">
                <EmojiPicker
                  // open={isEmojiPickerOpen}
                  // onOpenChange={setIsEmojiPickerOpen}
                  // onChange={handleEmojiSelect}
                  align="end"
                  onChange={handleEmojiSelect}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/80 outline-hidden transition-[color,box-shadow] hover:bg-gray-300 hover:text-foreground dark:hover:bg-gray-700">
                    <Smile size={15} />
                  </Button>
                </EmojiPicker>

                {/* <Popover>
                <PopoverTrigger asChild></PopoverTrigger>
                <PopoverContent
                  className='w-[320px] p-0'
                  align='end'></PopoverContent>
              </Popover> */}
              </div>

              {/* Expand/Collapse button */}
              <div className="min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/80 outline-hidden transition-[color,box-shadow] hover:bg-gray-300 hover:text-foreground dark:hover:bg-gray-700"
                  onClick={handleExpandClick}>
                  {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </Button>
              </div>
            </div>
            {isExpanded && (
              <div className="flex items-end justify-end p-2">
                {onCancel && (
                  <Button
                    variant="info"
                    size="xs"
                    onClick={onCancel}
                    className="mr-2 rounded-full"
                    disabled={
                      isSubmitting || isCreatingComment || isCreatingReply || isUpdatingComment
                    }>
                    Cancel
                  </Button>
                )}
                <Button
                  onClick={() => {
                    handleSubmit(editor)
                  }}
                  size="xs"
                  variant="info"
                  disabled={
                    isSubmitting ||
                    isCreatingComment ||
                    isUpdatingComment ||
                    isCreatingReply ||
                    placeholderVisible ||
                    !fileSelect.selectedItems.every(
                      (i) => i.source === 'filesystem' || !!i.serverFileId
                    )
                  }
                  loading={
                    isSubmitting || isCreatingComment || isCreatingReply || isUpdatingComment
                  }
                  loadingText="Submitting..."
                  className="flex items-center gap-1 rounded-full">
                  <Send size={14} />
                  Submit
                  <kbd className="flex items-center shrink-0 ring-1 ring-white/10 rounded-md p-[2px]">
                    <MetaIcon className="size-3! opacity-80" />
                    <CornerDownLeft className="size-3! opacity-80" />
                  </kbd>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

CommentComposer.displayName = 'CommentComposer'

export default CommentComposer
