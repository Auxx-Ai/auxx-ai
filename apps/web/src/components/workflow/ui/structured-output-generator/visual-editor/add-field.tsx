// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/add-field.tsx

import { Button } from '@auxx/ui/components/button'
import { PlusCircle } from 'lucide-react'
import React, { useCallback } from 'react'
import { useEventEmitter } from './context'
import { useVisualEditorStore } from './store'

const AddField = () => {
  const setIsAddingNewField = useVisualEditorStore((state) => state.setIsAddingNewField)
  const { emit } = useEventEmitter()

  const handleAddField = useCallback(() => {
    setIsAddingNewField(true)
    emit('addField', { path: [] })
  }, [setIsAddingNewField, emit])

  return (
    <div className='py-2 pl-5'>
      <Button size='sm' variant='outline' onClick={handleAddField}>
        <PlusCircle className='size-3.5' />
        Add field
      </Button>
    </div>
  )
}

export default React.memo(AddField)
