// components/editor/EditorButtons.tsx

import { Badge } from '@auxx/ui/components/badge'
import { BorderBeam } from '@auxx/ui/components/border-beam'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  File,
  Italic,
  LetterText,
  Link as LinkIcon,
  List,
  Quote,
  Sparkles,
  Strikethrough,
  Underline,
} from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import React, { useMemo, useState } from 'react'
import type { UseFileSelectReturn } from '~/components/file-select/types'
import { Tooltip } from '~/components/global/tooltip'
import { AITools } from '~/components/mail/email-editor/ai-tools'
import { useEditorActiveStateContext } from '~/components/mail/email-editor/editor-active-state-context'
import { ScheduleSendButton } from '~/components/mail/email-editor/schedule-send-button'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { useEditorContext } from './editor-context'
import EditorSelector from './editor-selector'

// Font options
const fontOptions = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Calibri', label: 'Calibri' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
]

// Font size options
const fontSizeOptions = [
  { value: '8px', label: '8' },
  { value: '9px', label: '9' },
  { value: '10px', label: '10' },
  { value: '11px', label: '11' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '22px', label: '22' },
  { value: '24px', label: '24' },
  { value: '26px', label: '26' },
  { value: '28px', label: '28' },
  { value: '30px', label: '30' },
  { value: '32px', label: '32' },
  { value: '34px', label: '34' },
  { value: '36px', label: '36' },
  { value: '38px', label: '38' },
  { value: '40px', label: '40' },
]

// Color options
const colorOptions = [
  { value: '#000000', label: 'Black' },
  { value: '#FFFFFF', label: 'White' },
  { value: '#FF0000', label: 'Red' },
  { value: '#00FF00', label: 'Green' },
  { value: '#0000FF', label: 'Blue' },
  { value: '#FFFF00', label: 'Yellow' },
  { value: '#FF00FF', label: 'Magenta' },
  { value: '#00FFFF', label: 'Cyan' },
  { value: '#FFA500', label: 'Orange' },
  { value: '#800080', label: 'Purple' },
]

interface EditorButtonsProps {
  editor: Editor | null
  onSend?: () => void
  onSchedule?: (scheduledAt: Date) => void
  isSending?: boolean
  disabled?: boolean
  /** className forwarded to popover/dropdown content elements (e.g. for z-index override) */
  popoverClassName?: string
}

// Font Selector Button
export const FontSelectorButton = ({ editor, disabled, popoverClassName }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <EditorSelector
      id='font-selector'
      options={fontOptions}
      value={editor.getAttributes('textStyle').fontFamily || ''}
      onChange={(value) => editor.chain().focus().setFontFamily(value).run()}
      placeholder='Font'
      disabled={disabled}
      className='min-w-[100px] '
      contentClassName={popoverClassName}
    />
  )
}

// Font Size Selector Button
export const FontSizeButton = ({ editor, disabled, popoverClassName }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <EditorSelector
      id='font-size-selector'
      options={fontSizeOptions}
      value={editor.getAttributes('textStyle').fontSize || ''}
      onChange={(value) => editor.chain().focus().setFontSize(value).run()}
      placeholder='Size'
      disabled={disabled}
      className='min-w-[60px]'
      contentClassName={popoverClassName}
    />
  )
}

// Color Picker Button
export const ColorPickerButton = ({ editor, disabled, popoverClassName }: EditorButtonsProps) => {
  if (!editor) return null

  // Try to get active state context if available
  let activeState: any = null
  try {
    activeState = useEditorActiveStateContext()
  } catch {
    // Context not available, component used outside email editor
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (activeState) {
          if (open) {
            activeState.trackPopoverOpen('color-picker')
          } else {
            activeState.trackPopoverClose('color-picker')
          }
        }
      }}>
      <PopoverTrigger asChild>
        <div className='shrink-0 flex'>
          <Tooltip content='Text color' side='bottom'>
            <Button
              variant='ghost'
              size='icon-sm'
              type='button'
              className='rounded-full'
              disabled={disabled}>
              <div className='flex size-4 items-center justify-center rounded-full border border-gray-300'>
                <div
                  className='size-3 rounded-full'
                  style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000000' }}
                />
              </div>
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>
      <PopoverContent className={cn('w-64 p-2', popoverClassName)}>
        <div className='grid grid-cols-5 gap-1'>
          {colorOptions.map((color) => (
            <button
              key={color.value}
              type='button'
              className='size-6 rounded-md border p-0.5'
              style={{ backgroundColor: color.value }}
              onClick={() => editor.chain().focus().setColor(color.value).run()}
              title={color.label}>
              {editor.getAttributes('textStyle').color === color.value && (
                <div className='flex h-full w-full items-center justify-center rounded-sm bg-black/10'>
                  <div className='size-3 rounded-full bg-white' />
                </div>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Bold Button
export const BoldButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <Tooltip content='Bold' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('bold') ? 'bg-muted' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled}>
        <Bold />
      </Button>
    </Tooltip>
  )
}

// Italic Button
export const ItalicButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <Tooltip content='Italic' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('italic') ? 'bg-muted' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled}>
        <Italic />
      </Button>
    </Tooltip>
  )
}

// Underline Button
export const UnderlineButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <Tooltip content='Underline' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('underline') ? 'bg-muted' : ''}`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={disabled}>
        <Underline />
      </Button>
    </Tooltip>
  )
}

// Strikethrough Button
export const StrikethroughButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <Tooltip content='Strikethrough' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('strike') ? 'bg-muted' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={disabled}>
        <Strikethrough />
      </Button>
    </Tooltip>
  )
}

// List Button
export const ListButton = ({ editor, disabled, popoverClassName }: EditorButtonsProps) => {
  if (!editor) return null

  // Try to get active state context if available
  let activeState: any = null
  try {
    activeState = useEditorActiveStateContext()
  } catch {
    // Context not available, component used outside email editor
  }

  // Track auto-formatting state
  const [autoFormatting, setAutoFormatting] = useState(false)

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (activeState) {
          if (open) {
            activeState.trackPopoverOpen('list-options')
          } else {
            activeState.trackPopoverClose('list-options')
          }
        }
      }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon-sm'
          type='button'
          className={`rounded-full ${
            editor.isActive('bulletList') || editor.isActive('orderedList') ? 'bg-muted' : ''
          }`}
          disabled={disabled}>
          <List />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={cn('w-56', popoverClassName)} align='start' side='bottom'>
        <DropdownMenuItem
          className={editor.isActive('bulletList') ? 'bg-muted' : ''}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          Bulleted List
        </DropdownMenuItem>
        <DropdownMenuItem
          className={editor.isActive('orderedList') ? 'bg-muted' : ''}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          Numbered List
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().indent().run()}>
          Indent Right
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().outdent().run()}>
          Indent Left
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={autoFormatting} onCheckedChange={setAutoFormatting}>
          Auto formatting
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Link Button
export const LinkButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor || disabled) return null

  const setLink = () => {
    const url = window.prompt('URL')

    if (url === null) {
      return
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <Tooltip content='Link' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('link') ? 'bg-muted' : ''}`}
        onClick={setLink}>
        <LinkIcon />
      </Button>
    </Tooltip>
  )
}

// Quote Button
export const QuoteButton = ({ editor, disabled }: EditorButtonsProps) => {
  if (!editor) return null

  return (
    <Tooltip content='Quote' side='bottom'>
      <Button
        variant='ghost'
        type='button'
        size='icon-sm'
        className={`rounded-full ${editor.isActive('blockquote') ? 'bg-muted' : ''}`}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        disabled={disabled}>
        <Quote />
      </Button>
    </Tooltip>
  )
}

// File Select Picker with Active State Tracking
const FileSelectPickerWithTracking = ({
  fileSelect,
  disabled,
  popoverClassName,
}: {
  fileSelect: UseFileSelectReturn
  disabled?: boolean
  popoverClassName?: string
}) => {
  // Try to get active state context if available
  let activeState: any = null
  try {
    activeState = useEditorActiveStateContext()
  } catch {
    // Context not available, component used outside email editor
  }

  return (
    <FileSelectPicker
      fileSelect={fileSelect}
      align='end'
      side='top'
      className={popoverClassName}
      onOpenChange={(open) => {
        if (activeState) {
          if (open) {
            activeState.trackPopoverOpen('file-select-picker')
          } else {
            activeState.trackPopoverClose('file-select-picker')
          }
        }
      }}>
      <div className='flex shrink-0'>
        <Tooltip content='Attach files' side='bottom'>
          <Button
            variant='ghost'
            size='icon-sm'
            className='rounded-full relative'
            disabled={disabled}>
            <File aria-hidden='true' />
            {fileSelect.selectedItems.length > 0 && (
              <Badge
                className='absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center'
                variant='default'>
                {fileSelect.selectedItems.length}
              </Badge>
            )}
            <span className='sr-only'>Attach files</span>
          </Button>
        </Tooltip>
      </div>
    </FileSelectPicker>
  )
}

// Animation variants for group transitions - using scale to prevent layout shift
const slideAnimationVariants: Variants = {
  hidden: {
    opacity: 0,
    scaleX: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0.0, 0.2, 1] as [number, number, number, number], // easeInOut cubic-bezier
    },
  },
  visible: {
    opacity: 1,
    scaleX: 1,
    transition: {
      duration: 0.3,
      ease: [0.0, 0.0, 0.2, 1] as [number, number, number, number], // easeOut cubic-bezier
    },
  },
  exit: {
    opacity: 0,
    scaleX: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0.0, 1, 1] as [number, number, number, number], // easeIn cubic-bezier
    },
  },
}

// Interface for button groups
interface EditorButtonGroup {
  id: string
  label: string
  icon: React.ComponentType<any>
  tooltip: string
  className: React.ComponentProps<'div'>['className']
  renderItems: (editor: Editor, props?: any) => React.ReactNode
}

// EditorToolbar component to bring them all together
export const EditorToolbar = ({
  editor: propEditor,
  onSend,
  onSchedule,
  isSending,
  disabled,
  fileSelect,
  aiToolsProps,
  showSend = true,
  popoverClassName,
}: Partial<EditorButtonsProps> & {
  fileSelect?: UseFileSelectReturn
  showSend?: boolean
  aiToolsProps?: {
    threadId?: string
    hasContent: boolean
    hasPreviousMessages: boolean
    state: any
    onOperation: (operation: any, options?: { tone?: string; language?: string }) => void
  }
}) => {
  // Use context to get editor if not provided as prop
  const { editor: contextEditor } = useEditorContext()
  const editor = propEditor || contextEditor

  // State for active group
  const [activeGroup, setActiveGroup] = useState<string | null>('formatting')

  // Define button groups
  const buttonGroups = useMemo<EditorButtonGroup[]>(() => {
    const groups: EditorButtonGroup[] = [
      {
        id: 'formatting',
        label: 'Formatting',
        icon: LetterText,
        tooltip: 'Formatting options',
        className: 'aria-selected:bg-primary-200',
        renderItems: (editor, props) => (
          <>
            <FontSelectorButton
              editor={editor}
              disabled={props?.disabled}
              popoverClassName={props?.popoverClassName}
            />
            <FontSizeButton
              editor={editor}
              disabled={props?.disabled}
              popoverClassName={props?.popoverClassName}
            />
            <ColorPickerButton
              editor={editor}
              disabled={props?.disabled}
              popoverClassName={props?.popoverClassName}
            />
            <BoldButton editor={editor} disabled={props?.disabled} />
            <ItalicButton editor={editor} disabled={props?.disabled} />
            <UnderlineButton editor={editor} disabled={props?.disabled} />
            <StrikethroughButton editor={editor} disabled={props?.disabled} />
            <ListButton
              editor={editor}
              disabled={props?.disabled}
              popoverClassName={props?.popoverClassName}
            />
            <LinkButton editor={editor} disabled={props?.disabled} />
            <QuoteButton editor={editor} disabled={props?.disabled} />
          </>
        ),
      },
    ]

    // Only add AI group if aiToolsProps is provided
    if (aiToolsProps) {
      groups.push({
        id: 'ai',
        label: 'AI Tools',
        icon: Sparkles,
        tooltip: 'AI assistant',
        className:
          'hover:bg-comparison-100 hover:text-comparison-600 text-comparison-500 aria-selected:bg-comparison-200',
        renderItems: (editor, props) => {
          return (
            <AITools
              editor={editor}
              threadId={props.aiToolsProps.threadId}
              hasContent={props.aiToolsProps.hasContent}
              hasPreviousMessages={props.aiToolsProps.hasPreviousMessages}
              state={props.aiToolsProps.state}
              onOperation={props.aiToolsProps.onOperation}
              popoverClassName={props?.popoverClassName}
            />
          )
        },
      })
    }

    return groups
  }, [aiToolsProps])

  // Toggle group function
  const toggleGroup = (groupId: string) => {
    setActiveGroup(activeGroup === groupId ? null : groupId)
  }

  // Return placeholder with same height to prevent layout jump
  if (!editor) {
    return (
      <div className='flex flex-1 items-center justify-between'>
        <div className='flex items-center gap-1 overflow-x-auto no-scrollbar p-0.5 h-10' />
      </div>
    )
  }

  return (
    <div className='flex flex-1 items-center justify-between'>
      <div className='flex items-center gap-1 overflow-x-auto no-scrollbar p-0.5 h-10'>
        {/* Main category buttons */}
        <div className='flex items-center gap-0.5 shrink-0'>
          {buttonGroups.map((group, index) => {
            const Icon = group.icon

            return (
              <React.Fragment key={group.id}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Tooltip content={group.tooltip} side='bottom'>
                    <Button
                      variant='ghost'
                      type='button'
                      size='icon-sm'
                      className={cn(
                        'rounded-full relative',
                        // activeGroup === group.id && 'bg-primary-200 hover:bg-primary-200 ',
                        group.className
                      )}
                      onClick={() => toggleGroup(group.id)}
                      disabled={disabled}
                      aria-selected={activeGroup === group.id}>
                      <Icon />
                      {group.id === 'ai' && (
                        <BorderBeam
                          duration={8}
                          size={30}
                          // borderWidth={1.5}
                          className='from-transparent via-comparison-500 '
                        />
                      )}
                    </Button>
                  </Tooltip>
                </motion.div>
                {/* Show file select button after formatting button */}
                {group.id === 'formatting' && fileSelect && (
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className='flex items-center'>
                    <FileSelectPickerWithTracking
                      fileSelect={fileSelect}
                      disabled={disabled}
                      popoverClassName={popoverClassName}
                    />
                  </motion.div>
                )}
              </React.Fragment>
            )
          })}
        </div>

        {/* Animated group content - all groups stay in DOM */}
        <div className='relative flex items-center'>
          {buttonGroups.map((group) => (
            <motion.div
              key={group.id}
              variants={slideAnimationVariants}
              initial='hidden'
              animate={activeGroup === group.id ? 'visible' : 'hidden'}
              className={cn(
                'flex items-center gap-0.5  no-scrollbar origin-left',
                activeGroup !== group.id && 'absolute left-0 pointer-events-none'
              )}
              style={{
                transformOrigin: 'left center',
              }}>
              {/* Only show separator for active group */}
              {activeGroup === group.id && (
                <motion.div
                  className='mx-1 h-4 w-px bg-border'
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                />
              )}

              {/* Group items */}
              <motion.div
                className='flex items-center gap-0.5'
                initial={{ opacity: 0 }}
                animate={{ opacity: activeGroup === group.id ? 1 : 0 }}
                transition={{ delay: 0.1 }}>
                {group.renderItems(editor, { aiToolsProps, disabled, popoverClassName })}
              </motion.div>
            </motion.div>
          ))}
        </div>

        {/* File attachment button - always visible */}
      </div>
      {showSend && onSend && (
        <ScheduleSendButton
          onSend={onSend}
          onSchedule={onSchedule ?? (() => {})}
          isSending={isSending}
          disabled={disabled}
          popoverClassName={popoverClassName}
        />
      )}
    </div>
  )
}
