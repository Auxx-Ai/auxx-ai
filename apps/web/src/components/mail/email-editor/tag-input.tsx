import type React from 'react'
import { useState } from 'react'
import Avatar from 'react-avatar'
import Select from 'react-select'

export type TagInputProps = {
  suggestions: string[]
  defaultValues?: { label: string; value: string }[]
  placeholder: string
  label: string

  onChange: (values: { label: string; value: string }[]) => void
  value: { label: string; value: string }[]
}

/**
 * TO, CC, BCC input field
 *
 * @returns
 */
const TagInput: React.FC<TagInputProps> = ({
  suggestions, // List of suggested values: e.g. {["user1@example.com", "user2@example.com"]}
  defaultValues = [], // Initial selected values
  label, // Input label: e.g. To:
  onChange, // Change handler
  value, // Current value
}) => {
  const [input, setInput] = useState('')

  const options = suggestions.map((suggestion) => ({
    label: (
      <span className='flex items-center gap-2'>
        <Avatar name={suggestion} size='25' textSizeRatio={2} round={true} />
        {suggestion}
      </span>
    ),
    value: suggestion,
  }))

  return (
    <div className='flex items-center rounded-md border'>
      <span className='ml-3 text-sm text-gray-500'>{label}</span>
      <Select
        value={value}
        // @ts-expect-error
        onChange={onChange}
        className='w-full flex-1'
        isMulti
        onInputChange={setInput}
        defaultValue={defaultValues}
        placeholder={''}
        options={
          input
            ? options.concat({
                label: (
                  <span className='flex items-center gap-2'>
                    <Avatar name={input} size='25' textSizeRatio={2} round={true} />
                    {input}
                  </span>
                ),
                value: input,
              })
            : options
        }
        classNames={{
          control: () => {
            return 'border-none! outline-hidden! ring-0! shadow-none! focus:border-none focus:outline-hidden focus:ring-0 focus:shadow-none dark:bg-transparent'
          },
          multiValue: () => {
            return 'dark:bg-gray-700!'
          },
          multiValueLabel: () => {
            return 'dark:text-white dark:bg-gray-700 rounded-md'
          },
          menu: () => {
            return 'dark:bg-gray-800 dark:text-white'
          },
          option: ({ isDisabled, isFocused, isSelected }) => {
            if (isSelected) return 'bg-purple-800'
            if (!isSelected && isFocused) return 'bg-purple-300'
            if (!isDisabled && isSelected) return 'active:bg-purple-800'
            if (!isDisabled && !isSelected) return 'active:bg-purple-500'
          },
        }}
        classNamePrefix='select'
      />
    </div>
  )
}

export default TagInput
