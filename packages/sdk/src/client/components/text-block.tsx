// packages/sdk/src/client/components/text-block.tsx

import React from 'react'

/**
 * Props for the TextBlock component
 */
export interface TextBlockProps {
  /** The text content to display */
  children: React.ReactNode
  /**
   * How to align the content of the text block.
   *
   * @default "center"
   */
  align?: 'left' | 'center' | 'right'
}

/**
 * TextBlock component for displaying text.
 */
export const TextBlock: React.FC<TextBlockProps> = (props) =>
  React.createElement('auxxtextblock', {
    ...props,
    component: 'TextBlock',
  })
