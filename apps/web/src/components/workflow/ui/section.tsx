// apps/web/src/components/workflow/ui/section.tsx

'use client'

import React from 'react'
import { Section as BaseSection, type SectionProps } from '@auxx/ui/components/section'
import { useReadOnly } from '../hooks'

/**
 * Workflow-specific Section component that injects read-only state
 * from the workflow context.
 */
function Section(props: Omit<SectionProps, 'isReadOnly'>) {
  const { isReadOnly } = useReadOnly()
  return <BaseSection {...props} isReadOnly={isReadOnly} />
}

export default React.memo(Section)
