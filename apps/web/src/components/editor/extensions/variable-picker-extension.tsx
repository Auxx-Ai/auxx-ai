// src/components/editor/extensions/variable-picker-extension.tsx
// Variable picker extension for TipTap editor - allows insertion of workflow variables as custom tags

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import {
  VariablePickerCommandAdapter,
  type VariablePickerCommandAdapterRef,
  type WorkflowVariable,
} from '../variable-picker-command-adapter'
// import { type AvailableVariable } from '~/components/workflow/hooks/use-available-variables'

/**
 * Configuration options for the VariablePicker extension
 */
// interface VariablePickerExtensionOptions {
//   suggestion: {
//     char: string
//     allowSpaces: boolean
//     startOfLine: boolean
//     variables: () => AvailableVariable[] | Promise<AvailableVariable[]>
//     expectedTypes?: string[]
//     render: () => {
//       onStart: (props: any) => void
//       onUpdate: (props: any) => void
//       onKeyDown: (props: any) => boolean
//       onExit: () => void
//     }
//   }
// }

/**
 * Variable picker extension for TipTap editor
 * Triggers on "{{" characters and provides workflow variable suggestions
 * Inserts variables as custom variable-node elements with proper styling
 */
// export const VariablePickerExtension = Extension.create<VariablePickerExtensionOptions>({
//   name: 'variable-picker',

//   addOptions() {
//     return {
//       suggestion: {
//         char: '{{',
//         allowSpaces: false,
//         startOfLine: false,
//         variables: () => [],
//         expectedTypes: undefined,
//         render: () => {
//           let component: ReactRenderer<VariablePickerCommandAdapterRef>
//           let popup: TippyInstance[]

//           return {
//             onStart: (props: any) => {
//               component = new ReactRenderer(VariablePickerCommandAdapter, {
//                 props: {
//                   variables: [],
//                   isLoading: true,
//                   expectedTypes: this.options.suggestion.expectedTypes,
//                   command: (variable: WorkflowVariable) => {
//                     // Insert variable node
//                     props.editor
//                       .chain()
//                       .focus()
//                       .deleteRange({ from: props.range.from, to: props.range.to })
//                       .insertContent({
//                         type: 'variable-node',
//                         attrs: {
//                           path: variable.path,
//                           label: variable.label,
//                           dataType: variable.dataType,
//                           nodeName: variable.nodeName,
//                         },
//                       })
//                       .insertContent(' ')
//                       .run()
//                   },
//                 },
//                 editor: props.editor,
//               })
//               console.log('PICKER VAR')

//               if (!props.clientRect) {
//                 return
//               }

//               popup = tippy('body', {
//                 getReferenceClientRect: props.clientRect,
//                 appendTo: () => document.body,
//                 content: component.element,
//                 showOnCreate: true,
//                 interactive: true,
//                 trigger: 'manual',
//                 placement: 'bottom-start',
//                 maxWidth: 400,
//                 zIndex: 9999,
//               })

//               // Load variables asynchronously
//               Promise.resolve(this.options.suggestion.variables()).then((variables) => {
//                 component?.updateProps({
//                   variables,
//                   isLoading: false,
//                   expectedTypes: this.options.suggestion.expectedTypes,
//                   command: (variable: WorkflowVariable) => {
//                     props.editor
//                       .chain()
//                       .focus()
//                       .deleteRange({ from: props.range.from, to: props.range.to })
//                       .insertContent({
//                         type: 'variable-node',
//                         attrs: {
//                           path: variable.path,
//                           label: variable.label,
//                           dataType: variable.dataType,
//                           nodeName: variable.nodeName,
//                         },
//                       })
//                       .insertContent(' ')
//                       .run()
//                   },
//                 })
//               })
//             },

//             onUpdate(props: any) {
//               component?.updateProps({
//                 ...props,
//                 command: (variable: WorkflowVariable) => {
//                   props.editor
//                     .chain()
//                     .focus()
//                     .deleteRange({ from: props.range.from, to: props.range.to })
//                     .insertContent({
//                       type: 'variable-node',
//                       attrs: {
//                         path: variable.path,
//                         label: variable.label,
//                         dataType: variable.dataType,
//                         nodeName: variable.nodeName,
//                       },
//                     })
//                     .insertContent(' ')
//                     .run()
//                 },
//               })

//               if (!props.clientRect) {
//                 return
//               }

//               popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
//             },

//             onKeyDown(props: any) {
//               if (props.event.key === 'Escape') {
//                 console.log('variable-picker-extension - Escape pressed')
//                 popup?.[0]?.hide()
//                 return true
//               }

//               if (!component?.ref) {
//                 return false
//               }

//               return component.ref.onKeyDown(props.event)
//             },

//             onExit() {
//               popup?.[0]?.destroy()
//               component?.destroy()
//             },
//           }
//         },
//       },
//     }
//   },

//   addProseMirrorPlugins() {
//     return [
//       Suggestion({
//         editor: this.editor,
//         ...this.options.suggestion,
//         // Transform the variables function to match suggestion API
//         items: async ({ query }: { query: string }) => {
//           const variables = await Promise.resolve(this.options.suggestion.variables())
//           // Filter variables based on query
//           return variables.filter(
//             (variable) =>
//               variable.label.toLowerCase().includes(query.toLowerCase()) ||
//               variable.path.toLowerCase().includes(query.toLowerCase()) ||
//               variable.nodeName.toLowerCase().includes(query.toLowerCase())
//           )
//         },
//       }),
//     ]
//   },
// })

/**
 * Factory function to create a VariablePickerExtension with workflow context
 * @param getVariables - Function to fetch available workflow variables
 * @param expectedTypes - Optional array of expected data types for filtering
 * @returns Configured VariablePickerExtension instance
 */
// export const createVariablePickerExtension = (
//   getVariables: () => AvailableVariable[] | Promise<AvailableVariable[]>,
//   expectedTypes?: string[]
// ) => {
//   return VariablePickerExtension.configure({
//     suggestion: {
//       char: '{{',
//       allowSpaces: false,
//       startOfLine: false,
//       variables: getVariables,
//       expectedTypes,
//       render: () => {
//         let component: ReactRenderer<VariablePickerCommandAdapterRef>
//         let popup: TippyInstance[]
//         let currentVariables: WorkflowVariable[] = []

//         return {
//           onStart: async (props: any) => {
//             component = new ReactRenderer(VariablePickerCommandAdapter, {
//               props: {
//                 variables: [],
//                 isLoading: true,
//                 expectedTypes,
//                 command: (variable: WorkflowVariable) => {
//                   props.editor
//                     .chain()
//                     .focus()
//                     .deleteRange({ from: props.range.from, to: props.range.to })
//                     .insertContent({
//                       type: 'variable-node',
//                       attrs: {
//                         path: variable.path,
//                         label: variable.label,
//                         dataType: variable.dataType,
//                         nodeName: variable.nodeName,
//                       },
//                     })
//                     .insertContent(' ')
//                     .run()
//                 },
//               },
//               editor: props.editor,
//             })

//             if (!props.clientRect) {
//               return
//             }

//             popup = tippy('body', {
//               getReferenceClientRect: props.clientRect,
//               appendTo: () => document.body,
//               content: component.element,
//               showOnCreate: true,
//               interactive: true,
//               trigger: 'manual',
//               placement: 'bottom-start',
//               maxWidth: 400,
//               zIndex: 9999,
//             })

//             // Load variables
//             try {
//               currentVariables = await Promise.resolve(getVariables())
//               component?.updateProps({
//                 variables: currentVariables,
//                 isLoading: false,
//                 expectedTypes,
//                 command: (variable: WorkflowVariable) => {
//                   props.editor
//                     .chain()
//                     .focus()
//                     .deleteRange({ from: props.range.from, to: props.range.to })
//                     .insertContent({
//                       type: 'variable-node',
//                       attrs: {
//                         path: variable.path,
//                         label: variable.label,
//                         dataType: variable.dataType,
//                         nodeName: variable.nodeName,
//                       },
//                     })
//                     .insertContent(' ')
//                     .run()
//                 },
//               })
//             } catch (error) {
//               console.error('Error loading variables:', error)
//               component?.updateProps({
//                 variables: [],
//                 isLoading: false,
//                 expectedTypes,
//                 command: (variable: WorkflowVariable) => {
//                   props.editor
//                     .chain()
//                     .focus()
//                     .deleteRange({ from: props.range.from, to: props.range.to })
//                     .insertContent({
//                       type: 'variable-node',
//                       attrs: {
//                         path: variable.path,
//                         label: variable.label,
//                         dataType: variable.dataType,
//                         nodeName: variable.nodeName,
//                       },
//                     })
//                     .insertContent(' ')
//                     .run()
//                 },
//               })
//             }
//           },

//           onUpdate(props: any) {
//             component?.updateProps({
//               variables: currentVariables,
//               isLoading: false,
//               expectedTypes,
//               command: (variable: WorkflowVariable) => {
//                 props.editor
//                   .chain()
//                   .focus()
//                   .deleteRange({ from: props.range.from, to: props.range.to })
//                   .insertContent({
//                     type: 'variable-node',
//                     attrs: {
//                       path: variable.path,
//                       label: variable.label,
//                       dataType: variable.dataType,
//                       nodeName: variable.nodeName,
//                     },
//                   })
//                   .insertContent(' ')
//                   .run()
//               },
//             })

//             if (!props.clientRect) {
//               return
//             }

//             popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
//           },

//           onKeyDown(props: any) {
//             if (props.event.key === 'Escape') {
//               popup?.[0]?.hide()
//               return true
//             }

//             if (!component?.ref) {
//               return false
//             }

//             return component.ref.onKeyDown(props.event)
//           },

//           onExit() {
//             popup?.[0]?.destroy()
//             component?.destroy()
//           },
//         }
//       },
//     },
//   })
// }
