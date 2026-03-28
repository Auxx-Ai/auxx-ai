// apps/web/src/components/workflow/ui/code-editor/code-editor-content.tsx

'use client'

import Loader from '@auxx/ui/components/loader'
import { useReactFlow } from '@xyflow/react'
import type { IDisposable } from 'monaco-editor'
import dynamic from 'next/dynamic'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useVarStore } from '~/components/workflow/store/use-var-store'
import EditorHeightResizeWrap from '../editor-height-resize-wrap'
import { useCodeEditorContext } from './code-editor-context'
import { COMPLETION_EDITOR_OPTIONS, DEFAULT_EDITOR_OPTIONS } from './constants'
import { createWorkflowCompletionProvider } from './monaco-workflow-completions'
import {
  createOverflowWidgetContainer,
  releaseOverflowWidgetContainer,
} from './overflow-widget-manager'
import { CodeLanguage, languageMap } from './types'

const Editor = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className='flex h-full items-center justify-center'>
      <Loader size='sm' title='Loading...' subtitle='Summoning the syntax highlighter' />
    </div>
  ),
})

interface WorkflowContext {
  getNodes: () => any[]
  getNodeVariables: (targetNodeId: string) => any[]
}

/**
 * Bridge component that safely calls ReactFlow/VarStore hooks
 * Only rendered when nodeId is provided, avoiding conditional hook calls
 */
const WorkflowCompletionsBridge: React.FC<{
  contextRef: React.MutableRefObject<WorkflowContext | null>
}> = ({ contextRef }) => {
  const reactFlowInstance = useReactFlow()
  const varStore = useVarStore()

  contextRef.current = {
    getNodes: () => reactFlowInstance.getNodes(),
    getNodeVariables: (targetNodeId: string) => {
      const nodeOutput = varStore.nodeOutputs.get(targetNodeId)
      return nodeOutput?.variables || []
    },
  }

  return null
}

/**
 * CodeEditor Content Component
 * Integrates Monaco Editor with resize functionality
 * Uses context to eliminate prop drilling
 */
const CodeEditorContent: React.FC = () => {
  const {
    value,
    onChange,
    language,
    placeholder,
    readOnly,
    height,
    minHeight,
    isExpanded,
    isFocused,
    setIsFocused,
    editorRef,
    monacoRef,
    contentHeight,
    setContentHeight,
    theme,
    noWrapper,
    tip,
    nodeId,
    enableWorkflowCompletions,
    onMount,
  } = useCodeEditorContext()

  const [isMounted, setIsMounted] = useState(false)
  const completionProviderRef = useRef<IDisposable | null>(null)
  const overflowContainerRef = useRef<HTMLElement | null>(null)
  const workflowContextRef = useRef<WorkflowContext | null>(null)

  // Calculate editor height
  // const editorHeight = isExpanded ? editorExpandHeight : contentHeight
  const editorHeight = contentHeight
  const editorContentMinHeight = minHeight - 28 // Account for header

  // Cleanup completion provider and overflow container on unmount
  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose()
      }
      if (overflowContainerRef.current) {
        releaseOverflowWidgetContainer()
        overflowContainerRef.current = null
      }
    }
  }, [])

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onChange(value || '')
    },
    [onChange]
  )

  const handleEditorDidMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor
      monacoRef.current = monaco

      // Set up focus handlers
      editor.onDidFocusEditorText(() => {
        setIsFocused(true)
      })
      editor.onDidBlurEditorText(() => {
        setIsFocused(false)
      })

      // Define custom themes with sticky scroll styling
      monaco.editor.defineTheme('auxx-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editorStickyScroll.background': '#ffffffcc',
        },
      })
      monaco.editor.defineTheme('auxx-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editorStickyScroll.background': '#1e2227',
          'editorStickyScroll.shadow': '#00000020',
        },
      })

      // Set theme
      const customTheme = theme === 'vs-dark' ? 'auxx-dark' : 'auxx-light'
      monaco.editor.setTheme(customTheme)

      // Update overflow container classes from the actual Monaco editor
      if (overflowContainerRef.current && editor.getDomNode) {
        const editorElement = editor.getDomNode()
        if (editorElement) {
          // Copy classes from Monaco editor to ensure proper styling
          overflowContainerRef.current.className = editorElement.className
        }
      }

      // Register workflow completion provider if enabled
      if (
        nodeId &&
        enableWorkflowCompletions &&
        language === CodeLanguage.javascript &&
        workflowContextRef.current
      ) {
        const wfContext = workflowContextRef.current
        const context = {
          getNodes: () => wfContext.getNodes(),
          getNodeVariables: (targetNodeId: string) => wfContext.getNodeVariables(targetNodeId),
          getCurrentNodeId: () => nodeId,
        }

        completionProviderRef.current = createWorkflowCompletionProvider(monaco, context)
      }

      // Call custom onMount if provided
      if (onMount) {
        onMount(editor, monaco)
      }

      setIsMounted(true)
    },
    [
      editorRef,
      monacoRef,
      setIsFocused,
      theme,
      nodeId,
      enableWorkflowCompletions,
      language,
      onMount,
    ]
  )

  // Monaco editor options - use enhanced options for workflow completions
  const shouldUseCompletions =
    nodeId && enableWorkflowCompletions && language === CodeLanguage.javascript
  const baseOptions = shouldUseCompletions ? COMPLETION_EDITOR_OPTIONS : DEFAULT_EDITOR_OPTIONS

  // Create overflow container using useMemo to avoid recreating on every render
  const overflowContainer = React.useMemo(() => {
    if (shouldUseCompletions) {
      const container = createOverflowWidgetContainer(theme)
      overflowContainerRef.current = container
      return container
    }
    return null
  }, [shouldUseCompletions, theme])

  const editorOptions = {
    ...baseOptions,
    readOnly,
    // Set overflow widget container if using completions
    ...(overflowContainer && { overflowWidgetsDomNode: overflowContainer }),
  }

  const bridgeElement = nodeId ? (
    <WorkflowCompletionsBridge contextRef={workflowContextRef} />
  ) : null

  // When expanded, use full height layout without resize wrapper
  if (isExpanded) {
    return (
      <>
        {bridgeElement}
        {tip && <div className='px-1 py-0.5'>{tip}</div>}
        <div className='h-full pb-4 px-2 flex-1 min-h-0 flex'>
          <div className='relative h-full flex-1 pt-1'>
            <Editor
              language={languageMap[language]}
              theme={isMounted ? (theme === 'vs-dark' ? 'auxx-dark' : 'auxx-light') : 'vs'}
              value={value}
              loading={
                <div className='flex h-full items-center justify-center'>
                  <Loader
                    size='sm'
                    title='Loading...'
                    subtitle='Summoning the syntax highlighter'
                  />
                </div>
              }
              onChange={handleEditorChange}
              options={editorOptions}
              onMount={handleEditorDidMount}
            />
            {!value && !isFocused && placeholder && (
              <div className='pointer-events-none absolute left-[34px] top-0 text-[13px] font-normal leading-[18px] text-gray-300'>
                {placeholder}
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // Inline view with resize wrapper
  return (
    <>
      {bridgeElement}
      {/* Tip section */}
      {tip && <div className='px-1 py-0.5'>{tip}</div>}

      {/* Editor with resize wrapper */}
      <EditorHeightResizeWrap
        height={editorHeight}
        minHeight={editorContentMinHeight}
        onHeightChange={setContentHeight}
        hideResize={false}
        nativeScroll>
        <div className='h-full pb-4 px-2 flex-1 min-h-0 flex'>
          <div className='relative h-full flex-1'>
            <Editor
              language={languageMap[language]}
              theme={isMounted ? (theme === 'vs-dark' ? 'auxx-dark' : 'auxx-light') : 'vs'}
              value={value}
              loading={
                <div className='flex h-full items-center justify-center'>
                  <Loader
                    size='sm'
                    title='Loading...'
                    subtitle='Summoning the syntax highlighter'
                  />
                </div>
              }
              onChange={handleEditorChange}
              options={editorOptions}
              onMount={handleEditorDidMount}
            />
            {/* Placeholder overlay */}
            {!value && !isFocused && placeholder && (
              <div className='pointer-events-none absolute left-[34px] top-0 text-[13px] font-normal leading-[18px] text-gray-300'>
                {placeholder}
              </div>
            )}
          </div>
        </div>
      </EditorHeightResizeWrap>
    </>
  )
}

export default React.memo(CodeEditorContent)
