// apps/web/src/components/contacts/drawer/property-provider.tsx
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
import { toastError } from '@auxx/ui/components/toast'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
} from '~/stores/custom-field-value-store'
import { useSaveFieldValue } from '~/hooks/use-save-field-value'
import type { ModelType } from '@auxx/lib/custom-fields/types'

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
  commitValueAsync: (newValue: any) => Promise<{ id?: string } | undefined>

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

  // ─── Deprecated - kept for backward compatibility ───
  /** @deprecated Use commitValue instead */
  setValue: (newValue: any) => Promise<any>
  /** @deprecated Use trackChange instead */
  // onChange: (newValue: any) => void
  /** @deprecated Use commitAndClose instead */
  // save: () => void
  /** @deprecated Use commitValue + close instead */
  // handleSave: (newValue: any, keepOpen?: boolean) => Promise<string | undefined>
  /** @deprecated Use onBeforeClose instead */
  // requestClose: React.MutableRefObject<((e: any) => void) | undefined>
}

const PropertyContext = createContext<PropertyContextValue | undefined>(undefined)

/** Store configuration for bi-directional sync with table */
export interface StoreConfig {
  resourceType: ResourceType
  resourceId: string
  entityDefId?: string
  modelType: ModelType
}

interface PropertyProviderProps {
  field: any
  value?: any
  mutate?: (newValue: any) => Promise<any>
  providerId: string
  loading?: boolean
  onOpenChange?: (providerId: string, isOpen: boolean) => void
  registerClose?: (providerId: string, closeFn: () => void) => void
  unregisterClose?: (providerId: string) => void
  /** Enable store integration for bi-directional sync with table */
  storeConfig?: StoreConfig
  children: ReactNode
}

/**
 * Extract .data from value wrapper (which is {data: ...} | null)
 */
function extractData(val: any): any {
  if (val === null || val === undefined) return null
  if (typeof val === 'object' && 'data' in val) {
    return val.data
  }
  return null
}

/**
 * Check if a value has changed compared to another value
 * Handles arrays, objects, and primitives
 */
function hasValueChanged(newValue: any, originalVal: any): boolean {
  if (newValue === originalVal) return false
  if (newValue === null || originalVal === null) return newValue !== originalVal
  if (newValue === undefined || originalVal === undefined) return true

  // Handle arrays (like multi-select values)
  if (Array.isArray(newValue) && Array.isArray(originalVal)) {
    if (newValue.length !== originalVal.length) return true
    const sortedNew = [...newValue].sort()
    const sortedOrig = [...originalVal].sort()
    return JSON.stringify(sortedNew) !== JSON.stringify(sortedOrig)
  }

  // Handle objects (like structured address)
  if (
    typeof newValue === 'object' &&
    typeof originalVal === 'object' &&
    !Array.isArray(newValue) &&
    !Array.isArray(originalVal)
  ) {
    return JSON.stringify(newValue) !== JSON.stringify(originalVal)
  }

  // Handle primitive values
  return String(newValue) !== String(originalVal)
}

export function PropertyProvider({
  field,
  value: initialValue,
  mutate,
  providerId,
  loading = false,
  onOpenChange,
  registerClose,
  unregisterClose,
  storeConfig,
  children,
}: PropertyProviderProps) {
  // ─── Store Integration ───
  const useStore = !!storeConfig

  // Get value from store if applicable
  const storeKey = useStore
    ? buildValueKey(
        storeConfig!.resourceType,
        storeConfig!.resourceId,
        field.id,
        storeConfig!.entityDefId
      )
    : null
  const storeValue = useCustomFieldValueStore((s) => (storeKey ? s.values[storeKey] : undefined))

  // Use store save hook if applicable
  const {
    saveValue: storeSave,
    saveValueAsync: storeSaveAsync,
    isPending: storeSaving,
  } = useSaveFieldValue({
    resourceType: storeConfig?.resourceType ?? 'contact',
    resourceId: storeConfig?.resourceId ?? '',
    entityDefId: storeConfig?.entityDefId,
    modelType: storeConfig?.modelType ?? ('contact' as ModelType),
  })

  // Determine the actual initial value: store value takes precedence if using store
  const effectiveInitialValue = useStore ? storeValue : extractData(initialValue)

  // ─── State ───
  const [currentValue, setCurrentValue] = useState<any>(effectiveInitialValue)
  const [serverValue, setServerValue] = useState<any>(effectiveInitialValue)
  const [isOpen, setIsOpen] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const previousIsOpenRef = useRef(isOpen)
  const isOutsideClick = useRef(false)

  // ─── Lifecycle Hooks ───
  const onBeforeClose = useRef<(() => void) | undefined>(undefined)
  // Deprecated alias
  // const requestClose = useRef<((e: any) => void) | undefined>(undefined)

  // Sync local state when store value changes (for store-integrated mode)
  useEffect(() => {
    if (useStore && storeValue !== undefined) {
      setCurrentValue(storeValue)
      setServerValue(storeValue)
      setIsDirty(false)
    }
  }, [useStore, storeValue])

  // Sync local state when initialValue changes (legacy mode - e.g., after a refresh or data refetch)
  useEffect(() => {
    if (useStore) return // Skip for store-integrated mode
    const extracted = extractData(initialValue)
    setCurrentValue(extracted)
    setServerValue(extracted)
    setIsDirty(false)
  }, [initialValue, useStore])

  // ─── Core Actions ───

  // Effective saving state (combines local and store saving states)
  const effectiveIsSaving = isSaving || storeSaving

  /**
   * Commit value to server. FIRE-AND-FORGET by default.
   * Local state updates synchronously, mutation runs in background.
   */
  const commitValue = useCallback(
    (newValue: any) => {
      if (effectiveIsSaving) return

      // Check if value actually changed
      if (!hasValueChanged(newValue, serverValue)) {
        setIsDirty(false)
        return
      }

      // 1. Update local state SYNCHRONOUSLY (instant UI update)
      setCurrentValue(newValue)
      setIsDirty(false)

      // 2. Fire mutation in BACKGROUND (no await, no blocking)
      if (useStore) {
        // Use store-integrated save (optimistic + background mutation)
        storeSave(field.id, newValue)
        // Store handles the optimistic update, so also update local serverValue
        setServerValue(newValue)
      } else if (mutate) {
        // Legacy: direct mutation
        setIsSaving(true)
        mutate(newValue === null ? null : { data: newValue })
          .then(() => {
            // On success, update server value
            setServerValue(newValue)
            setIsSaving(false)
          })
          .catch((error: any) => {
            // On error, roll back to server value
            setCurrentValue(serverValue)
            setIsSaving(false)
            toastError({
              title: 'Error saving field',
              description: error.message || 'Could not save this field value',
            })
          })
      }
    },
    [effectiveIsSaving, serverValue, useStore, storeSave, field.id, mutate]
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
      if (effectiveIsSaving) {
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

      // Fire mutation in background
      if (useStore) {
        // Use store-integrated save (optimistic + background mutation)
        storeSave(field.id, newValue)
        setServerValue(newValue)
      } else if (mutate) {
        setIsSaving(true)
        mutate(newValue === null ? null : { data: newValue })
          .then(() => {
            setServerValue(newValue)
            setIsSaving(false)
          })
          .catch((error: any) => {
            setCurrentValue(serverValue)
            setIsSaving(false)
            toastError({
              title: 'Error saving field',
              description: error.message || 'Could not save this field value',
            })
          })
      }
    },
    [effectiveIsSaving, serverValue, useStore, storeSave, field.id, mutate]
  )

  /**
   * Async version of commitValue that returns the result.
   * Use only when you need the returned ID (e.g., file attachments).
   */
  const commitValueAsync = useCallback(
    async (newValue: any): Promise<{ id?: string } | undefined> => {
      if (effectiveIsSaving) return undefined

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
      if (useStore) {
        const result = await storeSaveAsync(field.id, newValue)
        setServerValue(newValue)
        return result
      } else if (mutate) {
        setIsSaving(true)
        try {
          const result = await mutate(newValue === null ? null : { data: newValue })
          setServerValue(newValue)
          setIsSaving(false)
          return { id: (result as { id?: string })?.id }
        } catch (error: any) {
          setCurrentValue(serverValue)
          setIsSaving(false)
          toastError({
            title: 'Error saving field',
            description: error.message || 'Could not save this field value',
          })
          return undefined
        }
      }

      return undefined
    },
    [effectiveIsSaving, serverValue, useStore, storeSaveAsync, field.id, mutate]
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

  // ─── Deprecated methods (backward compatibility) ───

  /**
   * @deprecated Use commitValue instead
   * Async version that waits for mutation
   */
  // const setValue = useCallback(
  //   async (newValue: any): Promise<any> => {
  //     if (isSaving) return undefined

  //     if (!hasValueChanged(newValue, serverValue)) {
  //       setIsOpen(false)
  //       return undefined
  //     }

  //     const prevValue = currentValue
  //     setCurrentValue(newValue)
  //     setIsDirty(true)

  //     if (mutate) {
  //       setIsSaving(true)
  //       try {
  //         const result = await mutate(newValue === null ? null : { data: newValue })
  //         setServerValue(newValue)
  //         setIsDirty(false)
  //         return result
  //       } catch (err: any) {
  //         setCurrentValue(prevValue)
  //         toastError({
  //           title: 'Error saving field',
  //           description: err.message || 'Could not save this field value',
  //         })
  //         return undefined
  //       } finally {
  //         setIsSaving(false)
  //       }
  //     }

  //     return undefined
  //   },
  //   [currentValue, isSaving, mutate, serverValue]
  // )

  /**
   * @deprecated Use trackChange instead
   */
  // const onChange = useCallback((newValue: any) => {
  //   setCurrentValue(newValue)
  //   setIsDirty(true)
  // }, [])

  /**
   * @deprecated Use commitAndClose instead
   */
  // const save = useCallback(() => {
  //   if (isDirty && hasValueChanged(currentValue, serverValue)) {
  //     setValue(currentValue)
  //   }
  //   setIsOpen(false)
  // }, [currentValue, isDirty, setValue, serverValue])

  /**
   * @deprecated Use commitValue + close instead
   */
  // const handleSave = useCallback(
  //   async (newValue: any, keepOpen?: boolean): Promise<string | undefined> => {
  //     let valueId: string | undefined

  //     if (hasValueChanged(newValue, serverValue)) {
  //       const result = await setValue(newValue)
  //       valueId = result?.id
  //     }

  //     if (!keepOpen) {
  //       setIsOpen(false)
  //     }

  //     return valueId
  //   },
  //   [setValue, serverValue]
  // )

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
    value: currentValue,
    serverValue,
    isLoading: loading,
    isDirty,
    isOpen,
    isSaving: effectiveIsSaving,
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
    // Deprecated (backward compatibility)
    // setValue,
    // onChange,
    // save,
    // handleSave,
    // requestClose,
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
