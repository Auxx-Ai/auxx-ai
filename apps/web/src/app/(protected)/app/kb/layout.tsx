import React from 'react'

type Props = { children: React.ReactNode }

function KBLayout({ children }: Props) {
  return <div className="flex flex-1 grow overflow-hidden bg-secondary">{children}</div>
}

export default KBLayout
