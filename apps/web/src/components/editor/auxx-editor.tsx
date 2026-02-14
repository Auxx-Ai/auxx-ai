'use client'

import { Separator } from '@auxx/ui/components/separator'
import type { AnyExtension, Editor as EditorInstance, JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { slashCommand, suggestionItems } from './auxx-slash-command'
import {
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  EditorRoot,
} from './components'
import { defaultExtensions } from './default-extensions'
import { handleCommandNavigation, ImageResizer } from './extensions'
import GenerativeMenuSwitch from './generative/generative-menu-switch'
import { handleImageDrop, handleImagePaste } from './plugins'
import { uploadFn } from './plugins/image-upload'
import { ColorSelector } from './selectors/color-selector'
import { LinkSelector } from './selectors/link-selector'
import { NodeSelector } from './selectors/node-selector'
import { TextButtons } from './selectors/text-buttons'

import '~/styles/prosemirror.css'

// Empty content structure for the editor
const emptyContent: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }

// Props interface for AuxxEditor
interface AuxxEditorProps {
  initialContent?: JSONContent | null
  onContentChange?: (content: { json: JSONContent; html: string; markdown: string }) => void
  isSaving?: boolean
  autoSave?: boolean
  debounceMs?: number // Added debounce time parameter
}

const extensions = [...defaultExtensions, slashCommand] as AnyExtension[]

const AuxxEditor = ({
  initialContent: propInitialContent = null,
  onContentChange,
  isSaving = false,
  autoSave = true,
  debounceMs = 2000, // Set default debounce to 2 seconds
}: AuxxEditorProps) => {
  const [initialContent, setInitialContent] = useState<JSONContent | null>(null)
  const [saveStatus, setSaveStatus] = useState(isSaving ? 'Saving...' : 'Saved')
  const [charsCount, setCharsCount] = useState()
  const [editorInstance, setEditorInstance] = useState<EditorInstance | null>(null)
  const [contentChanged, setContentChanged] = useState(false)
  // Add a ref to track initial mounting to prevent initial save
  const isInitialMount = useRef(true)
  // Track last saved content to prevent duplicate saves
  const lastSavedContent = useRef<string | null>(null)
  // Add a ref to track if a debounced save is scheduled
  const saveScheduled = useRef(false)
  // Ref to the editor container for focus handling
  const editorContainerRef = useRef<HTMLDivElement>(null)
  // Keep a stable reference to the latest editor instance for the debounced save
  const latestEditor = useRef<EditorInstance | null>(null)

  const [openNode, setOpenNode] = useState(false)
  const [openColor, setOpenColor] = useState(false)
  const [openLink, setOpenLink] = useState(false)
  const [openAI, setOpenAI] = useState(false)

  // Update save status when isSaving prop changes
  useEffect(() => {
    setSaveStatus(isSaving ? 'Saving...' : contentChanged ? 'Unsaved' : 'Saved')
  }, [isSaving, contentChanged])

  // Update latestEditor ref whenever editorInstance changes
  useEffect(() => {
    latestEditor.current = editorInstance
  }, [editorInstance])

  // Create a debounced function that uses the latest editor state
  const debouncedSave = useDebounceCallback(() => {
    saveScheduled.current = false

    // Get the latest editor content at execution time
    if (!latestEditor.current) return

    const editor = latestEditor.current
    const json = editor.getJSON()
    const html = editor.getHTML()
    const markdown = editor.storage.markdown.getMarkdown()

    // Convert content to string to compare with last saved
    const contentString = JSON.stringify(json)

    // Only save if content is different from the last saved content
    if (contentString !== lastSavedContent.current) {
      if (onContentChange && autoSave) {
        // Update last saved content reference
        lastSavedContent.current = contentString

        // Call the parent's callback with latest content
        onContentChange({ json, html, markdown })
        setContentChanged(false)
      }
    }
  }, debounceMs)

  // This handles all editor updates, including tracking changes and word count
  const handleEditorUpdate = useCallback(
    ({ editor }: { editor: EditorInstance }) => {
      // Update editor instance
      setEditorInstance(editor)

      // Update word count
      setCharsCount(editor.storage.characterCount.words())

      // Skip saving on initial mount
      if (isInitialMount.current) {
        isInitialMount.current = false
        return
      }

      // Mark as changed
      setContentChanged(true)

      if (!autoSave) {
        setSaveStatus('Unsaved')
      } else if (!saveScheduled.current) {
        // Only schedule a save if one isn't already in progress
        saveScheduled.current = true

        // Trigger debounced save without passing content
        // Content will be retrieved from latest editor instance when it executes
        debouncedSave()
      }
    },
    [autoSave, debouncedSave]
  )

  // Handle editor initialization and focus
  useEffect(() => {
    // console.log('Editor mounted', propInitialContent, initialContent)
    // Use either provided initialContent or empty content
    if (propInitialContent) {
      setInitialContent(propInitialContent)
      // Initialize lastSavedContent with the initial content
      lastSavedContent.current = JSON.stringify(propInitialContent)
    } else {
      // Always use the empty content structure to ensure the editor is editable
      setInitialContent(emptyContent)
      lastSavedContent.current = JSON.stringify(emptyContent)
    }

    // Reset the scheduled save flag when component mounts
    saveScheduled.current = false
  }, [propInitialContent])

  // Function to focus the editor
  const focusEditor = useCallback(() => {
    if (editorInstance) {
      // Focus at the end of the document
      editorInstance.commands.focus('end')
    }
  }, [editorInstance])

  // Handle click on the editor container
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle clicks directly on the container (not on toolbar buttons, etc.)
      if (
        e.target === e.currentTarget ||
        (e.currentTarget as HTMLDivElement).contains(e.target as Node)
      ) {
        // focusEditor()
      }
    },
    [focusEditor]
  )

  if (!initialContent) return null

  return (
    <div
      ref={editorContainerRef}
      className='relative w-full max-w-(--breakpoint-lg) cursor-text'
      onClick={handleContainerClick}>
      <div className='absolute right-0 -top-5 z-10 mb-5 flex gap-2'>
        <div className='rounded-lg bg-accent px-2 py-1 text-sm text-muted-foreground'>
          {saveStatus}
        </div>
        <div
          className={
            charsCount ? 'rounded-lg bg-accent px-2 py-1 text-sm text-muted-foreground' : 'hidden'
          }>
          {charsCount} Words
        </div>
      </div>
      <EditorRoot>
        <EditorContent
          initialContent={initialContent}
          extensions={extensions}
          className='prose prose-sm prose-base relative my-5 min-h-[500px] w-full max-w-(--breakpoint-lg) focus:outline-hidden hover:prose-a:text-blue-500 sm:mb-[calc(20vh)] sm:rounded-lg'
          shouldRerenderOnTransaction={false}
          immediatelyRender={true}
          editorProps={{
            handleDOMEvents: { keydown: (_view, event) => handleCommandNavigation(event) },
            handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
            handleDrop: (view, event, _slice, moved) =>
              handleImageDrop(view, event, moved, uploadFn),
            attributes: {
              class:
                'prose prose-lg dark:prose-invert prose-headings:font-title font-default focus:outline-hidden max-w-full',
            },
          }}
          onUpdate={handleEditorUpdate}
          slotAfter={<ImageResizer />}>
          <EditorCommand className='z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md transition-all'>
            <EditorCommandEmpty className='px-2 text-muted-foreground'>
              No results
            </EditorCommandEmpty>
            <EditorCommandList>
              {suggestionItems.map((item) => (
                <EditorCommandItem
                  value={item.title}
                  onCommand={(val) => item.command?.(val)}
                  className='flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent'
                  key={item.title}>
                  <div className='flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background'>
                    {item.icon}
                  </div>
                  <div>
                    <p className='font-medium'>{item.title}</p>
                    <p className='text-xs text-muted-foreground'>{item.description}</p>
                  </div>
                </EditorCommandItem>
              ))}
            </EditorCommandList>
          </EditorCommand>

          <GenerativeMenuSwitch open={openAI} onOpenChange={setOpenAI}>
            <Separator orientation='vertical' />
            <NodeSelector open={openNode} onOpenChange={setOpenNode} />
            <Separator orientation='vertical' />

            <LinkSelector open={openLink} onOpenChange={setOpenLink} />
            <Separator orientation='vertical' />
            <TextButtons />
            <Separator orientation='vertical' />
            <ColorSelector open={openColor} onOpenChange={setOpenColor} />
          </GenerativeMenuSwitch>
        </EditorContent>
      </EditorRoot>
    </div>
  )
}

export default AuxxEditor
