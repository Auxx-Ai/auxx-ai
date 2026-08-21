// apps/web/src/components/fields/property-provider.tsx

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { formatToRawValue, readCurrency } from '@auxx/lib/field-values/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { toActorId } from '@auxx/types/actor'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import type { StoredFieldValue } from '~/components/resources/store/field-value-store'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'

/**
 * property-provider.tsx
 * Context provider for a single contact property row with helper methods
 * for handling state changes, save, cancel, and other common operations
 *
 * Key patterns:
 * - commitValue: Fire-and-forget save to server (no await needed)
 * - trackChange: Track local changes without saving
 * - commitAndClose: Save current value and close popover
 * - onBeforeClose: Hook for save-on-close pattern
 */

interface PropertyContextValue {
  // ─── Data ───
  field: any
  recordId: RecordId
  /** Current value (local if editing, server if not) */
  value: any
  /** Last confirmed server value - use for dirty comparison */
  serverValue: any
  isLoading: boolean
  isDirty: boolean
  isOpen: boolean
  isSaving: boolean
  isOutsideClick: RefObject<boolean>
  providerId: string
  /** Whether all fields are read-only (default: false) */
  readOnly: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle: boolean

  // ─── Core Actions ───
  /**
   * Commit value to server. FIRE-AND-FORGET by default.
   * Local state updates synchronously, mutation runs in background.
   * Only await this if you MUST wait for server confirmation.
   */
  commitValue: (newValue: any) => void

  /**
   * Track a local change without saving to server.
   * Updates value and marks field as dirty.
   */
  trackChange: (newValue: any) => void

  /**
   * Commit current dirty value and close popover.
   * Use for "save and done" actions like pressing Enter.
   */
  commitAndClose: () => void

  /**
   * Commit explicit value and close popover atomically.
   * Use for Enter key in text inputs where local state may differ from context.
   */
  commitValueAndClose: (newValue: any) => void

  /**
   * Commit value to server and wait for result.
   * Use ONLY when you need the returned ID (e.g., file fields).
   * For normal saves, use commitValue instead.
   */
  commitValueAsync: (newValue: any) => Promise<{ success: boolean; id?: string } | undefined>

  /** Cancel editing and revert to server value */
  cancel: () => void

  /** Open the popover */
  open: () => void

  /** Close the popover (cancels if dirty) */
  close: () => void

  /** Force close the popover */
  forceClose: () => void

  // ─── Lifecycle Hook ───
  /**
   * Hook for save-on-close pattern. Set this ref to a function that
   * will be called when the popover is about to close (outside click).
   */
  onBeforeClose: React.MutableRefObject<(() => void) | undefined>
}

const PropertyContext = createContext<PropertyContextValue | undefined>(undefined)

interface PropertyProviderProps {
  field: any
  providerId: string
  loading?: boolean
  onOpenChange?: (providerId: string, isOpen: boolean) => void
  registerClose?: (providerId: string, closeFn: () => void) => void
  unregisterClose?: (providerId: string) => void
  /** RecordId in format "entityDefinitionId:entityInstanceId" (required for saving) */
  recordId: RecordId
  /** Whether all fields are read-only (default: false) */
  readOnly?: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle?: boolean
  children: ReactNode
}

/**
 * Extract raw value from TypedFieldValue using centralized formatter.
 * Handles TypedFieldValue, arrays, and raw values.
 * @param val - The value from store or props (TypedFieldValue or raw)
 * @param fieldType - The field type for proper extraction
 */
function extractRawValue(val: StoredFieldValue | null | undefined, fieldType: FieldType): unknown {
  if (val === null || val === undefined) return null

  // Use centralized formatter for extraction
  // formatToRawValue handles TypedFieldValue, arrays, and raw values
  return formatToRawValue(val, fieldType)
}

/**
 * Whether this field's array values are ORDER-sensitive.
 *
 * True only for `options.multi` scalar fields (EMAIL/URL/PHONE), where the list
 * is ordered and index 0 is the primary — the value outbound mail/SMS actually
 * uses. Every other array-valued type (MULTI_SELECT, TAGS, RELATIONSHIP, ACTOR)
 * stores an unordered set, where a reshuffle carries no meaning.
 */
export function isOrderSensitive(field: any): boolean {
  return field?.options?.multi === true
}

/**
 * Normalize a value for comparison purposes.
 * Treats empty strings, null, and undefined as equivalent "empty" values.
 */
function normalizeForComparison(val: any): any {
  if (val === null || val === undefined) return null
  if (typeof val === 'string' && val.trim() === '') return null
  return val
}

/**
 * Collapse a field value to ONE canonical shape per field type, so the two
 * sides of a comparison are the same KIND before they are compared.
 *
 * Some converters are deliberately asymmetric: `toRawValue` returns a rich
 * object (what a renderer needs) while the input commits the narrow scalar the
 * write path wants. CURRENCY reads `{ code?, amount }` and writes a bare number;
 * ACTOR reads `{ actorType, id, actorId }` and writes an `ActorId` string.
 * Without this collapse the comparator falls through to `String(...)` and
 * "20000" !== "[object Object]" reports a change on EVERY blur, so an untouched
 * field commits forever and never converges.
 *
 * NAME needs nothing here — it reads and writes the same `{firstName,lastName}`
 * object, so the plain-object branch already answers correctly.
 */
function normalizeByFieldType(val: any, fieldType?: FieldType | string): any {
  if (val === null || val === undefined) return val
  if (!fieldType) return val

  if (Array.isArray(val)) return val.map((entry) => normalizeByFieldType(entry, fieldType))

  switch (fieldType) {
    // Read `{ code?, amount }` vs write bare minor units.
    case FieldTypeEnum.CURRENCY:
      return readCurrency(val) ?? val

    // Read `{ actorType, id, actorId }` vs write an `ActorId` string.
    case FieldTypeEnum.ACTOR: {
      if (typeof val === 'string') return val.trim()
      if (typeof val === 'object') {
        const obj = val as Record<string, unknown>
        if (typeof obj.actorId === 'string') return obj.actorId
        const actorType = (obj.actorType ?? obj.type) as string | undefined
        if (actorType && typeof obj.id === 'string') {
          return toActorId(actorType as Parameters<typeof toActorId>[0], obj.id)
        }
      }
      return val
    }

    default:
      return val
  }
}

/**
 * Check if a value has changed compared to another value
 * Handles arrays, objects, and primitives
 * Treats empty strings and null/undefined as equivalent (no change)
 *
 * @param orderSensitive - When true, arrays that differ only in ORDER count as
 *   changed. Required for `options.multi` scalar fields (EMAIL/URL/PHONE), where
 *   position is data: index 0 IS the primary value. See {@link isOrderSensitive}.
 * @param fieldType - Collapses read/write-asymmetric types (CURRENCY, ACTOR) to
 *   one canonical shape on both sides first. See {@link normalizeByFieldType}.
 */
export function hasValueChanged(
  newValue: any,
  originalVal: any,
  orderSensitive = false,
  fieldType?: FieldType | string
): boolean {
  // Normalize both values - empty strings are treated as null
  const normalizedNew = normalizeForComparison(normalizeByFieldType(newValue, fieldType))
  const normalizedOrig = normalizeForComparison(normalizeByFieldType(originalVal, fieldType))

  // If both are null/empty, no change
  if (normalizedNew === null && normalizedOrig === null) return false

  // If one is null and other isn't, that's a change
  if (normalizedNew === null || normalizedOrig === null) return true

  // Same reference
  if (normalizedNew === normalizedOrig) return false

  // Handle arrays (like multi-select values)
  if (Array.isArray(normalizedNew) && Array.isArray(normalizedOrig)) {
    if (normalizedNew.length !== normalizedOrig.length) return true
    // Empty arrays are equal
    if (normalizedNew.length === 0) return false
    // Order-insensitive by default: MULTI_SELECT/TAGS/RELATIONSHIP carry a SET
    // of values, so a reshuffle is not an edit. Multi-value scalars are the
    // opposite — set-as-primary reorders the same members, and sorting here
    // would report "unchanged" and silently drop the write.
    if (orderSensitive) {
      return JSON.stringify(normalizedNew) !== JSON.stringify(normalizedOrig)
    }
    const sortedNew = [...normalizedNew].sort()
    const sortedOrig = [...normalizedOrig].sort()
    return JSON.stringify(sortedNew) !== JSON.stringify(sortedOrig)
  }

  // Handle objects (like structured address)
  if (
    typeof normalizedNew === 'object' &&
    typeof normalizedOrig === 'object' &&
    !Array.isArray(normalizedNew) &&
    !Array.isArray(normalizedOrig)
  ) {
    return JSON.stringify(normalizedNew) !== JSON.stringify(normalizedOrig)
  }

  // Handle primitive values
  return String(normalizedNew) !== String(normalizedOrig)
}

export function PropertyProvider({
  field,
  providerId,
  loading = false,
  onOpenChange,
  registerClose,
  unregisterClose,
  recordId,
  readOnly = false,
  showTitle = true,
  children,
}: PropertyProviderProps) {
  // Derived once as a primitive so the commit callbacks depend on a stable
  // boolean rather than the whole `field` object.
  const orderSensitive = isOrderSensitive(field)

  // ─── Store Integration ───
  // Get value from store using RecordId directly with auto-fetch
  const { value: storeValue, isLoading: storeLoading } = useFieldValue(recordId, field.id, {
    autoFetch: true,
  })

  // if (field.fieldType === 'CALC') {
  //   console.log('VALUE:', storeValue)
  // }

  // Field metadata provider for relationship sync
  // The field object already contains options.relationship from the registry
  const getFieldMetadata = useCallback(
    (fieldId: string) => {
      if (fieldId !== field.id) return undefined
      return {
        type: field.fieldType || field.type,
        relationship: field.options?.relationship,
      }
    },
    [field]
  )

  // Use store save hook
  const {
    saveFieldValue: storeSave,
    saveFieldValueAsync: storeSaveAsync,
    saveMultipleAsync: storeSaveMultiple,
    isPending: isSaving,
  } = useSaveFieldValue({
    getFieldMetadata,
  })

  // Determine the actual initial value: store value takes precedence
  // storeValue is TypedFieldValue - extract raw value for component use
  const effectiveInitialValue = extractRawValue(storeValue, field.fieldType)

  // ─── State ───
  const [currentValue, setCurrentValue] = useState<any>(effectiveInitialValue)
  const [serverValue, setServerValue] = useState<any>(effectiveInitialValue)
  const [isOpen, setIsOpen] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const previousIsOpenRef = useRef(isOpen)
  const isOutsideClick = useRef(false)

  // ─── Lifecycle Hooks ───
  const onBeforeClose = useRef<(() => void) | undefined>(undefined)

  // Sync local state when store value changes
  useEffect(() => {
    if (storeValue !== undefined) {
      // Extract raw value from TypedFieldValue for component use
      const rawValue = extractRawValue(storeValue, field.fieldType)
      setCurrentValue(rawValue)
      setServerValue(rawValue)
      setIsDirty(false)
    }
  }, [storeValue, field.fieldType])

  // ─── Core Actions ───

  /**
   * Commit value to server. FIRE-AND-FORGET by default.
   * Local state updates synchronously, mutation runs in background.
   * Note: No isSaving guard - version tracking handles race conditions.
   */
  const commitValue = useCallback(
    (newValue: any) => {
      // Check if value actually changed
      if (!hasValueChanged(newValue, serverValue, orderSensitive, field.fieldType)) {
        setIsDirty(false)
        return
      }

      // Handle NAME field writes - split to source fields
      if (field.fieldType === FieldTypeEnum.NAME && field.options?.name) {
        const { firstNameFieldId, lastNameFieldId } = field.options.name
        const nameValue = newValue as { firstName: string; lastName: string }

        // Update local state SYNCHRONOUSLY
        setCurrentValue(newValue)
        setIsDirty(false)
        setServerValue(newValue)

        // Write BOTH source fields in a single batch mutation. Two separate
        // single-field writes race on the server-side displayName recompute:
        // each NAME source write recomputes the composed displayName by reading
        // its sibling from the DB, so concurrent first/last writes can read a
        // stale sibling and persist an outdated displayName. Batching writes
        // them sequentially in one request, so the final recompute always sees
        // the freshly-written sibling. The computed NAME value updates itself.
        void storeSaveMultiple(recordId, [
          {
            fieldId: firstNameFieldId,
            value: nameValue.firstName ?? '',
            fieldType: FieldTypeEnum.TEXT,
          },
          {
            fieldId: lastNameFieldId,
            value: nameValue.lastName ?? '',
            fieldType: FieldTypeEnum.TEXT,
          },
        ])

        // Optimistically mirror the server-side displayName recompute into the
        // record store so surfaces reading `record.displayName` (e.g. the drawer
        // header) update instantly. The editing tab is excluded from the
        // `record:updated` realtime echo, so without this it would stay stale
        // until a refetch. Only when this NAME field actually drives the
        // entity's primary displayName — mirrors the backend gate.
        const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
        const resource = useResourceStore.getState().getResourceById(entityDefinitionId)
        if (resource?.display.primaryDisplayField?.id === field.id) {
          const composed = `${nameValue.firstName ?? ''} ${nameValue.lastName ?? ''}`.trim()
          useRecordStore
            .getState()
            .updateRecord(entityDefinitionId, entityInstanceId, { displayName: composed })
        }
        return
      }

      // 1. Update local state SYNCHRONOUSLY (instant UI update)
      setCurrentValue(newValue)
      setIsDirty(false)

      // 2. Fire mutation in BACKGROUND (optimistic + background mutation).
      // `fieldOptions` keeps options.multi fields array-shaped through the
      // optimistic store write and the post-save shaping.
      storeSave(recordId, field.id, newValue, field.fieldType, { fieldOptions: field.options })
      // Store handles the optimistic update, so also update local serverValue
      setServerValue(newValue)
    },
    [
      recordId,
      serverValue,
      storeSave,
      storeSaveMultiple,
      field.id,
      field.fieldType,
      field.options,
      orderSensitive,
    ]
  )

  /**
   * Track a local change without saving to server.
   * Updates value and marks field as dirty.
   */
  const trackChange = useCallback((newValue: any) => {
    setCurrentValue(newValue)
    setIsDirty(true)
  }, [])

  /**
   * Commit current dirty value and close popover.
   */
  const commitAndClose = useCallback(() => {
    if (isDirty && hasValueChanged(currentValue, serverValue, orderSensitive, field.fieldType)) {
      commitValue(currentValue)
    }
    setIsOpen(false)
  }, [isDirty, currentValue, serverValue, commitValue, orderSensitive])

  /**
   * Commit explicit value and close popover atomically.
   * Avoids stale closure issues by handling both in one function.
   */
  const commitValueAndClose = useCallback(
    (newValue: any) => {
      if (isSaving) {
        setIsOpen(false)
        isOutsideClick.current = false
        return
      }

      if (!hasValueChanged(newValue, serverValue, orderSensitive, field.fieldType)) {
        setIsDirty(false)
        setIsOpen(false)
        isOutsideClick.current = false
        return
      }

      // Update local state and close immediately
      setCurrentValue(newValue)
      setIsDirty(false)
      setIsOpen(false)
      isOutsideClick.current = false

      // Fire mutation in background (optimistic + background mutation)
      storeSave(recordId, field.id, newValue, field.fieldType, { fieldOptions: field.options })
      setServerValue(newValue)
    },
    [
      recordId,
      isSaving,
      serverValue,
      storeSave,
      field.id,
      field.fieldType,
      field.options,
      orderSensitive,
    ]
  )

  /**
   * Async version of commitValue that returns the result.
   * Use only when you need the returned ID (e.g., file attachments).
   */
  const commitValueAsync = useCallback(
    async (newValue: any): Promise<{ success: boolean; id?: string } | undefined> => {
      // Check if value actually changed (skip for empty objects used to create initial value)
      const isEmptyObject =
        newValue !== null &&
        typeof newValue === 'object' &&
        !Array.isArray(newValue) &&
        Object.keys(newValue).length === 0

      if (
        !isEmptyObject &&
        !hasValueChanged(newValue, serverValue, orderSensitive, field.fieldType)
      ) {
        setIsDirty(false)
        return undefined
      }

      // Update local state synchronously
      setCurrentValue(newValue)
      setIsDirty(false)

      // Use async save path. Only advance serverValue on success — a failed
      // save rolls the store back, and advancing here would make the next
      // commit's "did it change" diff compare against a value the server
      // never accepted.
      const result = await storeSaveAsync(recordId, field.id, newValue, field.fieldType, {
        fieldOptions: field.options,
      })
      if (result?.success) {
        setServerValue(newValue)
      }
      return result
    },
    [
      recordId,
      serverValue,
      storeSaveAsync,
      field.id,
      field.fieldType,
      field.options,
      orderSensitive,
    ]
  )

  /**
   * Cancel editing and revert to server value
   */
  const cancel = useCallback(() => {
    setCurrentValue(serverValue)
    setIsDirty(false)
    setIsOpen(false)
  }, [serverValue])

  /**
   * Open the popover
   */
  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  /**
   * Close the popover (cancels if dirty via Esc key)
   */
  const close = useCallback(() => {
    if (isDirty && hasValueChanged(currentValue, serverValue, orderSensitive, field.fieldType)) {
      // Esc key was pressed while dirty - cancel instead of save
      setCurrentValue(serverValue)
      setIsDirty(false)
    }
    setIsOpen(false)
    isOutsideClick.current = false
  }, [isDirty, currentValue, serverValue, orderSensitive])

  /**
   * Force close the popover
   */
  const forceClose = useCallback(() => {
    close()
  }, [close])

  // ─── Effects ───

  // Notify parent of open state changes
  useEffect(() => {
    if (previousIsOpenRef.current !== isOpen) {
      onOpenChange?.(providerId, isOpen)
      previousIsOpenRef.current = isOpen
    }
  }, [isOpen, onOpenChange, providerId])

  // Register close handler with parent
  useEffect(() => {
    if (!registerClose) return
    registerClose(providerId, forceClose)
    return () => {
      unregisterClose?.(providerId)
    }
  }, [registerClose, unregisterClose, providerId, forceClose])

  // ─── Context Value ───
  const contextValue: PropertyContextValue = {
    field,
    recordId,
    value: currentValue,
    serverValue,
    readOnly,
    showTitle,
    isLoading: loading || storeLoading,
    isDirty,
    isOpen,
    isSaving,
    isOutsideClick,
    providerId,
    // New methods
    commitValue,
    trackChange,
    commitAndClose,
    commitValueAndClose,
    commitValueAsync,
    cancel,
    open,
    close,
    forceClose,
    onBeforeClose,
  }

  return <PropertyContext.Provider value={contextValue}>{children}</PropertyContext.Provider>
}

/**
 * Hook to access the property context
 * @returns The property context value
 * @throws Error if used outside of a PropertyProvider
 */
export function usePropertyContext() {
  const ctx = useContext(PropertyContext)
  if (!ctx) throw new Error('usePropertyContext must be used within a PropertyProvider')
  return ctx
}
