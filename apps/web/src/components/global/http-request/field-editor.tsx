// apps/web/src/components/global/http-request/field-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { createContext, useContext } from 'react'
import type { ValueSelector } from './types'

/**
 * The field-editor seam.
 *
 * The shared HTTP request builder components (key-value list/item, body editor)
 * render their key / value / body text through an injected `FieldEditor`, and
 * their file/binary rows through an optional `FilePicker`. This keeps the
 * components free of any workflow / TipTap / ReactFlow dependency: the workflow
 * node supplies adapters that bind a `nodeId`; the connector surface supplies a
 * plain or token editor (and no `FilePicker`).
 */
export interface HttpFieldEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  /** Body editors set this to render a multi-line surface. */
  multiline?: boolean
  className?: string
}

export type HttpFieldEditor = React.ComponentType<HttpFieldEditorProps>

/**
 * Props for the optional file/variable picker used by file-type key-value rows
 * and binary / form-data-file body branches. When no `FilePicker` is provided
 * those branches are hidden and never rendered.
 */
export interface HttpFilePickerProps {
  value: ValueSelector | string
  onSelect: (file: ValueSelector) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export type HttpFilePicker = React.ComponentType<HttpFilePickerProps>

export interface HttpRequestFieldContextValue {
  /** Key / value / body text editor. */
  FieldEditor: HttpFieldEditor
  /** Optional; absent ⇒ file/binary body + file key-value branches are hidden. */
  FilePicker?: HttpFilePicker
  /**
   * Placeholder for the key/value inputs. Defaults to the workflow variable
   * hint (`type '{' to insert variable...`); the plain connector surface
   * overrides these since it has no workflow variables.
   */
  keyPlaceholder?: string
  valuePlaceholder?: string
}

/**
 * Default field editor — a plain `<input>` / `<textarea>` adapter so the shared
 * components work with no provider (the connector's no-token case).
 */
export const PlainFieldEditor: HttpFieldEditor = ({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  multiline,
  className,
}) => {
  if (multiline) {
    return (
      <textarea
        className={cn(
          'text-sm w-full px-3 py-1.5 appearance-none rounded-none border-none bg-transparent outline-none resize-y hover:bg-primary-50 focus:bg-primary-100 focus:ring-0',
          className
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
      />
    )
  }

  return (
    <input
      className={cn(
        'text-sm w-full px-3 py-1.5 appearance-none rounded-none border-none bg-transparent outline-none hover:bg-primary-50 focus:bg-primary-100 focus:ring-0',
        className,
        // Trailing so it wins over the row's `p-1` override — aligns the input
        // text with the `pl-3` column headers in the plain (no-token) surface.
        'pl-3'
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}

const HttpRequestFieldContext = createContext<HttpRequestFieldContextValue>({
  FieldEditor: PlainFieldEditor,
})

export const HttpRequestFieldProvider = HttpRequestFieldContext.Provider

export const useHttpRequestField = () => useContext(HttpRequestFieldContext)
