import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import React from 'react'

type Props = {}

function ScopesPage({}: Props) {
  return (
    <div className='flex flex-col items-center justify-start gap-1 py-10 px-4 overflow-y-auto'>
      <div className=' max-w-3xl w-full mx-auto'>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>Scopes</FieldLegend>
            <FieldDescription>
              Configure the scopes granted to your app's OAuth tokens and App SDK calls
            </FieldDescription>
          </FieldSet>
          <FieldSet className='border  rounded-2xl'>
            <div className=''>
              <div className='flex flex-row items-center justify-between border-b p-2'>
                <FieldContent>
                  <FieldLabel htmlFor='lastName'>User management</FieldLabel>
                  <FieldDescription>View organization members.</FieldDescription>
                </FieldContent>

                <Select defaultValue='disabled'>
                  <SelectTrigger id='app-organization-auth-method' className='w-auto'>
                    <SelectValue placeholder='Select a method...' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='disabled'>Disabled</SelectItem>
                    <SelectItem value='read'>Read</SelectItem>
                    <SelectItem value='read-write'>Read-write</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-row items-center justify-between border-b p-2'>
                <FieldContent>
                  <FieldLabel htmlFor='lastName'>User management</FieldLabel>
                  <FieldDescription>View organization members.</FieldDescription>
                </FieldContent>

                <Select defaultValue='disabled'>
                  <SelectTrigger id='app-organization-auth-method' className='w-auto'>
                    <SelectValue placeholder='Select a method...' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='disabled'>Disabled</SelectItem>
                    <SelectItem value='read'>Read</SelectItem>
                    <SelectItem value='read-write'>Read-write</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FieldSet>
        </FieldGroup>
      </div>
    </div>
  )
}

export default ScopesPage
