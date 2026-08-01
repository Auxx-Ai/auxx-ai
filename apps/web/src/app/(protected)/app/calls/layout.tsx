// apps/web/src/app/(protected)/app/calls/layout.tsx

import type React from 'react'

type Props = { children: React.ReactNode }

function layout({ children }: Props) {
  return <>{children}</>
}

export default layout
