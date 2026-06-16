// apps/web/src/components/mail/composer-shared/composer-body.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { Upload } from 'lucide-react'
import type React from 'react'
import type { useDropzone } from 'react-dropzone'
import type { FileItem } from '~/components/files/files-store'
import { useEditorActiveStateContext } from '../email-editor/editor-active-state-context'
import { LazyTiptapEditor } from '../email-editor/lazy-tiptap-editor'
import type { MailAiSlashConfig } from '../email-editor/mail-slash-content'

interface ComposerBodyProps {
  // editor wiring
  content: JSONContent
  onContentChange: (json: JSONContent) => void
  placeholder?: string
  editable: boolean
  popoverClassName?: string
  contentClassName?: string
  /** Min-height for the editor region. Email 'min-h-[150px]', chat 'min-h-[60px]'. */
  editorMinHeightClassName?: string
  /** Optional AI-tools wiring — surfaces the "Ask AI" item in the `/` menu. */
  aiSlash?: MailAiSlashConfig
  /** Optional attachment wiring — surfaces the "Attach file" item in the `/` menu. */
  onAttachFile?: (file: FileItem) => void
  /** Formatting profile. `'rich'` (default, email) or `'plain'` (chat). */
  variant?: 'rich' | 'plain'

  // interaction
  onWrapperClick: React.MouseEventHandler<HTMLDivElement>
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>

  // dropzone (from useComposerAttachments)
  dropzone: Pick<ReturnType<typeof useDropzone>, 'getRootProps' | 'getInputProps' | 'isDragActive'>

  // framing
  /** Corner radius: 'sm' → rounded-[12px] (default), 'lg' → rounded-[20px] (chat hideHeader). */
  rounded?: 'sm' | 'lg'
  /** Extra classes for the frame wrapper (e.g. chat hideHeader adds shadow-lg). */
  frameClassName?: string
  /** Fully-wired toolbar content rendered inside `.editor-toolbar-wrapper`. */
  toolbar: React.ReactNode
  /** Email: From/To/Cc/Bcc/Subject — rendered inside the frame, above the editor. */
  headerFields?: React.ReactNode
  /**
   * Content rendered below the editor and inside the editor flex region —
   * email: signature, attachments, quick actions, prev-message; chat: attachments.
   */
  belowEditor?: React.ReactNode
}

/**
 * The presentational composer frame shared by the email reply editor and the
 * chat composer: the dropzone wrapper, drag overlay, active-state focus/blur
 * wiring, the Tiptap editor, and the toolbar row. Domain chrome (recipients,
 * signature, attachments, quick actions, send wiring) is injected via slots.
 */
export function ComposerBody({
  content,
  onContentChange,
  placeholder,
  editable,
  popoverClassName,
  contentClassName,
  editorMinHeightClassName = 'min-h-[150px]',
  aiSlash,
  onAttachFile,
  variant,
  onWrapperClick,
  onKeyDown,
  dropzone,
  rounded = 'sm',
  frameClassName,
  toolbar,
  headerFields,
  belowEditor,
}: ComposerBodyProps) {
  const activeState = useEditorActiveStateContext()
  const roundedClass = rounded === 'lg' ? 'rounded-[20px]' : 'rounded-[12px]'

  return (
    <div
      {...dropzone.getRootProps()}
      className={cn(
        'relative flex flex-col m-1 mt-0 border border-transparent ring-2 ring-transparent bg-white dark:bg-background',
        roundedClass,
        'focus-within:ring-blue-500 focus-within:hover:bg-white focus-within:hover:border-transparent dark:hover:bg-background',
        activeState.isActive && 'ring-blue-500 hover:bg-white hover:border-transparent',
        dropzone.isDragActive &&
          'border-transparent bg-white hover:bg-white hover:border-transparent',
        frameClassName
      )}
      onClick={onWrapperClick}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          activeState.setHasFocus(true)
        }
      }}
      onBlur={(e) => {
        // Small delay to allow popovers/selects to register as open before blur.
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setTimeout(() => activeState.setHasFocus(false), 0)
        }
      }}>
      <input {...dropzone.getInputProps()} />

      {/* Drag overlay */}
      {dropzone.isDragActive && (
        <div
          className={cn(
            'absolute inset-[-1px] z-50 flex items-center justify-center bg-blue-500/10 border-1 border-dashed border-info',
            roundedClass
          )}>
          <div className='text-center'>
            <Upload className='mx-auto size-8 text-blue-500' />
            <Badge variant='blue' className='cursor-default'>
              Drop here
            </Badge>
          </div>
        </div>
      )}

      {headerFields}

      {/* Editor Section */}
      <div className={cn('flex flex-col flex-1', editorMinHeightClassName)}>
        <LazyTiptapEditor
          content={content}
          onChange={onContentChange}
          placeholder={placeholder}
          editable={editable}
          popoverClassName={popoverClassName}
          contentClassName={contentClassName}
          aiSlash={aiSlash}
          onAttachFile={onAttachFile}
          variant={variant}
        />
        {belowEditor}
      </div>

      {/* Toolbar row */}
      <div className='editor-toolbar-wrapper relative px-2 py-1'>{toolbar}</div>
    </div>
  )
}
