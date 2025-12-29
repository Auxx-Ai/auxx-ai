import { keepPreviousData } from '@tanstack/react-query'
import { gmail_v1 } from 'googleapis'
import { useMemo } from 'react'
// import { labelVisibility } from '@auxx/lib/google/constants'
// import { LabelsResponse } from '@auxx/lib/google/labels'
import { api } from '~/trpc/react'

export type UserLabel = {
  id: string
  name: string
  type: 'user'
  labelListVisibility?: string
  messageListVisibility?: string
  color?: { textColor?: string | null; backgroundColor?: string | null }
}
export type Label = {
  id: string
  labelId?: string
  name: string
  isVisible: boolean
  description?: string | null
  enabled: boolean
  backgroundColor?: string | null
  textColor?: string | null
}

export function useAllLabels() {
  const { data, isLoading } = api.label.all.useQuery()
  // useSWR<LabelsResponse>('/api/google/labels')

  const userLabels = useMemo(
    () => data?.labels?.filter(isUserLabel).sort(sortLabels) || [],
    [data?.labels]
  )

  return { userLabels, data, isLoading }
}

export function useLabels() {
  // const { data, isLoading, error, mutate } =
  // useSWR<LabelsResponse>('/api/google/labels')
  // const {}  = api.label.getAll.useQuery(undefined, {})

  const { data, isLoading, isError, refetch } = api.label.all.useQuery(
    { type: 'user' },
    {
      placeholderData: keepPreviousData,
      // getNextPageParam: (lastPage) => lastPage?.nextCursor || null, // Fetch nextCursor for pagination
    }
  )

  const userLabels = useMemo(() => data?.labels.sort(sortLabels) || [], [data])
  // console.log('userLabels:', userLabels,data?.labels, isLoading, isError)
  return { userLabels, isLoading, isError, refetch }
}

export function useSplitLabels() {
  const { userLabels, isLoading, isError } = useLabels()

  const { visibleLabels, hiddenLabels } = useMemo(
    () => ({
      visibleLabels: userLabels.filter((label) => !isHiddenLabel(label)),
      hiddenLabels: userLabels.filter(isHiddenLabel),
    }),
    [userLabels]
  )

  return { visibleLabels, hiddenLabels, isLoading, isError }
}

function sortLabels(a: Label, b: Label) {
  const aName = a.name || ''
  const bName = b.name || ''

  // Order words that start with [ at the end
  if (aName.startsWith('[') && !bName.startsWith('[')) return 1
  if (!aName.startsWith('[') && bName.startsWith('[')) return -1

  return aName.localeCompare(bName)
}

function isUserLabel(label: gmail_v1.Schema$Label): label is UserLabel {
  return label.type === 'user'
}

function isHiddenLabel(label: Label) {
  // return label.isVisible === labelVisibility.labelHide
  return !label.isVisible
}
