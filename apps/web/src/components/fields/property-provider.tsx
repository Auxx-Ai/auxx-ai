// apps/web/src/components/fields/property-provider.tsx
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import type { ResourceId } from '@auxx/lib/resources/client'
import type { FieldType } from '@auxx/database/types'
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
  resourceId: ResourceId
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
  value?: any
  providerId: string
  loading?: boolean
  onOpenChange?: (providerId: string, isOpen: boolean) => void
  registerClose?: (providerId: string, closeFn: () => void) => void
  unregisterClose?: (providerId: string) => void
  /** ResourceId in format "entityDefinitionId:entityInstanceId" (required for saving) */
  resourceId: ResourceId
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
 * Normalize a value for comparison purposes.
 * Treats empty strings, null, and undefined as equivalent "empty" values.
 */
function normalizeForComparison(val: any): any {
  if (val === null || val === undefined) return null
  if (typeof val === 'string' && val.trim() === '') return null
  return val
}

/**
 * Check if a value has changed compared to another value
 * Handles arrays, objects, and primitives
 * Treats empty strings and null/undefined as equivalent (no change)
 */
function hasValueChanged(newValue: any, originalVal: any): boolean {
  // Normalize both values - empty strings are treated as null
  const normalizedNew = normalizeForComparison(newValue)
  const normalizedOrig = normalizeForComparison(originalVal)

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
  value: initialValue,
  providerId,
  loading = false,
  onOpenChange,
  registerClose,
  unregisterClose,
  resourceId,
  readOnly = false,
  showTitle = true,
  children,
}: PropertyProviderProps) {
  // ─── Store Integration ───
  // Get value from store using ResourceId directly
  const storeKey = buildFieldValueKey(resourceId, field.id)
  const storeValue = useFieldValueStore((s) => s.values[storeKey])

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
    isPending: isSaving,
  } = useSaveFieldValue({
    getFieldMetadata,
  })

  // Determine the actual initial value: store value takes precedence
  // storeValue is TypedFieldValue - extract raw value for component use
  const effectiveInitialValue =
    storeValue !== undefined
      ? extractRawValue(storeValue, field.fieldType)
      : extractRawValue(initialValue, field.fieldType)

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
      if (!hasValueChanged(newValue, serverValue)) {
        setIsDirty(false)
        return
      }

      // 1. Update local state SYNCHRONOUSLY (instant UI update)
      setCurrentValue(newValue)
      setIsDirty(false)

      // 2. Fire mutation in BACKGROUND (optimistic + background mutation)
      storeSave(resourceId, field.id, newValue, field.fieldType)
      // Store handles the optimistic update, so also update local serverValue
      setServerValue(newValue)
    },
    [resourceId, serverValue, storeSave, field.id, field.fieldType]
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
    if (isDirty && hasValueChanged(currentValue, serverValue)) {
      commitValue(currentValue)
    }
    setIsOpen(false)
  }, [isDirty, currentValue, serverValue, commitValue])

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

      if (!hasValueChanged(newValue, serverValue)) {
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
      storeSave(resourceId, field.id, newValue, field.fieldType)
      setServerValue(newValue)
    },
    [resourceId, isSaving, serverValue, storeSave, field.id, field.fieldType]
  )

  /**
   * Async version of commitValue that returns the result.
   * Use only when you need the returned ID (e.g., file attachments).
   */
  const commitValueAsync = useCallback(
    async (newValue: any): Promise<{ success: boolean; id?: string } | undefined> => {
      if (isSaving) return undefined

      // Check if value actually changed (skip for empty objects used to create initial value)
      const isEmptyObject =
        newValue !== null &&
        typeof newValue === 'object' &&
        !Array.isArray(newValue) &&
        Object.keys(newValue).length === 0

      if (!isEmptyObject && !hasValueChanged(newValue, serverValue)) {
        setIsDirty(false)
        return undefined
      }

      // Update local state synchronously
      setCurrentValue(newValue)
      setIsDirty(false)

      // Use async save path
      const result = await storeSaveAsync(resourceId, field.id, newValue, field.fieldType)
      setServerValue(newValue)
      return result
    },
    [resourceId, isSaving, serverValue, storeSaveAsync, field.id, field.fieldType]
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
    if (isDirty && hasValueChanged(currentValue, serverValue)) {
      // Esc key was pressed while dirty - cancel instead of save
      setCurrentValue(serverValue)
      setIsDirty(false)
    }
    setIsOpen(false)
    isOutsideClick.current = false
  }, [isDirty, currentValue, serverValue])

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
    resourceId,
    value: currentValue,
    serverValue,
    readOnly,
    showTitle,
    isLoading: loading,
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
