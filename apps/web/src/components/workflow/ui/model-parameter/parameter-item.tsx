// apps/web/src/components/workflow/ui/model-parameter/parameter-item.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Slider } from '@auxx/ui/components/slider'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { HelpCircle, X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ParameterItemProps, ParameterValue } from './types'

const isNullOrUndefined = <T,>(value: T | null | undefined): value is null | undefined => {
  return value === null || value === undefined
}

// Helper to get label as string (handle both string and TypeWithI18N)
const getLabel = (label: string | { en_US: string; [key: string]: string }): string => {
  return typeof label === 'string' ? label : label?.en_US || ''
}

// Helper to get help text as string (handle both string and TypeWithI18N)
const getHelpText = (
  help?: string | { en_US: string; [key: string]: string }
): string | undefined => {
  if (!help) return undefined
  return typeof help === 'string' ? help : help?.en_US || undefined
}

const ParameterItem: FC<ParameterItemProps> = ({
  parameterRule,
  value,
  onChange,
  onSwitch,
  isInWorkflow,
  disabled = false,
}): JSX.Element => {
  const [localValue, setLocalValue] = useState(value)
  const numberInputRef = useRef<HTMLInputElement>(null)

  // Simplified default value logic
  const getDefaultValue = (): ParameterValue => {
    if (!isNullOrUndefined(parameterRule.default)) {
      return parameterRule.default
    }

    // Fallback defaults by type
    switch (parameterRule.type) {
      case 'int':
      case 'float':
        return parameterRule.min ?? 0
      case 'string':
      case 'text':
        return ''
      case 'boolean':
        return false
      case 'tag':
        return []
      default:
        return undefined
    }
  }

  const renderValue = value ?? localValue ?? getDefaultValue()

  const handleInputChange = (newValue: ParameterValue) => {
    setLocalValue(newValue)

    if (
      onChange &&
      (parameterRule.name === 'stop' || !isNullOrUndefined(value) || parameterRule.required)
    )
      onChange(newValue)
  }

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = +e.target.value

    if (!isNullOrUndefined(parameterRule.max) && num > parameterRule.max!) {
      num = parameterRule.max as number
      if (numberInputRef.current) numberInputRef.current.value = `${num}`
    }

    if (!isNullOrUndefined(parameterRule.min) && num < parameterRule.min!)
      num = parameterRule.min as number

    handleInputChange(num)
  }

  const handleNumberInputBlur = () => {
    if (numberInputRef.current) numberInputRef.current.value = renderValue as string
  }

  const handleSlideChange = (values: number[]) => {
    const num = values[0]
    if (!isNullOrUndefined(parameterRule.max) && num > parameterRule.max!) {
      handleInputChange(parameterRule.max)
      if (numberInputRef.current) numberInputRef.current.value = `${parameterRule.max}`
      return
    }

    if (!isNullOrUndefined(parameterRule.min) && num < parameterRule.min!) {
      handleInputChange(parameterRule.min)
      if (numberInputRef.current) numberInputRef.current.value = `${parameterRule.min}`
      return
    }

    handleInputChange(num)
    if (numberInputRef.current) numberInputRef.current.value = `${num}`
  }

  const handleRadioChange = (value: string) => {
    handleInputChange(value === '1')
  }

  const handleStringInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    handleInputChange(e.target.value)
  }

  const handleSelect = (value: string) => {
    handleInputChange(value)
  }

  const handleTagChange = (newSequences: string[]) => {
    handleInputChange(newSequences)
  }

  const handleSwitch = (checked: boolean) => {
    if (onSwitch) {
      const assignValue: ParameterValue = localValue || getDefaultValue()
      onSwitch(checked, assignValue)
    }
  }

  useEffect(() => {
    if ((parameterRule.type === 'int' || parameterRule.type === 'float') && numberInputRef.current)
      numberInputRef.current.value = `${renderValue}`
  }, [value, parameterRule.type, renderValue])

  const renderInput = () => {
    const numberInputWithSlide =
      (parameterRule.type === 'int' || parameterRule.type === 'float') &&
      !isNullOrUndefined(parameterRule.min) &&
      !isNullOrUndefined(parameterRule.max)

    if (parameterRule.type === 'int') {
      let step = 100
      if (parameterRule.max) {
        if (parameterRule.max < 100) step = 1
        else if (parameterRule.max < 1000) step = 10
      }

      return (
        <div className='flex items-center gap-2'>
          {numberInputWithSlide && (
            <Slider
              className='w-[120px]'
              value={[renderValue as number]}
              min={parameterRule.min}
              max={parameterRule.max}
              step={step}
              disabled={disabled}
              onValueChange={handleSlideChange}
            />
          )}
          <Input
            ref={numberInputRef}
            className='h-7 w-22 shrink-0 text-sm pe-0.5'
            type='number'
            max={parameterRule.max}
            min={parameterRule.min}
            disabled={disabled}
            step={numberInputWithSlide ? step : 10 ** -(parameterRule.precision || 0)}
            onChange={handleNumberInputChange}
            onBlur={handleNumberInputBlur}
          />
        </div>
      )
    }

    if (parameterRule.type === 'float') {
      return (
        <div className='flex items-center gap-2'>
          {numberInputWithSlide && (
            <Slider
              className='w-[120px]'
              value={[renderValue as number]}
              min={parameterRule.min}
              max={parameterRule.max}
              step={0.1}
              disabled={disabled}
              onValueChange={handleSlideChange}
            />
          )}
          <Input
            ref={numberInputRef}
            className='h-7 w-22 shrink-0 text-sm pe-0.5'
            type='number'
            max={parameterRule.max}
            min={parameterRule.min}
            disabled={disabled}
            step={numberInputWithSlide ? 0.1 : 10 ** -(parameterRule.precision || 0)}
            onChange={handleNumberInputChange}
            onBlur={handleNumberInputBlur}
          />
        </div>
      )
    }

    if (parameterRule.type === 'boolean') {
      return (
        <RadioGroup
          className='flex w-[178px] items-center gap-4'
          value={renderValue ? '1' : '0'}
          onValueChange={handleRadioChange}>
          <div className='flex items-center space-x-2'>
            <RadioGroupItem value='1' id={`${parameterRule.name}-true`} />
            <Label htmlFor={`${parameterRule.name}-true`} className='text-sm'>
              True
            </Label>
          </div>
          <div className='flex items-center space-x-2'>
            <RadioGroupItem value='0' id={`${parameterRule.name}-false`} />
            <Label htmlFor={`${parameterRule.name}-false`} className='text-sm'>
              False
            </Label>
          </div>
        </RadioGroup>
      )
    }

    if (parameterRule.type === 'string' && !parameterRule.options?.length) {
      return (
        <Input
          className={cn(isInWorkflow ? 'w-[178px]' : 'w-full')}
          value={renderValue as string}
          variant='secondary'
          size='sm'
          onChange={handleStringInputChange}
          disabled={disabled}
        />
      )
    }

    if (parameterRule.type === 'text') {
      return (
        <Textarea
          className='h-20 w-full text-sm'
          disabled={disabled}
          value={renderValue as string}
          onChange={handleStringInputChange}
        />
      )
    }

    if (parameterRule.type === 'string' && !!parameterRule?.options?.length) {
      return (
        <Select value={renderValue as string} onValueChange={handleSelect}>
          <SelectTrigger size='sm' disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='z-200'>
            {parameterRule.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (parameterRule.type === 'tag') {
      return (
        <TagInput
          items={renderValue as string[]}
          onChange={handleTagChange}
          disabled={disabled}
          placeholder={
            parameterRule?.tagPlaceholder ? getLabel(parameterRule.tagPlaceholder) : undefined
          }
          isInWorkflow={isInWorkflow}
        />
      )
    }

    return null
  }

  return (
    <div className='mb-2 flex items-center justify-between gap-2'>
      <div className='shrink-0 basis-1/2'>
        <div className={cn('flex w-full shrink-0 items-center gap-2')}>
          {!parameterRule.required && parameterRule.name !== 'stop' && (
            <Switch
              size='sm'
              checked={!isNullOrUndefined(value)}
              onCheckedChange={handleSwitch}
              disabled={disabled}
            />
          )}
          <div
            className='text-xs text-muted-foreground truncate'
            title={getLabel(parameterRule.label)}>
            {getLabel(parameterRule.label)}
          </div>
          {parameterRule.help && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className='h-3 w-3 text-muted-foreground shrink-0' />
              </TooltipTrigger>
              <TooltipContent className='max-w-[200px]'>
                <p className='whitespace-pre-wrap text-xs'>{getHelpText(parameterRule.help)}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {parameterRule.type === 'tag' && parameterRule?.tagPlaceholder && (
          <div className={cn(!isInWorkflow && 'w-[178px]', 'text-xs text-muted-foreground mt-1')}>
            {getLabel(parameterRule.tagPlaceholder)}
          </div>
        )}
      </div>
      <div className='flex-1'>{renderInput()}</div>
    </div>
  )
}

// Simple TagInput component for stop sequences
const TagInput: FC<{
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  isInWorkflow?: boolean
  disabled?: boolean
}> = ({ items, onChange, placeholder, isInWorkflow, disabled }) => {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && inputValue.trim()) {
      e.preventDefault()
      if (!items.includes(inputValue.trim()) && items.length < 4) {
        onChange([...items, inputValue.trim()])
        setInputValue('')
      }
    }
  }

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div
      className={cn(
        'h-8 w-full border rounded-md px-2 py-1 flex items-center gap-1 flex-wrap',
        'focus-within:ring-1 focus-within:ring-blue-500'
      )}>
      {items.map((item, index) => (
        <Badge key={index} variant='secondary' className='text-xs h-5 px-1'>
          {item}
          <button
            type='button'
            onClick={() => removeItem(index)}
            className='ml-1 hover:text-destructive'>
            <X className='size-3' />
          </button>
        </Badge>
      ))}
      <Input
        value={inputValue}
        disabled={disabled}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={items.length === 0 ? placeholder : ''}
        className='border-0 bg-transparent p-0 h-auto focus-visible:ring-0 text-xs flex-1 min-w-[60px] shadow-none'
      />
    </div>
  )
}

export default ParameterItem
