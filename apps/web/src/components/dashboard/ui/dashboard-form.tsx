// apps/web/src/components/dashboard/ui/dashboard-form.tsx
'use client'

// Shell-free create/edit dashboard form: name (+ inline icon/color picker),
// description, and visibility, on react-hook-form + zod. One core for both modes
// — pass `dashboard` to edit, omit it to create. `dashboard-form-dialog.tsx`
// wraps this in a `Dialog`; the command palette hosts the create mode as a page.
// Owns its own mutations + cache invalidation; create routes to the new dashboard.

import type { DashboardVisibility } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Textarea } from '@auxx/ui/components/textarea'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Globe, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ResourcePicker } from '~/components/pickers/resource-picker/resource-picker'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'

const DEFAULT_ICON: IconPickerValue = { icon: 'layout-dashboard', color: 'blue' }

/** The subset of a dashboard the form needs to hydrate edit mode. */
export type EditableDashboard = {
  id: string
  name: string
  description: string | null
  icon: { iconId: string; color: string } | null
  visibility: DashboardVisibility
  /** Set ⇒ THE dashboard for an entity def — drives the "Primary entity" row + the org-visibility lock. */
  entityDefinitionId: string | null
}

const dashboardFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name must be less than 120 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters'),
  icon: z.object({ icon: z.string(), color: z.string() }),
  visibility: z.enum(['org', 'private']),
})

type DashboardFormValues = z.infer<typeof dashboardFormSchema>

/** Props for the shell-free dashboard create/edit form core. */
export interface DashboardFormProps {
  /** When present the form edits this dashboard; otherwise it creates a new one. */
  dashboard?: EditableDashboard
  /** Called after a successful save (for auto-select / list refresh hooks). */
  onSuccess?: (dashboard: { id: string }) => void
  /** Dismiss after a successful save (dialog closes; palette closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it to root. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it. */
  header?: (ctx: { title: string }) => ReactNode
}

export function DashboardForm({
  dashboard,
  onSuccess,
  onClose,
  onCancel,
  header,
}: DashboardFormProps) {
  const router = useRouter()
  const isEditing = !!dashboard
  const cancel = onCancel ?? onClose
  const { createDashboard, updateDashboard, isCreating, isUpdating } = useDashboardMutations()

  // "Primary entity" link (plan 02) — an immediate side-effect field (like the
  // widget config panel's data-source picker), decoupled from the name/
  // description/visibility submit below. Only meaningful in edit mode; create
  // mode's picker is a nice-to-have that's out of scope (README §create-dialog).
  const [entityDefinitionId, setEntityDefinitionId] = useState<string | null>(
    dashboard?.entityDefinitionId ?? null
  )
  const isLinked = isEditing && !!entityDefinitionId

  const form = useForm<DashboardFormValues>({
    resolver: standardSchemaResolver(dashboardFormSchema),
    defaultValues: {
      name: dashboard?.name ?? '',
      description: dashboard?.description ?? '',
      icon: {
        icon: dashboard?.icon?.iconId ?? DEFAULT_ICON.icon,
        color: dashboard?.icon?.color ?? DEFAULT_ICON.color,
      },
      visibility: dashboard?.visibility ?? 'org',
    },
  })

  const handleEntityChange = async (id: string | null) => {
    if (!dashboard) return
    if (await updateDashboard(dashboard.id, { entityDefinitionId: id })) {
      setEntityDefinitionId(id)
      if (id) form.setValue('visibility', 'org')
    }
  }

  const isPending = isCreating || isUpdating
  const icon = form.watch('icon')

  const onSubmit = async (data: DashboardFormValues) => {
    const payload = {
      name: data.name.trim(),
      description: data.description.trim() || null,
      icon: { iconId: data.icon.icon, color: data.icon.color },
      visibility: data.visibility,
    }
    if (dashboard) {
      if (await updateDashboard(dashboard.id, payload)) {
        onClose()
        onSuccess?.(dashboard)
      }
    } else {
      const created = await createDashboard(payload)
      if (created) {
        form.reset()
        onClose()
        onSuccess?.(created)
        router.push(`/app/dashboards/${created.id}`)
      }
    }
  }

  return (
    <>
      {header?.({ title: isEditing ? 'Dashboard settings' : 'New dashboard' })}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <div className='flex items-center gap-2'>
                  <IconPicker value={icon} onChange={(v) => form.setValue('icon', v)} modal={false}>
                    <button type='button' aria-label='Pick icon'>
                      <EntityIcon
                        iconId={icon.icon}
                        color={icon.color}
                        className='size-9! rounded-md border'
                      />
                    </button>
                  </IconPicker>
                  <FormControl>
                    <Input autoFocus placeholder='e.g. Support overview' {...field} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder='Optional' className='resize-none' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {isEditing && (
            <FormItem>
              <FormLabel>Primary entity</FormLabel>
              <ResourcePicker
                value={entityDefinitionId ? [entityDefinitionId] : []}
                onChange={(ids) => void handleEntityChange(ids[0] ?? null)}
                onSelectSingle={(id) => void handleEntityChange(id)}
                entityDefinedOnly
                disabled={isUpdating}
                emptyLabel='None — link an entity'
                triggerProps={{ showClear: true, className: 'w-full ps-0 pe-1' }}
              />
              <p className='text-xs text-muted-foreground'>
                Surfaces this dashboard on the entity's own route (e.g. Tickets → Dashboard) — at
                most one dashboard per entity.
              </p>
            </FormItem>
          )}

          <FormField
            control={form.control}
            name='visibility'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Visibility</FormLabel>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isLinked}
                  className='grid gap-2 sm:grid-cols-2'>
                  <RadioGroupItemCard
                    value='org'
                    label='Organization'
                    icon={<Globe />}
                    description='Everyone in the org can view and edit'
                  />
                  <RadioGroupItemCard
                    value='private'
                    label='Private'
                    icon={<Lock />}
                    description='Only you can see it'
                  />
                </RadioGroup>
                {isLinked && (
                  <p className='text-xs text-muted-foreground'>
                    Locked to Organization while linked to an entity.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <Button type='button' variant='ghost' size='sm' onClick={cancel} disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              type='submit'
              loading={isPending}
              loadingText={isEditing ? 'Saving...' : 'Creating...'}>
              {isEditing ? 'Save' : 'Create'} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
