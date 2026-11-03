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
    <div className="flex flex-col gap-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200 md:flex-row md:items-center md:justify-between md:gap-3 md:p-3 dark:bg-gray-800 dark:ring-gray-700">
      <div className="flex flex-col gap-1 text-center md:text-left">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{feedback}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Pontos confrontados: {completedPairs}
          <span className="hidden md:inline"> · arraste um ponto já marcado para ajustar a posição</span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:items-center">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 md:flex-row md:justify-start md:gap-1 md:rounded-md md:px-3 md:py-1.5 md:text-sm dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          <Undo2 size={20} className="md:h-4 md:w-4" />
          <span className="md:hidden">Desfazer</span>
          <span className="hidden md:inline">Desfazer último ponto</span>
        </button>

        <button
          onClick={onOpenProject}
          className="flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 md:flex-row md:justify-start md:gap-1 md:rounded-md md:px-3 md:py-1.5 md:text-sm dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          title="Abrir um confronto salvo anteriormente para continuar ou corrigir"
        >
          <FolderOpen size={20} className="md:h-4 md:w-4" />
          <span className="md:hidden">Abrir</span>
          <span className="hidden md:inline">Abrir edição</span>
        </button>

        <button
          onClick={onSaveProject}
          disabled={!canSaveProject}
          className="flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 md:flex-row md:justify-start md:gap-1 md:rounded-md md:px-3 md:py-1.5 md:text-sm dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          title="Salvar um arquivo editável para corrigir este confronto depois"
        >
          <Save size={20} className="md:h-4 md:w-4" />
          <span className="md:hidden">Salvar</span>
          <span className="hidden md:inline">Salvar edição</span>
        </button>

        <button
          onClick={onExport}
          disabled={!canExport || exporting}
          className="col-span-3 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 md:col-span-1 md:gap-1 md:rounded-md md:py-1.5 md:font-medium"
        >
          <Download size={18} className="md:h-4 md:w-4" />
          {exporting ? 'Exportando...' : 'Exportar Confronto'}
        </button>
      </div>
    </div>
  )
}
