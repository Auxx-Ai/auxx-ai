'use client'

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Node } from '@tiptap/pm/model'
import tippy, { type Instance } from 'tippy.js'
import { MentionPopover } from './mention-popover'

/**
 * Interface for team member data
 */
export interface TeamMember {
  id: string
  name: string | null
  email?: string | null
  image?: string | null
}

/**
 * Plugin state interface
 */
interface MentionPluginState {
  active: boolean
  range: { from: number; to: number } | null
  query: string
  decorations: DecorationSet
}

/**
 * Options for the CustomMention extension
 */
export interface CustomMentionOptions {
  teamMembers: TeamMember[]
  onMentionSelect: (memberId: string, memberName: string) => void
  renderHTML?: (options: { node: Node; HTMLAttributes: Record<string, any> }) => string
}

/**
 * Custom mention extension for TipTap editor
 * Provides full control over mention detection, UI, and styling
 */
export const CustomMention = Extension.create<CustomMentionOptions>({
  name: 'customMention',

  addOptions() {
    return { teamMembers: [], onMentionSelect: () => {}, renderHTML: undefined }
  },

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('customMention')
    const options = this.options || { teamMembers: [], onMentionSelect: () => {} }

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(): MentionPluginState {
            return { active: false, range: null, query: '', decorations: DecorationSet.empty }
          },
          apply(tr, state: MentionPluginState): MentionPluginState {
            // Track document changes
            if (tr.docChanged) {
              const { selection } = tr
              const { from } = selection

              // Check if we're at a position where we might have an @ symbol
              const textBefore = tr.doc.textBetween(Math.max(0, from - 20), from, '\n', ' ')
              const mentionMatch = textBefore.match(/@(\w*)$/)

              if (mentionMatch) {
                const query = mentionMatch[1] || ''
                const mentionStart = from - mentionMatch[0].length

                return {
                  active: true,
                  range: { from: mentionStart, to: from },
                  query,
                  decorations: DecorationSet.create(tr.doc, [
                    Decoration.inline(mentionStart, from, {
                      class: 'mention-query bg-blue-100 rounded px-1',
                    }),
                  ]),
                }
              } else {
                return { active: false, range: null, query: '', decorations: DecorationSet.empty }
              }
            }

            // Map decorations through document changes for non-doc changes
            return { ...state, decorations: state.decorations.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state)?.decorations
          },
          handleKeyDown(view, event) {
            const state = pluginKey.getState(view.state) as MentionPluginState | undefined

            if (!state?.active) return false

            // Handle escape to close mention popup
            if (event.key === 'Escape') {
              // Close mention popup logic would go here
              return true
            }

            return false
          },
        },
        view(editorView) {
          let popup: Instance | null = null
          let component: ReactRenderer | null = null
          let isCreatingComponent = false
          let updateTimeout: NodeJS.Timeout | null = null

          const cleanupPopup = () => {
            if (updateTimeout) {
              clearTimeout(updateTimeout)
              updateTimeout = null
            }
            if (popup) {
              popup.destroy()
              popup = null
            }
            if (component) {
              component.destroy()
              component = null
            }
            isCreatingComponent = false
          }

          const createNewPopup = async (state: MentionPluginState) => {
            if (isCreatingComponent || !state.range) return

            isCreatingComponent = true

            try {
              component = new ReactRenderer(MentionPopover, {
                props: {
                  teamMembers: Array.isArray(options.teamMembers) ? options.teamMembers : [],
                  query: state.query || '',
                  onSelect: (member: TeamMember) => {
                    // Replace the @query with the mention
                    const tr = editorView.state.tr
                    tr.replaceWith(
                      state.range!.from,
                      state.range!.to,
                      editorView.state.schema.text(`@${member.name} `)
                    )
                    editorView.dispatch(tr)

                    // Close popup
                    cleanupPopup()

                    // Call the callback with safety check
                    if (typeof options.onMentionSelect === 'function') {
                      options.onMentionSelect(member.id, member.name || '')
                    }
                  },
                },
              })

              // Wait a bit for the ReactRenderer to fully initialize
              await new Promise((resolve) => setTimeout(resolve, 10))

              // Only create tippy popup if ReactRenderer was successfully created
              if (component?.element) {
                popup = tippy(document.body, {
                  getReferenceClientRect: () => {
                    const coords = editorView.coordsAtPos(state.range!.from)
                    return {
                      width: 0,
                      height: 0,
                      top: coords.top,
                      bottom: coords.bottom,
                      left: coords.left,
                      right: coords.left,
                      x: coords.left,
                      y: coords.top,
                      toJSON: () => ({}),
                    } as DOMRect
                  },
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  hideOnClick: false,
                })[0]

                isCreatingComponent = false
              } else {
                throw new Error('ReactRenderer element not available')
              }
            } catch (error) {
              console.error('Error creating mention popup:', error)
              cleanupPopup()
            }
          }

          const updatePopup = () => {
            const state = pluginKey.getState(editorView.state) as MentionPluginState | undefined

            // Clear any pending updates
            if (updateTimeout) {
              clearTimeout(updateTimeout)
              updateTimeout = null
            }

            if (state?.active && state.range) {
              // Debounce the popup creation to avoid too many recreations
              updateTimeout = setTimeout(() => {
                // Always recreate the popup to avoid ReactRenderer update issues
                // This is safer than trying to update props on an existing ReactRenderer
                cleanupPopup()
                createNewPopup(state)
              }, 50) // Small delay to debounce rapid typing
            } else if (popup || component) {
              // Close popup if mention is no longer active
              cleanupPopup()
            }
          }

          return {
            update: () => {
              updatePopup()
            },
            destroy: () => {
              cleanupPopup()
            },
          }
        },
      }),
    ]
  },
})
