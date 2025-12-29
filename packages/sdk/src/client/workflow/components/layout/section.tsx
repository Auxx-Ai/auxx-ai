// packages/sdk/src/client/workflow/components/layout/section.tsx

import type React from 'react'

/**
 * Props for Section component
 */
export interface SectionProps {
  /** Section title */
  title?: string

  /** Section description */
  description?: string

  /** Section content */
  children?: React.ReactNode

  /** Whether the section is collapsible */
  collapsible?: boolean

  /** Default open state for collapsible sections */
  defaultOpen?: boolean

  /** Callback when section is toggled (receives new isOpen state) */
  onToggle?: (isOpen: boolean) => void

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Section component for grouping related fields.
 * Can be collapsible for advanced options.
 */
export const Section: React.FC<SectionProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowsection', {
    ...props,
    component: 'WorkflowSection',
  })
}
