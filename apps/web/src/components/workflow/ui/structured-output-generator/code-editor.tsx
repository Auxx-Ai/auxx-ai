// apps/web/src/components/workflow/ui/structured-output-generator/code-editor.tsx

import { cn } from '@auxx/ui/lib/utils'
import { Editor } from '@monaco-editor/react'
import { Clipboard, IndentIncrease } from 'lucide-react'
import { useTheme } from 'next-themes'
import React, { type FC, useCallback, useEffect, useRef } from 'react'
// import copy from 'copy-to-clipboard'
import { Tooltip } from '~/components/global/tooltip'

type CodeEditorProps = {
  value: string
  onUpdate?: (value: string) => void
  showFormatButton?: boolean
  editorWrapperClassName?: string
  readOnly?: boolean
  hideTopMenu?: boolean
} & React.HTMLAttributes<HTMLDivElement>

const CodeEditor: FC<CodeEditorProps> = ({
  value,
  onUpdate,
  showFormatButton = true,
  editorWrapperClassName,
  readOnly = false,
  hideTopMenu = false,
  className,
}) => {
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
  const [isMounted, setIsMounted] = React.useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

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
      // Set initial theme based on current theme
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

  // Handle theme changes after editor is mounted
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
            <Tooltip content='Copy'>
              <button
                type='button'
                className='flex h-6 w-6 items-center justify-center'
                onClick={() => navigator.clipboard.writeText(value)}>
                <Clipboard className='h-4 w-4' />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      <div className={cn('relative overflow-hidden', editorWrapperClassName)}>
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
            stickyScroll: { enabled: false },
            domReadOnly: true,
            minimap: { enabled: false },
            tabSize: 2,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlightOnlyWhenFocus: false,
            renderLineHighlight: 'none',
            // Hide scrollbar borders
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

export default React.memo(CodeEditor)
