// apps/web/src/components/custom-fields/ui/entity-definition-dialog.tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from '@auxx/ui/components/field'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon, DEFAULT_COLOR } from '@auxx/ui/components/icons'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useEntityDefinitionMutations } from '~/components/resources/hooks'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { Check, DivideSquare, X } from 'lucide-react'
import { Spinner } from '@auxx/ui/components/spinner'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { CustomFieldDialog } from './custom-field-dialog'

/** Entity definition data for editing */
interface EntityDefinitionEntity {
  id: string
  apiSlug: string
  icon: string | null
  color: string | null
  singular: string
  plural: string
  primaryDisplayFieldId?: string | null
  secondaryDisplayFieldId?: string | null
  avatarFieldId?: string | null
}

/** Props for EntityDefinitionDialog */
interface EntityDefinitionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingEntity?: EntityDefinitionEntity | null
  onSuccess?: () => void
}

/** Converts a string to a URL-friendly slug */
function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Dialog for creating and editing entity definitions */
export function EntityDefinitionDialog({
  open,
  onOpenChange,
  editingEntity = null,
  onSuccess,
}: EntityDefinitionDialogProps) {
  const isEditing = !!editingEntity

  // Form state - default to red package icon for new entities
  const [iconValue, setIconValue] = useState<IconPickerValue>({ icon: 'package', color: 'red' })
  const [singular, setSingular] = useState('')
  const [plural, setPlural] = useState('')
  const [slug, setSlug] = useState('')

  // Display field state
  const [primaryDisplayFieldId, setPrimaryDisplayFieldId] = useState<string | null>(null)
  const [secondaryDisplayFieldId, setSecondaryDisplayFieldId] = useState<string | null>(null)
  const [avatarFieldId, setAvatarFieldId] = useState<string | null>(null)

  // Track if user has manually edited singular field (stops auto-generation)
  const [singularTouched, setSingularTouched] = useState(false)

  // Custom field dialog state (shown after entity creation)
  const [customFieldDialogOpen, setCustomFieldDialogOpen] = useState(false)
  const [createdEntityId, setCreatedEntityId] = useState<string | null>(null)

  // Slug validation state
  const [slugExists, setSlugExists] = useState<boolean | null>(null)
  const [slugReason, setSlugReason] = useState<'reserved' | 'taken' | null>(null)
  const [isCheckingSlug, setIsCheckingSlug] = useState(false)

  // Combined form values for dirty checking
  const formValues = useMemo(
    () => ({
      icon: iconValue.icon,
      color: iconValue.color,
      singular,
      plural,
      slug,
      primaryDisplayFieldId,
      secondaryDisplayFieldId,
      avatarFieldId,
    }),
    [iconValue, singular, plural, slug, primaryDisplayFieldId, secondaryDisplayFieldId, avatarFieldId]
  )

  // Track dirty state for unsaved changes warning
  const { isDirty, setInitial } = useDirtyCheck(formValues)

  // Stable callback for closing the dialog
  const handleConfirmedClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Guard against accidental close when dirty
  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

  // Fetch custom fields for this entity definition (only when editing)
  const { data: customFields } = api.customField.getByEntityDefinition.useQuery(
    { entityDefinitionId: editingEntity?.id ?? '' },
    { enabled: isEditing && !!editingEntity?.id }
  )

  // Reset form when dialog opens/closes or editing entity changes
  useEffect(() => {
    if (open) {
      let initValues: typeof formValues

      if (editingEntity) {
        const icon = editingEntity.icon || 'package'
        const color = editingEntity.color || 'red'
        setIconValue({ icon, color })
        setSingular(editingEntity.singular)
        setPlural(editingEntity.plural)
        setSlug(editingEntity.apiSlug)
        setPrimaryDisplayFieldId(editingEntity.primaryDisplayFieldId ?? null)
        setSecondaryDisplayFieldId(editingEntity.secondaryDisplayFieldId ?? null)
        setAvatarFieldId(editingEntity.avatarFieldId ?? null)
        setSlugExists(null)
        setSlugReason(null)

        initValues = {
          icon,
          color,
          singular: editingEntity.singular,
          plural: editingEntity.plural,
          slug: editingEntity.apiSlug,
          primaryDisplayFieldId: editingEntity.primaryDisplayFieldId ?? null,
          secondaryDisplayFieldId: editingEntity.secondaryDisplayFieldId ?? null,
          avatarFieldId: editingEntity.avatarFieldId ?? null,
        }
      } else {
        setIconValue({ icon: 'package', color: 'red' })
        setSingular('')
        setPlural('')
        setSlug('')
        setPrimaryDisplayFieldId(null)
        setSecondaryDisplayFieldId(null)
        setAvatarFieldId(null)
        setSlugExists(null)
        setSlugReason(null)
        setSingularTouched(false)
        setCreatedEntityId(null)
        setCustomFieldDialogOpen(false)

        initValues = {
          icon: 'package',
          color: 'red',
          singular: '',
          plural: '',
          slug: '',
          primaryDisplayFieldId: null,
          secondaryDisplayFieldId: null,
          avatarFieldId: null,
        }
      }

      // Set baseline for dirty checking
      setInitial(initValues)
    }
  }, [open, editingEntity, setInitial])

  // tRPC utils for slug check
  const utils = api.useUtils()

  // Debounced slug check
  const checkSlug = useDebouncedCallback(async (slugToCheck: string) => {
    if (!slugToCheck || slugToCheck.length < 1) {
      setSlugExists(null)
      setSlugReason(null)
      setIsCheckingSlug(false)
      return
    }

    try {
      const result = await utils.entityDefinition.checkSlugExists.fetch({
        slug: slugToCheck,
        excludeId: editingEntity?.id,
      })
      setSlugExists(result.exists)
      setSlugReason(result.reason)
    } catch {
      // Treat errors as slug being unavailable
      setSlugExists(true)
      setSlugReason(null)
    } finally {
      setIsCheckingSlug(false)
    }
  }, 300)

  // Handle plural name change (auto-generate slug and singular in create mode)
  const handlePluralChange = useCallback(
    (value: string) => {
      setPlural(value)

      // Auto-generate slug from plural (only when creating)
      if (!isEditing) {
        const newSlug = toSlug(value)
        setSlug(newSlug)
        if (newSlug) {
          setIsCheckingSlug(true)
          checkSlug(newSlug)
        } else {
          setSlugExists(null)
          setSlugReason(null)
        }

        // Auto-generate singular (remove trailing 's' if present)
        // Only if user hasn't manually edited the singular field
        if (!singularTouched) {
          const singularValue = value.endsWith('s') ? value.slice(0, -1) : value
          setSingular(singularValue)
        }
      }
    },
    [isEditing, singularTouched, checkSlug]
  )

  // Handle slug change (manual edit)
  const handleSlugChange = useCallback(
    (value: string) => {
      const newSlug = toSlug(value)
      setSlug(newSlug)
      if (newSlug) {
        setIsCheckingSlug(true)
        checkSlug(newSlug)
      } else {
        setSlugExists(null)
        setSlugReason(null)
      }
    },
    [checkSlug]
  )

  // Use mutations hook for automatic resource cache invalidation
  const { createEntity: createEntityMutation, updateEntity: updateEntityMutation } =
    useEntityDefinitionMutations()

  // Custom field mutation hook (used after entity creation)
  // Note: entityDefinitionId is set to createdEntityId which is populated after entity creation
  const { create: createCustomField, isPending: isCreatingField } = useCustomFieldMutations({
    entityDefinitionId: createdEntityId ?? undefined,
  })

  /** Handle create success - open custom field dialog */
  const handleCreateSuccess = (data: { id: string }) => {
    // Mark form as clean so unsaved changes guard doesn't trigger
    setInitial(formValues)
    setCreatedEntityId(data.id)
    setCustomFieldDialogOpen(true)
  }

  /** Handle update success */
  const handleUpdateSuccess = () => {
    onOpenChange(false)
    onSuccess?.()
  }

  /** Handle custom field save - creates field with optimistic updates */
  const handleCustomFieldSave = async (fieldData: any) => {
    if (!createdEntityId) return
    // modelType is derived from entityDefinitionId on the server
    await createCustomField.mutateAsync({
      ...fieldData,
      entityDefinitionId: createdEntityId,
    })
  }

  /** Handle custom field dialog close - close both dialogs */
  const handleCustomFieldDialogClose = (open: boolean) => {
    setCustomFieldDialogOpen(open)
    if (!open) {
      // Close the entity dialog too and clean up
      setCreatedEntityId(null)
      onOpenChange(false)
      onSuccess?.()
    }
  }

  const isPending = createEntityMutation.isPending || updateEntityMutation.isPending

  // Form validation
  const isValid =
    singular.trim().length > 0 &&
    plural.trim().length > 0 &&
    slug.trim().length > 0 &&
    (isEditing || slugExists === false)

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!isValid) return

    if (isEditing && editingEntity) {
      updateEntityMutation.mutate(
        {
          id: editingEntity.id,
          data: {
            icon: iconValue.icon,
            color: iconValue.color,
            singular: singular.trim(),
            plural: plural.trim(),
            primaryDisplayFieldId,
            secondaryDisplayFieldId,
            avatarFieldId,
          },
        },
        {
          onSuccess: handleUpdateSuccess,
          onError: (error) => {
            toastError({ title: 'Failed to update entity', description: error.message })
          },
        }
      )
    } else {
      createEntityMutation.mutate(
        {
          apiSlug: slug.trim(),
          icon: iconValue.icon,
          color: iconValue.color,
          singular: singular.trim(),
          plural: plural.trim(),
        },
        {
          onSuccess: handleCreateSuccess,
          onError: (error) => {
            toastError({ title: 'Failed to create entity', description: error.message })
          },
        }
      )
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm" position="tc" {...guardProps}>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Entity' : 'Create New Entity'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update this entity definition.'
              : 'Create a custom entity to organize your data.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-4">
            {/* Row 1: Icon + Name fields (order depends on mode) */}
            <div className="grid grid-cols-[30px_1fr_1fr] gap-2 items-end">
              <Field>
                <FieldLabel className="sr-only">Icon</FieldLabel>
                <IconPicker value={iconValue} onChange={setIconValue} modal={false}>
                  {/* <Button variant="ghost" size="icon" type="button" className="rounded-md"> */}
                  <div>
                    <EntityIcon
                      iconId={iconValue.icon}
                      color={iconValue.color}
                      className="size-7.5! border rounded-full"
                    />
                  </div>
                  {/* </Button> */}
                </IconPicker>
              </Field>

              {isEditing ? (
                <>
                  {/* Edit mode: Singular first, then Plural */}
                  <Field>
                    <FieldLabel>Singular</FieldLabel>
                    <Input
                      placeholder="Customer"
                      value={singular}
                      onChange={(e) => setSingular(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Plural</FieldLabel>
                    <Input
                      placeholder="Customers"
                      value={plural}
                      onChange={(e) => setPlural(e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  {/* Create mode: Plural first (drives slug), then Singular */}
                  <Field>
                    <FieldLabel>Plural</FieldLabel>
                    <Input
                      placeholder="Customers"
                      value={plural}
                      onChange={(e) => handlePluralChange(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Singular</FieldLabel>
                    <Input
                      placeholder="Customer"
                      value={singular}
                      onChange={(e) => {
                        setSingular(e.target.value)
                        setSingularTouched(true)
                      }}
                    />
                  </Field>
                </>
              )}
            </div>

            {/* Row 2: Slug */}
            <Field>
              <FieldLabel>Slug</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <InputGroupText>/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="customers"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  disabled={isEditing}
                />
                <InputGroupAddon align="inline-end">
                  {isCheckingSlug ? (
                    <Spinner />
                  ) : slug && !isEditing ? (
                    slugExists === false ? (
                      <Check className="size-4 text-success" />
                    ) : slugExists === true ? (
                      <X className="size-4 text-destructive" />
                    ) : null
                  ) : null}
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {isEditing
                  ? 'Slug cannot be changed after creation.'
                  : 'A unique identifier for API access (cannot be changed later).'}
              </FieldDescription>
              {slugExists === true && !isEditing && (
                <FieldError>
                  {slugReason === 'reserved'
                    ? 'This slug is reserved for system entities.'
                    : 'This slug is already taken.'}
                </FieldError>
              )}
            </Field>

            {/* Display Field Configuration (only when editing and has custom fields) */}
            {isEditing && customFields && customFields.length > 0 && (
              <>
                <div className="border-t pt-4 mt-2">
                  <p className="text-sm font-medium mb-3">Display Fields</p>
                  <p className="text-xs text-muted-foreground">
                    Configure which fields are shown when this entity appears in pickers and lists.
                  </p>
                </div>

                <Field>
                  <VarEditorField className="p-0">
                    <VarEditorFieldRow
                      title="Display Field"
                      description="This field will be shown as the main name in pickers">
                      <Select
                        value={primaryDisplayFieldId ?? 'none'}
                        onValueChange={(v) => setPrimaryDisplayFieldId(v === 'none' ? null : v)}>
                        <SelectTrigger variant="transparent" size="sm">
                          <SelectValue placeholder="Select field for display name" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {customFields
                            .filter((f) =>
                              ['TEXT', 'EMAIL', 'NAME', 'PHONE', 'PHONE_INTL', 'URL', 'NUMBER'].includes(f.type)
                            )
                            .map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </VarEditorFieldRow>
                    <VarEditorFieldRow
                      title="Subtitle Field"
                      description="Optional subtitle shown below the primary name">
                      <Select
                        value={secondaryDisplayFieldId ?? 'none'}
                        onValueChange={(v) => setSecondaryDisplayFieldId(v === 'none' ? null : v)}>
                        <SelectTrigger variant="transparent" size="sm">
                          <SelectValue placeholder="Select field for subtitle" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {customFields.map((field) => (
                            <SelectItem key={field.id} value={field.id}>
                              {field.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </VarEditorFieldRow>
                    <VarEditorFieldRow
                      title="Avatar Field"
                      description="Image field to use as avatar in pickers">
                      <Select
                        value={avatarFieldId ?? 'none'}
                        onValueChange={(v) => setAvatarFieldId(v === 'none' ? null : v)}>
                        <SelectTrigger variant="transparent" size="sm">
                          <SelectValue placeholder="Select field for avatar" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {customFields
                            .filter((f) => f.type === 'URL' || f.type === 'FILE')
                            .map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </VarEditorFieldRow>
                  </VarEditorField>
                </Field>
              </>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={guardedClose}
              disabled={isPending}>
              Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              loading={isPending}
              loadingText="Saving..."
              disabled={!isValid || isPending}>
              {isEditing ? 'Update Entity' : 'Create Entity'} <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>

      {/* Custom field dialog shown after entity creation */}
      {customFieldDialogOpen && (
        <CustomFieldDialog
          open={customFieldDialogOpen}
          onOpenChange={handleCustomFieldDialogClose}
          onSave={handleCustomFieldSave}
          isPending={isCreatingField}
          currentRecordId={createdEntityId ?? undefined}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
