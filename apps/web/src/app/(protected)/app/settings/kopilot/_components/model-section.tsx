// apps/web/src/app/(protected)/app/settings/kopilot/_components/model-section.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import { AiModelPicker } from '~/components/pickers/ai-model-picker'
import { useSettings } from '~/hooks/use-settings'

/**
 * Master Kopilot model pin. Stores the picker's `provider:model` id;
 * `null` means "use system default". Per-turn / per-session picks
 * override this; system default is the floor.
 */
export function ModelSection() {
  const { getSetting, updateOrganizationSetting, isUpdatingOrgSetting } = useSettings({
    scope: 'KOPILOT',
  })

  const modelId = getSetting('kopilot.modelId') as string | null

  return (
    <section className='space-y-3'>
      <div className='space-y-1'>
        <h2 className='text-base font-semibold tracking-tight text-foreground'>Model</h2>
        <p className='text-sm text-muted-foreground'>
          Default model for Kopilot. Per-session and per-turn picks override this. Leave unset to
          use the system default.
        </p>
      </div>
      <div className='flex items-center gap-2'>
        <AiModelPicker
          value={modelId}
          onChange={(model) =>
            updateOrganizationSetting('kopilot.modelId', model?.id ?? null, false)
          }
          modelTypes={[ModelType.LLM]}
          isUpdating={isUpdatingOrgSetting}
          triggerClassName='max-w-sm'
          skipDeprecated
        />
        {modelId && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => updateOrganizationSetting('kopilot.modelId', null, false)}
            disabled={isUpdatingOrgSetting}
            aria-label='Reset to system default'>
            <X />
          </Button>
        )}
      </div>
    </section>
  )
}
