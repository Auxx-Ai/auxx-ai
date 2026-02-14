// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/schema-node.tsx

import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { type Field, JSON_SCHEMA_MAX_DEPTH, type StructuredField, Type } from '../types'
import { getFieldType, getHasChildren } from '../utils'
import AddField from './add-field'
import Card from './card'
import EditCard from './edit-card'
import { useVisualEditorStore } from './store'

type SchemaNodeProps = {
  name: string
  required: boolean
  schema?: Field
  field?: StructuredField // New  based
  path: string[]
  parentPath?: string[]
  depth: number
}

// Support 10 levels of indentation
const indentPadding: Record<number, string> = {
  0: 'pl-0',
  1: 'pl-[20px]',
  2: 'pl-[40px]',
  3: 'pl-[60px]',
  4: 'pl-[80px]',
  5: 'pl-[100px]',
  6: 'pl-[120px]',
  7: 'pl-[140px]',
  8: 'pl-[160px]',
  9: 'pl-[180px]',
  10: 'pl-[200px]',
}

const indentLeft: Record<number, string> = {
  0: 'left-0',
  1: 'left-[20px]',
  2: 'left-[40px]',
  3: 'left-[60px]',
  4: 'left-[80px]',
  5: 'left-[100px]',
  6: 'left-[120px]',
  7: 'left-[140px]',
  8: 'left-[160px]',
  9: 'left-[180px]',
  10: 'left-[200px]',
}

const SchemaNode: FC<SchemaNodeProps> = ({
  name,
  required,
  schema,
  field,
  path,
  parentPath,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const hoveringProperty = useVisualEditorStore((state) => state.hoveringProperty)
  const setHoveringProperty = useVisualEditorStore((state) => state.setHoveringProperty)
  const isAddingNewField = useVisualEditorStore((state) => state.isAddingNewField)
  const advancedEditing = useVisualEditorStore((state) => state.advancedEditing)
  const focusedFieldPath = useVisualEditorStore((state) => state.focusedFieldPath)

  // Minimal debounce for smooth hover transitions
  const setHoveringPropertyDebounced = useDebounceCallback((path: string | null) => {
    setHoveringProperty(path)
  }, 10)

  // Determine which prop to use
  const effectiveSchema = schema

  const hasChildren = useMemo(() => {
    return effectiveSchema ? getHasChildren(effectiveSchema) : false
  }, [effectiveSchema])

  const type = useMemo(() => {
    return effectiveSchema ? getFieldType(effectiveSchema) : 'string'
  }, [effectiveSchema])

  const currentPath = path.join('.')
  const isHovering = hoveringProperty === currentPath
  const isFocused = focusedFieldPath === currentPath

  // Memoize fields object outside of conditional rendering
  const editCardFields = useMemo(() => {
    // For now, keep using legacy EditData format until EditCard is updated
    return {
      name,
      type: type as any, // Type will be string, cast for now
      required,
      description: effectiveSchema?.description,
      enum: effectiveSchema?.enum,
    }
  }, [name, type, required, effectiveSchema])
  const handleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const handleMouseEnter = useCallback(() => {
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced(path.join('.'))
  }, [advancedEditing, isAddingNewField, path, setHoveringPropertyDebounced])

  const handleMouseLeave = useCallback(() => {
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced(null)
  }, [advancedEditing, isAddingNewField, setHoveringPropertyDebounced])

  return (
    <div className='relative'>
      <div className={cn('relative z-10', indentPadding[depth])}>
        {depth > 0 && hasChildren && (
          <div
            className={cn(
              'flex items-center absolute top-0 w-5 h-7 px-0.5 z-10 bg-primary-100',
              indentLeft[depth - 1]
            )}>
            <button onClick={handleExpand} className='py-0.5 text-tertiary hover:text-accent'>
              {isExpanded ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
            </button>
          </div>
        )}

        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          {isHovering && depth > 0 ? (
            <EditCard fields={editCardFields} path={path} parentPath={parentPath!} depth={depth} />
          ) : (
            <Card
              name={name}
              type={type}
              required={required}
              description={effectiveSchema?.description}
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          'flex justify-center w-5 absolute z-0',
          effectiveSchema?.description
            ? 'h-[calc(100%-3rem)] top-12'
            : 'h-[calc(100%-1.75rem)] top-7',
          indentLeft[depth]
        )}>
        <Separator
          orientation='vertical'
          className={cn('mx-0', isHovering ? 'bg-divider-deep' : 'bg-primary-200')}
        />
      </div>

      {isExpanded && hasChildren && depth < JSON_SCHEMA_MAX_DEPTH && (
        <>
          {effectiveSchema?.type === Type.object &&
            effectiveSchema.properties &&
            Object.entries(effectiveSchema.properties).map(([key, childSchema]) => (
              <SchemaNode
                key={key}
                name={key}
                required={!!effectiveSchema.required?.includes(key)}
                schema={childSchema}
                path={[...path, 'properties', key]}
                parentPath={path}
                depth={depth + 1}
              />
            ))}

          {effectiveSchema?.type === Type.array &&
            effectiveSchema.items &&
            effectiveSchema.items.type === Type.object &&
            effectiveSchema.items.properties &&
            Object.entries(effectiveSchema.items.properties).map(([key, childSchema]) => (
              <SchemaNode
                key={key}
                name={key}
                required={!!effectiveSchema.items?.required?.includes(key)}
                schema={childSchema}
                path={[...path, 'items', 'properties', key]}
                parentPath={path}
                depth={depth + 1}
              />
            ))}
        </>
      )}

      {depth === 0 && !isAddingNewField && <AddField />}
    </div>
  )
}

export default React.memo(SchemaNode)
