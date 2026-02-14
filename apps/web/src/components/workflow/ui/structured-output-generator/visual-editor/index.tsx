// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/index.tsx
import type { FC } from 'react'
import type { SchemaRoot } from '../types'
import { useSchemaNodeOperations } from './hooks'
import SchemaNode from './schema-node'

export type VisualEditorProps = { schema: SchemaRoot; onChange: (schema: SchemaRoot) => void }

const VisualEditor: FC<VisualEditorProps> = (props) => {
  const { schema } = props
  useSchemaNodeOperations(props)

  return (
    <div className='h-full overflow-y-auto rounded-xl bg-primary-100 p-1 pl-2'>
      <SchemaNode name='structured_output' schema={schema} required={false} path={[]} depth={0} />
    </div>
  )
}

export default VisualEditor
