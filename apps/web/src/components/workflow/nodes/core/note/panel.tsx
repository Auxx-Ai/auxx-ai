// apps/web/src/components/workflow/nodes/core/note/panel.tsx

import type React from 'react'

interface NotePanelProps {
  nodeId: string
}

/**
 * Note panel - Empty because note editing happens directly in the node
 */
export const NotePanel: React.FC<NotePanelProps> = ({ nodeId }) => {
  return (
    <div className='p-4 text-center text-sm text-muted-foreground'>
      Click on the note to edit it directly in the canvas.
    </div>
  )
}
