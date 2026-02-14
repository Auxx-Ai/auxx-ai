// apps/web/src/components/workflow/ui/structured-output-generator/index.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { Braces, ExternalLink, GitBranch, X } from 'lucide-react'
import React, { type FC, useCallback, useState } from 'react'
import ErrorMessage from './error-message'
import JsonImporter from './json-importer'
import SchemaEditor from './schema-editor'
import { JSON_SCHEMA_MAX_DEPTH, type SchemaRoot, type SchemaView, Type } from './types'
import {
  checkJsonSchemaDepth,
  convertBooleanToString,
  getValidationErrorMessage,
  jsonToSchema,
  preValidateSchema,
  validateSchemaAgainstDraft7,
} from './utils'
import VisualEditor from './visual-editor'
import {
  EventEmitterProvider,
  useEventEmitter,
  VisualEditorContextProvider,
} from './visual-editor/context'
import { useVisualEditorStore } from './visual-editor/store'

type StructuredOutputGeneratorProps = {
  isShow: boolean
  defaultSchema?: SchemaRoot
  onSave: (schema: SchemaRoot) => void
  onClose: () => void
}

const DEFAULT_SCHEMA: SchemaRoot = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false,
}

const StructuredOutputGeneratorContent: FC<Omit<StructuredOutputGeneratorProps, 'isShow'>> = ({
  defaultSchema,
  onSave,
  onClose,
}) => {
  const [currentTab, setCurrentTab] = useState<SchemaView>('visual')
  const [jsonSchema, setJsonSchema] = useState(() => {
    return defaultSchema || DEFAULT_SCHEMA
  })
  const [json, setJson] = useState(JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const advancedEditing = useVisualEditorStore((state) => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore((state) => state.setAdvancedEditing)
  const isAddingNewField = useVisualEditorStore((state) => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore((state) => state.setIsAddingNewField)
  const setHoveringProperty = useVisualEditorStore((state) => state.setHoveringProperty)
  const { emit } = useEventEmitter()

  const updateBtnWidth = useCallback((width: number) => {
    setBtnWidth(width + 32)
  }, [])

  const handleTabChange = useCallback(
    (value: string) => {
      const newTab = value as SchemaView
      if (currentTab === newTab) return
      if (currentTab === 'json') {
        try {
          const schema = JSON.parse(json)
          setParseError(null)
          const result = preValidateSchema(schema)
          if (!result.success) {
            setValidationError(result.error?.message || 'Invalid schema')
            return
          }
          const schemaDepth = checkJsonSchemaDepth(schema)
          if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
            setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
            return
          }
          convertBooleanToString(schema)
          const validationErrors = validateSchemaAgainstDraft7(schema)
          if (validationErrors.length > 0) {
            setValidationError(getValidationErrorMessage(validationErrors))
            return
          }
          setJsonSchema(schema)
          setValidationError('')
        } catch (error) {
          setValidationError('')
          if (error instanceof Error) setParseError(error)
          else setParseError(new Error('Invalid JSON'))
          return
        }
      } else if (currentTab === 'visual') {
        if (advancedEditing || isAddingNewField)
          emit('quitEditing', {
            callback: (backup: SchemaRoot) =>
              setJson(JSON.stringify(backup || jsonSchema, null, 2)),
          })
        else setJson(JSON.stringify(jsonSchema, null, 2))
      }

      setCurrentTab(newTab)
    },
    [currentTab, jsonSchema, json, advancedEditing, isAddingNewField, emit]
  )

  const handleSubmit = useCallback(
    (schema: any) => {
      const jsonSchema = jsonToSchema(schema) as SchemaRoot
      if (currentTab === 'visual') setJsonSchema(jsonSchema)
      else if (currentTab === 'json') setJson(JSON.stringify(jsonSchema, null, 2))
    },
    [currentTab]
  )

  const handleVisualEditorUpdate = useCallback((schema: SchemaRoot) => {
    setJsonSchema(schema)
  }, [])

  const handleSchemaEditorUpdate = useCallback((schema: string) => {
    setJson(schema)
  }, [])

  const handleResetDefaults = useCallback(() => {
    if (currentTab === 'visual') {
      setHoveringProperty(null)
      advancedEditing && setAdvancedEditing(false)
      isAddingNewField && setIsAddingNewField(false)
    }
    setJsonSchema(DEFAULT_SCHEMA)
    setJson(JSON.stringify(DEFAULT_SCHEMA, null, 2))
  }, [
    currentTab,
    advancedEditing,
    isAddingNewField,
    setAdvancedEditing,
    setIsAddingNewField,
    setHoveringProperty,
  ])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSave = useCallback(() => {
    let schema = jsonSchema
    if (currentTab === 'json') {
      try {
        schema = JSON.parse(json)
        setParseError(null)
        const result = preValidateSchema(schema)
        if (!result.success) {
          setValidationError(result.error?.message || 'Invalid schema')
          return
        }
        const schemaDepth = checkJsonSchemaDepth(schema)
        if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
          setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
          return
        }
        convertBooleanToString(schema)
        const validationErrors = validateSchemaAgainstDraft7(schema)
        if (validationErrors.length > 0) {
          setValidationError(getValidationErrorMessage(validationErrors))
          return
        }
        setJsonSchema(schema)
        setValidationError('')
      } catch (error) {
        setValidationError('')
        if (error instanceof Error) setParseError(error)
        else setParseError(new Error('Invalid JSON'))
        return
      }
    } else if (currentTab === 'visual') {
      if (advancedEditing || isAddingNewField) {
        toastError({
          title: 'Warning',
          description: 'Please save or cancel your current edits before proceeding',
        })
        return
      }
    }

    onSave(schema)
    onClose()
  }, [currentTab, jsonSchema, json, onSave, onClose, advancedEditing, isAddingNewField])

  return (
    <div className='flex h-full flex-col relative flex-1 overflow-hidden'>
      {/* Header */}
      <div className=''>
        <DialogHeader>
          <DialogTitle>Structured Output</DialogTitle>
        </DialogHeader>
        {/* Content */}
        <div className='flex items-center justify-between py-2'>
          {/* Tab */}
          <RadioTab
            value={currentTab}
            onValueChange={handleTabChange}
            size='sm'
            radioGroupClassName='grid w-full'
            className='border border-primary-200 flex'>
            <RadioTabItem value='visual' size='sm'>
              <GitBranch />
              Visual Editor
            </RadioTabItem>
            <RadioTabItem value='json' size='sm'>
              <Braces />
              JSON Schema
            </RadioTabItem>
          </RadioTab>
          <div className='flex items-center gap-x-0.5'>
            {/* <Separator orientation="vertical" className="h-3" /> */}
            {/* JSON Schema Importer */}
            <JsonImporter updateBtnWidth={updateBtnWidth} onSubmit={handleSubmit} />
          </div>
        </div>
      </div>
      <div className='flex grow flex-col gap-y-1 overflow-hidden'>
        {currentTab === 'visual' && (
          <VisualEditor schema={jsonSchema} onChange={handleVisualEditorUpdate} />
        )}
        {currentTab === 'json' && (
          <SchemaEditor schema={json} onUpdate={handleSchemaEditorUpdate} />
        )}
        {parseError && <ErrorMessage message={parseError.message} />}
        {validationError && <ErrorMessage message={validationError} />}
      </div>
      {/* Footer */}
      <DialogFooter className='justify-between'>
        <div className='flex items-center gap-x-3'>
          <div className='flex items-center gap-x-2'>
            <Button variant='ghost' size='sm' onClick={handleResetDefaults}>
              Reset defaults
            </Button>
            <Separator orientation='vertical' className='ml-1 mr-0 h-4' />
          </div>
          <div className='flex items-center gap-x-2'>
            <Button variant='ghost' size='sm' onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant='outline' size='sm' onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </DialogFooter>
    </div>
  )
}

const StructuredOutputGenerator: FC<StructuredOutputGeneratorProps> = ({ isShow, ...props }) => {
  return (
    <Dialog open={isShow} onOpenChange={props.onClose}>
      <DialogContent className='max-w-4xl h-[600px] ' position='tc'>
        <EventEmitterProvider>
          <VisualEditorContextProvider>
            <StructuredOutputGeneratorContent {...props} />
          </VisualEditorContextProvider>
        </EventEmitterProvider>
      </DialogContent>
    </Dialog>
  )
}

export default StructuredOutputGenerator
export type { SchemaRoot } from './types'
