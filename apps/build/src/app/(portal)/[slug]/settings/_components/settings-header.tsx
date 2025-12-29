import React from 'react'

type Props = { title: string; icon: React.ReactNode }

function SettingsHeader({ title, icon }: Props) {
  return (
    <div className="flex items-center px-3 h-9 flex-row justify-between border-b">
      <div className="flex items-center gap-2 flex-row">
        {icon}
        <div className="text-sm ">{title}</div>
      </div>
    </div>
  )
}

export default SettingsHeader
