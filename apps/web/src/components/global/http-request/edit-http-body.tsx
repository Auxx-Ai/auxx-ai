// apps/web/src/components/global/http-request/edit-http-body.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useHttpRequestField } from './field-editor'
import KeyValueList from './key-value-list'
import type { Body, KeyValue } from './types'
import { BodyPayloadValueType, BodyType } from './types'
import {
  generateId,
  getBodyContent,
  keyValueToBodyPayload,
  parseBodyDataToKeyValue,
  setBodyContent,
  setBodyFileReference,
} from './utils'

interface EditHttpBodyProps {
  body: Body
  isReadOnly: boolean
  onChange: (body: Body) => void
}

export const EditHttpBody = memo(function EditHttpBody({
  body,
  isReadOnly,
  onChange,
}: EditHttpBodyProps) {
  const { FieldEditor, FilePicker } = useHttpRequestField()
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
        <div className='space-y-1'>
          <label className='text-xs font-medium'>JSON</label>
          <FieldEditor
            multiline
            value={getBodyContent(body)}
            onChange={handleBodyContentChange}
            placeholder='Enter JSON content or use {{variables}}...'
            disabled={isReadOnly}
            className='min-h-[100px] rounded-lg border border-primary-200'
          />
        </div>
      )

    case BodyType.rawText:
      return (
        <div className='space-y-1'>
          <label className='text-xs font-medium'>Raw Text</label>
          <FieldEditor
            multiline
            value={getBodyContent(body)}
            onChange={handleBodyContentChange}
            placeholder='Enter raw text or use {{variables}}...'
            disabled={isReadOnly}
            className='min-h-[100px] rounded-lg border border-primary-200'
          />
        </div>
      )

    case BodyType.binary:
      // Binary upload bodies require a file picker; hidden when none is injected.
      if (!FilePicker) {
        return null
      }
      return (
        <div className='space-y-2'>
          <FilePicker
            value={body?.data?.[0]?.file || []}
            onSelect={handleBodyFileChange}
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
