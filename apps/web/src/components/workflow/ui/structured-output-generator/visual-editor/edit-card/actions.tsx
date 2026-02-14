// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/edit-card/actions.tsx

import { Button } from '@auxx/ui/components/button'
import { Edit, Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import React from 'react'
import { Tooltip } from '~/components/global/tooltip'

type ActionsProps = {
  disableAddBtn: boolean
  onAddChildField: () => void
  onEdit: () => void
  onDelete: () => void
}

const Actions: FC<ActionsProps> = ({ disableAddBtn, onAddChildField, onEdit, onDelete }) => {
  return (
    <div className='flex items-center gap-x-0.5'>
      <Tooltip content='Add child field'>
        <Button variant='ghost' size='icon-xs' onClick={onAddChildField} disabled={disableAddBtn}>
          <Plus />
        </Button>
      </Tooltip>
      <Tooltip content='Edit'>
        <Button variant='ghost' size='icon-xs' onClick={onEdit}>
          <Edit />
        </Button>
      </Tooltip>
      <Tooltip content='Remove'>
        <Button
          variant='ghost'
          size='icon-xs'
          onClick={onDelete}
          className='hover:bg-bad-100 hover:text-destructive'>
          <Trash2 />
        </Button>
      </Tooltip>
    </div>
  )
}

export default React.memo(Actions)
