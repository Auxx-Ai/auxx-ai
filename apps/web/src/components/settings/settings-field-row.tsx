// apps/web/src/components/settings/settings-field-row.tsx
'use client'

import type { SettingConfig, SettingKey, SettingValue } from '@auxx/lib/settings/client'
import { type ReactElement, type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { AdminGate } from '~/components/global/admin-gate'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSettings } from '~/hooks/use-settings'
import { mapFieldTypeToBaseType } from '~/lib/custom-fields/field-type-utils'
import { useSettingsCatalog } from '~/providers/dehydrated-state-provider'

/** FieldTypes whose `FieldInputAdapter` value/onChange convention is `string[]` rather than the stored scalar. */
const ARRAY_WRAPPED_FIELD_TYPES = new Set(['SINGLE_SELECT'])

/** `recording.defaultBotName` → `Default bot name` */
function humanizeKey(key: string): string {
  const last = key.split('.').at(-1) ?? key
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

interface SettingsFieldRowProps {
  /** Catalog key — see `packages/lib/src/settings/catalog.ts` for the full list. */
  settingKey: SettingKey
  /** Override the humanized title derived from the key's last segment. */
  title?: string
  /** Override the catalog entry's description. */
  description?: string
  placeholder?: string
  className?: string
  /**
   * Controlled mode: parent owns the value and save (e.g. a form section that
   * batch-saves via `batchUpdateOrganizationSettings`). Providing `onChange`
   * disables this row's own autosave — pass `value` alongside it.
   */
  value?: unknown
  onChange?: (value: unknown) => void
  /** Custom input replacing `FieldInputAdapter`, keeping the row chrome. The child owns its own saving. */
  children?: ReactNode
}

/**
 * Renders one setting as a `FieldPanelRow` + `FieldInputAdapter`, wired to the
 * settings catalog/`useSettings` hook. Autosaves on change by default (routed
 * to `updateOrganizationSetting`/`updateUserSetting` by the entry's `access`);
 * pass `value`/`onChange` for controlled/batched saving instead.
 *
 * ```tsx
 * <SettingsFieldRow settingKey='recording.defaultBotName' />
 * ```
 */
export function SettingsFieldRow({
  settingKey,
  title,
  description,
  placeholder,
  className,
  value: controlledValue,
  onChange: controlledOnChange,
  children,
}: SettingsFieldRowProps): JSX.Element | null {
  const catalog = useSettingsCatalog() as Record<string, SettingConfig>
  const entry = catalog[settingKey]
  const { getSetting, updateOrganizationSetting, updateUserSetting } = useSettings({})
  const isOrgAccess = entry?.access === 'org'

  const baseType = useMemo(
    () => (entry ? mapFieldTypeToBaseType(entry.fieldType) : undefined),
    [entry]
  )

  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[SettingsFieldRow] Unknown setting key: "${settingKey}"`)
    }
    return null
  }

  const isControlled = controlledOnChange !== undefined
  const rawValue = isControlled ? controlledValue : getSetting(settingKey)
  // null = explicit reset-to-default sentinel; fall back to the catalog default for display.
  const currentValue = rawValue ?? entry.defaultValue

  const save = (next: unknown) => {
    if (isControlled) {
      controlledOnChange?.(next)
      return
    }
    if (entry.access === 'org') {
      updateOrganizationSetting(settingKey, next as SettingValue)
    } else {
      updateUserSetting(settingKey, next as SettingValue)
    }
  }

  // Select-family FieldTypes: FieldInputAdapter emits/expects `string[]` — wrap/unwrap
  // at this boundary so settings readers/writers keep dealing in the natural scalar.
  const isSelectWrapped = ARRAY_WRAPPED_FIELD_TYPES.has(entry.fieldType)
  const adapterValue = isSelectWrapped
    ? currentValue == null
      ? []
      : [currentValue as string]
    : currentValue

  const handleAdapterChange = (val: unknown) => {
    if (isSelectWrapped) {
      const arr = Array.isArray(val) ? (val as string[]) : []
      save(arr[0] ?? null)
      return
    }
    save(val === '' ? null : val)
  }

  const rowTitle = title ?? humanizeKey(settingKey)
  const rowDescription = description ?? entry.description

  const input: ReactNode = children ?? (
    <FieldInputAdapter
      fieldType={entry.fieldType}
      fieldOptions={entry.options}
      triggerProps={{ className: 'w-full ps-0 pe-1' }}
      value={adapterValue}
      onChange={handleAdapterChange}
      placeholder={placeholder}
    />
  )

  return (
    <FieldPanelRow
      title={rowTitle}
      description={rowDescription}
      type={baseType}
      showIcon
      className={className}>
      {isOrgAccess ? (
        <AdminGate action={`edit ${rowTitle.toLowerCase()}`}>{input as ReactElement}</AdminGate>
      ) : (
        input
      )}
    </FieldPanelRow>
  )
}
