// packages/ui/src/passport/use-passport.ts
'use client'

import { useContext } from 'react'
import { PassportContext } from './passport-provider'
import type { PassportContextValue } from './types'

/**
 * Access the passport managed by the nearest `<PassportProvider>`.
 */
export function usePassport(): PassportContextValue {
  const ctx = useContext(PassportContext)
  if (!ctx) {
    throw new Error('usePassport must be used within a <PassportProvider>')
  }
  return ctx
}
