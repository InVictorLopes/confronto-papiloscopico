import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'

interface ExportDialogProps {
  defaultName: string
  gapStart: number
  gapEnd: number
  onConfirm: (filename: string) => void
  onCancel: () => void
}

export default function ExportDialog({
  defaultName,
  gapStart,
  gapEnd,
  onConfirm,
  onCancel,
}: ExportDialogProps) {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(gapStart, gapEnd)
  }, [gapStart, gapEnd])

  function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            Exportar confronto
          </h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Nome do arquivo
        </label>
        <div className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 dark:border-gray-600">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') onCancel()
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none dark:text-gray-100"
          />
          <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">.jpg</span>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </div>
    </div>
  )
}
