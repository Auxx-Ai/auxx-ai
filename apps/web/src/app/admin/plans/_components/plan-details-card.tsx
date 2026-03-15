// apps/web/src/app/admin/plans/_components/plan-details-card.tsx
/**
 * Consolidated plan details card — all plan fields in a single table-row layout.
 */
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Switch } from '@auxx/ui/components/switch'
import { Table, TableBody, TableCell, TableRow } from '@auxx/ui/components/table'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Calendar,
  CreditCard,
  Crown,
  DollarSign,
  FileText,
  Hash,
  ShieldCheck,
  Star,
  Type,
  Users,
} from 'lucide-react'
import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { PlanFormData } from './plan-form-types'
import { StripeSync } from './stripe-sync'

interface PlanDetailsCardProps {
  register: UseFormRegister<PlanFormData>
  errors: FieldErrors<PlanFormData>
  watch: UseFormWatch<PlanFormData>
  setValue: UseFormSetValue<PlanFormData>
  plan?: any
}

const ROW = '*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'
const LABEL = 'bg-muted/50 py-2 font-medium'

export function PlanDetailsCard({ register, errors, watch, setValue, plan }: PlanDetailsCardProps) {
  const watchIsFree = watch('isFree')
  const watchIsCustomPricing = watch('isCustomPricing')
  const watchHasTrial = watch('hasTrial')
  const isEditMode = !!plan

  return (
    <Card className='border-none rounded-none shadow-none'>
      <CardHeader>
        <CardTitle>Plan Details</CardTitle>
        <CardDescription>Plan information, pricing, and display options</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-hidden rounded-md border bg-background'>
          <Table>
            <TableBody>
              {/* ── Basic Information ── */}
              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Type className='size-3.5 text-muted-foreground' />
                    Name
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <Input
                    {...register('name', { required: 'Plan name is required' })}
                    placeholder='e.g. Starter, Growth, Enterprise'
                    className='h-8 text-sm'
                  />
                  {errors.name && (
                    <p className='text-xs text-destructive mt-1'>{errors.name.message}</p>
                  )}
                </TableCell>
              </TableRow>

              <TableRow className={ROW}>
                <TableCell className={`${LABEL} align-top`}>
                  <div className='flex items-center gap-1'>
                    <FileText className='size-3.5 text-muted-foreground' />
                    Description
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <Textarea
                    {...register('description', { required: 'Description is required' })}
                    placeholder='Brief description of this plan'
                    rows={2}
                    className='text-sm'
                  />
                  {errors.description && (
                    <p className='text-xs text-destructive mt-1'>{errors.description.message}</p>
                  )}
                </TableCell>
              </TableRow>

              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Hash className='size-3.5 text-muted-foreground' />
                    Hierarchy Level
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      size='sm'
                      {...register('hierarchyLevel', { valueAsNumber: true })}
                      placeholder='0'
                      className='w-20'
                    />
                    <span className='text-xs text-muted-foreground'>
                      0 = Free, 1 = Starter, 2 = Growth, 3 = Enterprise
                    </span>
                  </div>
                </TableCell>
              </TableRow>

              {/* ── Pricing ── */}
              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Crown className='size-3.5 text-muted-foreground' />
                    Free Plan
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <Switch
                    size='sm'
                    checked={watchIsFree}
                    onCheckedChange={(checked) =>
                      setValue('isFree', checked, { shouldDirty: true })
                    }
                  />
                </TableCell>
              </TableRow>

              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <CreditCard className='size-3.5 text-muted-foreground' />
                    Custom Pricing
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <Switch
                    size='sm'
                    checked={watchIsCustomPricing}
                    onCheckedChange={(checked) =>
                      setValue('isCustomPricing', checked, { shouldDirty: true })
                    }
                  />
                </TableCell>
              </TableRow>

              {!watchIsCustomPricing && !watchIsFree && (
                <>
                  <TableRow className={ROW}>
                    <TableCell className={LABEL}>
                      <div className='flex items-center gap-1'>
                        <DollarSign className='size-3.5 text-muted-foreground' />
                        Monthly Price
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      <div className='flex items-center gap-1'>
                        <span className='text-sm text-muted-foreground'>$</span>
                        <Input
                          type='number'
                          step='0.01'
                          {...register('monthlyPrice', { valueAsNumber: true })}
                          placeholder='0.00'
                          className='h-8 text-sm w-28'
                        />
                      </div>
                    </TableCell>
                  </TableRow>

                  <TableRow className={ROW}>
                    <TableCell className={LABEL}>
                      <div className='flex items-center gap-1'>
                        <DollarSign className='size-3.5 text-muted-foreground' />
                        Annual Price
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      <div className='flex items-center gap-1'>
                        <span className='text-sm text-muted-foreground'>$</span>
                        <Input
                          type='number'
                          step='0.01'
                          {...register('annualPrice', { valueAsNumber: true })}
                          placeholder='0.00'
                          className='h-8 text-sm w-28'
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                </>
              )}

              {/* ── Trial ── */}
              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Calendar className='size-3.5 text-muted-foreground' />
                    Trial Period
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <div className='flex items-center gap-3'>
                    <Switch
                      size='sm'
                      checked={watchHasTrial}
                      onCheckedChange={(checked) =>
                        setValue('hasTrial', checked, { shouldDirty: true })
                      }
                    />
                    {watchHasTrial && (
                      <div className='flex items-center gap-1'>
                        <Input
                          type='number'
                          {...register('trialDays', { valueAsNumber: true })}
                          placeholder='14'
                          className='h-8 text-sm w-20'
                        />
                        <span className='text-xs text-muted-foreground'>days</span>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {/* ── Display & Seats ── */}
              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <ShieldCheck className='size-3.5 text-muted-foreground' />
                    Self-Service
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <div className='flex items-center gap-2'>
                    <Switch
                      size='sm'
                      checked={watch('selfServed')}
                      onCheckedChange={(checked) =>
                        setValue('selfServed', checked, { shouldDirty: true })
                      }
                    />
                    <span className='text-xs text-muted-foreground'>
                      Users can subscribe directly
                    </span>
                  </div>
                </TableCell>
              </TableRow>

              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Star className='size-3.5 text-muted-foreground' />
                    Most Popular
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <Switch
                    size='sm'
                    checked={watch('isMostPopular')}
                    onCheckedChange={(checked) =>
                      setValue('isMostPopular', checked, { shouldDirty: true })
                    }
                  />
                </TableCell>
              </TableRow>

              <TableRow className={ROW}>
                <TableCell className={LABEL}>
                  <div className='flex items-center gap-1'>
                    <Users className='size-3.5 text-muted-foreground' />
                    Seats
                  </div>
                </TableCell>
                <TableCell className='py-2'>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      size='sm'
                      {...register('minSeats', { valueAsNumber: true })}
                      placeholder='1'
                      className=' w-20'
                    />
                    <span className='text-xs text-muted-foreground'>to</span>
                    <Input
                      type='number'
                      {...register('maxSeats', { valueAsNumber: true })}
                      placeholder='10'
                      size='sm'
                      className='w-20'
                    />
                  </div>
                </TableCell>
              </TableRow>

              {/* ── Stripe (edit mode only) ── */}
              {isEditMode && (
                <>
                  <TableRow className={ROW}>
                    <TableCell className={LABEL}>
                      <div className='flex items-center gap-1'>
                        <CreditCard className='size-3.5 text-muted-foreground' />
                        Stripe
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      <div className='flex items-center gap-2'>
                        {plan.stripeProductId ? (
                          <Badge variant='outline' className='font-mono text-xs'>
                            {plan.stripeProductId}
                          </Badge>
                        ) : (
                          <span className='text-sm text-muted-foreground'>Not synced</span>
                        )}
                        <StripeSync planId={plan.id} plan={plan} />
                      </div>
                    </TableCell>
                  </TableRow>

                  {plan.stripePriceIdMonthly && (
                    <TableRow className={ROW}>
                      <TableCell className={LABEL}>
                        <span className='pl-5 text-muted-foreground'>Monthly Price ID</span>
                      </TableCell>
                      <TableCell className='py-2'>
                        <Badge variant='outline' className='font-mono text-xs'>
                          {plan.stripePriceIdMonthly}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )}

                  {plan.stripePriceIdAnnual && (
                    <TableRow className={ROW}>
                      <TableCell className={LABEL}>
                        <span className='pl-5 text-muted-foreground'>Annual Price ID</span>
                      </TableCell>
                      <TableCell className='py-2'>
                        <Badge variant='outline' className='font-mono text-xs'>
                          {plan.stripePriceIdAnnual}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
