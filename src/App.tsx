import { useRef, useState } from 'react'
import html2canvas from 'html2canvas-pro'
import { Fingerprint, Hash, HelpCircle, Moon, MoveUpRight, Sun } from 'lucide-react'
import type { AppState, Coordinate, ImageSlot, ImageTransform, ProjectFile } from './types'
import { DEFAULT_IMAGE_TRANSFORM } from './types'
import ImagePanel from './components/ImagePanel'
import ControlPanel from './components/ControlPanel'
import MinutiaeTable from './components/MinutiaeTable'
import Magnifier from './components/Magnifier'
import ExportDialog from './components/ExportDialog'
import { useTheme } from './useTheme'

const MANUAL_URL = `${import.meta.env.BASE_URL}manual.html`

function buildDefaultExportName() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const prefix = 'confronto_papiloscopico_'
  const suffix = `_${dd}_${mm}_${yyyy}`
  return { name: prefix + suffix, gap: prefix.length }
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'confronto_papiloscopico'
}

// Menor número inteiro positivo ainda não usado — preenche a lacuna deixada por um ponto excluído
// em vez de sempre continuar a contagem para frente.
function nextAvailableId(minutiae: { id: number }[]): number {
  const used = new Set(minutiae.map((m) => m.id))
  let n = 1
  while (used.has(n)) n++
  return n
}

const initialState: AppState = {
  imageA: null,
  imageB: null,
  minutiae: [],
  currentStep: 'WAITING_A',
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [state, setState] = useState<AppState>(initialState)
  const [exporting, setExporting] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showNumbers, setShowNumbers] = useState(true)
  const [arrowMode, setArrowMode] = useState(false)
  const [editing, setEditing] = useState<{ id: number; slot: ImageSlot } | null>(null)
  const [transformA, setTransformA] = useState<ImageTransform>(DEFAULT_IMAGE_TRANSFORM)
  const [transformB, setTransformB] = useState<ImageTransform>(DEFAULT_IMAGE_TRANSFORM)
  const captureRef = useRef<HTMLDivElement>(null)
  const panelARef = useRef<HTMLDivElement>(null)
  const panelBRef = useRef<HTMLDivElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(slot: 'A' | 'B', file: File) {
    const dataUrl = await readFileAsDataUrl(file)
    setState((prev) => ({
      ...prev,
      [slot === 'A' ? 'imageA' : 'imageB']: dataUrl,
    }))
    if (slot === 'A') setTransformA(DEFAULT_IMAGE_TRANSFORM)
    else setTransformB(DEFAULT_IMAGE_TRANSFORM)
  }

  function handleCreatePointA(coord: Coordinate) {
    if (state.currentStep !== 'WAITING_A' || !state.imageA) return
    setState((prev) => ({
      ...prev,
      minutiae: [
        ...prev.minutiae,
        {
          id: nextAvailableId(prev.minutiae),
          coordA: coord,
          coordB: null,
          labelOffsetA: { x: 0, y: 0 },
          labelOffsetB: { x: 0, y: 0 },
          hideNumber: false,
        },
      ],
      currentStep: 'WAITING_B',
    }))
  }

  function handleCreatePointB(coord: Coordinate) {
    if (state.currentStep !== 'WAITING_B' || !state.imageB) return
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) => (m.coordB === null ? { ...m, coordB: coord } : m)),
      currentStep: 'WAITING_A',
    }))
  }

  function handleMovePoint(slot: ImageSlot, id: number, coord: Coordinate) {
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) =>
        m.id === id ? { ...m, [slot === 'A' ? 'coordA' : 'coordB']: coord } : m,
      ),
    }))
  }

  function handleMoveLabel(slot: ImageSlot, id: number, offset: Coordinate) {
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) =>
        m.id === id ? { ...m, [slot === 'A' ? 'labelOffsetA' : 'labelOffsetB']: offset } : m,
      ),
    }))
  }

  function handleToggleNumber(id: number) {
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) => (m.id === id ? { ...m, hideNumber: !m.hideNumber } : m)),
    }))
  }

  function handleStartEdit(slot: ImageSlot, id: number) {
    setEditing({ id, slot })
  }

  function handleEndEdit() {
    setEditing(null)
  }

  function handleChangeId(oldId: number, newId: number): boolean {
    if (!Number.isInteger(newId) || newId <= 0) return false
    if (oldId === newId) return true
    if (state.minutiae.some((m) => m.id === newId)) return false
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) => (m.id === oldId ? { ...m, id: newId } : m)),
    }))
    return true
  }

  function handleReorder(id: number, direction: 'up' | 'down') {
    setState((prev) => {
      const idx = prev.minutiae.findIndex((m) => m.id === id)
      if (idx === -1) return prev
      const swapWith = direction === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= prev.minutiae.length) return prev
      const next = [...prev.minutiae]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return { ...prev, minutiae: next }
    })
  }

  function handleDelete(id: number) {
    setState((prev) => {
      const target = prev.minutiae.find((m) => m.id === id)
      const wasPending = target && target.coordB === null
      return {
        ...prev,
        minutiae: prev.minutiae.filter((m) => m.id !== id),
        currentStep: wasPending ? 'WAITING_A' : prev.currentStep,
      }
    })
  }

  function handleUndo() {
    setState((prev) => {
      if (prev.minutiae.length === 0) return prev
      const rest = prev.minutiae.slice(0, -1)
      return { ...prev, minutiae: rest, currentStep: 'WAITING_A' }
    })
  }

  function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.95)
    const link = document.createElement('a')
    link.href = jpegUrl
    link.download = filename
    link.click()
  }

  async function performExport(filename: string) {
    setShowExportDialog(false)
    if (!captureRef.current) return
    setExporting(true)
    try {
      const safeName = sanitizeFilename(filename)
      const combined = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: 2,
        windowWidth: 1400,
      })
      downloadCanvas(combined, `${safeName}.jpg`)

      if (panelARef.current) {
        const canvasA = await html2canvas(panelARef.current, { backgroundColor: '#ffffff', useCORS: true, scale: 2 })
        downloadCanvas(canvasA, `${safeName}_questionada.jpg`)
      }
      if (panelBRef.current) {
        const canvasB = await html2canvas(panelBRef.current, { backgroundColor: '#ffffff', useCORS: true, scale: 2 })
        downloadCanvas(canvasB, `${safeName}_padrao.jpg`)
      }
    } finally {
      setExporting(false)
    }
  }

  function performSaveProject(filename: string) {
    setShowSaveDialog(false)
    const project: ProjectFile = { version: 1, state, transformA, transformB }
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${sanitizeFilename(filename)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleOpenProjectFile(file: File) {
    try {
      const text = await readFileAsText(file)
      const project = JSON.parse(text) as ProjectFile
      if (!project || project.version !== 1 || !project.state) {
        window.alert('Arquivo de edição inválido.')
        return
      }
      setState(project.state)
      setTransformA(project.transformA ?? DEFAULT_IMAGE_TRANSFORM)
      setTransformB(project.transformB ?? DEFAULT_IMAGE_TRANSFORM)
      setEditing(null)
    } catch {
      window.alert('Não foi possível abrir esse arquivo de edição.')
    }
  }

  const hasImages = !!state.imageA && !!state.imageB
  const completedPairs = state.minutiae.filter((m) => m.coordA && m.coordB).length

  const editingMinutia = editing ? state.minutiae.find((m) => m.id === editing.id) ?? null : null
  const defaultExportName = buildDefaultExportName()

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Fingerprint className="text-blue-600" size={28} />
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Confronto Papiloscópico</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Processamento 100% local — nenhuma imagem é enviada a servidores
          </p>
        </div>
        <a
          href={MANUAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700"
          title="Abrir o manual de uso"
        >
          <HelpCircle size={18} />
          Dúvidas
        </a>
        <button
          onClick={toggleTheme}
          className="rounded-md bg-white p-2 text-gray-600 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700"
          title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <ControlPanel
        currentStep={state.currentStep}
        completedPairs={completedPairs}
        hasImages={hasImages}
        onUndo={handleUndo}
        canUndo={state.minutiae.length > 0}
        onExport={() => setShowExportDialog(true)}
        canExport={hasImages && completedPairs > 0}
        exporting={exporting}
        onSaveProject={() => setShowSaveDialog(true)}
        canSaveProject={hasImages}
        onOpenProject={() => projectInputRef.current?.click()}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleOpenProjectFile(file)
          e.target.value = ''
        }}
      />

      {editing && editingMinutia && editingMinutia.coordA && editingMinutia.coordB && state.imageA && state.imageB && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-6 rounded-xl bg-white/95 p-4 shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-800/95 dark:ring-gray-700">
            <Magnifier
              image={state.imageA}
              point={editingMinutia.coordA}
              label={editing.slot === 'A' ? 'Editando · Imagem A' : 'Referência · Imagem A'}
              variant={editing.slot === 'A' ? 'editing' : 'reference'}
              rotation={transformA.rotation}
              flipped={transformA.flipped}
              inverted={transformA.inverted}
              contrast={transformA.contrast}
            />
            <Magnifier
              image={state.imageB}
              point={editingMinutia.coordB}
              label={editing.slot === 'B' ? 'Editando · Imagem B' : 'Referência · Imagem B'}
              variant={editing.slot === 'B' ? 'editing' : 'reference'}
              rotation={transformB.rotation}
              flipped={transformB.flipped}
              inverted={transformB.inverted}
              contrast={transformB.contrast}
            />
          </div>
        </div>
      )}

      {showExportDialog && (
        <ExportDialog
          defaultName={defaultExportName.name}
          gapStart={defaultExportName.gap}
          gapEnd={defaultExportName.gap}
          onConfirm={performExport}
          onCancel={() => setShowExportDialog(false)}
        />
      )}

      {showSaveDialog && (
        <ExportDialog
          title="Salvar edição"
          extension=".json"
          confirmLabel="Salvar"
          defaultName={`${defaultExportName.name}_edicao`}
          gapStart={defaultExportName.gap}
          gapEnd={defaultExportName.gap}
          onConfirm={performSaveProject}
          onCancel={() => setShowSaveDialog(false)}
        />
      )}

      <div ref={captureRef} className="flex flex-col gap-4 bg-gray-50 p-2 md:flex-row dark:bg-gray-800/60">
        <ImagePanel
          ref={panelARef}
          slot="A"
          title="Imagem Questionada"
          image={state.imageA}
          minutiae={state.minutiae}
          showNumbers={showNumbers}
          arrowMode={arrowMode}
          transform={transformA}
          onTransformChange={setTransformA}
          otherImage={state.imageB}
          otherTransform={transformB}
          canCreate={state.currentStep === 'WAITING_A'}
          onUpload={(file) => handleUpload('A', file)}
          onCreatePoint={handleCreatePointA}
          onMovePoint={(id, coord) => handleMovePoint('A', id, coord)}
          onMoveLabel={(id, offset) => handleMoveLabel('A', id, offset)}
          onStartEdit={(id) => handleStartEdit('A', id)}
          onEndEdit={handleEndEdit}
        />
        <ImagePanel
          ref={panelBRef}
          slot="B"
          title="Imagem Padrão"
          image={state.imageB}
          minutiae={state.minutiae}
          showNumbers={showNumbers}
          arrowMode={arrowMode}
          transform={transformB}
          onTransformChange={setTransformB}
          otherImage={state.imageA}
          otherTransform={transformA}
          canCreate={state.currentStep === 'WAITING_B'}
          onUpload={(file) => handleUpload('B', file)}
          onCreatePoint={handleCreatePointB}
          onMovePoint={(id, coord) => handleMovePoint('B', id, coord)}
          onMoveLabel={(id, offset) => handleMoveLabel('B', id, offset)}
          onStartEdit={(id) => handleStartEdit('B', id)}
          onEndEdit={handleEndEdit}
        />
      </div>

      <MinutiaeTable
        minutiae={state.minutiae}
        onChangeId={handleChangeId}
        onReorder={handleReorder}
        onDelete={handleDelete}
        onToggleNumber={handleToggleNumber}
      />

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700 sm:flex-row sm:items-center sm:flex-wrap">
        <button
          onClick={() => setShowNumbers((v) => !v)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium shadow-sm ring-1 ${
            showNumbers
              ? 'bg-blue-600 text-white ring-blue-600'
              : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-600'
          }`}
          title="Mostrar ou ocultar o número de todos os pontos"
        >
          <Hash size={14} />
          Mostrar números
        </button>

        <button
          onClick={() => setArrowMode((v) => !v)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium shadow-sm ring-1 ${
            arrowMode
              ? 'bg-blue-600 text-white ring-blue-600'
              : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-600'
          }`}
          title="Com o modo linha ligado, arrastar um ponto move só o número (com uma linha até o ponto real)"
        >
          <MoveUpRight size={14} />
          Modo linha
        </button>
      </div>
    </div>
  )
}
