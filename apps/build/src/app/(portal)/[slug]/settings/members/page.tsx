'use client'
import { FieldGroup, FieldSet } from '@auxx/ui/components/field'
import { Users } from 'lucide-react'
import { useCopyClipboard } from '@/hooks/use-copy-clipboard'
import SettingsHeader from '../_components/settings-header'

type Props = {}

function GeneralMembersSettings({}: Props) {
  const { copy, copied } = useCopyClipboard()

  return (
    <>
      <SettingsHeader title='Members' icon={<Users className='size-4' />} />
      <div className='flex-1 overflow-y-auto min-h-0'>
        <div className='p-6 lg:py-12 max-w-3xl mx-auto'>
          <div className='flex flex-col space-y-10'>
            <div className='space-y-0'>
              <div className='text-xl font-semibold'>Members</div>
              <div className='text-base'>
                Manage developer account members, set access levels, and invite new users
              </div>
            </div>
            <form>
              <FieldGroup>
                <FieldSet>
                  {/* Logo */}
                  {/* Account name */}
                </FieldSet>
              </FieldGroup>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

export default GeneralMembersSettings
