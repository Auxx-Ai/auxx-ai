import React from 'react'
import { Mailbox } from '../_components/mail'
import { api } from '~/trpc/server'
// import { api } from '~/trpc/ser'

type Props = { params: Promise<{ labelId: string }> }

export default async function MailPage({ params }: Props) {
  const { labelId } = await params
  console.log(labelId)

  const labels = await api.label.all()
  // const labels = []
  return (
    <>
      <Mailbox labelId={labelId} labels={labels} />
    </>
  )
}
