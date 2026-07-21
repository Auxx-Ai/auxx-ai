// apps/web/src/components/dispatch/ui/setup-wizard/wizard-address-page.tsx
'use client'

import { forwardRef, useImperativeHandle } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import {
  BusinessAddressFields,
  normalizeAddress,
} from '~/components/money/ui/settings/business-address-fields'
import { useSettings } from '~/hooks/use-settings'
import type { WizardStepHandle } from './wizard-step-handle'

/**
 * Page 3 of `DispatchSetupWizard` — the `documents.business.address` fields, reusing the shared
 * {@link BusinessAddressFields} block extracted from the Documents settings page so both write
 * the identical `AddressStruct` shape into the same `documents.business` org setting (the same
 * value the Documents page displays and the route planner reads as its depot).
 *
 * Edits are held in a local draft and written once via `tryAdvance` when the shell navigates
 * away (any direction) — one `updateOrganizationSetting` call per page-leave instead of one per
 * keystroke, matching the Documents page's batched-save behavior. Address fields are free-form
 * text, so a dirty draft always saves and navigation is never blocked.
 */
export const WizardAddressPage = forwardRef<WizardStepHandle>(
  function WizardAddressPage(_props, ref) {
    const { getSetting, updateOrganizationSetting } = useSettings({})

    const rawBusiness = getSetting('documents.business')
    const business = (rawBusiness && typeof rawBusiness === 'object' ? rawBusiness : {}) as Record<
      string,
      unknown
    >
    const server = normalizeAddress(business.address)

    const { draft, setDraft, dirty, save } = useDirtyDraft(server, {
      onSave: (next) =>
        updateOrganizationSetting('documents.business', { ...business, address: next }),
    })

    useImperativeHandle(ref, () => ({
      tryAdvance: () => {
        if (dirty) save()
        return true
      },
    }))

    return (
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-muted-foreground text-sm'>
          Used as the depot for route planning, and printed on every quote and invoice.
        </p>
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='dispatch-wizard-address'
          defaultLabelWidth={140}
          className='p-0'>
          <BusinessAddressFields value={draft} onChange={setDraft} />
        </FieldPanel>
      </div>
    )
  }
)
