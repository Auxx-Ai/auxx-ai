// apps/web/src/components/workflow/nodes/core/http/components/edit-http-body.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import type { Body, KeyValue } from '../types'
import { BodyPayloadValueType, BodyType } from '../types'
import {
  generateId,
  getBodyContent,
  keyValueToBodyPayload,
  parseBodyDataToKeyValue,
  setBodyContent,
  setBodyFileReference,
} from '../utils'
import { KeyValueList } from '.'

interface EditHttpBodyProps {
  body: Body
  isReadOnly: boolean
  nodeId: string
  onChange: (body: Body) => void
}

export const EditHttpBody = memo(function EditHttpBody({
  body,
  isReadOnly,
  nodeId,
  onChange,
}: EditHttpBodyProps) {
  const bodyType = body?.type || BodyType.none

  // Parse body data for form-based body types
  const bodyList = useMemo(() => {
    if (bodyType === BodyType.formData || bodyType === BodyType.xWwwFormUrlencoded) {
      return parseBodyDataToKeyValue(body.data || [])
    }
    return []
  }, [body, bodyType])

  const handleBodyListChange = (newList: KeyValue[]) => {
    const bodyPayload = keyValueToBodyPayload(newList)
    onChange({ ...body, data: bodyPayload })
  }

  const handleAddBodyItem = () => {
    const currentBody = body || { type: BodyType.none, data: [] }
    const newData = [
      ...(currentBody.data || []),
      { id: generateId(), key: '', value: '', type: BodyPayloadValueType.text },
    ]
    onChange({ ...currentBody, data: newData })
  }

  const handleBodyContentChange = (content: string) => {
    const newBody = setBodyContent(body, content)
    onChange(newBody)
  }

  const handleBodyFileChange = (fileRef: string[]) => {
    const newBody = setBodyFileReference(body, fileRef)
    onChange(newBody)
  }

  switch (bodyType) {
    case BodyType.none:
      return <div className='text-sm text-muted-foreground'>No body content</div>

    case BodyType.formData:
      return (
        <div className='space-y-2'>
          <KeyValueList
            readonly={isReadOnly}
            list={bodyList}
            onChange={handleBodyListChange}
            onAdd={handleAddBodyItem}
            isSupportFile={true}
          />
          {bodyList.length === 0 && (
            <Button variant='outline' size='xs' onClick={handleAddBodyItem}>
              <Plus className='mr-1' />
              Add item
            </Button>
          )}
        </div>
      )

    case BodyType.xWwwFormUrlencoded:
      return (
        <div className='space-y-2'>
          <KeyValueList
            readonly={isReadOnly}
            list={bodyList}
            onChange={handleBodyListChange}
            onAdd={handleAddBodyItem}
            isSupportFile={false}
          />
          {bodyList.length === 0 && (
            <Button variant='outline' size='xs' onClick={handleAddBodyItem}>
              <Plus className='mr-1' />
              Add item
            </Button>
          )}
        </div>
      )

    case BodyType.json:
      return (
        <Editor
          title={<label className='text-xs font-medium'>JSON</label>}
          value={getBodyContent(body)}
          onChange={handleBodyContentChange}
          nodeId={nodeId}
          placeholder='Enter JSON content or use {{variables}}...'
          minHeight={100}
          readOnly={isReadOnly}
        />
      )

    case BodyType.rawText:
      return (
        <Editor
          title={<label className='text-xs font-medium'>Raw Text</label>}
          value={getBodyContent(body)}
          onChange={handleBodyContentChange}
          nodeId={nodeId}
          placeholder='Enter raw text or use {{variables}}...'
          minHeight={100}
          readOnly={isReadOnly}
        />
      )

    case BodyType.binary:
      return (
        <div className='space-y-2'>
          <VariablePicker
            nodeId={nodeId}
            value={body?.data?.[0]?.file || []}
            onChange={handleBodyFileChange}
            placeholder='Select file variable'
            disabled={isReadOnly}
          />
          <div className='text-xs text-muted-foreground'>
            Select a file variable from previous nodes
          </div>
        </div>
      )

    default:
      return null
  }
})
