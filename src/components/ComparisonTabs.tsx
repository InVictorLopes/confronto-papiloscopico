import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'

export interface ComparisonTabMeta {
  id: string
  name: string
}

interface ComparisonTabsProps {
  tabs: ComparisonTabMeta[]
  activeTabId: string
  onSwitch: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onClose: (id: string) => void
}

// Abas estilo Excel: cada uma guarda um confronto independente (imagens, pontos, recorte
// e ajustes) — trocar de aba nunca descarta o que foi feito nas outras (ver App.tsx).
export default function ComparisonTabs({ tabs, activeTabId, onSwitch, onAdd, onRename, onClose }: ComparisonTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.select()
  }, [editingId])

  function startRenaming(tab: ComparisonTabMeta) {
    setEditingId(tab.id)
    setDraft(tab.name)
  }

  function commit() {
    if (editingId) onRename(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="flex flex-wrap items-end gap-1 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            onDoubleClick={() => startRenaming(tab)}
            className={`group flex cursor-pointer items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
              active
                ? 'border-gray-200 bg-white font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
                : 'border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-900/40 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
            title="Clique para abrir esta aba — duplo clique para renomear"
          >
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-28 rounded border border-blue-400 bg-white px-1 py-0.5 text-gray-800 outline-none dark:bg-gray-900 dark:text-gray-100"
              />
            ) : (
              <span className="max-w-[10rem] truncate">{tab.name}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                startRenaming(tab)
              }}
              className="rounded p-0.5 text-gray-400 opacity-0 hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
              title="Renomear aba"
            >
              <Pencil size={11} />
            </button>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
                className="rounded p-0.5 text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/40"
                title="Fechar aba"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={onAdd}
        className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        title="Nova aba — cria um confronto novo, independente dos outros"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
