import { useRef, useState } from 'react'
import { Check, Download, Pencil, X } from 'lucide-react'

export type ExportKind = 'questionada' | 'padrao' | 'conjunto' | 'edicao'

export interface ExportSelection {
  kind: ExportKind
  filename: string // sem extensão
}

interface MultiExportDialogProps {
  dateSuffix: string // ex: "02_09_2026"
  onConfirm: (selections: ExportSelection[]) => void
  onCancel: () => void
}

const KIND_ORDER: ExportKind[] = ['questionada', 'padrao', 'conjunto', 'edicao']

const KIND_LABEL: Record<ExportKind, string> = {
  questionada: 'Imagem Questionada',
  padrao: 'Imagem Padrão',
  conjunto: 'O conjunto',
  edicao: 'A edição',
}

const KIND_PREFIX: Record<ExportKind, string> = {
  questionada: 'Imagem_questionada',
  padrao: 'Imagem_padrao',
  conjunto: 'confronto_papiloscopico',
  edicao: 'Edicao',
}

const KIND_EXT: Record<ExportKind, string> = {
  questionada: '.jpg',
  padrao: '.jpg',
  conjunto: '.jpg',
  edicao: '.json',
}

function autoName(kind: ExportKind, caseId: string, dateSuffix: string) {
  return `${KIND_PREFIX[kind]}_CAD_${caseId}_${dateSuffix}`
}

export default function MultiExportDialog({ dateSuffix, onConfirm, onCancel }: MultiExportDialogProps) {
  const [caseId, setCaseId] = useState('')
  const [selected, setSelected] = useState<Record<ExportKind, boolean>>({
    questionada: true,
    padrao: true,
    conjunto: true,
    edicao: true,
  })
  const [overrides, setOverrides] = useState<Record<ExportKind, string | null>>({
    questionada: null,
    padrao: null,
    conjunto: null,
    edicao: null,
  })
  const [editingKind, setEditingKind] = useState<ExportKind | null>(null)
  const [draft, setDraft] = useState('')
  const caseIdInputRef = useRef<HTMLInputElement>(null)

  function effectiveName(kind: ExportKind) {
    return overrides[kind] ?? autoName(kind, caseId, dateSuffix)
  }

  function startEditing(kind: ExportKind) {
    setDraft(effectiveName(kind))
    setEditingKind(kind)
  }

  function commitEditing() {
    if (!editingKind) return
    const trimmed = draft.trim()
    setOverrides((prev) => ({ ...prev, [editingKind]: trimmed || null }))
    setEditingKind(null)
  }

  function resetOverride(kind: ExportKind) {
    setOverrides((prev) => ({ ...prev, [kind]: null }))
  }

  function handleSubmit() {
    const selections: ExportSelection[] = KIND_ORDER.filter((k) => selected[k]).map((k) => ({
      kind: k,
      filename: effectiveName(k),
    }))
    if (selections.length > 0) onConfirm(selections)
  }

  const anySelected = KIND_ORDER.some((k) => selected[k])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Exportar confronto</h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Identificador do caso — aplicado ao nome de todos os arquivos abaixo
        </label>
        <div className="mb-4 flex flex-wrap items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-blue-500 dark:border-gray-600">
          <span className="text-gray-400 dark:text-gray-500">confronto_papiloscopico_CAD_</span>
          <input
            ref={caseIdInputRef}
            type="text"
            autoFocus
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') onCancel()
            }}
            className="min-w-[4rem] flex-1 bg-transparent text-gray-800 outline-none dark:text-gray-100"
          />
          <span className="text-gray-400 dark:text-gray-500">_{dateSuffix}</span>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {KIND_ORDER.map((kind) => (
            <div
              key={kind}
              className="flex flex-col gap-1 rounded-md px-2 py-1.5 ring-1 ring-gray-100 dark:ring-gray-700"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected[kind]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [kind]: e.target.checked }))}
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="w-32 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">
                  {KIND_LABEL[kind]}
                </span>
                {editingKind === kind ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEditing()
                        if (e.key === 'Escape') setEditingKind(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    />
                    <button
                      onClick={commitEditing}
                      className="shrink-0 rounded p-1 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
                      title="Confirmar nome"
                    >
                      <Check size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {effectiveName(kind)}
                      {KIND_EXT[kind]}
                    </span>
                    <button
                      onClick={() => startEditing(kind)}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700"
                      title="Editar o nome deste arquivo"
                    >
                      <Pencil size={14} />
                    </button>
                    {overrides[kind] !== null && (
                      <button
                        onClick={() => resetOverride(kind)}
                        className="shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        title="Voltar a seguir o identificador do caso"
                      >
                        Restaurar
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!anySelected}
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
