import { Trash2 } from 'lucide-react'
import type { Minutia } from '../types'

interface MinutiaeTableProps {
  minutiae: Minutia[]
  onChangeColor: (id: number, color: string) => void
  onDelete: (id: number) => void
}

const QUICK_COLORS = [
  { value: '#dc2626', label: 'Vermelho' },
  { value: '#2563eb', label: 'Azul' },
]

export default function MinutiaeTable({ minutiae, onChangeColor, onDelete }: MinutiaeTableProps) {
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
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">ID</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Cor</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Status</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {minutiae.map((m) => {
            const pending = m.coordB === null
            return (
              <tr key={m.id} className={pending ? 'bg-amber-50 dark:bg-amber-900/20' : undefined}>
                <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                  <span
                    className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.id}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {QUICK_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => onChangeColor(m.id, c.value)}
                        className={`h-6 w-6 rounded-full ring-2 ring-offset-1 transition dark:ring-offset-gray-800 ${
                          m.color.toLowerCase() === c.value
                            ? 'ring-gray-500 dark:ring-gray-400'
                            : 'ring-transparent hover:ring-gray-300 dark:hover:ring-gray-500'
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      />
                    ))}
                    <input
                      type="color"
                      value={m.color}
                      onChange={(e) => onChangeColor(m.id, e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border border-gray-300 p-0.5 dark:border-gray-600"
                      title="Escolher outra cor"
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  {pending ? (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Aguardando Imagem B</span>
                  ) : (
                    <span className="text-xs font-medium text-green-600 dark:text-green-400">Par completo</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onDelete(m.id)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                  >
                    <Trash2 size={14} />
                    Excluir
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
        Dica: arraste o marcador diretamente na imagem para reposicionar um ponto com precisão.
      </p>
    </div>
  )
}
