import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import type { Minutia } from '../types'

interface MinutiaeTableProps {
  minutiae: Minutia[]
  onChangeId: (oldId: number, newId: number) => boolean
  onReorder: (id: number, direction: 'up' | 'down') => void
  onDelete: (id: number) => void
  onToggleNumber: (id: number) => void
}

function IdCell({ id, onChangeId }: { id: number; onChangeId: (oldId: number, newId: number) => boolean }) {
  const [draft, setDraft] = useState(String(id))
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mantém o campo sincronizado quando o número muda por fora (ex: exclusão de outro ponto),
  // sem sobrescrever o que o usuário está digitando neste momento.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(id))
  }, [id])

  function commit() {
    const n = Number(draft)
    if (draft.trim() === '' || !onChangeId(id, n)) {
      setInvalid(true)
      setDraft(String(id))
      window.setTimeout(() => setInvalid(false), 1200)
      return
    }
    setInvalid(false)
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(String(id))
          setInvalid(false)
        }
      }}
      title="Editar o número deste ponto"
      className={`h-8 w-14 rounded-full border-2 bg-white text-center font-bold [appearance:textfield] dark:bg-gray-900 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
        invalid ? 'border-amber-500 text-amber-600' : 'border-red-600 text-red-600'
      }`}
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    />
  )
}

export default function MinutiaeTable({
  minutiae,
  onChangeId,
  onReorder,
  onDelete,
  onToggleNumber,
}: MinutiaeTableProps) {
  if (minutiae.length === 0) {
    return (
      <div className="rounded-lg bg-white p-4 text-center text-sm text-gray-400 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:ring-gray-700">
        Nenhum ponto marcado ainda.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/40">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Nº</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Status</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {minutiae.map((m, index) => {
            const pending = m.coordB === null
            return (
              <tr key={m.id} className={pending ? 'bg-amber-50 dark:bg-amber-900/20' : undefined}>
                <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                  <IdCell id={m.id} onChangeId={onChangeId} />
                </td>
                <td className="px-3 py-2">
                  {pending ? (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Aguardando Imagem B</span>
                  ) : (
                    <span className="text-xs font-medium text-green-600 dark:text-green-400">Par completo</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col">
                      <button
                        onClick={() => onReorder(m.id, 'up')}
                        disabled={index === 0}
                        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                        title="Mover para cima na lista"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => onReorder(m.id, 'down')}
                        disabled={index === minutiae.length - 1}
                        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                        title="Mover para baixo na lista"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <button
                      onClick={() => onToggleNumber(m.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      title={m.hideNumber ? 'Mostrar número deste ponto' : 'Ocultar número deste ponto'}
                    >
                      {m.hideNumber ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => onDelete(m.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                    >
                      <Trash2 size={14} />
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
        Dica: arraste o marcador diretamente na imagem para reposicionar um ponto com precisão. Ao excluir um ponto, o
        próximo criado reaproveita o número que ficou faltando na sequência.
      </p>
    </div>
  )
}
