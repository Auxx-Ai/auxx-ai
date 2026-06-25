// apps/web/src/components/schema-editor/ui/code-editor.tsx

import { Spinner } from '@auxx/ui/components/spinner'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Clipboard, IndentIncrease } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { type HTMLAttributes, useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'

const Editor = dynamic(() => import('@monaco-editor/react').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className='flex h-full items-center justify-center'>
      <Spinner className='size-5 text-muted-foreground' />
    </div>
  ),
})

interface CodeEditorProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  onUpdate?: (value: string) => void
  showFormatButton?: boolean
  editorWrapperClassName?: string
  readOnly?: boolean
  hideTopMenu?: boolean
}

/**
 * Monaco-backed JSON editor (dynamically imported, SSR-disabled). Moved
 * verbatim from the old StructuredOutputGenerator — the look/behavior is
 * unchanged; only the module style was modernized to a named export.
 */
export function CodeEditor({
  value,
  onUpdate,
  showFormatButton = true,
  editorWrapperClassName,
  readOnly = false,
  hideTopMenu = false,
  className,
}: CodeEditorProps) {
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
  const [isMounted, setIsMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const { copy, copied } = useCopy({ toastMessage: 'Copied to clipboard' })

  const handleEditorDidMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor
      monacoRef.current = monaco
      monaco.editor.defineTheme('light-theme', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#00000000',
          'editor.lineHighlightBackground': '#00000000',
          focusBorder: '#00000000',
        },
      })
      monaco.editor.defineTheme('dark-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#00000000',
          'editor.lineHighlightBackground': '#00000000',
          focusBorder: '#00000000',
        },
      })
      const currentTheme = theme === 'dark' ? 'dark-theme' : 'light-theme'
      monaco.editor.setTheme(currentTheme)
      setIsMounted(true)
    },
    [theme]
  )

  const formatJsonContent = useCallback(() => {
    if (editorRef.current) editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) onUpdate?.(value)
    },
    [onUpdate]
  )

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      editorRef.current?.layout()
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (isMounted && monacoRef.current) {
      const currentTheme = theme === 'dark' ? 'dark-theme' : 'light-theme'
      monacoRef.current.editor.setTheme(currentTheme)
    }
  }, [theme, isMounted])

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col h-full bg-primary-100 overflow-hidden',
        hideTopMenu && 'pt-2',
        className
      )}>
      {!hideTopMenu && (
        <div className='flex items-center justify-between pl-2 pr-1 pt-1'>
          <div className='uppercase text-sm font-semibold py-0.5 text-primary-500'>
            <span className='px-1 py-0.5'>JSON</span>
          </div>
          <div className='flex items-center gap-x-0.5'>
            {showFormatButton && (
              <Tooltip content='Format'>
                <button
                  type='button'
                  className='flex h-6 w-6 items-center justify-center'
                  onClick={formatJsonContent}>
                  <IndentIncrease className='h-4 w-4' />
                </button>
              </Tooltip>
            )}
            <Tooltip content={copied ? 'Copied' : 'Copy'}>
              <button
                type='button'
                className='flex h-6 w-6 items-center justify-center'
                onClick={() => copy(value)}>
                {copied ? <Check className='h-4 w-4' /> : <Clipboard className='h-4 w-4' />}
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      <div className={cn('relative overflow-hidden flex-1', editorWrapperClassName)}>
        <Editor
          defaultLanguage='json'
          theme={
            isMounted
              ? theme === 'dark'
                ? 'dark-theme'
                : 'light-theme'
              : theme === 'dark'
                ? 'vs-dark'
                : 'vs'
          }
          value={value}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly,
            // Force Monaco's legacy hidden <textarea> input path instead of the
            // EditContext API (its default since 0.52). With EditContext on, the
            // focused editable element is a <div class="native-edit-context"> — not
            // a textarea/contentEditable — so @tanstack/hotkeys' isInputElement
            // misses it and global single-key chords (g,i / s,c …) fire while
            // typing here. The textarea path is detected and suppresses them.
            editContext: false,
            stickyScroll: { enabled: false },
            domReadOnly: readOnly,
            minimap: { enabled: false },
            tabSize: 2,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlightOnlyWhenFocus: false,
            renderLineHighlight: 'none',
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
              verticalScrollbarSize: 0,
              horizontalScrollbarSize: 0,
              alwaysConsumeMouseWheel: false,
            },
          }}
        />
      </div>
    </div>
  )
}
