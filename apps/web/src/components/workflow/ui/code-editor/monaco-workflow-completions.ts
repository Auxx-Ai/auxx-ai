// apps/web/src/components/workflow/ui/code-editor/monaco-workflow-completions.ts

import type { Node } from '@xyflow/react'
import type { editor, IDisposable, languages } from 'monaco-editor'
import type { UnifiedVariable } from '~/components/workflow/types'
import { getPathFromVariableId } from '~/components/workflow/utils/variable-utils'

interface CompletionContext {
  getNodes: () => Node[]
  getNodeVariables: (nodeId: string) => UnifiedVariable[]
  getCurrentNodeId?: () => string
}

/**
 * Creates a Monaco completion provider for workflow variable access
 * Supports syntax: $('node-id').var('variable-name')
 */
export function createWorkflowCompletionProvider(
  monaco: any,
  context: CompletionContext
): IDisposable {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['$', '(', '.', "'", '"', 'v'],

    provideCompletionItems: (
      model: editor.ITextModel,
      position: any,
      ctx: languages.CompletionContext,
      token: any
    ): languages.ProviderResult<languages.CompletionList> => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const linePrefix = model.getLineContent(position.lineNumber).substring(0, position.column - 1)

      // Get the word at the current position for proper replacement
      const word = model.getWordAtPosition(position)

      // Pattern 1: User typed "$(" - suggest node IDs
      if (linePrefix.match(/\$\($/)) {
        return createNodeSuggestions(monaco, context, '', position, model)
      }

      // Pattern 2: User typed "$('node" or "$("node" - filter node suggestions
      const partialNodeMatch = linePrefix.match(/\$\((['"]{0,1})([^'"]*)$/)
      if (partialNodeMatch && !linePrefix.includes(').')) {
        const quoteChar = partialNodeMatch[1]
        const partialNodeId = partialNodeMatch[2]
        return createNodeSuggestions(monaco, context, partialNodeId, position, model, quoteChar)
      }

      // Pattern 3: User typed "$('node-id')." or "$('node-id').v" etc - suggest 'var' method
      const nodeMethodMatch = linePrefix.match(/\$\(['"]([^'"]+)['"]\)\.([a-zA-Z]*)$/)
      if (nodeMethodMatch) {
        const partialMethod = nodeMethodMatch[2] || ''

        // Don't suggest if they've already typed 'var('
        if (partialMethod.includes('(')) {
          return { suggestions: [] }
        }

        // Always show var suggestion if we match the pattern, even if no partial text
        if (partialMethod === '' || 'var'.startsWith(partialMethod.toLowerCase())) {
          // Calculate the range to replace
          const replaceRange =
            partialMethod && word
              ? new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                )
              : undefined

          return {
            suggestions: createMethodSuggestions(monaco, replaceRange).suggestions,
            incomplete: false, // This tells Monaco our list is complete
          }
        }

        // No matching suggestions
        return { suggestions: [] }
      }

      // Pattern 4: User typed "$('node-id').var(" - suggest variables
      const nodeVarMatch = linePrefix.match(/\$\(['"]([^'"]+)['"]\)\.var\((['"]{0,1})([^'"]*)$/)
      if (nodeVarMatch) {
        const nodeId = nodeVarMatch[1]
        const quoteChar = nodeVarMatch[2]
        const partialVarName = nodeVarMatch[3] || ''
        return createVariableSuggestions(
          monaco,
          context,
          nodeId,
          partialVarName,
          position,
          model,
          quoteChar
        )
      }

      return { suggestions: [] }
    },
  })
}

/**
 * Create suggestions for node IDs
 */
function createNodeSuggestions(
  monaco: any,
  context: CompletionContext,
  filter?: string,
  position?: any,
  model?: editor.ITextModel,
  quoteChar?: string
): languages.CompletionList {
  const nodes = context.getNodes()
  const currentNodeId = context.getCurrentNodeId?.()

  const suggestions = nodes
    .filter((node) => {
      // Don't suggest the current node (avoid self-reference)
      if (node.id === currentNodeId) return false
      // Apply filter if provided
      if (filter && !node.id.toLowerCase().includes(filter.toLowerCase())) {
        return false
      }
      return true
    })
    .map((node) => {
      const nodeTitle = node.data?.title || node.data?.label || node.type
      const isUpstream = currentNodeId ? isNodeUpstream(nodes, node.id, currentNodeId) : true

      let insertText: string
      let range: any

      if (position && model) {
        const lineContent = model.getLineContent(position.lineNumber)
        const beforeCursor = lineContent.substring(0, position.column - 1)
        const afterCursor = lineContent.substring(position.column - 1)

        // Check what's around the cursor to determine proper replacement
        if (quoteChar) {
          // We have quotes, just insert the node ID
          insertText = node.id
          // Find the range to replace (between the quotes)
          const startPos = beforeCursor.lastIndexOf(quoteChar) + 1
          range = new monaco.Range(
            position.lineNumber,
            startPos + 1,
            position.lineNumber,
            position.column
          )
        } else if (beforeCursor.endsWith('$(') && afterCursor.startsWith("')")) {
          // Case: $('|') where | is cursor - just insert node ID
          insertText = node.id
          range = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column
          )
        } else if (beforeCursor.endsWith('$(') && afterCursor.startsWith(')')) {
          // Case: $(|) where | is cursor - insert quoted node ID and position cursor after the )
          insertText = `'${node.id}')$0` // $0 positions cursor at the end
          range = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column + 1 // Include the closing ) in replacement
          )
        } else if (beforeCursor.endsWith('$(')) {
          // Case: $(| - insert full quoted string with closing
          insertText = `'${node.id}')`
        } else {
          // Default case
          insertText = `'${node.id}')`
        }
      } else {
        // Fallback
        insertText = `'${node.id}')`
      }

      const isSnippet = insertText.includes('$0')

      return {
        label: node.id,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: insertText,
        insertTextRules: isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range: range,
        detail: `${nodeTitle} (${node.type})`,
        documentation: {
          value: `Access variables from **${nodeTitle}**\n\nNode ID: \`${node.id}\`\nType: ${node.type}${
            !isUpstream ? '\n\n⚠️ This node is not upstream of the current node' : ''
          }`,
          isTrusted: true,
        },
        sortText: isUpstream ? `0_${node.id}` : `1_${node.id}`, // Sort upstream nodes first
        filterText: `${node.id} ${nodeTitle}`, // Allow filtering by both ID and title
      }
    })

  return { suggestions }
}

/**
 * Create suggestions for methods (currently just 'var')
 */
function createMethodSuggestions(monaco: any, range?: any): languages.CompletionList {
  return {
    suggestions: [
      {
        label: 'var',
        kind: monaco.languages.CompletionItemKind.Function, // Try Function instead of Method
        insertText: 'var(',
        detail: 'Access a variable from this node',
        documentation: {
          value:
            'Access a specific variable output from the selected node.\n\nExample: `$("node-123").var("content")`',
          isTrusted: true,
        },
        preselect: true, // Make this the default selection
        sortText: '0000', // Ensure it appears first
        filterText: 'var', // Make sure it matches when typing 'var'
        range: range, // Specify what text to replace
        commitCharacters: ['('], // Auto-commit on typing '('
      },
    ],
  }
}

/**
 * Create suggestions for variables from a specific node
 */
function createVariableSuggestions(
  monaco: any,
  context: CompletionContext,
  nodeId: string,
  filter?: string,
  position?: any,
  model?: editor.ITextModel,
  quoteChar?: string
): languages.CompletionList {
  const variables = context.getNodeVariables(nodeId)

  const suggestions = variables
    .filter((variable) => {
      // Filter by partial match if provided
      if (filter) {
        const searchTerm = filter.toLowerCase()
        const varPath = getPathFromVariableId(variable.id)
        return (
          varPath.toLowerCase().includes(searchTerm) ||
          variable.label.toLowerCase().includes(searchTerm)
        )
      }
      return true
    })
    .map((variable) => {
      const typeIcon = getTypeIcon(variable.type)
      const isRequired = variable.required ? ' (required)' : ''
      const varPath = getPathFromVariableId(variable.id)

      let insertText: string
      let range: any

      if (position && model) {
        const lineContent = model.getLineContent(position.lineNumber)
        const beforeCursor = lineContent.substring(0, position.column - 1)
        const afterCursor = lineContent.substring(position.column - 1)

        // Check what's around the cursor to determine proper replacement
        if (quoteChar) {
          // We have quotes, just insert the variable path
          insertText = varPath
          // Find the range to replace (between the quotes)
          const startPos = beforeCursor.lastIndexOf(quoteChar) + 1
          range = new monaco.Range(
            position.lineNumber,
            startPos + 1,
            position.lineNumber,
            position.column
          )
        } else if (beforeCursor.endsWith('.var(') && afterCursor.startsWith("')")) {
          // Case: .var('|') where | is cursor - just insert variable path
          insertText = varPath
          range = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column
          )
        } else if (beforeCursor.endsWith('.var(') && afterCursor.startsWith(')')) {
          // Case: .var(|) where | is cursor - insert quoted variable path and position cursor after the )
          insertText = `'${varPath}')$0` // $0 positions cursor at the end
          range = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column + 1 // Include the closing ) in replacement
          )
        } else if (beforeCursor.endsWith('.var(')) {
          // Case: .var(| - insert full quoted string with closing
          insertText = `'${varPath}')`
        } else {
          // Default case
          insertText = `'${varPath}')`
        }
      } else {
        // Fallback
        insertText = `'${varPath}')`
      }

      const isSnippet = insertText.includes('$0')

      return {
        label: varPath,
        kind: monaco.languages.CompletionItemKind.Property,
        insertText: insertText,
        insertTextRules: isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range: range,
        detail: `${typeIcon} ${variable.type}${isRequired}`,
        documentation: {
          value: `**${variable.label}**\n\n${
            variable.description || 'No description available'
          }\n\nType: \`${variable.type}\`\nFull ID: \`${variable.id}\``,
          isTrusted: true,
        },
        sortText: variable.required ? `0_${varPath}` : `1_${varPath}`, // Sort required first
        filterText: `${varPath} ${variable.label}`, // Allow filtering by both path and label
      }
    })

  // If no variables found, show a helpful message
  if (suggestions.length === 0) {
    return {
      suggestions: [
        {
          label: 'No variables available',
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: "'')  // No variables available from this node",
          detail: 'This node has no output variables',
          documentation: {
            value: `The node **${nodeId}** does not produce any output variables.\n\nThis could mean:\n- The node hasn't been configured yet\n- The node type doesn't produce outputs\n- The node configuration is invalid`,
            isTrusted: true,
          },
        },
      ],
    }
  }

  return { suggestions }
}

/**
 * Get an icon representation for a variable type
 */
function getTypeIcon(type: string): string {
  const typeIcons: Record<string, string> = {
    string: '📝',
    number: '🔢',
    boolean: '✓',
    array: '📋',
    object: '📦',
    datetime: '📅',
    email: '📧',
    url: '🔗',
    file: '📄',
    image: '🖼️',
    json: '{ }',
  }
  return typeIcons[type.toLowerCase()] || '📌'
}

/**
 * Check if nodeA is upstream of nodeB
 */
function isNodeUpstream(nodes: Node[], nodeA: string, nodeB: string): boolean {
  // This is a simplified check - in production, you'd want to traverse the graph
  // For now, we'll assume all nodes except the current one are potentially upstream
  return true
}

/**
 * Transform $('node-id').var('variable') syntax to node-id.variable format
 * This is used when executing the code
 */
export function transformWorkflowVariableSyntax(code: string): string {
  // Transform $('node-id').var('variable') to {{node-id.variable}}
  return code.replace(/\$\(['"]([^'"]+)['"]\)\.var\(['"]([^'"]+)['"]\)/g, '{{$1.$2}}')
}

/**
 * Extract all variable references from code
 * Returns array of { nodeId, variablePath, fullPath }
 */
export function extractVariableReferences(code: string): Array<{
  nodeId: string
  variablePath: string
  fullPath: string
}> {
  const references: Array<{ nodeId: string; variablePath: string; fullPath: string }> = []
  const regex = /\$\(['"]([^'"]+)['"]\)\.var\(['"]([^'"]+)['"]\)/g

  let match
  while ((match = regex.exec(code)) !== null) {
    references.push({
      nodeId: match[1],
      variablePath: match[2],
      fullPath: `${match[1]}.${match[2]}`,
    })
  }

  return references
}
