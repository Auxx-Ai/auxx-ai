// apps/web/src/app/(protected)/app/accounting/banking/import/page.tsx

import { BankImportPage } from '~/components/accounting/ui/banking/import/bank-import-page'

/**
 * Accounting > Banking > Import (HANDOFF slot 3D).
 *
 * The landing surface: pick the account, drop the file, and see what has already
 * been imported. Unlike every other importer's `/import` route this is NOT a
 * redirect into `/new` - the account has to be chosen before there is anything
 * to upload, and it is not a column any file can supply.
 *
 * It is also the target of the "Import statements for this range" link on a
 * coverage gap in Accounting > Settings > Bank accounts.
 */
export default function AccountingBankingImportPage() {
  return <BankImportPage />
}
