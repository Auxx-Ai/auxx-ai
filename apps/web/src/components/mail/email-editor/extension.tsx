import { mergeAttributes, Node } from '@tiptap/core'
import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import type React from 'react'

// import GhostText from "./ghost-text";

// import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

const GhostText = (props: NodeViewProps) => {
  return (
    <NodeViewWrapper as='span'>
      <NodeViewContent className='!inline select-none text-gray-300' as='span'>
        {props.node.attrs.content}
      </NodeViewContent>
    </NodeViewWrapper>
  )
}

/**
 * Creates a custom ProseMirror node called "ghostText".
 * This node is an inline, non-selectable, atomic node that renders as a <span> element with a "data-type" attribute set to "ghost-text".
 */
export default Node.create({
  name: 'ghostText',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,
  //  The attributes for the "ghostText" node, with a default "content" attribute set to an empty string.
  addAttributes() {
    return { content: { default: '' } }
  },
  // An array of objects defining how to parse the "ghost-text" HTML tag.
  parseHTML() {
    return [{ tag: 'ghost-text' }]
  },
  // HTMLAttributes - The HTML attributes to be merged with the "ghost-text" data type.
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'ghost-text' }), 0]
  },
  // A function that renders the "GhostText" React component as the node view.
  addNodeView() {
    return ReactNodeViewRenderer(GhostText as React.ComponentType<NodeViewProps>)
  },
})
