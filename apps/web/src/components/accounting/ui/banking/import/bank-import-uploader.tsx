// apps/web/src/components/accounting/ui/banking/import/bank-import-uploader.tsx

'use client'

// The upload card of Accounting > Banking > Import (HANDOFF slot 3D,
// plans/bank-connection/05-file-import.md §§4-5).
//
// ⚠️ **A bank-specific uploader, not a hook into `StepUpload`.** The generic
// upload step parses CSV and nothing else, and the two things this one adds -
// detecting OFX by content, and applying a mapping the user never has to answer
// for - are decisions about a FORMAT and a TARGET DEF that the shared step has
// no business knowing. The wizard is entered at the step AFTER upload, so
// everything downstream (mapping, review, plan, execute) is the shared code
// unchanged.

import { isOfxContent } from '@auxx/lib/import/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { toastError } from '@auxx/ui/components/toast'
import { formatBytes } from '@auxx/utils/file'
import { AlertCircle, Columns, Rows3, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useChunkedUpload } from '~/components/data-import/hooks/use-chunked-upload'
import type { ColumnHeader } from '~/components/data-import/types'
import { parseCSV } from '~/components/data-import/utils/parse-csv'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { api } from '~/trpc/react'
import { formatMinor } from '../../ledger/format'
import { type BankColumnMapping, OFX_COLUMN_MAPPING, orderedForApply } from './bank-import-mapping'

/** The def every statement row lands on. */
const BANK_TRANSACTION_DEF = 'bank_transaction'

const IMPORT_BASE_PATH = '/app/accounting/banking/import'

/** Statement formats worth offering. `.txt` is what a renamed OFX arrives as. */
const ACCEPTED = ['.csv', '.ofx', '.qfx', '.qbo', '.txt']

/** 4MB, matching the router's `MAX_OFX_BYTES` - the text crosses the wire. */
const MAX_OFX_BYTES = 4_000_000

interface ParsedFile {
  fileName: string
  fileSize: number
  headers: ColumnHeader[]
  rows: string[][]
  /** The fixed OFX mapping, or a remembered one, or null when the user must map. */
  mapping: BankColumnMapping[] | null
  /** Why the mapping step can be skipped, for the card to say so. */
  mappingSource: 'ofx' | 'remembered' | null
  ofx: OfxSummary | null
}

interface OfxSummary {
  form: string
  accountId: string | null
  last4: string | null
  accountType: string | null
  kind: 'bank' | 'creditcard'
  currency: string | null
  ledgerBalanceMinor: number | null
  ledgerBalanceAsOf: string | null
  duplicateFitIds: string[]
  hasFitIds: boolean
}

interface BankImportUploaderProps {
  bankAccountId: string
  /** The chosen account's own type and tail, for the two mismatch warnings. */
  accountType: 'depository' | 'credit'
  accountLast4: string | null
  currencyCode: string
}

export function BankImportUploader({
  bankAccountId,
  accountType,
  accountLast4,
  currencyCode,
}: BankImportUploaderProps) {
  const router = useRouter()
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)

  const parseFile = api.banking.bankingImport.parseFile.useMutation()
  const utils = api.useUtils()
  const saveColumnMapping = api.dataImport.saveColumnMapping.useMutation()

  const { upload, progress, reset } = useChunkedUpload({
    onError: (error) => setParseError(error.message),
  })

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      setParseError(null)
      setParsed(null)

      try {
        const text = await file.text()

        if (isOfxContent(text)) {
          if (text.length > MAX_OFX_BYTES) {
            setParseError(
              `This statement is ${formatBytes(file.size)}, which is larger than the 4MB an OFX ` +
                'file may be. Export a shorter date range.'
            )
            return
          }
          // The SERVER parses, even though the same function is right here: one
          // authority for what a file says, and one place its refusals come from.
          const doc = await parseFile.mutateAsync({ fileName: file.name, content: text })
          if (!doc.isOfx) {
            setParseError('This file looked like OFX but could not be read as one.')
            return
          }
          setParsed({
            fileName: file.name,
            fileSize: file.size,
            headers: doc.headers,
            rows: doc.rows,
            mapping: doc.hasFitIds ? OFX_COLUMN_MAPPING : null,
            mappingSource: doc.hasFitIds ? 'ofx' : null,
            ofx: {
              form: doc.form,
              accountId: doc.account?.accountId ?? null,
              last4: doc.account?.last4 ?? null,
              accountType: doc.account?.accountType ?? null,
              kind: doc.account?.kind ?? 'bank',
              currency: doc.currency,
              ledgerBalanceMinor: doc.ledgerBalance?.amountMinor ?? null,
              ledgerBalanceAsOf: doc.ledgerBalance?.asOf ?? null,
              duplicateFitIds: doc.duplicateFitIds,
              hasFitIds: doc.hasFitIds,
            },
          })
          return
        }

        const csv = await parseCSV(file)
        const remembered = await utils.banking.bankingImport.savedMapping.fetch({
          headers: csv.headers.map((header) => header.name),
        })
        setParsed({
          fileName: file.name,
          fileSize: file.size,
          headers: csv.headers,
          rows: csv.rows,
          mapping: remembered?.columns ?? null,
          mappingSource: remembered ? 'remembered' : null,
          ofx: null,
        })
      } catch (error) {
        setParseError(
          error instanceof Error ? error.message : 'This file could not be read as a statement.'
        )
      }
    },
    [parseFile, utils]
  )

  const handleStart = async () => {
    if (!parsed) return
    setIsPreparing(true)
    try {
      const jobId = await upload({
        entityDefinitionId: BANK_TRANSACTION_DEF,
        fileName: parsed.fileName,
        headers: parsed.headers,
        rows: parsed.rows,
      })

      // Skips first: `finalizeUpload` has already run a fallback auto-map, and
      // two columns pointed at one field is a refusal by name.
      if (parsed.mapping) {
        // 🛑 **`customFieldId` is not optional on a custom-entity def.** Every
        // `bank_transaction` field is a `CustomField` row, and `buildRecordData`
        // resolves a mapped column through that id - a mapping saved with a
        // `targetFieldKey` and a null id imports six rows carrying nothing but
        // their defaults, with no error anywhere. (It did, on the first drive.)
        const fields = await utils.dataImport.getImportableFields.fetch({
          entityDefinitionId: BANK_TRANSACTION_DEF,
          includeIdentifiers: true,
        })
        const idByKey = new Map(fields.map((field) => [field.key, field.id ?? null]))

        for (const column of orderedForApply(parsed.mapping)) {
          await saveColumnMapping.mutateAsync({
            jobId,
            columnIndex: column.columnIndex,
            targetFieldKey: column.targetFieldKey,
            customFieldId: column.targetFieldKey
              ? (idByKey.get(column.targetFieldKey) ?? null)
              : null,
            resolutionType: column.resolutionType,
            identityRole: column.isIdentifier ? { kind: 'match' } : null,
          })
        }
      }

      // With a mapping already applied there is nothing to ask on the mapping
      // step, so the wizard opens on the value review instead.
      const step = parsed.mapping ? 'review-values' : 'map-columns'
      router.push(
        `${IMPORT_BASE_PATH}/${jobId}?step=${step}&account=${encodeURIComponent(bankAccountId)}`
      )
    } catch (error) {
      toastError({
        title: 'The statement could not be uploaded',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
      setIsPreparing(false)
    }
  }

  const handleReset = () => {
    setParsed(null)
    setParseError(null)
    setIsPreparing(false)
    reset()
  }

  const dates = parsed ? fileDateRange(parsed) : null
  const busy = isPreparing || progress.phase === 'uploading'

  const last4Mismatch =
    parsed?.ofx?.last4 && accountLast4 && parsed.ofx.last4 !== accountLast4
      ? `This statement is for an account ending ${parsed.ofx.last4}, and you picked one ending ${accountLast4}.`
      : null
  const kindMismatch =
    parsed?.ofx && (parsed.ofx.kind === 'creditcard') !== (accountType === 'credit')
      ? parsed.ofx.kind === 'creditcard'
        ? 'This is a credit card statement and the account you picked is a depository account. A card is a liability and its signs are the reverse of a chequing account.'
        : 'This is a bank statement and the account you picked is a credit card.'
      : null

  return (
    <div className='flex flex-col gap-3'>
      {!parsed && (
        <FileSelectDropZone
          onFilesSelected={handleFilesSelected}
          onBrowseExisting={() => {}}
          dragActive={dragActive}
          onDragActiveChange={setDragActive}
          maxFiles={1}
          fileExtensions={ACCEPTED}
          placeholder='Drop a statement here - CSV, OFX, QFX or QBO'
          showFilePicker={false}
          className='min-h-[180px]'
        />
      )}

      {parseError && (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {parsed && (
        <div className='overflow-hidden rounded-2xl border'>
          <div className='flex items-center justify-between border-b p-4'>
            <div className='flex min-w-0 items-center gap-3'>
              <EntityIcon iconId='file-spreadsheet' variant='muted' />
              <div className='min-w-0'>
                <p className='truncate font-medium text-sm'>{parsed.fileName}</p>
                <p className='text-muted-foreground text-sm'>
                  {parsed.ofx ? `OFX (${parsed.ofx.form})` : 'CSV'} • {formatBytes(parsed.fileSize)}
                </p>
              </div>
            </div>
            <Button
              variant='destructive-hover'
              size='icon-sm'
              onClick={handleReset}
              disabled={busy}>
              <Trash2 />
            </Button>
          </div>

          <div className='grid grid-cols-2 divide-x'>
            <Stat
              icon={<Rows3 className='size-4' />}
              label='Transactions'
              value={parsed.rows.length}
            />
            <Stat
              icon={<Columns className='size-4' />}
              label='Columns'
              value={parsed.headers.length}
            />
          </div>

          <div className='flex flex-col gap-2 border-t p-4 text-sm'>
            {dates && (
              <p>
                Covers <span className='font-medium'>{dates.from}</span> to{' '}
                <span className='font-medium'>{dates.to}</span>.
              </p>
            )}
            {parsed.mappingSource === 'ofx' && (
              <p className='text-muted-foreground'>
                Every row carries a bank transaction id, so there is nothing to map. Re-importing
                this file will update these rows rather than duplicate them.
              </p>
            )}
            {parsed.mappingSource === 'remembered' && (
              <p className='text-muted-foreground'>
                Using the column mapping you saved for this export. You can still change it on the
                next step.
              </p>
            )}
            {parsed.ofx?.ledgerBalanceMinor != null && (
              <p className='text-muted-foreground'>
                Statement balance {formatMinor(parsed.ofx.ledgerBalanceMinor, currencyCode)}
                {parsed.ofx.ledgerBalanceAsOf ? ` as of ${parsed.ofx.ledgerBalanceAsOf}` : ''}.
              </p>
            )}
            {parsed.ofx?.accountId && (
              <div className='flex flex-wrap items-center gap-1.5'>
                <Badge variant='outline' size='xs'>
                  {parsed.ofx.kind === 'creditcard' ? 'Credit card' : 'Bank'}
                </Badge>
                {parsed.ofx.accountType && (
                  <Badge variant='outline' size='xs'>
                    {parsed.ofx.accountType}
                  </Badge>
                )}
                <span className='text-muted-foreground text-xs'>
                  Account ending {parsed.ofx.last4 ?? '----'}
                </span>
              </div>
            )}
          </div>

          {(last4Mismatch || kindMismatch || (parsed.ofx?.duplicateFitIds.length ?? 0) > 0) && (
            <div className='flex flex-col gap-2 border-t p-4'>
              {last4Mismatch && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertDescription>{last4Mismatch}</AlertDescription>
                </Alert>
              )}
              {kindMismatch && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertDescription>{kindMismatch}</AlertDescription>
                </Alert>
              )}
              {parsed.ofx && parsed.ofx.duplicateFitIds.length > 0 && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertDescription>
                    This file reuses {parsed.ofx.duplicateFitIds.length} transaction id
                    {parsed.ofx.duplicateFitIds.length === 1 ? '' : 's'} (
                    {parsed.ofx.duplicateFitIds.slice(0, 3).join(', ')}
                    {parsed.ofx.duplicateFitIds.length > 3 ? ', …' : ''}). The later row will
                    overwrite the earlier one. Check those lines against the statement before
                    importing.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <div className='border-t bg-muted/30 p-4'>
            <Button
              onClick={handleStart}
              loading={busy}
              loadingText={
                progress.totalChunks > 1
                  ? `Uploading ${progress.chunksUploaded} of ${progress.totalChunks}`
                  : 'Uploading'
              }
              className='w-full'>
              Upload and continue
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className='p-4 text-center'>
      <div className='mb-1 flex items-center justify-center gap-2 text-muted-foreground'>
        {icon}
        <span className='font-medium text-xs'>{label}</span>
      </div>
      <p className='font-bold text-2xl'>{value.toLocaleString()}</p>
    </div>
  )
}

/**
 * The file's date range, read from whichever column the mapping says is the
 * date, or `null` when nothing says.
 *
 * ⚠️ A best-effort preview only. The authoritative range is the one
 * `bankingImport.coverageEffect` computes on the confirm step through the SAME
 * resolvers the executor uses; this one exists so a person can see they picked
 * the wrong month before uploading anything.
 */
function fileDateRange(parsed: ParsedFile): { from: string; to: string } | null {
  const dateColumn = parsed.mapping?.find((column) => column.targetFieldKey === 'postedAt')
  if (!dateColumn) return null
  const keys = parsed.rows
    .map((row) => row[dateColumn.columnIndex]?.trim() ?? '')
    .filter((value) => /^\d{4}-\d{2}-\d{2}/.test(value))
    .map((value) => value.slice(0, 10))
    .sort()
  const from = keys[0]
  const to = keys[keys.length - 1]
  return from && to ? { from, to } : null
}
