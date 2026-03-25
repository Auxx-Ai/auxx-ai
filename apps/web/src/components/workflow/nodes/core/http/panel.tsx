// apps/web/src/components/workflow/nodes/core/http/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputDecrement,
  NumberInputField,
  NumberInputIncrement,
  NumberInputScrubber,
} from '@auxx/ui/components/input-number'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { generateId } from '@auxx/utils/generateId'
import { produce } from 'immer'
import { ChevronDown, FileJson, Plus } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import Field from '~/components/workflow/ui/field'
import { InputEditor } from '~/components/workflow/ui/input-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { EditHttpBody, ErrorHandling, KeyValueList } from './components'
import { AuthDialog } from './components/auth-dialog'
import { BodyTypeOptions, MethodOptions } from './constants'
import { httpNodeDefinition } from './schema'
import type { HttpNodeData, KeyValue } from './types'
import { BodyType } from './types'
import {
  keyValueToHeaders,
  keyValueToParams,
  parseHeadersToKeyValue,
  parseParamsToKeyValue,
} from './utils'

interface HttpPanelProps {
  nodeId: string
  data: HttpNodeData
}

const HttpNodePanelComponent = ({ nodeId, data }: HttpPanelProps) => {
  const { isReadOnly } = useReadOnly()

  const { inputs, setInputs } = useNodeCrud<HttpNodeData>(nodeId, data)

  // Local KV array state — decoupled from the string format to prevent
  // ID regeneration and state loss on every keystroke.
  const [headersList, setHeadersList] = useState(() =>
    parseHeadersToKeyValue(inputs?.headers || '')
  )
  const [paramsList, setParamsList] = useState(() => parseParamsToKeyValue(inputs?.params || ''))

  // Track our own serialized strings so we can detect truly external changes
  const headersStringRef = useRef(inputs?.headers || '')
  const paramsStringRef = useRef(inputs?.params || '')

  // Re-parse only when the string changes externally (not from our own onChange)
  useEffect(() => {
    const current = inputs?.headers || ''
    if (current !== headersStringRef.current) {
      headersStringRef.current = current
      setHeadersList(parseHeadersToKeyValue(current))
    }
  }, [inputs?.headers])

  useEffect(() => {
    const current = inputs?.params || ''
    if (current !== paramsStringRef.current) {
      paramsStringRef.current = current
      setParamsList(parseParamsToKeyValue(current))
    }
  }, [inputs?.params])

  const handleHeadersChange = (newList: KeyValue[]) => {
    setHeadersList(newList)
    const headersString = keyValueToHeaders(newList)
    headersStringRef.current = headersString
    setInputs({ ...inputs, headers: headersString })
  }

  const handleParamsChange = (newList: KeyValue[]) => {
    setParamsList(newList)
    const paramsString = keyValueToParams(newList)
    paramsStringRef.current = paramsString
    setInputs({ ...inputs, params: paramsString })
  }

  const handleAddHeader = () => {
    const newList = [...headersList, { id: generateId(), key: '', value: '' }]
    setHeadersList(newList)
    const headersString = keyValueToHeaders(newList)
    headersStringRef.current = headersString
    setInputs({ ...inputs, headers: headersString })
  }

  const handleAddParam = () => {
    const newList = [...paramsList, { id: generateId(), key: '', value: '' }]
    setParamsList(newList)
    const paramsString = keyValueToParams(newList)
    paramsStringRef.current = paramsString
    setInputs({ ...inputs, params: paramsString })
  }

  // Method handlers
  const handleMethodChange = (method: string) => {
    setInputs({ ...inputs, method: method as any })
  }

  const handleBodyTypeChange = (bodyType: string) => {
    setInputs(
      produce(inputs, (draft) => {
        if (!draft.body) draft.body = { type: BodyType.none, data: [] }
        draft.body.type = bodyType as any
      })
    )
  }

  // Timeout handlers
  const handleTimeoutChange = (field: 'connect' | 'read' | 'write', value: number | undefined) => {
    setInputs(
      produce(inputs, (draft) => {
        if (!draft.timeout) draft.timeout = {}
        draft.timeout[field] = value
      })
    )
  }

  // Retry handlers
  const handleRetryEnabledChange = (enabled: boolean) => {
    setInputs(
      produce(inputs, (draft) => {
        if (!draft.retry_config) {
          draft.retry_config = { retry_enabled: false, max_retries: 1, retry_interval: 0 }
        }
        draft.retry_config.retry_enabled = enabled
      })
    )
  }

  const handleMaxRetriesChange = (value: number | undefined) => {
    setInputs(
      produce(inputs, (draft) => {
        if (!draft.retry_config) {
          draft.retry_config = { retry_enabled: false, max_retries: 1, retry_interval: 0 }
        }
        draft.retry_config.max_retries = value ?? 1
      })
    )
  }

  const handleRetryIntervalChange = (value: number | undefined) => {
    setInputs(
      produce(inputs, (draft) => {
        if (!draft.retry_config) {
          draft.retry_config = { retry_enabled: false, max_retries: 1, retry_interval: 0 }
        }
        draft.retry_config.retry_interval = value ?? 0
      })
    )
  }

  // Credential handlers
  const handleCredentialConnected = (credentialId: string) => {
    setInputs({ ...inputs, credentialId })
  }

  const handleCredentialDisconnected = () => {
    setInputs({ ...inputs, credentialId: null })
  }
  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section title='HTTP Request Configuration' isRequired>
        <div className='space-y-5'>
          <Field
            title='Request'
            isRequired
            actions={
              <>
                <AuthDialog
                  nodeId={nodeId}
                  authorization={inputs.authorization}
                  onChange={(auth) => {
                    setInputs({ ...inputs, authorization: auth })
                  }}
                />
                {/* <Button
                  variant='ghost'
                  size='xs'
                  onClick={() => {
                    // Placeholder for method selection logic
                    console.log('Import from cURL')
                  }}>
                  <FileJson />
                  From cURL
                </Button> */}
              </>
            }>
            <div className='space-y-2'>
              <div className='flex flex-row items-center gap-2'>
                <InputGroup>
                  <InputGroupAddon align='inline-start'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <InputGroupButton variant='ghost' className='!pr-1.5 text-xs'>
                          {(inputs.method || 'get').toUpperCase()}{' '}
                          <ChevronDown className='size-3' />
                        </InputGroupButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='[--radius:0.95rem]'>
                        <DropdownMenuRadioGroup
                          value={inputs.method || 'get'}
                          onValueChange={handleMethodChange}>
                          {MethodOptions.map((option) => (
                            <DropdownMenuRadioItem
                              key={option.value}
                              value={option.value}
                              className='pl-3'>
                              {option.label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </InputGroupAddon>
                  <div className='flex-1 px-2'>
                    <InputEditor
                      nodeId={nodeId}
                      value={inputs.url}
                      onBlur={(value) => {
                        setInputs({ ...inputs, url: value })
                      }}
                      placeholder='Enter URL'
                      className='w-full'
                    />
                  </div>
                </InputGroup>
              </div>
            </div>
          </Field>
          <Field
            title='Headers'
            actions={
              <Button variant='ghost' size='xs' onClick={handleAddHeader}>
                <Plus /> Add header
              </Button>
            }>
            <KeyValueList
              readonly={isReadOnly}
              list={headersList}
              onChange={handleHeadersChange}
              onAdd={handleAddHeader}
              nodeId={nodeId}
            />
          </Field>
          <Field
            title='Params'
            actions={
              <Button variant='ghost' size='xs' onClick={handleAddParam}>
                <Plus /> Add param
              </Button>
            }>
            <KeyValueList
              readonly={isReadOnly}
              list={paramsList}
              onChange={handleParamsChange}
              onAdd={handleAddParam}
              nodeId={nodeId}
            />
          </Field>
          {inputs.method !== 'get' && inputs.method !== 'head' && (
            <Field
              title='Body'
              actions={
                <Select
                  value={inputs.body?.type || BodyType.none}
                  onValueChange={handleBodyTypeChange}>
                  <SelectTrigger variant={'default'} size='sm' disabled={isReadOnly}>
                    <SelectValue placeholder='Type' />
                  </SelectTrigger>
                  <SelectContent>
                    {BodyTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }>
              <EditHttpBody
                nodeId={nodeId}
                body={inputs.body}
                isReadOnly={isReadOnly}
                onChange={(body) => setInputs({ ...inputs, body })}
              />
            </Field>
          )}
        </div>
      </Section>
      <Section title='Timeout' initialOpen={false}>
        <div className='space-y-2'>
          <p className='text-xs text-muted-foreground'>All timeout values are in seconds</p>
          <div className='grid grid-cols-3 gap-4'>
            <NumberInput
              value={inputs.timeout?.connect}
              onValueChange={(val) => handleTimeoutChange('connect', val)}
              min={0}
              step={1}
              disabled={isReadOnly}>
              <div className='flex flex-col items-start'>
                <NumberInputScrubber htmlFor='timeout-connection' className='mb-1'>
                  Connection
                </NumberInputScrubber>
                <InputGroup>
                  <InputGroupAddon align='inline-start'>
                    <NumberInputDecrement />
                  </InputGroupAddon>
                  <NumberInputField id='timeout-connection' placeholder='10' />
                  <InputGroupAddon align='inline-end'>
                    <NumberInputIncrement />
                    <InputGroupText>s</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </NumberInput>
            <NumberInput
              value={inputs.timeout?.read}
              onValueChange={(val) => handleTimeoutChange('read', val)}
              min={0}
              step={1}
              disabled={isReadOnly}>
              <div className='flex flex-col items-start'>
                <NumberInputScrubber htmlFor='timeout-read' className='mb-1'>
                  Read
                </NumberInputScrubber>
                <InputGroup>
                  <InputGroupAddon align='inline-start'>
                    <NumberInputDecrement />
                  </InputGroupAddon>
                  <NumberInputField id='timeout-read' placeholder='30' />
                  <InputGroupAddon align='inline-end'>
                    <NumberInputIncrement />
                    <InputGroupText>s</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </NumberInput>
            <NumberInput
              value={inputs.timeout?.write}
              onValueChange={(val) => handleTimeoutChange('write', val)}
              min={0}
              step={1}
              disabled={isReadOnly}>
              <div className='flex flex-col items-start'>
                <NumberInputScrubber htmlFor='timeout-write' className='mb-1'>
                  Write
                </NumberInputScrubber>
                <InputGroup>
                  <InputGroupAddon align='inline-start'>
                    <NumberInputDecrement />
                  </InputGroupAddon>
                  <NumberInputField id='timeout-write' placeholder='30' />
                  <InputGroupAddon align='inline-end'>
                    <NumberInputIncrement />
                    <InputGroupText>s</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </NumberInput>
          </div>
        </div>
      </Section>
      <Section
        title='Retry on failure'
        initialOpen={false}
        showEnable
        enabled={inputs.retry_config?.retry_enabled || false}
        onEnableChange={handleRetryEnabledChange}>
        <div className='space-y-2'>
          <NumberInput
            value={inputs.retry_config?.max_retries}
            onValueChange={handleMaxRetriesChange}
            min={1}
            max={10}
            step={1}
            disabled={isReadOnly || !inputs.retry_config?.retry_enabled}>
            <div className='flex flex-row gap-1 items-center'>
              <NumberInputScrubber htmlFor='max-retries' className='w-[100px]'>
                Max retries
              </NumberInputScrubber>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <NumberInputDecrement />
                </InputGroupAddon>
                <NumberInputField id='max-retries' placeholder='1' />
                <InputGroupAddon align='inline-end'>
                  <NumberInputIncrement />
                  <InputGroupText>times</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </NumberInput>
          <NumberInput
            value={inputs.retry_config?.retry_interval}
            onValueChange={handleRetryIntervalChange}
            min={100}
            max={5000}
            step={100}
            disabled={isReadOnly || !inputs.retry_config?.retry_enabled}>
            <div className='flex flex-row gap-1 items-center'>
              <NumberInputScrubber htmlFor='retry-interval' className='w-[100px]'>
                Retry interval
              </NumberInputScrubber>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <NumberInputDecrement />
                </InputGroupAddon>
                <NumberInputField id='retry-interval' placeholder='1000' />
                <InputGroupAddon align='inline-end'>
                  <NumberInputIncrement />
                  <InputGroupText>ms</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </NumberInput>
        </div>
      </Section>
      <ErrorHandling
        nodeId={nodeId}
        isReadOnly={isReadOnly}
        config={inputs}
        onChange={(errorConfig) => setInputs({ ...inputs, ...errorConfig })}
      />
      <OutputVariablesDisplay
        outputVariables={httpNodeDefinition.outputVariables?.(inputs, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const HttpNodePanel = memo(HttpNodePanelComponent)
