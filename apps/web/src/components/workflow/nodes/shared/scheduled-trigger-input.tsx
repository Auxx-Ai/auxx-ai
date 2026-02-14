// apps/web/src/components/workflow/nodes/shared/scheduled-trigger-input.tsx

import React from 'react'
import Section from '~/components/workflow/ui/section'
import type { TriggerInputProps } from '../trigger-registry'

/**
 * Scheduled trigger input component for test mode
 * Simple display showing that the trigger will execute immediately
 */
export function ScheduledTriggerInput({ inputs, errors, onChange }: TriggerInputProps) {
  return (
    <Section title='Scheduled Trigger' initialOpen>
      <div className='text-sm text-muted-foreground'>
        This workflow will be triggered immediately for testing purposes.
      </div>
    </Section>
  )
}
