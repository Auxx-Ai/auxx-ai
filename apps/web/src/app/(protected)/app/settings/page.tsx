import React from 'react'
import { redirect } from 'next/navigation'

type Props = {
  // children
}

const SettingsPage = (props: Props) => {
  redirect('/app/settings/general')
}
export default SettingsPage
