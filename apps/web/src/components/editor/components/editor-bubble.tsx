// apps/web/src/components/editor/components/editor-bubble.tsx
import { BubbleMenu, isNodeSelection, useCurrentEditor } from '@tiptap/react'
import type { BubbleMenuProps } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Instance, Props } from 'tippy.js'

export interface EditorBubbleProps
  extends Omit<BubbleMenuProps, 'editor'>,
    React.RefAttributes<HTMLDivElement> {
  readonly children: ReactNode
}

export const EditorBubble: React.FC<EditorBubbleProps> = ({ children, tippyOptions, ...rest }) => {
    const { editor: currentEditor } = useCurrentEditor()
    const instanceRef = useRef<Instance<Props> | null>(null)

    useEffect(() => {
      if (!instanceRef.current || !tippyOptions?.placement) return

      instanceRef.current.setProps({ placement: tippyOptions.placement })
      instanceRef.current.popperInstance?.update()
    }, [tippyOptions?.placement])

    const bubbleMenuProps: Omit<BubbleMenuProps, 'children'> = useMemo(() => {
      const shouldShow: BubbleMenuProps['shouldShow'] = ({ editor, state }) => {
        const { selection } = state
        const { empty } = selection

        // don't show bubble menu if:
        // - the editor is not editable
        // - the selected node is an image
        // - the selection is empty
        // - the selection is a node selection (for drag handles)
        if (!editor.isEditable || editor.isActive('image') || empty || isNodeSelection(selection)) {
          console.log('dont show')
          return false
        }
        console.log('show bubble menu')

        return true
      }

      return {
        shouldShow,
        tippyOptions: {
          onCreate: (val) => {
            instanceRef.current = val

            instanceRef.current.popper.firstChild?.addEventListener('blur-sm', (event) => {
              event.preventDefault()
              event.stopImmediatePropagation()
            })
          },
          moveTransition: 'transform 0.15s ease-out',
          ...tippyOptions,
        },
        editor: currentEditor,
        ...rest,
      }
    }, [rest, tippyOptions])

    if (!currentEditor) return null

    const { ref, ...bubbleRest } = rest
    return (
      // We need to add this because of https://github.com/ueberdosis/tiptap/issues/2658
      <div ref={ref}>
        <BubbleMenu {...bubbleMenuProps} {...bubbleRest}>
          {children}
        </BubbleMenu>
      </div>
    )
}

EditorBubble.displayName = 'EditorBubble'

export default EditorBubble
