import { redirect } from 'next/navigation'
import React from 'react'

type Props = {
  // children
}

const SettingsPage = (props: Props) => {
  redirect('/app/settings/general')
}
export default SettingsPage
