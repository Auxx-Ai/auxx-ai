// apps/web/src/components/workflow/ui/code-editor/code-editor-header.tsx

'use client'

import React, { useState } from 'react'
import { Clipboard, ClipboardCheck, Maximize2, Minimize2, Code2, Download, Sparkles } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { useCodeEditorContext } from './code-editor-context'
import { Tooltip } from '~/components/global/tooltip'
import { CodeLanguage } from './types'
import { ActionButton } from '~/components/workflow/ui/action-button'
import { GenerateContentDialog } from '~/components/workflow/dialogs/generate-content-dialog'
import { useWorkflowStore } from '~/components/workflow/store'

/**
 * Toggle expand button component
 * Reused from prompt-editor
 */
const ToggleExpandBtn: React.FC<{
  isExpand: boolean
  onExpandChange: (expanded: boolean) => void
}> = ({ isExpand, onExpandChange }) => (
  <ActionButton onClick={() => onExpandChange(!isExpand)}>
    {isExpand ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
  </ActionButton>
)

/**
 * Language badge component
 */
const LanguageBadge: React.FC<{ language: CodeLanguage }> = ({ language }) => {
  const displayName = language === CodeLanguage.javascript ? 'JS' : 'JSON'

  return (
    <span className="inline-flex items-center rounded bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700">
      {displayName}
    </span>
  )
}

/**
 * CodeEditor Header Component
 * Contains title with language badge, line count, and operation buttons
 * Uses context to eliminate prop drilling
 */
const CodeEditorHeader: React.FC = () => {
  const {
    title,
    value,
    onChange,
    language,
    isExpanded,
    setIsExpanded,
    handleCopy,
    handleFormat,
    handleDownload,
    isCopied,
    readOnly,
    headerRight,
    downloadFilename,
    nodeId,
    codeInputs,
    codeOutputs,
  } = useCodeEditorContext()

  // Get workflowId from store
  const workflowId = useWorkflowStore((state) => state.workflow?.id)

  // Generate dialog state
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)

  // Calculate line count
  const lineCount = value ? value.split('\n').length : 0

  /**
   * Handle applying generated content
   */
  const handleApplyGenerated = (generatedContent: string) => {
    onChange(generatedContent)
  }

  /**
   * Map CodeLanguage enum to the expected type for GenerateContentDialog
   */
  const getLanguageForDialog = (): 'javascript' | 'json' => {
    return language === CodeLanguage.json ? 'json' : 'javascript'
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between pl-3 pr-2 pt-1',
        isExpanded ? 'h-10' : 'h-7'
      )}>
      {/* Title section with language badge */}
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold uppercase text-primary-500">{title || 'CODE'}</div>
        <LanguageBadge language={language} />
      </div>

      {/* Operations section */}
      <div
        className="flex items-center"
        onClick={(e) => {
          e.nativeEvent.stopImmediatePropagation()
          e.stopPropagation()
        }}>
        {/* Line count */}
        <div className="text-xs font-medium leading-[18px] text-primary-500">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </div>

        {/* Divider */}
        <div className="mx-2 h-3 w-px bg-primary-200"></div>

        {/* Operation buttons */}
        <div className="flex items-center">
          {/* Custom header right content */}
          {headerRight}

          {/* Generate code button */}
          {!readOnly && workflowId && nodeId && (
            <Tooltip content="Generate Code">
              <div>
                <ActionButton className="ml-1" onClick={() => setIsGenerateDialogOpen(true)}>
                  <Sparkles className="size-4" />
                </ActionButton>
              </div>
            </Tooltip>
          )}

          {/* Format code button */}
          {!readOnly && (
            <Tooltip content="Format code">
              <div>
                <ActionButton className="ml-1" onClick={handleFormat}>
                  <Code2 className="size-4" />
                </ActionButton>
              </div>
            </Tooltip>
          )}

          {/* Copy button */}
          <Tooltip content={isCopied ? 'Copied!' : 'Copy code'}>
            <div>
              <ActionButton className="ml-1" onClick={handleCopy}>
                {!isCopied ? (
                  <Clipboard className="size-4 cursor-pointer" />
                ) : (
                  <ClipboardCheck className="size-4" />
                )}
              </ActionButton>
            </div>
          </Tooltip>

          {/* Download button - only show if download is enabled */}
          {downloadFilename && (
            <Tooltip content="Download">
              <div>
                <ActionButton className="ml-1" onClick={handleDownload}>
                  <Download className="size-4" />
                </ActionButton>
              </div>
            </Tooltip>
          )}

          {/* Expand/collapse button */}
          <Tooltip content={isExpanded ? 'Close' : 'Expand'}>
            <div className="ml-1">
              <ToggleExpandBtn isExpand={isExpanded} onExpandChange={setIsExpanded} />
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Generate Content Dialog */}
      {workflowId && nodeId && (
        <GenerateContentDialog
          open={isGenerateDialogOpen}
          onOpenChange={setIsGenerateDialogOpen}
          nodeId={nodeId}
          workflowId={workflowId}
          generationType="code"
          language={getLanguageForDialog()}
          currentContentValue={value}
          codeInputs={codeInputs}
          codeOutputs={codeOutputs}
          onApply={handleApplyGenerated}
        />
      )}
    </div>
  )
}

export default React.memo(CodeEditorHeader)
