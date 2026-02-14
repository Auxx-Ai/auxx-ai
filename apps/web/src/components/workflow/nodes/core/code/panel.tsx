// apps/web/src/components/workflow/nodes/core/code/panel.tsx

import type React from 'react'
import { memo, useCallback } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { CodeInputEditor } from './components/code-input-editor'
import { CodeOutputEditor } from './components/code-output-editor'
import type { CodeNodeData, CodeNodeInput, CodeNodeOutput } from './types'
import { smartUpdateTemplate } from './utils/template-generator'

interface CodePanelProps {
  nodeId: string
  data: CodeNodeData
}

const CodePanelComponent: React.FC<CodePanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  // Use CRUD operations for the data
  const { inputs: nodeData, setInputs } = useNodeCrud<CodeNodeData>(nodeId, data)

  // Memoized handlers to prevent re-renders during node dragging
  const handleCodeChange = useCallback(
    (newCode: string) => {
      setInputs({ ...nodeData, code: newCode })
    },
    [nodeData, setInputs]
  )

  // Handle output variables change
  const handleOutputsChange = useCallback(
    (outputs: CodeNodeOutput[]) => {
      const updatedCode = smartUpdateTemplate(nodeData.code || '', nodeData.inputs || [], outputs)
      setInputs({ ...nodeData, outputs, code: updatedCode })
    },
    [nodeData, setInputs]
  )

  // Handle input variables change
  const handleInputsChange = useCallback(
    (inputs: CodeNodeInput[]) => {
      const updatedCode = smartUpdateTemplate(nodeData.code || '', inputs, nodeData.outputs || [])
      setInputs({ ...nodeData, inputs, code: updatedCode })
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel title='Code Configuration' nodeId={nodeId} data={data} showNextStep={true}>
      <CodeInputEditor
        inputs={nodeData.inputs || []}
        onChange={handleInputsChange}
        isReadOnly={isReadOnly}
        nodeId={nodeId}
      />
      <CodeOutputEditor
        outputs={nodeData.outputs || []}
        onChange={handleOutputsChange}
        isReadOnly={isReadOnly}
      />
      <Section
        title='Code Editor'
        description='Write your custom code in the main() function. Input variables are available as direct variables.'
        initialOpen={true}>
        <CodeEditor
          value={nodeData.code || ''}
          onChange={handleCodeChange}
          language={CodeLanguage.javascript}
          title='Code Editor'
          placeholder='const main = async () => {\n  // Your code here\n  return {\n    output1: undefined\n  }\n}'
          minHeight={200}
          readOnly={isReadOnly}
          nodeId={nodeId}
          enableWorkflowCompletions={true}
          codeInputs={nodeData.inputs?.map((i) => ({ name: i.name }))}
          codeOutputs={nodeData.outputs?.map((o) => ({
            name: o.name,
            type: o.type,
            description: o.description,
          }))}
        />
      </Section>
    </BasePanel>
  )
}

export const CodePanel = memo(CodePanelComponent)
