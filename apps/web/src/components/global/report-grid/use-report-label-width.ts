// apps/web/src/components/global/report-grid/use-report-label-width.ts

'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'auxx.reports.label-width.'

/** A report's label column width in px, remembered per report in localStorage (108-D5). */
export function useReportLabelWidth(
  reportKey: string,
  defaultWidth: number
): [number, (width: number) => void] {
  const [width, setWidthState] = useState(defaultWidth)

  // Read after mount: the server render has no storage, and the two must match.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(STORAGE_PREFIX + reportKey))
    setWidthState(Number.isFinite(stored) && stored > 0 ? stored : defaultWidth)
  }, [reportKey, defaultWidth])

  const setWidth = useCallback(
    (next: number) => {
      setWidthState(next)
      window.localStorage.setItem(STORAGE_PREFIX + reportKey, String(next))
    },
    [reportKey]
  )

  return [width, setWidth]
}
