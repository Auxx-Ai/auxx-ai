// apps/web/src/components/workflow/nodes/inputs/form-input/panel.tsx

'use client'

import { produce } from 'immer'
import React, { useCallback } from 'react'
import { AddressComponentsEditor } from '~/components/custom-fields/ui/address-component-editor'
import {
  type CurrencyOptions,
  CurrencyOptionsEditor,
} from '~/components/custom-fields/ui/currency-options-editor'
import { FileOptionsEditor } from '~/components/custom-fields/ui/file-options-editor'
// Reuse existing editors from custom-fields for type configuration
import { OptionsEditor } from '~/components/custom-fields/ui/options-editor'
import {
  type TextOptions,
  TextOptionsEditor,
} from '~/components/custom-fields/ui/text-options-editor'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BaseType } from '~/components/workflow/types/unified-types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { InputTypePicker } from '~/components/workflow/ui/input-type-picker'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { getFormInputOutputVariables } from './output-variables'
import type { FormInputNodeData, TypeOptions } from './types'

/**
 * Props for FormInputPanel component
 */
interface FormInputPanelProps {
  nodeId: string
  data: FormInputNodeData
}

/**
 * Get default type options for a given input type
 */
function getDefaultTypeOptions(inputType: BaseType): TypeOptions {
  switch (inputType) {
    case BaseType.STRING:
      return {
        string: {
          multiline: false,
          minLength: undefined,
          maxLength: undefined,
        },
      }
    case BaseType.ENUM:
      return { enum: [] }
    case BaseType.FILE:
      return {
        file: {
          allowMultiple: false,
          maxFiles: undefined,
          allowedFileTypes: undefined,
          allowedFileExtensions: undefined,
        },
      }
    case BaseType.CURRENCY:
      return {
        currency: {
          currencyCode: 'USD',
          decimalPlaces: 'two-places',
          displayType: 'symbol',
          groups: 'default',
        },
      }
    case BaseType.ADDRESS:
      return {
        address: {
          components: ['street1', 'street2', 'city', 'state', 'zipCode', 'country'],
        },
      }
    case BaseType.BOOLEAN:
      return { boolean: { variant: 'switch' } }
    default:
      return {}
  }
}

/**
 * Check if a type needs additional configuration
 */
function typeNeedsConfiguration(inputType: BaseType): boolean {
  return [
    BaseType.STRING,
    BaseType.ENUM,
    BaseType.FILE,
    BaseType.CURRENCY,
    BaseType.ADDRESS,
  ].includes(inputType)
}

/**
 * Check if a type supports default value
 */
function typeSupportsDefaultValue(inputType: BaseType): boolean {
  return ![BaseType.FILE, BaseType.ADDRESS].includes(inputType)
}

/**
 * Configuration panel for form-input node
 */
const FormInputPanelComponent: React.FC<FormInputPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<FormInputNodeData>(nodeId, data)

  const inputType = nodeData.inputType || BaseType.STRING

  /**
   * Handle input type change - reset type-specific options and default value
   */
  const handleInputTypeChange = useCallback(
    (newType: BaseType) => {
      const newData = produce(nodeData, (draft) => {
        draft.inputType = newType
        draft.defaultValue = undefined // Reset default value
        draft.typeOptions = getDefaultTypeOptions(newType)
      })
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  /**
   * Handle type options change
   */
  const handleTypeOptionsChange = useCallback(
    (options: Partial<TypeOptions>) => {
      const newData = produce(nodeData, (draft) => {
        draft.typeOptions = { ...draft.typeOptions, ...options }
      })
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  /**
   * Generic field change handler for ConstantInputAdapter
   */
  const handleFieldChange = useCallback(
    (field: keyof FormInputNodeData) => (_content: string, value: any) => {
      setNodeData(
        produce(nodeData, (draft) => {
          ;(draft as any)[field] = value
        })
      )
    },
    [nodeData, setNodeData]
  )

  /**
   * Render type-specific configuration sections
   */
  const renderTypeConfiguration = () => {
    switch (inputType) {
      case BaseType.STRING:
        return (
          <TextOptionsEditor
            options={
              (nodeData.typeOptions?.string as TextOptions) || {
                multiline: false,
                minLength: undefined,
                maxLength: undefined,
              }
            }
            onChange={(options) => handleTypeOptionsChange({ string: options })}
            disabled={isReadOnly}
          />
        )

      case BaseType.ENUM:
        return (
          <OptionsEditor
            options={nodeData.typeOptions?.enum}
            onChange={(options) => handleTypeOptionsChange({ enum: options })}
          />
        )

      case BaseType.ADDRESS:
        return (
          <AddressComponentsEditor
            components={nodeData.typeOptions?.address?.components || []}
            onChange={(components) => handleTypeOptionsChange({ address: { components } })}
          />
        )

      case BaseType.FILE:
        return (
          <FileOptionsEditor
            options={nodeData.typeOptions?.file || { allowMultiple: false }}
            onChange={(options) => handleTypeOptionsChange({ file: options })}
          />
        )

      case BaseType.CURRENCY:
        return (
          <CurrencyOptionsEditor
            options={
              (nodeData.typeOptions?.currency as CurrencyOptions) || {
                currencyCode: 'USD',
                decimalPlaces: 'two-places',
                displayType: 'symbol',
                groups: 'default',
              }
            }
            onChange={(options) => handleTypeOptionsChange({ currency: options })}
          />
        )

      default:
        return null
    }
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section title='Form Input Configuration' isRequired>
        <VarEditorField className='p-0'>
          {/* Input Type */}
          <VarEditorFieldRow title='Type' description='The type of input to collect' isRequired>
            <div className='flex-1 pe-2 h-8 flex items-center'>
              <InputTypePicker
                value={inputType}
                onChange={handleInputTypeChange}
                disabled={isReadOnly}
              />
            </div>
          </VarEditorFieldRow>

          {/* Label - uses ConstantInputAdapter with STRING type */}
          <VarEditorFieldRow
            title='Label'
            description='The label shown to users'
            type={BaseType.STRING}
            isRequired>
            <ConstantInputAdapter
              value={nodeData.label || ''}
              onChange={handleFieldChange('label')}
              varType={BaseType.STRING}
              placeholder='Enter field label'
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>

          {/* Placeholder - uses ConstantInputAdapter with STRING type */}
          {inputType !== BaseType.BOOLEAN && (
            <VarEditorFieldRow
              title='Placeholder'
              description='Hint text when empty'
              type={BaseType.STRING}>
              <ConstantInputAdapter
                value={nodeData.placeholder || ''}
                onChange={handleFieldChange('placeholder')}
                varType={BaseType.STRING}
                placeholder='Optional placeholder'
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          )}

          {/* Hint - Helper text shown to users when filling this field */}
          <VarEditorFieldRow
            title='Hint'
            description='Helper text shown to users when filling this field'
            type={BaseType.STRING}>
            <ConstantInputAdapter
              value={nodeData.hint || ''}
              onChange={handleFieldChange('hint')}
              varType={BaseType.STRING}
              placeholder='Optional hint for users'
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>

          {/* Required - uses ConstantInputAdapter with BOOLEAN type */}
          <VarEditorFieldRow
            title='Required'
            description='Make field mandatory'
            type={BaseType.BOOLEAN}>
            <ConstantInputAdapter
              value={nodeData.required || false}
              onChange={handleFieldChange('required')}
              varType={BaseType.BOOLEAN}
              fieldOptions={{ variant: 'switch' }}
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>

          {/* Default Value - uses ConstantInputAdapter with dynamic type */}
          {typeSupportsDefaultValue(inputType) && (
            <VarEditorFieldRow
              title='Default'
              description='Optional default value'
              type={inputType}
              showIcon>
              <ConstantInputAdapter
                value={nodeData.defaultValue}
                onChange={handleFieldChange('defaultValue')}
                varType={inputType}
                placeholder='Enter default value'
                disabled={isReadOnly}
                fieldOptions={{
                  enum: nodeData.typeOptions?.enum,
                  currency: nodeData.typeOptions?.currency,
                  string: nodeData.typeOptions?.string,
                }}
              />
            </VarEditorFieldRow>
          )}

          {/* Switch Label - only for boolean inputs with switch variant */}
          {inputType === BaseType.BOOLEAN && (
            <VarEditorFieldRow
              title='Switch Label'
              description='Label shown next to the switch'
              type={BaseType.STRING}>
              <ConstantInputAdapter
                value={nodeData.typeOptions?.boolean?.label || ''}
                onChange={(_content: string, value: string) => {
                  handleTypeOptionsChange({
                    boolean: { ...nodeData.typeOptions?.boolean, label: value },
                  })
                }}
                varType={BaseType.STRING}
                placeholder='e.g., Enable notifications'
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          )}
        </VarEditorField>
      </Section>

      {/* Type-specific configuration */}
      {typeNeedsConfiguration(inputType) && (
        <Section title='Type Configuration'>{renderTypeConfiguration()}</Section>
      )}

      {/* Output Variables */}
      <OutputVariablesDisplay
        outputVariables={getFormInputOutputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const FormInputPanel = React.memo(FormInputPanelComponent)
