import { redirect } from 'next/navigation'
// import React from 'react'

// type Props = {}

export default function DefaultPage() {
  redirect('/app/mail/inbox/open')
}
