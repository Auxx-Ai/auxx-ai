'use client'

import { useState, useEffect, useRef } from 'react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import {
  FileQuestion,
  ArrowRight,
  Loader2,
  X,
  Check,
  AlertCircle,
  Download,
  FileSpreadsheet,
} from 'lucide-react'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Progress } from '@auxx/ui/components/progress'

// Move this outside the component to prevent recreation on each render
// Sample field definitions - replace with your actual field definitions
const FIELD_DEFINITIONS = [
  {
    id: 'subPartSku',
    label: 'Subpart SKU',
    required: true,
    description: 'The SKU of the component part',
    matchTerms: ['sku', 'part number', 'part_number', 'partno', 'part no', 'part_sku'],
  },
  {
    id: 'quantity',
    label: 'Quantity',
    required: true,
    description: 'Number of units needed (must be a number)',
    matchTerms: ['qty', 'quantity', 'amount', 'count', 'units'],
  },
  {
    id: 'notes',
    label: 'Notes',
    required: false,
    description: 'Optional notes about this component usage',
    matchTerms: ['notes', 'note', 'description', 'comment', 'comments'],
  },
]

export function CSVColumnMapper({
  onDataImported, // Callback function that receives the mapped data
  parentPartId, // Optional parent part ID if we're mapping subparts
  isOpen = false, // Control the dialog open state
  setIsOpen, // Function to set the dialog open state
  availableParts = [], // Available parts data for validation
}: {
  onDataImported: (data: any[]) => void // Callback to handle imported data
  parentPartId?: string // Optional parent part ID for subparts
  isOpen?: boolean // Control the dialog open state
  setIsOpen: (open: boolean) => void // Function to set the dialog open state
  availableParts?: { id: string; sku: string }[] // Available parts for validation
}) {
  // const [isOpen, setIsOpen] = useState(false)
  const [csvData, setCsvData] = useState(null)
  const [sampleRows, setSampleRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [columnMappings, setColumnMappings] = useState({})
  const [validationErrors, setValidationErrors] = useState([])
  const [missingRequiredFields, setMissingRequiredFields] = useState([])
  const [step, setStep] = useState(1) // 1: Upload, 2: Map, 3: Preview
  const [isMappingComplete, setIsMappingComplete] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progressValue, setProgressValue] = useState(0)
  const [activeTab, setActiveTab] = useState('map')
  const fileInputRef = useRef(null)

  const requiredFields = FIELD_DEFINITIONS.filter((field) => field.required).map(
    (field) => field.id
  )

  // Reset the state when dialog is opened/closed
  useEffect(() => {
    if (!isOpen) {
      // Reset everything but keep the last successful mapping for reuse
      setCsvData(null)
      setSampleRows([])
      setHeaders([])
      setValidationErrors([])
      setMissingRequiredFields([])
      setStep(1)
      setProgressValue(0)
      setActiveTab('map')
    }
  }, [isOpen])

  // Fix for potential infinite loop - remove requiredFields from dependency array
  // since it's a constant derived from FIELD_DEFINITIONS
  useEffect(() => {
    const mappedFields = Object.values(columnMappings)
    const missingFields = requiredFields.filter((field) => !mappedFields.includes(field))

    // Only update state if values have changed
    if (JSON.stringify(missingFields) !== JSON.stringify(missingRequiredFields)) {
      setMissingRequiredFields(missingFields)
      setIsMappingComplete(missingFields.length === 0)
    }
  }, [columnMappings, missingRequiredFields])

  // Process file upload
  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const csv = e.target.result
        processCSV(csv)
      } catch (error) {
        toastError({ title: 'Failed to parse CSV file' })
        console.error(error)
      }
    }
    reader.readAsText(file)
  }

  // Process CSV content
  const processCSV = (csv) => {
    // Split into rows and detect delimiter
    const rows = csv.split(/\r?\n/).filter((row) => row.trim()) as string[]
    if (rows.length === 0) {
      toastError({ title: 'CSV file appears to be empty' })
      return
    }

    // Detect delimiter (comma, semicolon, tab)
    const detectedDelimiter = detectDelimiter(rows[0])

    // Parse headers and sample data
    const headerRow = rows[0]
      .split(detectedDelimiter)
      .map((h) => h.trim().replace(/^["']|["']$/g, ''))

    // Extract sample rows (up to 5)
    const samples = rows.slice(1, 6).map((row) => {
      const cells = row
        .split(detectedDelimiter)
        .map((cell) => cell.trim().replace(/^["']|["']$/g, ''))
      // Ensure we have the same number of cells as headers
      while (cells.length < headerRow.length) cells.push('')
      return cells
    })

    // Store the parsed data
    setCsvData(csv)
    setHeaders(headerRow)
    setSampleRows(samples)

    // Auto-map columns based on header names
    const automaticMappings = {}
    headerRow.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim()

      // Try to find a matching field
      const matchedField = FIELD_DEFINITIONS.find(
        (field) =>
          field.label.toLowerCase() === normalizedHeader ||
          field.matchTerms.some((term) => normalizedHeader.includes(term))
      )

      if (matchedField) {
        automaticMappings[index] = matchedField.id
      }
    })

    setColumnMappings(automaticMappings)
    setStep(2)
  }

  // Detect the delimiter used in the CSV
  const detectDelimiter = (line) => {
    const delimiters = [',', ';', '\t', '|']
    const counts = delimiters.map((delimiter) => {
      return { delimiter, count: line.split(delimiter).length - 1 }
    })

    // Sort by count in descending order
    counts.sort((a, b) => b.count - a.count)
    return counts[0].count > 0 ? counts[0].delimiter : ','
  }

  // Update column mapping
  const updateMapping = (columnIndex, fieldId) => {
    // If field is already mapped to another column, remove that mapping
    const existingMapping = Object.entries(columnMappings).find(
      ([key, value]) => value === fieldId && parseInt(key) !== columnIndex
    )

    if (existingMapping) {
      const newMappings = { ...columnMappings }
      delete newMappings[existingMapping[0]]
      setColumnMappings({ ...newMappings, [columnIndex]: fieldId })
    } else {
      setColumnMappings({ ...columnMappings, [columnIndex]: fieldId })
    }
  }

  // Remove a mapping
  const removeMapping = (columnIndex) => {
    const newMappings = { ...columnMappings }
    delete newMappings[columnIndex]
    setColumnMappings(newMappings)
  }

  // Validate the mappings and move to preview
  const validateAndPreview = () => {
    if (missingRequiredFields.length > 0) {
      toastError({
        title: 'Missing required fields',
        description: `${missingRequiredFields
          .map((field) => {
            const def = FIELD_DEFINITIONS.find((f) => f.id === field)
            return def ? def.label : field
          })
          .join(', ')}`,
      })
      return
    }

    setActiveTab('preview')
    validateData()
  }

  // Validate the data based on mappings
  const validateData = () => {
    if (!csvData) return

    setIsProcessing(true)
    setValidationErrors([])

    // Parse the full CSV data
    const rows = csvData.split(/\r?\n/).filter((row) => row.trim())
    const delimiter = detectDelimiter(rows[0])

    // Skip header row
    const dataRows = rows.slice(1)
    const errors = []

    // Process each row
    dataRows.forEach((row, rowIndex) => {
      const cells = row.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ''))

      // Skip empty rows
      if (cells.every((cell) => !cell)) return

      const rowErrors = []

      // Validate each mapped field
      Object.entries(columnMappings).forEach(([colIndex, fieldId]) => {
        const value = cells[colIndex] || ''
        const field = FIELD_DEFINITIONS.find((f) => f.id === fieldId)

        if (field?.required && !value) {
          rowErrors.push({ field: field.label, message: 'Required field is empty' })
        }

        // Specific validation for known fields
        if (fieldId === 'quantity' && value) {
          const num = parseFloat(value)
          if (isNaN(num) || num <= 0) {
            rowErrors.push({ field: field.label, message: 'Quantity must be a positive number' })
          }
        }

        if (fieldId === 'subPartSku' && value) {
          const matchingPart = availableParts.find(
            (part) => part.sku.toLowerCase() === value.toLowerCase()
          )

          if (!matchingPart) {
            rowErrors.push({ field: field.label, message: `No part found with SKU "${value}"` })
          } else if (matchingPart.id === parentPartId) {
            rowErrors.push({ field: field.label, message: 'Part cannot be a subpart of itself' })
          }
        }
      })

      if (rowErrors.length > 0) {
        errors.push({
          row: rowIndex + 2, // +2 for 1-based indexing and header row
          errors: rowErrors,
        })
      }

      // Update progress
      setProgressValue(Math.floor(((rowIndex + 1) / dataRows.length) * 100))
    })

    setValidationErrors(errors)
    setStep(3)
    setIsProcessing(false)
  }

  // Process and import the data
  const processImport = () => {
    if (!csvData || !isMappingComplete) return

    setIsProcessing(true)

    // Parse the full CSV data
    const rows = csvData.split(/\r?\n/).filter((row) => row.trim())
    const delimiter = detectDelimiter(rows[0])

    // Skip header row
    const dataRows = rows.slice(1)
    const mappedData = []

    // Process each row
    dataRows.forEach((row, rowIndex) => {
      const cells = row.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ''))

      // Skip empty rows
      if (cells.every((cell) => !cell)) return

      const mappedRow = {}
      let skipRow = false

      // Map each field
      Object.entries(columnMappings).forEach(([colIndex, fieldId]) => {
        const value = cells[colIndex] || ''

        if (fieldId === 'subPartSku' && value) {
          const matchingPart = availableParts.find(
            (part) => part.sku.toLowerCase() === value.toLowerCase()
          )

          if (!matchingPart) {
            skipRow = true
          } else if (matchingPart.id === parentPartId) {
            skipRow = true
          } else {
            // Store the part ID instead of SKU
            mappedRow.subPartId = matchingPart.id
          }
        } else if (fieldId === 'quantity' && value) {
          mappedRow[fieldId] = parseInt(value) || 1
        } else {
          mappedRow[fieldId] = value
        }
      })

      if (!skipRow && mappedRow.subPartId) {
        mappedData.push(mappedRow)
      }

      // Update progress
      setProgressValue(Math.floor(((rowIndex + 1) / dataRows.length) * 100))
    })

    // Call the onDataImported callback with the mapped data
    onDataImported(mappedData)

    setIsProcessing(false)
    setIsOpen(false)
    toastSuccess({ title: `Imported ${mappedData.length} subparts successfully` })
  }

  // Download template CSV
  const downloadTemplate = () => {
    const fields = FIELD_DEFINITIONS.map((field) => field.label)
    const csvContent = [fields.join(',')].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'subparts_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Import Subparts from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file and map its columns to the required fields
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="map" disabled={!csvData}>
                Map Columns
              </TabsTrigger>
              <TabsTrigger value="preview" disabled={!isMappingComplete || !csvData}>
                Preview & Validate
              </TabsTrigger>
            </TabsList>

            <TabsContent value="map" className="space-y-4 py-4">
              {step === 1 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium">Upload CSV File</h3>
                      <p className="text-sm text-muted-foreground">
                        Select a CSV file with subpart information
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadTemplate}
                      className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      Template
                    </Button>
                  </div>

                  <div className="flex w-full items-center justify-center">
                    <Label
                      htmlFor="csv-file"
                      className="flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 hover:bg-muted/50">
                      <div className="flex flex-col items-center justify-center pb-6 pt-5">
                        <FileSpreadsheet className="mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="mb-2 text-sm text-muted-foreground">
                          <span className="font-semibold">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-muted-foreground">CSV files only</p>
                      </div>
                      <Input
                        id="csv-file"
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </Label>
                  </div>

                  <Alert>
                    <FileQuestion className="h-4 w-4" />
                    <AlertTitle>CSV Format</AlertTitle>
                    <AlertDescription>
                      Your CSV should include columns for Subpart SKU, Quantity, and optional Notes.
                      Don't worry if your headers don't match exactly - you'll be able to map them
                      in the next step.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : step === 2 ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-medium">Map CSV Columns</h3>
                      <p className="text-sm text-muted-foreground">
                        Match your CSV columns to the required fields
                      </p>
                    </div>

                    <Button size="sm" disabled={!isMappingComplete} onClick={validateAndPreview}>
                      Continue to Preview
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>

                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">CSV Column</TableHead>
                          <TableHead className="w-[180px]">Map To Field</TableHead>
                          <TableHead>Sample Values</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {headers.map((header, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{header}</TableCell>
                            <TableCell>
                              <Select
                                value={columnMappings[index] || ''}
                                onValueChange={(value) => updateMapping(index, value)}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select field" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="no-mapping">-- Not Mapped --</SelectItem>
                                  {FIELD_DEFINITIONS.map((field) => (
                                    <SelectItem key={field.id} value={field.id}>
                                      {field.label} {field.required && '*'}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              <div className="max-w-[200px] overflow-hidden text-ellipsis">
                                {sampleRows.map((row, i) => (
                                  <div key={i} className="truncate">
                                    {row[index] || (
                                      <span className="italic text-muted-foreground">empty</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {columnMappings[index] && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeMapping(index)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="font-medium">Required Fields:</div>
                    <div className="flex flex-wrap gap-2">
                      {FIELD_DEFINITIONS.filter((f) => f.required).map((field) => {
                        const isMapped = Object.values(columnMappings).includes(field.id)
                        return (
                          <div
                            key={field.id}
                            className={`flex items-center rounded-md px-2 py-1 text-xs ${
                              isMapped
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                            {isMapped ? (
                              <Check className="mr-1 h-3 w-3" />
                            ) : (
                              <AlertCircle className="mr-1 h-3 w-3" />
                            )}
                            {field.label}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="preview" className="space-y-4 py-4">
              {isProcessing ? (
                <div className="space-y-4 py-8">
                  <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                    <h3 className="font-medium">Processing CSV Data</h3>
                    <p className="text-sm text-muted-foreground">
                      Validating rows and checking for errors...
                    </p>
                  </div>
                  <Progress value={progressValue} className="w-full" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-medium">Preview Import Data</h3>
                      <p className="text-sm text-muted-foreground">
                        Review the data before importing
                      </p>
                    </div>
                  </div>

                  {validationErrors.length > 0 ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Validation Errors Found</AlertTitle>
                      <AlertDescription>
                        There are {validationErrors.length} row(s) with errors that need to be fixed
                        before importing.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="default" className="border-green-200 bg-green-50">
                      <Check className="h-4 w-4 text-green-600" />
                      <AlertTitle className="text-green-800">Ready to Import</AlertTitle>
                      <AlertDescription className="text-green-700">
                        No validation errors were found. You can proceed with the import.
                      </AlertDescription>
                    </Alert>
                  )}

                  {validationErrors.length > 0 && (
                    <div className="overflow-hidden rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Row</TableHead>
                            <TableHead>Field</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {validationErrors.map((error, i) =>
                            error.errors.map((fieldError, j) => (
                              <TableRow key={`${i}-${j}`}>
                                <TableCell>{error.row}</TableCell>
                                <TableCell>{fieldError.field}</TableCell>
                                <TableCell className="text-red-600">{fieldError.message}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isProcessing}>
              Cancel
            </Button>

            {activeTab === 'preview' && (
              <Button
                onClick={processImport}
                disabled={isProcessing || validationErrors.length > 0}
                loading={isProcessing}
                loadingText="Processing...">
                Import Data
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
