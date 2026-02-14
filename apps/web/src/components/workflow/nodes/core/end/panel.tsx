// apps/web/src/components/workflow/nodes/core/end/panel.tsx

import { produce } from 'immer'
import type React from 'react'
import { memo, useCallback } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import Section from '../../../ui/section'
import type { EndNodeData } from './types'

interface EndPanelProps {
  nodeId: string
  data: EndNodeData
}

/**
 * Configuration panel for the End node - simplified version
 */
const EndPanelComponent: React.FC<EndPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs, setInputs } = useNodeCrud<EndNodeData>(nodeId, data)

  /**
   * Update message helper using produce for immutable updates
   */
  const updateMessage = useCallback(
    (value: string) => {
      const newData = produce(inputs, (draft: EndNodeData) => {
        draft.message = value
      })
      setInputs(newData)
    },
    [inputs, setInputs]
  )

  return (
    <BasePanel title='End Node Configuration' nodeId={nodeId} data={data} showNextStep={false}>
      <Section title='End Configuration' initialOpen description='Configure how the workflow ends'>
        <div className='space-y-4'>
          <Editor
            title={<span className='text-xs font-semibold text-muted-foreground'>Message</span>}
            readOnly={isReadOnly}
            value={inputs.message || ''}
            onChange={(value) => {
              // Store both the original editor content and the preprocessed text
              updateMessage(value)
            }}
            placeholder='Use { for variables'
            nodeId={nodeId}
            includeEnvironment
            includeSystem
            showRemove={false}
            showAIGenerate={false}
            minHeight={200}
          />
        </div>
      </Section>
    </BasePanel>
  )
}

export const EndPanel = memo(EndPanelComponent)
