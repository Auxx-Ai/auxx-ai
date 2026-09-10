// apps/web/src/components/accounting/ui/banking/review/analyze-panel.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { parseBankDescriptor } from '@auxx/lib/banking/client'
import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import {
  BANK_RULE_MATCH_FIELDS,
  BANK_RULE_MATCH_OPERATORS,
  type BankRuleMatchField,
  type BankRuleMatchOperator,
  isSafeRegexPattern,
} from '@auxx/lib/banking/rules/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SearchX, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { useChartAccounts } from '../../gl-account-picker'
import { EMPTY_CELL, formatSignedMinor } from '../../ledger/format'
import { BankRuleDialog } from '../rules/bank-rule-dialog'
import {
  firstValue,
  MATCH_FIELD_OPTIONS,
  MATCH_OPERATOR_OPTIONS,
  TRIGGER_PROPS,
} from '../rules/bank-rule-options'

interface AnalyzePanelProps {
  line: BankTransactionRow
  currencyCode: string
}

/**
 * Take one bank line apart, and find every other line like it.
 *
 * Stripe Financial Connections ships a `description` and nothing else - no
 * merchant name, no category - so what a line IS has to be read off its own
 * text. Most of that text is structure: `SHOPIFY DES:TRANSFER
 * ID:ST-F1K0R8X3L3D5 CO ID:SHOPIFYPMT WEB` is an originator, an entry
 * description, a per-payment reference and an ACH entry class, and only one of
 * those four is worth matching on.
 *
 * 🛑 **The bank's own line is never edited, hidden or replaced.** It is shown
 * verbatim at the top and the parts below are a reading of it, not a
 * replacement for it. `matchKey` appears as a part too, so a reviewer can see
 * what grouping actually has to work with.
 *
 * ⚠️ What this builds is a `bank_rule`'s matching half exactly - the same
 * field, the same four operators, the same value, drawn from the same
 * `bank-rule-options` vocabularies the rule dialog uses. So the count shown
 * here is the count the rule will act on, and Create rule opens the real dialog
 * seeded rather than a second form that could drift from it.
 */
export function AnalyzePanel({ line, currencyCode }: AnalyzePanelProps) {
  const parsed = useMemo(() => parseBankDescriptor(line.description), [line.description])
  const { accounts } = useChartAccounts()

  const [matchField, setMatchField] = useState<BankRuleMatchField>('description')
  const [matchOperator, setMatchOperator] = useState<BankRuleMatchOperator>('contains')
  const [matchValue, setMatchValue] = useState('')
  const [ruleOpen, setRuleOpen] = useState(false)

  /**
   * The opening pattern: the most identifying part of the line.
   *
   * An ACH originator id (`CO ID`) is the bank's own stable identifier for who
   * sent the money, and it survives every per-payment reference printed around
   * it. Failing that the originator's printed name, and failing that the match
   * key - never the raw line, which contains the reference that makes it
   * unique and would open on a pattern matching exactly one row.
   */
  useEffect(() => {
    const originator = parsed.tags.find(
      (tag) => tag.label === 'CO ID' || tag.label === 'ORIG ID'
    )?.value
    const opening = originator || parsed.lead
    setMatchField(opening ? 'description' : 'matchKey')
    setMatchOperator('contains')
    setMatchValue(opening || line.matchKey || '')
  }, [parsed, line.matchKey])

  // The preview is a person typing, so it waits for them to stop.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(matchValue), 250)
    return () => clearTimeout(timer)
  }, [matchValue])

  const regexRefused =
    matchOperator === 'regex' && !!debounced.trim() && !isSafeRegexPattern(debounced)
  const canPreview = !!debounced.trim() && !regexRefused

  const preview = api.bankingRules.previewPattern.useQuery(
    { matchField, matchOperator, matchValue: debounced },
    { enabled: canPreview }
  )

  const accountLabel = (glAccountId: string) => {
    const account = accounts.find((item) => item.id === glAccountId)
    return account ? `${account.code} ${account.name}` : glAccountId
  }

  const searchFor = (value: string, field: BankRuleMatchField) => {
    setMatchField(field)
    setMatchOperator('contains')
    setMatchValue(value)
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* The bank's line, verbatim. Everything below is a reading of it, and
          this is what any of it can be checked against. */}
      <p className='break-words rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed'>
        {line.description || EMPTY_CELL}
      </p>

      <div className='flex flex-col gap-1.5'>
        <span className='text-muted-foreground text-xs'>
          Click a part to search for it. Faded parts change on every payment.
        </span>
        <div className='flex flex-wrap gap-1'>
          {parsed.lead && (
            <LinePart
              label='Payee'
              value={parsed.lead}
              onClick={() => searchFor(parsed.lead, 'description')}
            />
          )}
          {parsed.tags.map((tag, index) => (
            <LinePart
              // Duplicate labels are real: a wire carries two `ID:` tags, one
              // for the beneficiary and one for their bank.
              key={`${tag.label}-${index}`}
              label={tag.label}
              value={tag.value}
              varies={tag.isReference}
              onClick={() => searchFor(tag.value, 'description')}
            />
          ))}
          {parsed.sec && <LinePart label='ACH class' value={parsed.sec} />}
          {line.matchKey && (
            <LinePart
              label='Match key'
              value={line.matchKey}
              onClick={() => searchFor(line.matchKey ?? '', 'matchKey')}
            />
          )}
        </div>
      </div>

      <FieldPanel className='p-0' breakpoint='md' resizeId='bank-analyze'>
        <FieldPanelRow
          title='Search in'
          type={BaseType.STRING}
          showIcon
          description='The match key is the description with dates, reference numbers and card digits stripped out.'>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: MATCH_FIELD_OPTIONS }}
            triggerProps={TRIGGER_PROPS}
            value={matchField}
            onChange={(value) => {
              const next = firstValue(value)
              if (BANK_RULE_MATCH_FIELDS.includes(next as BankRuleMatchField)) {
                setMatchField(next as BankRuleMatchField)
              }
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Operator' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: MATCH_OPERATOR_OPTIONS }}
            triggerProps={TRIGGER_PROPS}
            value={matchOperator}
            onChange={(value) => {
              const next = firstValue(value)
              if (BANK_RULE_MATCH_OPERATORS.includes(next as BankRuleMatchOperator)) {
                setMatchOperator(next as BankRuleMatchOperator)
              }
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Pattern'
          type={BaseType.STRING}
          showIcon
          isLastRow
          // `isSafeRegexPattern` is the guard the rule writer applies, so a
          // pattern refused here is refused at create time too. Said now,
          // rather than after the person has chosen an action for it.
          validationError={
            regexRefused
              ? 'Over 200 characters, or a quantifier nested inside a quantified group. Refused before it can run against a live feed.'
              : undefined
          }>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={matchValue}
            placeholder='SHOPIFYPMT'
            onChange={(value) => setMatchValue(String(value ?? ''))}
          />
        </FieldPanelRow>
      </FieldPanel>

      {canPreview &&
        (preview.isPending ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-2/3' />
          </div>
        ) : preview.data?.matchCount === 0 ? (
          <EmptySection
            icon={<SearchX className='size-5' />}
            title='No lines match'
            description='Try a shorter pattern, or a part of the line that does not change between payments.'
          />
        ) : preview.data ? (
          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center gap-1.5'>
              <span className='font-medium text-sm'>
                {preview.data.matchCount} {preview.data.matchCount === 1 ? 'line' : 'lines'}
              </span>
              {/* The rule-mining signal: a pattern whose matches are already
                  coded the same way is a rule somebody has been writing by
                  hand, one line at a time. */}
              {preview.data.codedByAccount.length === 0 ? (
                <span className='text-muted-foreground text-xs'>none coded yet</span>
              ) : (
                preview.data.codedByAccount.slice(0, 3).map((entry) => (
                  <Badge key={entry.glAccountId} variant='teal' size='xs'>
                    {entry.count} × {accountLabel(entry.glAccountId)}
                  </Badge>
                ))
              )}
              {preview.data.truncated && (
                <Badge variant='amber' size='xs'>
                  first 5,000 lines only
                </Badge>
              )}
            </div>

            <ol className='flex flex-col gap-0'>
              {preview.data.sample.map((row) => (
                <li
                  key={row.id}
                  className={`flex items-baseline gap-3 border-border border-l py-1 ps-4 text-xs ${
                    row.id === line.id ? 'font-medium' : 'text-muted-foreground'
                  }`}>
                  <span className='w-[5.5rem] shrink-0 tabular-nums'>
                    {row.postedAt ?? EMPTY_CELL}
                  </span>
                  <span className='w-[6rem] shrink-0 text-right tabular-nums'>
                    {formatSignedMinor(row.amountMinor, currencyCode)}
                  </span>
                  <span className='truncate font-mono text-[11px]'>{row.description}</span>
                </li>
              ))}
            </ol>

            <Button variant='outline' size='sm' className='w-fit' onClick={() => setRuleOpen(true)}>
              <Wand2 />
              Create rule from this pattern
            </Button>
          </div>
        ) : null)}

      <BankRuleDialog
        open={ruleOpen}
        onClose={() => setRuleOpen(false)}
        seed={{ name: parsed.lead || line.matchKey || '', matchField, matchOperator, matchValue }}
      />
    </div>
  )
}

/**
 * One part of the bank's line, as a clickable token.
 *
 * ⚠️ `varies` is not decoration. A reviewer who builds a pattern out of a trace
 * number gets a rule that matches exactly one line forever, and the fading is
 * the only warning before the preview says "1 line".
 */
function LinePart({
  label,
  value,
  varies,
  onClick,
}: {
  label: string
  value: string
  varies?: boolean
  onClick?: () => void
}) {
  if (!value) return null
  const badge = (
    <Badge variant='outline' size='sm' className={varies ? 'opacity-50' : undefined}>
      <span className='uppercase opacity-60'>{label}</span>
      <span className='font-mono'>{value}</span>
    </Badge>
  )
  if (!onClick) return badge
  return (
    <button type='button' onClick={onClick} className='rounded-md hover:opacity-80'>
      {badge}
    </button>
  )
}
