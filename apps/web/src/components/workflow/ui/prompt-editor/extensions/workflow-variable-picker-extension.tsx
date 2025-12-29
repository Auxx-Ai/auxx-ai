// apps/web/src/components/workflow/prompt-editor/extensions/workflow-variable-picker-extension.tsx

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { VariableExplorerEnhanced } from '~/components/workflow/ui/variables/variable-explorer-enhanced'
import type { BaseType, UnifiedVariable } from '~/components/workflow/types/variable-types'
import React, { useImperativeHandle, useRef, useEffect, useState } from 'react'

/**
 * Configuration options for the WorkflowVariablePicker extension
 */
interface WorkflowVariablePickerExtensionOptions {
  suggestion: {
    char: string
    allowSpaces: boolean
    startOfLine: boolean
    variables: () => UnifiedVariable[] | Promise<UnifiedVariable[]>
    expectedTypes?: string[]
    render: () => {
      onStart: (props: any) => void
      onUpdate: (props: any) => void
      onKeyDown: (props: any) => boolean
      onExit: () => void
    }
  }
}

/**
 * Workflow Variable picker extension for TipTap editor
 * Triggers on single "{" character for workflow prompt editor
 * Inserts variables as custom variable-node elements with proper styling
 */
const suggestionPluginKey = new PluginKey('workflow-variable-picker-suggestion')

export const WorkflowVariablePickerExtension =
  Extension.create<WorkflowVariablePickerExtensionOptions>({
    name: 'workflow-variable-picker',

    onCreate() {},
    onDestroy() {},

    addOptions() {
      return {
        suggestion: {
          char: '{',
          allowSpaces: true,
          startOfLine: false,
          allowedPrefixes: null,
          variables: () => [],
          expectedTypes: undefined,
          render: () => ({
            onStart: () => {},
            onUpdate: () => {},
            onKeyDown: () => {},
            onExit: () => {},
          }),
        },
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
          pluginKey: suggestionPluginKey,
          // Transform the variables function to match suggestion API
          items: async ({ query }: { query: string }) => {
            const variables = await Promise.resolve(this.options.suggestion.variables())
            // Filter variables based on query if there is one
            if (!query) return variables
            return variables.filter(
              (variable) =>
                variable.label.toLowerCase().includes(query.toLowerCase()) ||
                (variable.source || '').toLowerCase().includes(query.toLowerCase()) ||
                (variable.description &&
                  variable.description.toLowerCase().includes(query.toLowerCase()))
            )
          },
        }),
      ]
    },
  })

/**
 * Adapter component that wraps VariableExplorer for use in TipTap extension
 */
interface VariableExplorerAdapterProps {
  command: (variable: UnifiedVariable) => void
  isLoading?: boolean
  expectedTypes?: string[]
  query?: string
}

interface VariableExplorerAdapterRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type VarExplorerRef = VariableExplorerAdapterRef
type VarExplorerProps = VariableExplorerAdapterProps & React.RefAttributes<VarExplorerRef>

const VariableExplorerAdapter: React.FC<VarExplorerProps> = ({
  nodeId,
  command,
  isLoading,
  expectedTypes,
  query = '',
  ref,
}) => {
  // No conversion needed - variables are already UnifiedVariable[]

  const containerRef = useRef<HTMLDivElement>(null)
  const [localSearch, setLocalSearch] = useState(query)

  // Update local search when query changes
  useEffect(() => {
    setLocalSearch(query)
  }, [query])

  // Handle keyboard navigation
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      // Don't handle events if the search input is focused
      const activeElement = document.activeElement
      const searchInput = containerRef.current?.querySelector('input[type="text"]')
      // console.log('Key down event:', event.key, 'Active element:', activeElement)
      // If search input is focused, only handle navigation keys
      if (activeElement === searchInput) {
        // Allow typing in search field, only handle navigation
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) {
          if (containerRef.current) {
            const commandElement = containerRef.current.querySelector('[cmdk-root]')
            if (commandElement) {
              const syntheticEvent = new KeyboardEvent('keydown', {
                key: event.key,
                code: event.code,
                keyCode: event.keyCode,
                which: event.which,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
                bubbles: true,
                cancelable: true,
              })
              commandElement.dispatchEvent(syntheticEvent)
              return true
            }
          }
        }
        // Don't intercept other keys when typing in search
        return false
      }

      // Forward all keyboard events to the Command component
      if (containerRef.current) {
        const commandElement = containerRef.current.querySelector('[cmdk-root]')
        if (commandElement) {
          const syntheticEvent = new KeyboardEvent('keydown', {
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            which: event.which,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
          })
          commandElement.dispatchEvent(syntheticEvent)

          // Return true if we handled navigation keys
          const handledKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab']
          return handledKeys.includes(event.key)
        }
      }
      return false
    },
  }))

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border bg-popover/60 backdrop-blur-sm shadow-lg shadow-black/10 outline-hidden  overflow-hidden w-[400px] pointer-events-auto"
      onKeyDown={(e) => {
        e.stopPropagation()
      }}>
      {isLoading ? (
        <div className="p-4 text-center text-muted-foreground">Loading variables...</div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Show the current search query */}
          {localSearch && (
            <div className="px-3 py-2 border-b bg-muted/50">
              <div className="text-sm text-muted-foreground">
                Searching for: <span className="font-medium text-foreground">{localSearch}</span>
              </div>
            </div>
          )}

          {/* Show filtered variables or empty state */}
          <VariableExplorerEnhanced
            nodeId={nodeId} // No node context in this adapter
            onVariableSelect={command}
            className="max-h-[400px]"
            placeholder="Type in editor to filter..."
            allowedTypes={expectedTypes}
          />
        </div>
      )}
    </div>
  )
}

VariableExplorerAdapter.displayName = 'VariableExplorerAdapter'

/**
 * Factory function to create a WorkflowVariablePickerExtension with workflow context
 * @param getVariables - Function to fetch available workflow variables
 * @param getGroups - Function to fetch variable groups
 * @param getAllVariables - Function to fetch all variables (flattened)
 * @param expectedTypes - Optional array of expected data types for filtering
 * @returns Configured WorkflowVariablePickerExtension instance
 */
export const createWorkflowVariablePickerExtension = (
  nodeId: string,
  expectedTypes?: BaseType[]
) => {
  return WorkflowVariablePickerExtension.configure({
    suggestion: {
      char: '{',
      allowSpaces: false,
      startOfLine: false,
      // variables: getVariables,
      expectedTypes,
      render: () => {
        let component: ReactRenderer<VariableExplorerAdapterRef>
        let popup: TippyInstance[]

        return {
          onStart: async (props: any) => {
            // console.log('onStart:', props.query)
            component = new ReactRenderer(VariableExplorerAdapter, {
              props: {
                nodeId,
                variables: [],
                isLoading: true,
                expectedTypes,
                query: props.query || '',
                command: (variable: UnifiedVariable) => {
                  // Variables are managed by node updates, not manually added

                  props.editor
                    .chain()
                    .focus()
                    .deleteRange({ from: props.range.from, to: props.range.to })
                    .insertContent({
                      type: 'variable-node',
                      attrs: {
                        variableId: variable.id,
                      },
                    })
                    .run()
                },
              },
              editor: props.editor,
            })

            if (!props.clientRect) {
              return
            }

            // Determine the appropriate container for the popup
            // If inside a dialog, append to the dialog's portal container to avoid focus trap issues
            const getAppendTarget = (): HTMLElement => {
              const editorElement = props.editor.options.element
              if (!editorElement) return document.body

              // Check if we're inside a dialog by looking for the portal container
              const dialogContent = editorElement.closest('[data-state="open"]')
              const dialogPortalContainer = dialogContent?.querySelector(
                '[data-dialog-portal-container]'
              ) as HTMLElement | null

              if (dialogPortalContainer) {
                return dialogPortalContainer
              }

              return document.body
            }

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: getAppendTarget,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
              maxWidth: 500,
              zIndex: 9999,
              theme: 'workflow-variable-picker',
              allowHTML: true,
              animation: false,
              hideOnClick: true,
              onHide: () => {
                // Destroy the component when popup is hidden
              },
              onShown: () => {},
            })

            component?.updateProps({
              isLoading: false,
              expectedTypes,
              query: props.query || '',
              command: (variable: UnifiedVariable) => {
                // Variables are managed by node updates, not manually added

                props.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: props.range.from, to: props.range.to })
                  .insertContent({ type: 'variable-node', attrs: { variableId: variable.id } })
                  .run()
              },
            })
          },

          onUpdate(props: any) {
            component?.updateProps({
              isLoading: false,
              expectedTypes,
              query: props.query || '',
              command: (variable: UnifiedVariable) => {
                // Variables are managed by node updates, not manually added

                props.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: props.range.from, to: props.range.to })
                  .insertContent({ type: 'variable-node', attrs: { variableId: variable.id } })
                  // .insertContent(' ')
                  .run()
              },
            })

            if (!props.clientRect) {
              return
            }

            popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
          },

          onKeyDown(props: any) {
            // console.log('onKeyDown (suggestion):', props.event.key)
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide()
              return true
            }

            if (!component?.ref) {
              return false
            }

            return component.ref.onKeyDown(props.event)
          },

          onExit() {
            console.log('onExit')
            popup?.[0]?.destroy()
            component?.destroy()
          },
        }
      },
    },
  })
}
