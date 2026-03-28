// apps/web/src/components/workflow/nodes/core/format/panel.tsx

'use client'

import {
  type FormatOperation,
  OPERATION_EXAMPLES,
  OPERATION_GROUPS,
  OPERATION_METADATA,
} from '@auxx/lib/workflow-engine/constants'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { produce } from 'immer'
import { ChevronsUpDown, Info } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { ComboPicker, type OptionGroup } from '~/components/pickers/combo-picker'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { computeFormatOutputVariables } from './output-variables'
import type { FormatNodeData } from './types'

const CURRENCY_ENUM_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CAD', label: 'CAD (C$)' },
  { value: 'AUD', label: 'AUD (A$)' },
  { value: 'JPY', label: 'JPY (¥)' },
]

interface FormatPanelProps {
  nodeId: string
  data: FormatNodeData
}

const FormatPanelComponent = ({ nodeId, data }: FormatPanelProps) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs } = useNodeCrud<FormatNodeData>(nodeId, data)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Build ComboPicker groups
  const operationGroups: OptionGroup[] = useMemo(
    () =>
      OPERATION_GROUPS.map((group) => ({
        label: group.label,
        options: group.operations.map((op) => ({
          value: op,
          label: OPERATION_METADATA[op].label,
          iconId: group.iconId,
          color: group.color,
        })),
      })),
    []
  )

  // Selected option for display
  const selectedOption = useMemo(() => {
    const meta = OPERATION_METADATA[nodeData.operation]
    const group = OPERATION_GROUPS.find((g) => g.operations.includes(nodeData.operation))
    return {
      value: nodeData.operation,
      label: meta.label,
      iconId: group?.iconId,
      color: group?.color,
    }
  }, [nodeData.operation])

  // Handle operation change — preserve shared config values between related operations
  const handleOperationChange = useCallback(
    (newOperation: FormatOperation) => {
      const prev = nodeData
      const newData = produce(nodeData, (draft) => {
        draft.operation = newOperation
        draft.fieldModes = {}

        // Reset all operation-specific configs
        draft.trimConfig = undefined
        draft.padConfig = undefined
        draft.truncateConfig = undefined
        draft.wrapConfig = undefined
        draft.replaceConfig = undefined
        draft.replaceRegexConfig = undefined
        draft.removeConfig = undefined
        draft.currencyConfig = undefined
        draft.percentageConfig = undefined
        draft.fixedDecimalsConfig = undefined
        draft.compactConfig = undefined
        draft.slugConfig = undefined
        draft.substringConfig = undefined
        draft.firstLastNConfig = undefined
        draft.regexMatchConfig = undefined
        draft.splitConfig = undefined
        draft.stripHtmlConfig = undefined

        // Initialize with defaults, then carry over shared values from previous config
        switch (newOperation) {
          case 'trim':
            draft.trimConfig = { trimAll: false }
            break
          case 'pad_start':
          case 'pad_end':
            // Preserve padConfig when switching between pad_start ↔ pad_end
            draft.padConfig = prev.padConfig
              ? { ...prev.padConfig }
              : { length: 10, isLengthConstant: true, character: ' ' }
            break
          case 'truncate':
            draft.truncateConfig = { maxLength: 100, isMaxLengthConstant: true, suffix: '...' }
            break
          case 'wrap':
            draft.wrapConfig = { prefix: '', suffix: '' }
            break
          case 'replace':
            draft.replaceConfig = {
              find: prev.removeConfig?.find ?? prev.replaceConfig?.find ?? '',
              replaceWith:
                prev.replaceRegexConfig?.replaceWith ?? prev.replaceConfig?.replaceWith ?? '',
              replaceAll: prev.replaceConfig?.replaceAll ?? true,
            }
            break
          case 'replace_regex':
            draft.replaceRegexConfig = {
              pattern: prev.replaceRegexConfig?.pattern ?? '',
              replaceWith:
                prev.replaceConfig?.replaceWith ?? prev.replaceRegexConfig?.replaceWith ?? '',
              flags: prev.replaceRegexConfig?.flags ?? 'g',
            }
            break
          case 'remove':
            draft.removeConfig = {
              find: prev.replaceConfig?.find ?? prev.removeConfig?.find ?? '',
            }
            break
          case 'currency': {
            // Carry over locale from compact
            const locale = prev.compactConfig?.locale ?? prev.currencyConfig?.locale ?? 'en-US'
            draft.currencyConfig = {
              locale,
              currencyCode: prev.currencyConfig?.currencyCode ?? 'USD',
            }
            break
          }
          case 'percentage': {
            // Carry over decimals from fixed_decimals
            const decimals =
              prev.fixedDecimalsConfig?.decimals ?? prev.percentageConfig?.decimals ?? 0
            const isConst =
              prev.fixedDecimalsConfig?.isDecimalsConstant ??
              prev.percentageConfig?.isDecimalsConstant ??
              true
            draft.percentageConfig = { decimals, isDecimalsConstant: isConst }
            break
          }
          case 'fixed_decimals': {
            // Carry over decimals from percentage
            const decimals =
              prev.percentageConfig?.decimals ?? prev.fixedDecimalsConfig?.decimals ?? 2
            const isConst =
              prev.percentageConfig?.isDecimalsConstant ??
              prev.fixedDecimalsConfig?.isDecimalsConstant ??
              true
            draft.fixedDecimalsConfig = { decimals, isDecimalsConstant: isConst }
            break
          }
          case 'compact': {
            // Carry over locale from currency
            const locale = prev.currencyConfig?.locale ?? prev.compactConfig?.locale ?? 'en-US'
            draft.compactConfig = { locale }
            break
          }
          case 'slug':
            draft.slugConfig = { separator: '-' }
            break
          case 'substring':
            draft.substringConfig = {
              start: 0,
              isStartConstant: true,
              end: undefined,
              isEndConstant: true,
            }
            break
          case 'first_n':
          case 'last_n':
            // Preserve firstLastNConfig when switching between first_n ↔ last_n
            draft.firstLastNConfig = prev.firstLastNConfig
              ? { ...prev.firstLastNConfig }
              : { count: 10, isCountConstant: true }
            break
          case 'regex_match':
            draft.regexMatchConfig = { pattern: '', group: 0 }
            break
          case 'split':
            draft.splitConfig = { delimiter: ',' }
            break
          case 'strip_html':
            draft.stripHtmlConfig = { keepLineBreaks: true }
            break
        }
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  // Handle main rich-text input change
  const handleInputChange = useCallback(
    (value: string | any) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      setInputs({ ...nodeData, input: stringValue })
    },
    [nodeData, setInputs]
  )

  // Generic config updater
  const updateConfig = useCallback(
    <K extends keyof FormatNodeData>(key: K, updates: Partial<NonNullable<FormatNodeData[K]>>) => {
      const newData = produce(nodeData, (draft) => {
        const current = (draft[key] ?? {}) as Record<string, any>
        ;(draft as any)[key] = { ...current, ...updates }
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  // Field mode helper
  const getFieldMode = useCallback(
    (fieldKey: string, defaultValue = true): boolean => {
      return nodeData.fieldModes?.[fieldKey] ?? defaultValue
    },
    [nodeData.fieldModes]
  )

  // Compute output variables
  const outputVariables = useMemo(
    () => computeFormatOutputVariables(nodeData, nodeId),
    [nodeData.operation, nodeId]
  )

  // Render operation-specific options below the main input
  const renderOperationOptions = () => {
    const op = nodeData.operation

    switch (op) {
      // --- Trim ---
      case 'trim':
        return (
          <VarEditorFieldRow title='Collapse internal whitespace' type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.trimConfig?.trimAll ?? false}
              onChange={(value) => {
                updateConfig('trimConfig', { trimAll: value === true || value === 'true' })
              }}
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={getFieldMode('trimAll')}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Pad Start / Pad End ---
      case 'pad_start':
      case 'pad_end':
        return (
          <>
            <VarEditorFieldRow
              title='Length'
              type={BaseType.NUMBER}
              isRequired
              onClear={
                nodeData.padConfig?.length != null
                  ? () => updateConfig('padConfig', { length: undefined })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.padConfig?.length}
                onChange={(value: any, isConstant: boolean) => {
                  const numValue = isConstant
                    ? typeof value === 'number'
                      ? value
                      : Number.parseInt(value, 10)
                    : value
                  updateConfig('padConfig', {
                    length: Number.isNaN(numValue) ? undefined : numValue,
                    isLengthConstant: isConstant,
                  })
                }}
                varType={BaseType.NUMBER}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.NUMBER]}
                placeholder='Pick variable'
                placeholderConstant='Target length'
                allowConstant
                isConstantMode={nodeData.padConfig?.isLengthConstant ?? true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Character'
              type={BaseType.STRING}
              onClear={
                nodeData.padConfig?.character && nodeData.padConfig.character !== ' '
                  ? () => updateConfig('padConfig', { character: ' ' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.padConfig?.character ?? ' '}
                onChange={(value) => updateConfig('padConfig', { character: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='Pad character'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Truncate ---
      case 'truncate':
        return (
          <>
            <VarEditorFieldRow
              title='Max Length'
              type={BaseType.NUMBER}
              isRequired
              onClear={
                nodeData.truncateConfig?.maxLength != null
                  ? () => updateConfig('truncateConfig', { maxLength: undefined })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.truncateConfig?.maxLength}
                onChange={(value: any, isConstant: boolean) => {
                  const numValue = isConstant
                    ? typeof value === 'number'
                      ? value
                      : Number.parseInt(value, 10)
                    : value
                  updateConfig('truncateConfig', {
                    maxLength: Number.isNaN(numValue) ? undefined : numValue,
                    isMaxLengthConstant: isConstant,
                  })
                }}
                varType={BaseType.NUMBER}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.NUMBER]}
                placeholder='Pick variable'
                placeholderConstant='Max length'
                allowConstant
                isConstantMode={nodeData.truncateConfig?.isMaxLengthConstant ?? true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Suffix'
              type={BaseType.STRING}
              onClear={
                nodeData.truncateConfig?.suffix && nodeData.truncateConfig.suffix !== '...'
                  ? () => updateConfig('truncateConfig', { suffix: '...' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.truncateConfig?.suffix ?? '...'}
                onChange={(value) => updateConfig('truncateConfig', { suffix: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='...'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Wrap ---
      case 'wrap':
        return (
          <>
            <VarEditorFieldRow
              title='Prefix'
              onClear={
                nodeData.wrapConfig?.prefix
                  ? () => updateConfig('wrapConfig', { prefix: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.wrapConfig?.prefix ?? ''}
                onChange={(value: any) => {
                  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                  updateConfig('wrapConfig', { prefix: strValue })
                }}
                mode={VAR_MODE.RICH}
                placeholder='Prefix text'
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Suffix'
              onClear={
                nodeData.wrapConfig?.suffix
                  ? () => updateConfig('wrapConfig', { suffix: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.wrapConfig?.suffix ?? ''}
                onChange={(value: any) => {
                  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                  updateConfig('wrapConfig', { suffix: strValue })
                }}
                mode={VAR_MODE.RICH}
                placeholder='Suffix text'
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Replace ---
      case 'replace':
        return (
          <>
            <VarEditorFieldRow
              title='Find'
              isRequired
              onClear={
                nodeData.replaceConfig?.find
                  ? () => updateConfig('replaceConfig', { find: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceConfig?.find ?? ''}
                onChange={(value: any) => {
                  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                  updateConfig('replaceConfig', { find: strValue })
                }}
                mode={VAR_MODE.RICH}
                placeholder='Text to find'
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Replace With'
              onClear={
                nodeData.replaceConfig?.replaceWith
                  ? () => updateConfig('replaceConfig', { replaceWith: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceConfig?.replaceWith ?? ''}
                onChange={(value: any) => {
                  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                  updateConfig('replaceConfig', { replaceWith: strValue })
                }}
                mode={VAR_MODE.RICH}
                placeholder='Replacement text'
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Replace All' type={BaseType.BOOLEAN}>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceConfig?.replaceAll ?? true}
                onChange={(value) => {
                  updateConfig('replaceConfig', { replaceAll: value === true || value === 'true' })
                }}
                fieldOptions={{ variant: 'switch' }}
                varType={BaseType.BOOLEAN}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.BOOLEAN]}
                allowConstant
                isConstantMode={getFieldMode('replaceAll')}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Replace Regex ---
      case 'replace_regex':
        return (
          <>
            <VarEditorFieldRow
              title='Pattern'
              type={BaseType.STRING}
              isRequired
              onClear={
                nodeData.replaceRegexConfig?.pattern
                  ? () => updateConfig('replaceRegexConfig', { pattern: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceRegexConfig?.pattern ?? ''}
                onChange={(value) => updateConfig('replaceRegexConfig', { pattern: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='Regex pattern'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Replace With'
              onClear={
                nodeData.replaceRegexConfig?.replaceWith
                  ? () => updateConfig('replaceRegexConfig', { replaceWith: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceRegexConfig?.replaceWith ?? ''}
                onChange={(value: any) => {
                  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                  updateConfig('replaceRegexConfig', { replaceWith: strValue })
                }}
                mode={VAR_MODE.RICH}
                placeholder='Replacement text'
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Flags'
              type={BaseType.STRING}
              onClear={
                nodeData.replaceRegexConfig?.flags && nodeData.replaceRegexConfig.flags !== 'g'
                  ? () => updateConfig('replaceRegexConfig', { flags: 'g' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.replaceRegexConfig?.flags ?? 'g'}
                onChange={(value) => updateConfig('replaceRegexConfig', { flags: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='g'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Remove ---
      case 'remove':
        return (
          <VarEditorFieldRow
            title='Find'
            isRequired
            onClear={
              nodeData.removeConfig?.find
                ? () => updateConfig('removeConfig', { find: '' })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.removeConfig?.find ?? ''}
              onChange={(value: any) => {
                const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                updateConfig('removeConfig', { find: strValue })
              }}
              mode={VAR_MODE.RICH}
              placeholder='Text to remove'
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Currency ---
      case 'currency':
        return (
          <>
            <VarEditorFieldRow title='Currency' type={BaseType.ENUM}>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.currencyConfig?.currencyCode ?? 'USD'}
                onChange={(value) =>
                  updateConfig('currencyConfig', { currencyCode: String(value) })
                }
                varType={BaseType.ENUM}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.ENUM, BaseType.STRING]}
                fieldOptions={{ enum: CURRENCY_ENUM_OPTIONS }}
                placeholderConstant='Select currency'
                allowConstant
                isConstantMode={getFieldMode('currencyCode')}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Locale'
              type={BaseType.STRING}
              onClear={
                nodeData.currencyConfig?.locale && nodeData.currencyConfig.locale !== 'en-US'
                  ? () => updateConfig('currencyConfig', { locale: 'en-US' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.currencyConfig?.locale ?? 'en-US'}
                onChange={(value) => updateConfig('currencyConfig', { locale: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='en-US'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Percentage ---
      case 'percentage':
        return (
          <VarEditorFieldRow
            title='Decimal Places'
            type={BaseType.NUMBER}
            onClear={
              nodeData.percentageConfig?.decimals != null
                ? () => updateConfig('percentageConfig', { decimals: undefined })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.percentageConfig?.decimals}
              onChange={(value: any, isConstant: boolean) => {
                const numValue = isConstant
                  ? typeof value === 'number'
                    ? value
                    : Number.parseInt(value, 10)
                  : value
                updateConfig('percentageConfig', {
                  decimals: Number.isNaN(numValue) ? undefined : numValue,
                  isDecimalsConstant: isConstant,
                })
              }}
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant='Decimal places'
              allowConstant
              isConstantMode={nodeData.percentageConfig?.isDecimalsConstant ?? true}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Fixed Decimals ---
      case 'fixed_decimals':
        return (
          <VarEditorFieldRow
            title='Decimal Places'
            type={BaseType.NUMBER}
            onClear={
              nodeData.fixedDecimalsConfig?.decimals != null
                ? () => updateConfig('fixedDecimalsConfig', { decimals: undefined })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.fixedDecimalsConfig?.decimals}
              onChange={(value: any, isConstant: boolean) => {
                const numValue = isConstant
                  ? typeof value === 'number'
                    ? value
                    : Number.parseInt(value, 10)
                  : value
                updateConfig('fixedDecimalsConfig', {
                  decimals: Number.isNaN(numValue) ? undefined : numValue,
                  isDecimalsConstant: isConstant,
                })
              }}
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant='Decimal places'
              allowConstant
              isConstantMode={nodeData.fixedDecimalsConfig?.isDecimalsConstant ?? true}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Compact ---
      case 'compact':
        return (
          <VarEditorFieldRow
            title='Locale'
            type={BaseType.STRING}
            onClear={
              nodeData.compactConfig?.locale && nodeData.compactConfig.locale !== 'en-US'
                ? () => updateConfig('compactConfig', { locale: 'en-US' })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.compactConfig?.locale ?? 'en-US'}
              onChange={(value) => updateConfig('compactConfig', { locale: String(value) })}
              varType={BaseType.STRING}
              placeholderConstant='en-US'
              allowVariable={false}
              isConstantMode={true}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Slug ---
      case 'slug':
        return (
          <VarEditorFieldRow
            title='Separator'
            type={BaseType.STRING}
            onClear={
              nodeData.slugConfig?.separator && nodeData.slugConfig.separator !== '-'
                ? () => updateConfig('slugConfig', { separator: '-' })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.slugConfig?.separator ?? '-'}
              onChange={(value) => updateConfig('slugConfig', { separator: String(value) })}
              varType={BaseType.STRING}
              placeholderConstant='-'
              allowVariable={false}
              isConstantMode={true}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Substring ---
      case 'substring':
        return (
          <>
            <VarEditorFieldRow
              title='Start'
              type={BaseType.NUMBER}
              onClear={
                nodeData.substringConfig?.start != null
                  ? () => updateConfig('substringConfig', { start: undefined })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.substringConfig?.start}
                onChange={(value: any, isConstant: boolean) => {
                  const numValue = isConstant
                    ? typeof value === 'number'
                      ? value
                      : Number.parseInt(value, 10)
                    : value
                  updateConfig('substringConfig', {
                    start: Number.isNaN(numValue) ? undefined : numValue,
                    isStartConstant: isConstant,
                  })
                }}
                varType={BaseType.NUMBER}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.NUMBER]}
                placeholder='Pick variable'
                placeholderConstant='Start index'
                allowConstant
                isConstantMode={nodeData.substringConfig?.isStartConstant ?? true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='End'
              type={BaseType.NUMBER}
              onClear={
                nodeData.substringConfig?.end != null
                  ? () => updateConfig('substringConfig', { end: undefined })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.substringConfig?.end}
                onChange={(value: any, isConstant: boolean) => {
                  const numValue = isConstant
                    ? typeof value === 'number'
                      ? value
                      : Number.parseInt(value, 10)
                    : value
                  updateConfig('substringConfig', {
                    end: Number.isNaN(numValue) ? undefined : numValue,
                    isEndConstant: isConstant,
                  })
                }}
                varType={BaseType.NUMBER}
                mode={VAR_MODE.PICKER}
                allowedTypes={[BaseType.NUMBER]}
                placeholder='Pick variable'
                placeholderConstant='End index'
                allowConstant
                isConstantMode={nodeData.substringConfig?.isEndConstant ?? true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- First N / Last N ---
      case 'first_n':
      case 'last_n':
        return (
          <VarEditorFieldRow
            title='Count'
            type={BaseType.NUMBER}
            isRequired
            onClear={
              nodeData.firstLastNConfig?.count != null
                ? () => updateConfig('firstLastNConfig', { count: undefined })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.firstLastNConfig?.count}
              onChange={(value: any, isConstant: boolean) => {
                const numValue = isConstant
                  ? typeof value === 'number'
                    ? value
                    : Number.parseInt(value, 10)
                  : value
                updateConfig('firstLastNConfig', {
                  count: Number.isNaN(numValue) ? undefined : numValue,
                  isCountConstant: isConstant,
                })
              }}
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant='Number of characters'
              allowConstant
              isConstantMode={nodeData.firstLastNConfig?.isCountConstant ?? true}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Regex Match ---
      case 'regex_match':
        return (
          <>
            <VarEditorFieldRow
              title='Pattern'
              type={BaseType.STRING}
              isRequired
              onClear={
                nodeData.regexMatchConfig?.pattern
                  ? () => updateConfig('regexMatchConfig', { pattern: '' })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.regexMatchConfig?.pattern ?? ''}
                onChange={(value) => updateConfig('regexMatchConfig', { pattern: String(value) })}
                varType={BaseType.STRING}
                placeholderConstant='Regex pattern'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Group'
              type={BaseType.NUMBER}
              onClear={
                nodeData.regexMatchConfig?.group != null && nodeData.regexMatchConfig.group !== 0
                  ? () => updateConfig('regexMatchConfig', { group: 0 })
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.regexMatchConfig?.group ?? 0}
                onChange={(value) => {
                  updateConfig('regexMatchConfig', {
                    group: Number.parseInt(String(value), 10) || 0,
                  })
                }}
                varType={BaseType.NUMBER}
                placeholderConstant='Capture group (0 = full match)'
                allowVariable={false}
                isConstantMode={true}
                hideClearButton
                disabled={isReadOnly}
              />
            </VarEditorFieldRow>
          </>
        )

      // --- Split ---
      case 'split':
        return (
          <VarEditorFieldRow
            title='Delimiter'
            isRequired
            onClear={
              nodeData.splitConfig?.delimiter
                ? () => updateConfig('splitConfig', { delimiter: '' })
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.splitConfig?.delimiter ?? ','}
              onChange={(value: any) => {
                const strValue = typeof value === 'string' ? value : JSON.stringify(value)
                updateConfig('splitConfig', { delimiter: strValue })
              }}
              mode={VAR_MODE.RICH}
              placeholder='Delimiter'
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // --- Strip HTML ---
      case 'strip_html':
        return (
          <VarEditorFieldRow title='Keep line breaks' type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.stripHtmlConfig?.keepLineBreaks ?? true}
              onChange={(value) => {
                updateConfig('stripHtmlConfig', {
                  keepLineBreaks: value === true || value === 'true',
                })
              }}
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={getFieldMode('keepLineBreaks')}
              hideClearButton
              disabled={isReadOnly}
            />
          </VarEditorFieldRow>
        )

      // Operations with no extra options
      default:
        return null
    }
  }

  const operationOptions = renderOperationOptions()

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Operation Section */}
      <Section
        title='Operation'
        isRequired
        actions={
          <ComboPicker
            groups={operationGroups}
            selected={selectedOption}
            multi={false}
            open={pickerOpen}
            onOpen={() => setPickerOpen(true)}
            onClose={() => setPickerOpen(false)}
            onChange={(opt) => {
              if (opt && !Array.isArray(opt)) {
                handleOperationChange(opt.value as FormatOperation)
              }
              setPickerOpen(false)
            }}
            showSearch
            searchPlaceholder='Search operations...'>
            <Button variant='ghost' size='xs' disabled={isReadOnly}>
              <EntityIcon iconId={selectedOption.iconId} color={selectedOption.color} size='sm' />
              {selectedOption.label}
              <ChevronsUpDown className='size-3 opacity-50' />
            </Button>
          </ComboPicker>
        }>
        <VarEditorField className='p-0'>
          {/* Main rich-text input */}
          <div className='p-1'>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.input ?? ''}
              onChange={handleInputChange}
              mode={VAR_MODE.RICH}
              placeholder='Enter text or insert variables...'
              hideClearButton
              disabled={isReadOnly}
            />
          </div>

          {/* Operation-specific options */}
          {operationOptions && <div className='border-t'>{operationOptions}</div>}
        </VarEditorField>

        {/* Example */}
        <div className='pt-2'>
          <Alert>
            <Info className='size-4' />
            <AlertDescription>
              <span className='font-mono text-xs'>{OPERATION_EXAMPLES[nodeData.operation]}</span>
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      {/* Output Variables */}
      <OutputVariablesDisplay outputVariables={outputVariables} initialOpen={false} />
    </BasePanel>
  )
}

export const FormatPanel = memo(FormatPanelComponent)
