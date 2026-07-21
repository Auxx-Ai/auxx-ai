// apps/web/src/components/dispatch/ui/worker-profile-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { AddressStruct } from '~/components/fields/inputs/address-struct-input-field'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ColorTagPicker } from '~/components/tags/ui/color-tag-picker'
import { BaseType } from '~/components/workflow/types'
import type { WorkerProfileDraftApi } from '../hooks/use-worker-profile-draft'

interface WorkerProfilePageProps {
  profile: WorkerProfileDraftApi
}

/**
 * Profile page fields (07-m2-build.md §E.1): board color, home-base address, active toggle,
 * start/end-at-home route switches (v4/01-planner-polish.md Phase 3). Purely presentational —
 * the draft, mutations, and the footer Save/Remove wiring live in `useWorkerProfileDraft` at
 * the dialog level so edits survive `DialogNavPages` unmounting this page on a tab switch.
 */
export function WorkerProfilePage({ profile }: WorkerProfilePageProps) {
  const { draft, patch, isSaving } = profile

  return (
    <div className='flex flex-col gap-4 p-4'>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='worker-profile'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Board color' type={BaseType.ENUM} showIcon>
          <div className='py-2'>
            <ColorTagPicker
              value={draft.color}
              onChange={(color) => patch({ color })}
              disabled={isSaving}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Home base'
          type={BaseType.STRING}
          showIcon
          description='Used for routing on the live map (M3).'>
          <div className='py-2'>
            <FieldInputAdapter
              fieldType={FieldType.ADDRESS_STRUCT}
              value={draft.homeBase}
              onChange={(homeBase) => patch({ homeBase: homeBase as AddressStruct })}
              disabled={isSaving}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Active'
          type={BaseType.BOOLEAN}
          showIcon
          description='Inactive workers are hidden from the board.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.isActive}
            onChange={(isActive) => patch({ isActive: isActive as boolean })}
            disabled={isSaving}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Start at home'
          type={BaseType.BOOLEAN}
          showIcon
          description='Route begins at the business address.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.routeStartAtHome}
            onChange={(routeStartAtHome) =>
              patch({ routeStartAtHome: routeStartAtHome as boolean })
            }
            disabled={isSaving}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='End at home'
          type={BaseType.BOOLEAN}
          showIcon
          description='Route ends at the business address.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.routeEndAtHome}
            onChange={(routeEndAtHome) => patch({ routeEndAtHome: routeEndAtHome as boolean })}
            disabled={isSaving}
          />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}
