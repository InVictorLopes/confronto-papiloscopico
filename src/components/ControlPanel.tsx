import { Download, FolderOpen, Save, Undo2 } from 'lucide-react'
import type { ComparisonStep } from '../types'

interface ControlPanelProps {
  currentStep: ComparisonStep
  completedPairs: number
  hasImages: boolean
  onUndo: () => void
  canUndo: boolean
  onExport: () => void
  canExport: boolean
  exporting: boolean
  onSaveProject: () => void
  canSaveProject: boolean
  onOpenProject: () => void
}

export default function ControlPanel({
  currentStep,
  completedPairs,
  hasImages,
  onUndo,
  canUndo,
  onExport,
  canExport,
  exporting,
  onSaveProject,
  canSaveProject,
  onOpenProject,
}: ControlPanelProps) {
  const feedback = !hasImages
    ? 'Carregue as duas imagens para iniciar a marcação'
    : currentStep === 'WAITING_A'
      ? 'Marque o próximo ponto na Imagem Questionada (A).'
      : 'Agora marque o ponto correspondente na Imagem Padrão (B).'

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-200 md:flex-row md:items-center md:justify-between dark:bg-gray-800 dark:ring-gray-700">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{feedback}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Pontos confrontados: {completedPairs} · arraste um ponto já marcado para ajustar a posição
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          <Undo2 size={16} />
          Desfazer último ponto
        </button>

        <button
          onClick={onOpenProject}
          className="flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          title="Abrir um confronto salvo anteriormente para continuar ou corrigir"
        >
          <FolderOpen size={16} />
          Abrir edição
        </button>

        <button
          onClick={onSaveProject}
          disabled={!canSaveProject}
          className="flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          title="Salvar um arquivo editável para corrigir este confronto depois"
        >
          <Save size={16} />
          Salvar edição
        </button>

        <button
          onClick={onExport}
          disabled={!canExport || exporting}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          {exporting ? 'Exportando...' : 'Exportar Confronto'}
        </button>
      </div>
    </div>
  )
}
