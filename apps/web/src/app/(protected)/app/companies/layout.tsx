// apps/web/src/app/(protected)/app/companies/layout.tsx

import type React from 'react'

type Props = { children: React.ReactNode; modal: React.ReactNode }

function layout({ children, modal }: Props) {
  return (
    <>
      {children} {modal}
    </>
  )
}

export default layout
