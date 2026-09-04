// apps/web/src/components/accounting/ui/banking/import/bank-import-page.tsx

'use client'

// Accounting > Banking > Import (HANDOFF slot 3D, plans/accounting/ui-plan.md
// §2.9, plans/bank-connection/05-file-import.md).
//
// ## Why this screen exists at all
//
// Four reasons, and none of them goes away if the aggregator changes (05 §1):
// Stripe FC reaches back 180 days and a cutover is usually older; a customer
// reconciling a prior year cannot be served by any API; some institutions are
// not covered at all; and 🛑 this is the only ingest path a vendor cannot switch
// off. Teller shut its API down in July 2026 mid-plan, which is why that last
// one is not theoretical.
//
// ## The shape
//
// The account is chosen FIRST, on its own card, because "which account is this
// statement for?" is not something a bank writes in its own export and is not a
// column anything can be mapped to. Everything after the upload is the shared
// import wizard, unchanged, at `import/[jobId]`.

import { FieldType } from '@auxx/database/enums'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Landmark } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import SettingsPage from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BankImportBatches } from './bank-import-batches'
import { BankImportUploader } from './bank-import-uploader'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Import' },
]

const PAGE_DESCRIPTION =
  'Bring a bank statement in from a file. CSV, or OFX/QFX/QBO where the bank still offers it. A file and a live feed can cover the same weeks safely - lines already present are linked, not duplicated.'

/** The ledger is pinned to USD for the cutover, like every other accounting screen. */
const DISPLAY_CURRENCY = 'USD'

export function BankImportPage() {
  useRequireCapability(PermissionKey.ledgerView)

  // The chosen account rides the URL so it survives the hop into the wizard and
  // back, and so a coverage gap on the settings page can deep-link to it.
  const [accountId, setAccountId] = useQueryState('account')

  const accountsQuery = api.banking.bankAccount.list.useQuery()
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const selected = accounts.find((account) => account.id === accountId) ?? null

  const coverage = api.banking.bankAccount.coverage.useQuery(
    { id: accountId ?? '' },
    { enabled: !!accountId }
  )

  const options = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: [account.name ?? 'Bank account', account.last4 ? `···${account.last4}` : null]
          .filter(Boolean)
          .join(' '),
      })),
    [accounts]
  )

  if (!accountsQuery.isPending && accounts.length === 0) {
    return (
      <SettingsPage
        title='Import statements'
        description={PAGE_DESCRIPTION}
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Landmark}
          title='No bank account yet'
          description={
            <span>
              A statement has to belong to an account, and the account is what carries the GL
              mapping and the coverage record. Add one first.
            </span>
          }
          button={
            <Button asChild variant='outline'>
              <a href='/app/accounting/settings/bank-accounts'>Add a bank account</a>
            </Button>
          }
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Import statements'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}>
      <Section
        title='Account'
        description='Which account this statement is for. Every line in the file lands on it.'>
        <FieldPanel orientation='responsive' breakpoint='md' resizeId='bank-import' className='p-0'>
          <FieldPanelRow title='Bank account' type={BaseType.RELATION} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options }}
              value={accountId ?? ''}
              // ⚠️ `FieldInputAdapter` hands a SINGLE_SELECT change back as an
              // ARRAY of option keys, not a string - the same widget serves
              // multi-select. Writing it straight into the query param put
              // `?account=id` on the wire as an array and every read of it 400ed.
              onChange={(value) =>
                void setAccountId((Array.isArray(value) ? value[0] : value) || null)
              }
              placeholder='Select a bank account'
              disabled={accountsQuery.isPending}
            />
          </FieldPanelRow>
          {selected && (
            <FieldPanelRow title='Coverage' type={BaseType.STRING} showIcon>
              <p className='py-1.5 text-muted-foreground text-sm'>
                {coverage.isPending
                  ? 'Reading…'
                  : coverage.data?.coverageFrom
                    ? `Holds data from ${coverage.data.coverageFrom}. ${
                        coverage.data.gaps.length === 0
                          ? 'No gaps.'
                          : `${coverage.data.gaps.length} possible gap${
                              coverage.data.gaps.length === 1 ? '' : 's'
                            }: ${coverage.data.gaps
                              .slice(0, 3)
                              .map((gap) => `${gap.from} → ${gap.to}`)
                              .join(', ')}.`
                      }`
                    : 'This account holds no transactions yet, so a statement will set its coverage floor.'}
              </p>
            </FieldPanelRow>
          )}
        </FieldPanel>
      </Section>

      <Section
        title='Statement file'
        description='Drop the export your bank gave you. OFX, QFX and QBO carry a transaction id, so there is nothing to map and a re-import cannot duplicate.'>
        {selected ? (
          <BankImportUploader
            bankAccountId={selected.id}
            accountType={selected.type}
            accountLast4={selected.last4}
            currencyCode={selected.currency ?? DISPLAY_CURRENCY}
          />
        ) : (
          <p className='text-muted-foreground text-sm'>Pick an account above first.</p>
        )}
      </Section>

      <BankImportBatches
        bankAccountId={selected?.id ?? null}
        currencyCode={selected?.currency ?? DISPLAY_CURRENCY}
      />
    </SettingsPage>
  )
}
