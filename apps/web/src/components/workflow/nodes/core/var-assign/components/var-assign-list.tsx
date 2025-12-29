// apps/web/src/components/workflow/nodes/core/var-assign/components/var-assign-list.tsx

'use client'

import React, { useCallback } from 'react'
import { produce } from 'immer'
import { VarAssignItem } from './var-assign-item'
import { type VariableAssignment } from '../types'

interface VarAssignListProps {
  assignments: VariableAssignment[]
  // availableVariables: UnifiedVariable[]
  // variableGroups: VariableGroup[]
  onChange: (assignments: VariableAssignment[]) => void
  nodeId: string
  readOnly?: boolean
  onAdd?: () => void
}

/**
 * List of variable assignments with add button
 */
export const VarAssignList: React.FC<VarAssignListProps> = ({
  assignments,
  // availableVariables,
  // variableGroups,
  onChange,
  nodeId,
  readOnly,
}) => {
  const handleRemoveAssignment = useCallback(
    (index: number) => {
      const newAssignments = produce(assignments, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newAssignments)
    },
    [assignments, onChange]
  )

  const handleAssignmentChange = useCallback(
    (index: number, assignment: VariableAssignment) => {
      const newAssignments = produce(assignments, (draft) => {
        draft[index] = assignment
      })
      onChange(newAssignments)
    },
    [assignments, onChange]
  )

  return (
    <div>
      {assignments.map((assignment, index) => (
        <VarAssignItem
          key={assignment.id}
          assignment={assignment}
          onRemove={() => handleRemoveAssignment(index)}
          onChange={(updated) => handleAssignmentChange(index, updated)}
          nodeId={nodeId}
          readOnly={readOnly}
          canDelete={assignments.length > 1}
        />
      ))}

      {/* {!readOnly && (
        <Button size="sm" variant="outline" className="w-full mt-2" onClick={handleAddAssignment}>
          <Plus className="h-3 w-3 mr-1" />
          Add Variable
        </Button>
      )} */}
    </div>
  )
}
