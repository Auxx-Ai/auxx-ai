// apps/web/src/components/workflow/dialogs/generate-content-dialog.tsx
'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import { Label } from '@auxx/ui/components/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@auxx/ui/components/empty'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Loader2, Copy, Check, Sparkles } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { AiModelPicker } from '~/components/pickers/ai-model-picker'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { Tooltip } from '~/components/global/tooltip'

/** Generation type determines what kind of content to generate */
type GenerationType = 'prompt' | 'code'

/** Code language options */
type CodeLanguage = 'javascript' | 'json'

/** Input variable for code generation */
interface CodeInput {
  name: string
  description?: string
}

/** Output variable for code generation */
interface CodeOutput {
  name: string
  type: string
  description?: string
}

interface GenerateContentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeId: string
  workflowId: string
  /** What type of content to generate */
  generationType: GenerationType
  /** Language for code generation (required when generationType='code') */
  language?: CodeLanguage
  /** Existing content to modify/improve */
  currentContent?: string
  /** For overwrite confirmation check */
  currentContentValue?: string
  /** Input variables for code generation */
  codeInputs?: CodeInput[]
  /** Output variables for code generation */
  codeOutputs?: CodeOutput[]
  onApply: (generatedContent: string) => void
}

/**
 * Unified dialog for generating AI-powered prompts or code
 * Two-column layout: Left for inputs, Right for generated result
 * Adapts UI based on generationType prop
 */
export function GenerateContentDialog({
  open,
  onOpenChange,
  nodeId,
  workflowId,
  generationType,
  language,
  currentContent = '',
  currentContentValue = '',
  codeInputs,
  codeOutputs,
  onApply,
}: GenerateContentDialogProps) {
  // Form state
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [instructions, setInstructions] = useState('')
  const [idealOutput, setIdealOutput] = useState('')

  // Generated result state
  const [generatedContent, setGeneratedContent] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)

  // Confirmation dialog hook for overwrite confirmation
  const [confirm, ConfirmDialog] = useConfirm()

  // Track dirty state for unsaved changes warning
  const formValues = useMemo(
    () => ({ instructions, idealOutput }),
    [instructions, idealOutput]
  )
  const { isDirty, setInitial } = useDirtyCheck(formValues)

  // Reset baseline when dialog opens
  useEffect(() => {
    if (open) {
      setInitial({ instructions: '', idealOutput: '' })
    }
  }, [open, setInitial])

  // Stable callback for closing the dialog
  const handleConfirmedClose = useCallback(() => {
    setInstructions('')
    setIdealOutput('')
    setGeneratedContent(null)
    setIsCopied(false)
    onOpenChange(false)
  }, [onOpenChange])

  // Guard against accidental close when dirty
  const { guardProps, guardedClose, ConfirmDialog: UnsavedConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

  // Derive labels based on generation type
  const isCodeGeneration = generationType === 'code'
  const contentLabel = isCodeGeneration ? 'Code' : 'Prompt'
  const dialogTitle = `Generate ${contentLabel}`
  const generateButtonText = `Generate ${contentLabel}`
  const generatedTitle = `Generated ${contentLabel}`
  const instructionsPlaceholder = isCodeGeneration
    ? 'Describe what the code should do. Be specific about inputs, outputs, and any edge cases to handle...'
    : 'Describe the task you want the AI to perform. Be specific about the input format, expected behavior, and any constraints...'

  // Generate content mutation
  const generateContent = api.aiFeature.generateContent.useMutation({
    onSuccess: (data) => {
      setGeneratedContent(data.content)
    },
    onError: (error) => {
      toastError({
        title: `Failed to generate ${contentLabel.toLowerCase()}`,
        description: error.message,
      })
    },
  })

  /**
   * Handle content generation
   */
  const handleGenerate = async () => {
    if (!instructions.trim()) {
      toastError({
        title: 'Instructions required',
        description: `Please provide instructions for the ${contentLabel.toLowerCase()} generation`,
      })
      return
    }

    generateContent.mutate({
      instruction: instructions,
      generationType,
      language: isCodeGeneration ? language : undefined,
      currentContent: currentContent || undefined,
      idealOutput: idealOutput || undefined,
      modelId: selectedModel || undefined,
      nodeId,
      workflowId,
      // Pass code inputs/outputs for code generation
      codeInputs: isCodeGeneration ? codeInputs : undefined,
      codeOutputs: isCodeGeneration ? codeOutputs : undefined,
    })
  }

  /**
   * Handle applying generated content to editor
   * Bypasses unsaved changes guard since user intentionally applied
   */
  const handleApply = async () => {
    if (!generatedContent) return

    // Check if current editor has content and confirm overwrite
    if (currentContentValue && currentContentValue.trim().length > 0) {
      const confirmed = await confirm({
        title: `Overwrite existing ${contentLabel.toLowerCase()}?`,
        description: `The current ${contentLabel.toLowerCase()} will be replaced with the generated ${contentLabel.toLowerCase()}.`,
        confirmText: 'Overwrite',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (!confirmed) return
    }

    onApply(generatedContent)
    // Close directly without guard since user intentionally applied
    handleConfirmedClose()
  }

  /**
   * Handle copy to clipboard
   */
  const handleCopy = () => {
    if (!generatedContent) return
    navigator.clipboard.writeText(generatedContent)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  /**
   * Handle dialog close with unsaved changes guard
   */
  const handleClose = useCallback(() => {
    guardedClose()
  }, [guardedClose])

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="h-[600px]" innerClassName="p-0" position="tc" size="3xl" {...guardProps}>
          <div className="flex flex-col flex-1 min-h-0">
            {/* Header */}
            <DialogHeader className="border-b px-3 h-10 flex flex-row items-center justify-start mb-0">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                <Button variant="ghost" size="sm">
                  {dialogTitle}
                </Button>
                <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
                <DialogDescription className="sr-only">
                  Generate {contentLabel.toLowerCase()} using AI
                </DialogDescription>
              </div>
            </DialogHeader>

            {/* Main Content: Two equal columns */}
            <div className="flex flex-1 min-h-0">
              {/* Left Column: Inputs */}
              <div className="flex-1 border-r flex flex-col">
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4">
                    {/* AI Model Picker */}
                    <div className="space-y-2">
                      <Label>AI Model</Label>
                      <AiModelPicker
                        value={selectedModel}
                        onChange={(model) => setSelectedModel(model?.id ?? null)}
                        triggerClassName="w-full"
                      />
                    </div>

                    {/* Instructions */}
                    <div className="space-y-2">
                      <Label>
                        Instructions <span className="text-destructive">*</span>
                      </Label>
                      {isCodeGeneration ? (
                        <Textarea
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                          placeholder={instructionsPlaceholder}
                          rows={6}
                        />
                      ) : (
                        <div className="">
                          <Editor
                            value={instructions}
                            title="Instructions"
                            onChange={setInstructions}
                            placeholder={instructionsPlaceholder}
                            nodeId={nodeId}
                            minHeight={150}
                            showAIGenerate={false}
                          />
                        </div>
                      )}
                    </div>

                    {/* Ideal Output (Optional) */}
                    <div className="space-y-2">
                      <Label>Ideal Output (optional)</Label>
                      <Textarea
                        value={idealOutput}
                        onChange={(e) => setIdealOutput(e.target.value)}
                        placeholder={`Provide an example of what the ideal ${contentLabel.toLowerCase()} should look like...`}
                        rows={4}
                      />
                    </div>
                  </div>
                </ScrollArea>

                {/* Generate Button */}
                <div className="border-t p-3">
                  <Button
                    className="w-full"
                    onClick={handleGenerate}
                    loading={generateContent.isPending}
                    loadingText="Generating...">
                    <Sparkles />
                    {generateButtonText}
                  </Button>
                </div>
              </div>

              {/* Right Column: Generated Result */}
              <div className="flex-1 flex flex-col bg-muted/30">
                {/* Sticky Header */}
                <div className="sticky top-0 z-10 bg-muted/30 border-b px-4 py-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {generatedTitle}
                  </span>
                  {generatedContent && (
                    <div className="flex items-center gap-2">
                      <Tooltip content={isCopied ? 'Copied!' : 'Copy'}>
                        <Button variant="ghost" size="sm" onClick={handleCopy}>
                          {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </Button>
                      </Tooltip>
                      <Button size="sm" onClick={handleApply}>
                        Apply
                      </Button>
                    </div>
                  )}
                </div>

                {/* Body */}

                {generateContent.isPending ? (
                  <Empty className="flex-1 min-h-0 flex ">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Loader2 className="animate-spin" />
                      </EmptyMedia>
                      <EmptyTitle>Generating {contentLabel.toLowerCase()}...</EmptyTitle>
                      <EmptyDescription>This may take a few moments</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : generatedContent ? (
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      <pre
                        className={cn(
                          'whitespace-pre-wrap text-sm font-mono bg-background rounded-lg border p-4',
                          isCodeGeneration && 'language-' + (language || 'javascript')
                        )}>
                        {generatedContent}
                      </pre>
                    </div>
                  </ScrollArea>
                ) : (
                  <Empty className="flex-1 min-h-0 flex rounded-2xl">
                    <EmptyHeader className="-mt-15">
                      <EmptyMedia variant="icon">
                        <Sparkles />
                      </EmptyMedia>
                      <EmptyTitle>No {contentLabel.toLowerCase()} generated</EmptyTitle>
                      <EmptyDescription>
                        Fill in the instructions and click &quot;{generateButtonText}&quot; to
                        create{' '}
                        {contentLabel.toLowerCase() === 'code' ? 'code' : 'a prompt template'}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
      <UnsavedConfirmDialog />
    </>
  )
}
