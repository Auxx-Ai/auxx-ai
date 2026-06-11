// apps/web/src/components/workflow/credentials/credential-dialog.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { AlertTriangle, CheckCircle, Loader2, Settings, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type UseFormReturn, useForm } from 'react-hook-form'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { filterCredentialDataForEdit, hasSensitiveFieldChanges } from './credential-data-utils'
import { CredentialFormBuilder } from './credential-form-builder'
import { type CredentialTypeMetadata, getCredentialType } from './credential-registry'
import { CredentialSelector } from './credential-selector'
import { CredentialTypeSelector } from './credential-type-selector'
import { useCredentials } from './credentials-provider'
import { validateCredentialData } from './validation-utils'

type CredentialPage =
  | 'select-type'
  | 'select-credential'
  | 'configure'
  | 'test-save'
  | 'edit'
  | 'connected'

interface CredentialFormData {
  name: string
  [key: string]: any
}

interface BaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CreateProps extends BaseProps {
  mode: 'create'
  /** Pre-selects the credential type and skips the type-selection page. */
  initialType?: string | null
  /** Called with the new credential id after a successful create (incl. OAuth). */
  onCreated?: (credentialId: string) => void
}

interface EditProps extends BaseProps {
  mode: 'edit'
  credentialId: string | null
}

interface ConnectProps extends BaseProps {
  mode: 'connect'
  allowedCredentialTypes: string[]
  currentCredentialId?: string | null
  onCredentialConnected: (credentialId: string) => void
  onCredentialDisconnected: () => void
  hideCreateOption?: boolean
}

export type CredentialDialogProps = CreateProps | EditProps | ConnectProps

/** Default name suggestion when a credential type is picked, e.g. "Slack API Jun 11". */
const defaultNameFor = (type: CredentialTypeMetadata) =>
  `${type.displayName} ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

/** Seed the form with the type's declared property defaults plus a friendly name. */
const defaultValuesFor = (type: CredentialTypeMetadata): CredentialFormData => {
  const values: CredentialFormData = { name: defaultNameFor(type) }
  type.credentialType.properties.forEach((prop) => {
    if (prop.default !== undefined && prop.default !== null) {
      values[prop.name] = prop.default
    }
  })
  return values
}

/**
 * Unified credential dialog covering all three flows as `DialogNavPages`:
 *  - `create` — select type → configure → test & save (with a step indicator)
 *  - `edit` — single page editing name + non-sensitive fields
 *  - `connect` — pick/connect a credential for a workflow node; "create new" and
 *    "edit" run inline as pages instead of stacking nested dialogs
 */
export function CredentialDialog(props: CredentialDialogProps) {
  const { open, onOpenChange, mode } = props
  const connect = mode === 'connect'

  const [page, setPage] = useState<CredentialPage>('select-type')
  const [selectedType, setSelectedType] = useState<CredentialTypeMetadata | null>(null)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { createCredential, updateCredential, refetchCredentials } = useCredentials()
  const testData = api.credentials.testData.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()

  const form = useForm<CredentialFormData>({ mode: 'onChange', defaultValues: { name: '' } })

  // Connect mode: info about the currently connected credential (for the connected page).
  const currentCredentialId = connect ? props.currentCredentialId : null
  const { data: connectedInfo } = api.credentials.getInfo.useQuery(
    { id: currentCredentialId! },
    { enabled: open && !!currentCredentialId, refetchOnWindowFocus: false }
  )

  // Edit page data (edit mode prop, or the connected credential in connect mode).
  const editCredentialId = mode === 'edit' ? props.credentialId : currentCredentialId
  const {
    data: editData,
    isLoading: editLoading,
    error: editError,
  } = api.credentials.getNonSensitiveData.useQuery(
    { id: editCredentialId! },
    { enabled: open && page === 'edit' && !!editCredentialId, refetchOnWindowFocus: false }
  )
  const editType = editData ? getCredentialType(editData.info.type) : null

  // Initialize page + form whenever the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-initialize only on open
  useEffect(() => {
    if (!open) return
    setTestResult(null)
    setIsSaving(false)
    setSelectedCredentialId(null)
    setSearchQuery('')

    if (mode === 'edit') {
      setPage('edit')
      return
    }
    if (mode === 'create') {
      const type = props.initialType ? getCredentialType(props.initialType) : null
      setSelectedType(type)
      form.reset(type ? defaultValuesFor(type) : { name: '' })
      setPage(type ? 'configure' : 'select-type')
      return
    }
    // connect
    if (props.currentCredentialId) {
      setSelectedCredentialId(props.currentCredentialId)
      setPage('connected')
    } else if (props.allowedCredentialTypes.length === 1) {
      setSelectedType(getCredentialType(props.allowedCredentialTypes[0]))
      setPage('select-credential')
    } else {
      setSelectedType(null)
      setPage('select-type')
    }
  }, [open])

  // Hydrate the edit form once the credential data loads.
  useEffect(() => {
    if (page === 'edit' && editData) {
      form.reset({ name: editData.info.name, ...editData.nonSensitiveData })
    }
  }, [page, editData, form])

  // Bail out of the edit page if the credential fails to load.
  useEffect(() => {
    if (page === 'edit' && editError && open) {
      toastError({ title: 'Failed to load credential', description: editError.message })
      onOpenChange(false)
    }
  }, [page, editError, open, onOpenChange])

  const handleTypeSelect = (type: CredentialTypeMetadata) => {
    setSelectedType(type)
    if (connect) {
      setPage('select-credential')
    } else {
      form.reset(defaultValuesFor(type))
      setPage('configure')
    }
  }

  const handleCreateNew = () => {
    if (!selectedType) return
    form.reset(defaultValuesFor(selectedType))
    setTestResult(null)
    setPage('configure')
  }

  const finishCreate = (credentialId: string) => {
    if (props.mode === 'connect') props.onCredentialConnected(credentialId)
    else if (props.mode === 'create') props.onCreated?.(credentialId)
    onOpenChange(false)
  }

  const handleTest = async () => {
    if (!selectedType) return
    const { name: _name, ...credentialData } = form.getValues()
    try {
      const result = await testData.mutateAsync({
        type: selectedType.credentialType.name,
        data: credentialData,
      })
      setTestResult(result)
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test credential',
      })
    }
  }

  const handleCreateSave = async () => {
    if (!selectedType) return

    const isFormValid = await form.trigger()
    if (!isFormValid) {
      toastError({
        title: 'Validation Error',
        description: 'Please fix the errors in the form before saving',
      })
      return
    }

    const { name, ...credentialData } = form.getValues()
    const validationResult = validateCredentialData(
      credentialData,
      selectedType.credentialType.properties
    )
    if (!validationResult.isValid) {
      toastError({
        title: 'Validation Error',
        description: Object.values(validationResult.errors).join(', '),
      })
      return
    }

    setIsSaving(true)
    try {
      const credentialId = await createCredential({
        type: selectedType.credentialType.name,
        name,
        data: credentialData,
      })
      finishCreate(credentialId)
    } catch {
      // createCredential already error-toasts via the provider mutation.
    } finally {
      setIsSaving(false)
    }
  }

  const handleEditSave = async () => {
    if (!editCredentialId || !editData || !editType) return

    const isFormValid = await form.trigger()
    if (!isFormValid) {
      toastError({
        title: 'Validation Error',
        description: 'Please fix the errors in the form before saving',
      })
      return
    }

    const { name, ...rawCredentialData } = form.getValues()
    const properties = editType.credentialType.properties

    // Empty sensitive fields mean "keep the stored value" — drop them from the patch.
    const filteredCredentialData = filterCredentialDataForEdit(rawCredentialData, properties)

    const validationResult = validateCredentialData(rawCredentialData, properties, true)
    if (!validationResult.isValid) {
      toastError({
        title: 'Validation Error',
        description: Object.values(validationResult.errors).join(', '),
      })
      return
    }

    const hasChanges =
      name !== editData.info.name ||
      Object.keys(filteredCredentialData).length > 0 ||
      hasSensitiveFieldChanges(rawCredentialData, properties)
    if (!hasChanges) {
      toastError({ title: 'No Changes', description: 'No changes detected to save' })
      return
    }

    setIsSaving(true)
    try {
      await updateCredential(editCredentialId, { name, data: filteredCredentialData })
      await refetchCredentials()
      if (connect) setPage('connected')
      else onOpenChange(false)
    } catch {
      // updateCredential already error-toasts via the provider mutation.
    } finally {
      setIsSaving(false)
    }
  }

  const handleConnect = () => {
    if (props.mode !== 'connect' || !selectedCredentialId) return
    props.onCredentialConnected(selectedCredentialId)
    onOpenChange(false)
  }

  const handleDisconnect = async () => {
    if (props.mode !== 'connect') return
    const confirmed = await confirm({
      title: 'Disconnect Credential?',
      description:
        'This will remove the credential connection from this node. The credential itself will not be deleted.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      props.onCredentialDisconnected()
      onOpenChange(false)
    }
  }

  // ── Navigation model ────────────────────────────────────────────────────────

  const typeCrumb = selectedType
    ? {
        label: selectedType.displayName,
        icon: <selectedType.icon className='size-4' />,
      }
    : null

  const nav = (() => {
    switch (page) {
      case 'select-type':
        return {
          title: 'Select Credential Type',
          crumbs: [{ label: connect ? 'Connect credential' : 'New credential' }],
        }
      case 'select-credential':
        return {
          title: 'Select Credential',
          crumbs: [typeCrumb ?? { label: 'Select credential' }],
          onBack:
            props.mode === 'connect' && props.allowedCredentialTypes.length > 1
              ? () => {
                  setSelectedType(null)
                  setPage('select-type')
                }
              : undefined,
        }
      case 'configure':
        return {
          title: 'Configure Credential',
          crumbs: [typeCrumb ?? { label: 'Configure' }],
          onBack: connect
            ? () => setPage('select-credential')
            : props.mode === 'create' && !props.initialType
              ? () => {
                  setSelectedType(null)
                  setPage('select-type')
                }
              : undefined,
        }
      case 'test-save':
        return {
          title: 'Test & Save',
          crumbs: [
            ...(typeCrumb ? [{ ...typeCrumb, onClick: () => setPage('configure') }] : []),
            { label: 'Test & save' },
          ],
          onBack: () => setPage('configure'),
        }
      case 'edit':
        return {
          title: 'Edit Credential',
          crumbs: [
            editType
              ? {
                  label: `Edit ${editType.displayName}`,
                  icon: <editType.icon className='size-4' />,
                }
              : { label: 'Edit credential' },
          ],
          onBack: connect ? () => setPage('connected') : undefined,
        }
      case 'connected':
        return {
          title: 'Credential Connected',
          crumbs: [{ label: connectedInfo?.name ?? 'Connected credential' }],
        }
    }
  })()

  // Step indicator for the create flow ("Step 2 of 3" in the nav actions slot).
  const createSteps: CredentialPage[] | null =
    mode === 'create'
      ? props.initialType
        ? ['configure', 'test-save']
        : ['select-type', 'configure', 'test-save']
      : null
  const stepIndex = createSteps ? createSteps.indexOf(page) : -1
  const stepIndicator =
    createSteps && stepIndex >= 0 ? (
      // mr-8 clears the dialog's absolutely-positioned close button (size-7 right-1).
      <span className='mr-8 px-2 text-xs text-muted-foreground'>
        Step {stepIndex + 1} of {createSteps.length}
      </span>
    ) : undefined

  // Next is gated on form validity; OAuth types additionally require a completed flow.
  const nameValue = form.watch('name')
  const oauthComplete = form.watch('oauthComplete')
  const needsOAuth = selectedType ? hasOAuth2Config(selectedType.credentialType) : false
  const nextDisabled = !form.formState.isValid || !nameValue || (needsOAuth && !oauthComplete)

  const connectedType = connectedInfo ? getCredentialType(connectedInfo.type) : null

  // Whether the dialog opens on the type-selection page (drives search autofocus).
  const opensOnTypeSelect =
    mode === 'create'
      ? !props.initialType
      : connect
        ? !props.currentCredentialId && props.allowedCredentialTypes.length > 1
        : false

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          innerClassName='p-0'
          position='tc'
          size='content'
          onOpenAutoFocus={(e) => {
            if (!opensOnTypeSelect) return
            e.preventDefault()
            searchInputRef.current?.focus()
          }}>
          <div className='flex flex-col'>
            <DialogNav
              title={nav.title}
              crumbs={nav.crumbs}
              onBack={nav.onBack}
              backDisabled={isSaving}
              actions={stepIndicator}
            />

            <DialogNavPages value={page}>
              <DialogNavPage value='select-type' size='lg'>
                <div className='flex flex-col min-h-0 flex-1'>
                  <div className='px-3 py-3'>
                    <InputSearch
                      ref={searchInputRef}
                      placeholder='Search credential types...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onClear={() => setSearchQuery('')}
                    />
                  </div>
                  <ScrollArea viewportClassName='max-h-[400px]'>
                    <div className='p-3 pt-0 pr-5'>
                      <CredentialTypeSelector
                        onSelect={handleTypeSelect}
                        selectedType={selectedType?.id}
                        allowedCredentialTypes={
                          props.mode === 'connect' ? props.allowedCredentialTypes : undefined
                        }
                        searchQuery={searchQuery}
                      />
                    </div>
                  </ScrollArea>
                </div>
              </DialogNavPage>

              <DialogNavPage value='select-credential' size='md'>
                <ScrollArea viewportClassName='max-h-[28rem]'>
                  <div className='p-3 pr-5'>
                    {props.mode === 'connect' && (
                      <CredentialSelector
                        allowedCredentialTypes={
                          selectedType ? [selectedType.id] : props.allowedCredentialTypes
                        }
                        selectedCredentialId={selectedCredentialId}
                        onCredentialSelect={setSelectedCredentialId}
                        onCreateNew={handleCreateNew}
                        hideCreateOption={props.hideCreateOption}
                      />
                    )}
                  </div>
                </ScrollArea>
              </DialogNavPage>

              <DialogNavPage value='configure' size='md'>
                <ScrollArea viewportClassName='max-h-[28rem]'>
                  <div className='p-3 pr-5'>
                    {selectedType && (
                      <CredentialConfigForm form={form}>
                        <CredentialFormBuilder
                          properties={selectedType.credentialType.properties}
                          form={form}
                          credentialType={selectedType.credentialType}
                          onOAuth2Success={finishCreate}
                        />
                      </CredentialConfigForm>
                    )}
                  </div>
                </ScrollArea>
              </DialogNavPage>

              <DialogNavPage value='test-save' size='sm'>
                <div className='p-3'>
                  {selectedType && (
                    <div className='space-y-4'>
                      <div className='py-6 text-center'>
                        <selectedType.icon className='mx-auto mb-4 size-12 text-muted-foreground' />
                        <h3 className='mb-2 text-lg font-medium'>Ready to Create Credential</h3>
                        <p className='text-sm text-muted-foreground'>
                          Your {selectedType.displayName} credential "{form.getValues('name')}" is
                          configured and ready to be saved.
                        </p>
                      </div>

                      {testResult && (
                        <Alert variant={testResult.success ? 'default' : 'destructive'}>
                          {testResult.success ? (
                            <CheckCircle className='size-4' />
                          ) : (
                            <AlertTriangle className='size-4' />
                          )}
                          <AlertDescription>
                            {testResult.message ||
                              (testResult.success
                                ? 'Connection test passed'
                                : 'Connection test failed')}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </div>
              </DialogNavPage>

              <DialogNavPage value='edit' size='md'>
                <ScrollArea viewportClassName='max-h-[28rem]'>
                  <div className='p-3 pr-5'>
                    {editLoading ? (
                      <div className='flex items-center justify-center py-8 text-muted-foreground'>
                        <Loader2 className='mr-2 size-5 animate-spin' />
                        <span>Loading credential data...</span>
                      </div>
                    ) : editData && editType ? (
                      <CredentialConfigForm form={form}>
                        <CredentialFormBuilder
                          properties={editType.credentialType.properties}
                          form={form}
                          editMode
                          nonSensitiveValues={editData.nonSensitiveData}
                        />
                      </CredentialConfigForm>
                    ) : null}
                  </div>
                </ScrollArea>
              </DialogNavPage>

              <DialogNavPage value='connected' size='sm'>
                <div className='p-3'>
                  <div className='space-y-4'>
                    <div className='py-6 text-center'>
                      {connectedType && (
                        <connectedType.icon className='mx-auto mb-4 size-12 text-primary' />
                      )}
                      <h3 className='mb-2 text-lg font-medium'>
                        {connectedInfo?.name ?? 'Connected credential'}
                      </h3>
                      <p className='text-sm text-muted-foreground'>
                        This credential is connected to your node
                      </p>
                    </div>

                    <div className='flex gap-3'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setPage('edit')}
                        className='flex-1'>
                        <Settings />
                        Edit Credential
                      </Button>
                      <Button
                        variant='destructive'
                        size='sm'
                        onClick={handleDisconnect}
                        className='flex-1'>
                        <Trash2 />
                        Disconnect
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogNavPage>
            </DialogNavPages>

            <DialogFooter className='mt-0 border-t p-3'>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onOpenChange(false)}
                disabled={isSaving}>
                {page === 'connected' ? 'Close' : 'Cancel'}{' '}
                <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>

              {page === 'select-credential' && (
                <Button
                  size='sm'
                  onClick={handleConnect}
                  disabled={!selectedCredentialId}
                  data-dialog-submit>
                  Connect <KbdSubmit variant='default' size='sm' />
                </Button>
              )}

              {page === 'configure' && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    setTestResult(null)
                    setPage('test-save')
                  }}
                  disabled={nextDisabled}
                  data-dialog-submit>
                  Next <KbdSubmit variant='outline' size='sm' />
                </Button>
              )}

              {page === 'test-save' && (
                <>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={handleTest}
                    loading={testData.isPending}
                    loadingText='Testing...'>
                    Test connection
                  </Button>
                  <Button
                    size='sm'
                    onClick={handleCreateSave}
                    loading={isSaving}
                    loadingText='Creating...'
                    data-dialog-submit>
                    Create credential <KbdSubmit variant='default' size='sm' />
                  </Button>
                </>
              )}

              {page === 'edit' && (
                <Button
                  size='sm'
                  onClick={handleEditSave}
                  disabled={!form.formState.isValid || editLoading}
                  loading={isSaving}
                  loadingText='Saving...'
                  data-dialog-submit>
                  Save changes <KbdSubmit variant='default' size='sm' />
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  )
}

/**
 * Shared configure/edit form chrome: the required name field followed by the
 * type-specific fields (passed as children).
 */
function CredentialConfigForm({
  form,
  children,
}: {
  form: UseFormReturn<CredentialFormData>
  children: React.ReactNode
}) {
  return (
    <Form {...form}>
      <div className='space-y-3'>
        <FormField
          control={form.control}
          name='name'
          rules={{ required: 'Credential name is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="after:content-['*'] after:ml-0.5 after:text-red-500">
                Credential Name
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder='Enter a name for this credential'
                  value={field.value || ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        {children}
      </div>
    </Form>
  )
}
