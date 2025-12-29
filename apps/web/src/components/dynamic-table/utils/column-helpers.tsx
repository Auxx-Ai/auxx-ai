// apps/web/src/components/dynamic-table/utils/column-helpers.tsx

import { Calendar, CalendarClock, DollarSign, Hash, Mail, Phone, Link2, Type } from 'lucide-react'
import type { ExtendedColumnDef, DateColumnFormatting, CurrencyColumnFormatting, NumberColumnFormatting } from '../types'
import { FormattedCell } from '../components/formatted-cell'

/**
 * Base config for column helpers
 */
interface BaseColumnConfig<TData> {
  id: string
  accessorKey: string
  header: string
  enableSorting?: boolean
  enableFiltering?: boolean
  enableResize?: boolean
  enableReorder?: boolean
  minSize?: number
  size?: number
  defaultVisible?: boolean
}

/**
 * Config for date column
 */
interface DateColumnConfig<TData> extends BaseColumnConfig<TData> {
  defaultFormat?: DateColumnFormatting['format']
  includeTime?: boolean
}

/**
 * Config for currency column
 */
interface CurrencyColumnConfig<TData> extends BaseColumnConfig<TData> {
  currencyCode?: string
  decimalPlaces?: CurrencyColumnFormatting['decimalPlaces']
  displayType?: CurrencyColumnFormatting['displayType']
}

/**
 * Config for number column
 */
interface NumberColumnConfig<TData> extends BaseColumnConfig<TData> {
  decimalPlaces?: number
  displayAs?: NumberColumnFormatting['displayAs']
  prefix?: string
  suffix?: string
}

/**
 * Create a date column with proper formatting support
 * Automatically uses FormattedCell with DATE fieldType
 */
export function createDateColumn<TData>({
  id,
  accessorKey,
  header,
  defaultFormat = 'medium',
  includeTime = false,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 100,
  size = 150,
  defaultVisible = true,
}: DateColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: includeTime ? 'DATETIME' : 'DATE',
    columnType: 'date',
    defaultFormatting: {
      type: 'date',
      format: defaultFormat,
      includeTime,
    },
    icon: includeTime ? CalendarClock : Calendar,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell
        value={getValue()}
        fieldType={includeTime ? 'DATETIME' : 'DATE'}
        columnId={id}
      />
    ),
  }
}

/**
 * Create a currency column with proper formatting support
 * Automatically uses FormattedCell with CURRENCY fieldType
 */
export function createCurrencyColumn<TData>({
  id,
  accessorKey,
  header,
  currencyCode = 'USD',
  decimalPlaces = 'two-places',
  displayType = 'symbol',
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 80,
  size = 120,
  defaultVisible = true,
}: CurrencyColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'CURRENCY',
    columnType: 'currency',
    defaultFormatting: {
      type: 'currency',
      currencyCode,
      decimalPlaces,
      displayType,
    },
    icon: DollarSign,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell
        value={getValue()}
        fieldType="CURRENCY"
        columnId={id}
        options={{ currencyCode, decimalPlaces, displayType }}
      />
    ),
  }
}

/**
 * Create a number column with proper formatting support
 * Automatically uses FormattedCell with NUMBER fieldType
 */
export function createNumberColumn<TData>({
  id,
  accessorKey,
  header,
  decimalPlaces = 0,
  displayAs = 'number',
  prefix,
  suffix,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 60,
  size = 100,
  defaultVisible = true,
}: NumberColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'NUMBER',
    columnType: 'number',
    defaultFormatting: {
      type: 'number',
      decimalPlaces,
      displayAs,
      prefix,
      suffix,
    },
    icon: Hash,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell
        value={getValue()}
        fieldType="NUMBER"
        columnId={id}
      />
    ),
  }
}

/**
 * Create an email column with clickable mailto link
 */
export function createEmailColumn<TData>({
  id,
  accessorKey,
  header,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 120,
  size = 200,
  defaultVisible = true,
}: BaseColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'EMAIL',
    columnType: 'email',
    icon: Mail,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType="EMAIL" columnId={id} />
    ),
  }
}

/**
 * Create a phone column with clickable tel link
 */
export function createPhoneColumn<TData>({
  id,
  accessorKey,
  header,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 100,
  size = 150,
  defaultVisible = true,
}: BaseColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'PHONE',
    columnType: 'phone',
    icon: Phone,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType="PHONE" columnId={id} />
    ),
  }
}

/**
 * Create a URL column with clickable link
 */
export function createUrlColumn<TData>({
  id,
  accessorKey,
  header,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 100,
  size = 200,
  defaultVisible = true,
}: BaseColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'URL',
    columnType: 'text',
    icon: Link2,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType="URL" columnId={id} />
    ),
  }
}

/**
 * Create a text column with standard formatting
 */
export function createTextColumn<TData>({
  id,
  accessorKey,
  header,
  enableSorting = true,
  enableFiltering = true,
  enableResize = true,
  enableReorder = true,
  minSize = 100,
  size = 200,
  defaultVisible = true,
}: BaseColumnConfig<TData>): ExtendedColumnDef<TData> {
  return {
    id,
    accessorKey,
    header,
    fieldType: 'TEXT',
    columnType: 'text',
    icon: Type,
    enableSorting,
    enableFiltering,
    enableResizing: enableResize,
    enableReorder,
    defaultVisible,
    minSize,
    size,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType="TEXT" columnId={id} />
    ),
  }
}
