// apps/web/src/components/config/config-drawer.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Field } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import {
  AlertCircle,
  Check,
  Copy,
  Folder,
  Lock,
  Pencil,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { ConfigVariableInput } from './ui/config-variable-input'
import { SourceBadge, TypeBadge } from './ui/source-badge'

interface ConfigDrawerProps {
  variableKey: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  isDbEnabled: boolean
}

/**
 * Right-side drawer showing config variable detail and edit form.
 * Uses DockableDrawer for consistency with other drawers in the app.
 */
export function ConfigDrawer({ variableKey, open, onOpenChange, isDbEnabled }: ConfigDrawerProps) {
  const utils = api.useUtils()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const [confirm, ConfirmDialog] = useConfirm()
  const { copied, copy } = useCopy({ toastMessage: 'Value copied to clipboard' })
  const [editValue, setEditValue] = useState<string | number | boolean | string[] | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const { data: variable } = api.configVariable.getByKey.useQuery(
    { key: variableKey! },
    { enabled: !!variableKey && open }
  )

  /** Reset edit state when variable changes */
  useEffect(() => {
    setIsEditing(false)
    setEditValue(null)
  }, [variableKey])

  const setVariable = api.configVariable.set.useMutation({
    onSuccess: () => {
      utils.configVariable.getGrouped.invalidate()
      utils.configVariable.getByKey.invalidate({ key: variableKey! })
      setIsEditing(false)
      setEditValue(null)
    },
    onError: (error) => {
      toastError({ title: 'Failed to save', description: error.message })
    },
  })

  const deleteVariable = api.configVariable.delete.useMutation({
    onSuccess: () => {
      utils.configVariable.getGrouped.invalidate()
      utils.configVariable.getByKey.invalidate({ key: variableKey! })
      setIsEditing(false)
      setEditValue(null)
    },
    onError: (error) => {
      toastError({ title: 'Failed to reset', description: error.message })
    },
  })

  /** Start editing with current value */
  const handleEdit = () => {
    if (!variable) return
    setEditValue(variable.value)
    setIsEditing(true)
  }

  /** Save the edited value */
  const handleSave = async () => {
    if (editValue === null) return
    await setVariable.mutateAsync({ key: variableKey!, value: editValue })
  }

  /** Reset (delete DB override) */
  const handleReset = async () => {
    const confirmed = await confirm({
      title: 'Reset to default?',
      description: `This will remove the database override for ${variableKey}. The value will fall back to the environment variable or default.`,
      confirmText: 'Reset',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await deleteVariable.mutateAsync({ key: variableKey! })
    }
  }

  if (!open || !variableKey) return null

  const definition = variable?.definition
  const canEdit = isDbEnabled && definition && !definition.isEnvOnly

  return (
    <>
      <ConfirmDialog />
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={600}
        title='Configure Variable'>
        <DrawerHeader
          icon={<Settings className='h-4 w-4' />}
          title='Configure Variable'
          actions={<DockToggleButton />}
          onClose={() => onOpenChange(false)}
        />

        {/* Card content - variable name and description */}
        <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
          <EntityIcon iconId='settings' color='gray' className='size-10' />
          <div className='flex flex-col align-start w-full'>
            <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate'>
              {!variable ? (
                <div className='mb-1'>
                  <Skeleton className='h-6 w-80' />
                </div>
              ) : (
                (definition?.key ?? 'Untitled')
              )}
            </div>
            <div className='text-xs text-neutral-500'>
              {!variable ? <Skeleton className='h-4 w-40' /> : definition?.description}
            </div>
          </div>
        </div>

        {/* Metrics grid */}
        {variable && definition && (
          <div className='grid grid-cols-2 border-b'>
            {/* Source */}
            <div className='border-r border-b'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>Source</CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <SourceBadge source={variable.source} />
              </CardContent>
            </div>

            {/* Type */}
            <div className='border-b'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>Type</CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <TypeBadge type={definition.type} />
              </CardContent>
            </div>

            {/* Group */}
            <div className='border-r'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>Group</CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <Folder className='h-4 w-4 text-muted-foreground' />
                  <span className='text-sm font-semibold'>{definition.group}</span>
                </div>
              </CardContent>
            </div>

            {/* Sensitive */}
            <div>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  Sensitive
                </CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <Lock className='h-4 w-4 text-muted-foreground' />
                  <span className='text-sm font-semibold'>
                    {definition.isSensitive ? 'Yes' : 'No'}
                  </span>
                </div>
              </CardContent>
            </div>
          </div>
        )}

        <ScrollArea className='flex-1'>
          {variable && definition && (
            <div className='space-y-6 p-4'>
              {definition.defaultValue !== undefined && (
                <Field title='Default' description='The fallback value when no override is set'>
                  <div className='font-mono text-sm bg-muted p-3 rounded-md break-all'>
                    {String(definition.defaultValue)}
                  </div>
                </Field>
              )}

              {/* Current value */}
              <Field
                title='Current Value'
                description='The active resolved value for this variable'>
                {!isEditing ? (
                  <InputGroup>
                    <InputGroupInput
                      type='text'
                      value={
                        definition.isSensitive
                          ? '••••••••'
                          : variable.value !== null
                            ? String(variable.value)
                            : ''
                      }
                      placeholder='not set'
                      readOnly
                      className='font-mono text-xs'
                      onFocus={(e) => e.target.select()}
                    />
                    <InputGroupAddon align='inline-end' className='gap-0.5'>
                      <Tooltip content='Copy'>
                        <InputGroupButton
                          aria-label='Copy value'
                          className='rounded-full'
                          size='icon-xs'
                          onClick={() => variable.value !== null && copy(String(variable.value))}
                          disabled={variable.value === null || definition.isSensitive}>
                          {copied ? <Check /> : <Copy />}
                        </InputGroupButton>
                      </Tooltip>
                      {canEdit && (
                        <Tooltip content='Edit'>
                          <InputGroupButton
                            aria-label='Edit value'
                            className='rounded-full'
                            size='icon-xs'
                            onClick={handleEdit}>
                            <Pencil />
                          </InputGroupButton>
                        </Tooltip>
                      )}
                      {canEdit && variable.hasDbOverride && (
                        <Tooltip content='Reset to default'>
                          <InputGroupButton
                            aria-label='Reset to default'
                            className='rounded-full'
                            size='icon-xs'
                            onClick={handleReset}
                            disabled={deleteVariable.isPending}>
                            <RotateCcw />
                          </InputGroupButton>
                        </Tooltip>
                      )}
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <InputGroup>
                    <ConfigVariableInput
                      definition={definition}
                      value={editValue}
                      onChange={setEditValue}
                    />
                    <InputGroupAddon align='inline-end' className='gap-0.5'>
                      <Tooltip content='Save'>
                        <InputGroupButton
                          aria-label='Save value'
                          className='rounded-full bg-good-50 text-good-600 hover:bg-good-100'
                          size='icon-xs'
                          onClick={handleSave}
                          disabled={setVariable.isPending}>
                          <Check />
                        </InputGroupButton>
                      </Tooltip>
                      <Tooltip content='Cancel'>
                        <InputGroupButton
                          aria-label='Cancel edit'
                          className='rounded-full bg-bad-50 text-bad-600 hover:bg-bad-100'
                          size='icon-xs'
                          onClick={() => setIsEditing(false)}>
                          <X />
                        </InputGroupButton>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                )}
              </Field>

              {/* Warnings */}
              {definition.isEnvOnly && (
                <Alert variant='warning'>
                  <AlertCircle />
                  <AlertDescription>
                    This variable can only be set via environment variable.
                  </AlertDescription>
                </Alert>
              )}
              {!isDbEnabled && !definition.isEnvOnly && (
                <Alert variant='warning'>
                  <AlertCircle />
                  <AlertDescription>
                    DB overrides are disabled. Set IS_CONFIG_VARIABLES_IN_DB_ENABLED=true to enable.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </ScrollArea>
      </DockableDrawer>
    </>
  )
}
