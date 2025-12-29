// apps/web/src/app/(protected)/subscription/convert/layout.tsx
import React from 'react'
import { ConvertProvider } from './_components/convert-provider'
import { ConvertProgress } from './_components/convert-progress'

type Props = { children: React.ReactNode }

/** Layout for subscription conversion flow */
function layout({ children }: Props) {
  return (
    <ConvertProvider>
      <ConvertProgress />
      <div className="mt-10">{children}</div>
    </ConvertProvider>
  )
}

export default layout
