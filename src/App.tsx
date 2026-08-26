import { useRef, useState } from 'react'
import html2canvas from 'html2canvas-pro'
import { Fingerprint, Hash, HelpCircle, Moon, MoveUpRight, Sun } from 'lucide-react'
import type { AppState, Coordinate, ImageSlot, ImageTransform } from './types'
import { DEFAULT_IMAGE_TRANSFORM } from './types'
import ImagePanel from './components/ImagePanel'
import ControlPanel from './components/ControlPanel'
import MinutiaeTable from './components/MinutiaeTable'
import Magnifier from './components/Magnifier'
import ExportDialog from './components/ExportDialog'
import { DEFAULT_MARKER_COLOR } from './colorPalette'
import { useTheme } from './useTheme'

const MANUAL_URL = `${import.meta.env.BASE_URL}manual.html`

const DEFAULT_MARKER_SIZE = 18
const MIN_MARKER_SIZE = 12
const MAX_MARKER_SIZE = 40
const DEFAULT_ARROW_THICKNESS = 1.5
const MIN_ARROW_THICKNESS = 0.5
const MAX_ARROW_THICKNESS = 5

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

const initialState: AppState = {
  imageA: null,
  imageB: null,
  minutiae: [],
  currentStep: 'WAITING_A',
  globalCounter: 1,
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [state, setState] = useState<AppState>(initialState)
  const [exporting, setExporting] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [markerSize, setMarkerSize] = useState(DEFAULT_MARKER_SIZE)
  const [showNumbers, setShowNumbers] = useState(true)
  const [arrowMode, setArrowMode] = useState(false)
  const [arrowThickness, setArrowThickness] = useState(DEFAULT_ARROW_THICKNESS)
  const [editing, setEditing] = useState<{ id: number; slot: ImageSlot } | null>(null)
  const [transformA, setTransformA] = useState<ImageTransform>(DEFAULT_IMAGE_TRANSFORM)
  const [transformB, setTransformB] = useState<ImageTransform>(DEFAULT_IMAGE_TRANSFORM)
  const captureRef = useRef<HTMLDivElement>(null)

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
          id: prev.globalCounter,
          color: DEFAULT_MARKER_COLOR,
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
      minutiae: prev.minutiae.map((m) =>
        m.id === prev.globalCounter ? { ...m, coordB: coord } : m,
      ),
      currentStep: 'WAITING_A',
      globalCounter: prev.globalCounter + 1,
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

  function handleChangeColor(id: number, color: string) {
    setState((prev) => ({
      ...prev,
      minutiae: prev.minutiae.map((m) => (m.id === id ? { ...m, color } : m)),
    }))
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
      const last = prev.minutiae[prev.minutiae.length - 1]
      const rest = prev.minutiae.slice(0, -1)
      if (last.coordB === null) {
        return { ...prev, minutiae: rest, currentStep: 'WAITING_A' }
      }
      return { ...prev, minutiae: rest, currentStep: 'WAITING_A', globalCounter: last.id }
    })
  }

  async function performExport(filename: string) {
    setShowExportDialog(false)
    if (!captureRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: 2,
        windowWidth: 1400,
      })
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.95)
      const link = document.createElement('a')
      link.href = jpegUrl
      link.download = `${sanitizeFilename(filename)}.jpg`
      link.click()
    } finally {
      setExporting(false)
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

      <div ref={captureRef} className="flex flex-col gap-4 bg-gray-50 p-2 md:flex-row dark:bg-gray-800/60">
        <ImagePanel
          slot="A"
          title="Imagem Questionada"
          image={state.imageA}
          minutiae={state.minutiae}
          markerSize={markerSize}
          showNumbers={showNumbers}
          arrowMode={arrowMode}
          arrowThickness={arrowThickness}
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
          slot="B"
          title="Imagem Padrão"
          image={state.imageB}
          minutiae={state.minutiae}
          markerSize={markerSize}
          showNumbers={showNumbers}
          arrowMode={arrowMode}
          arrowThickness={arrowThickness}
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
        onChangeColor={handleChangeColor}
        onDelete={handleDelete}
        onToggleNumber={handleToggleNumber}
      />

      <div className="flex flex-col gap-3 rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="flex items-center gap-3">
          <label htmlFor="marker-size" className="font-medium text-gray-600 dark:text-gray-300">
            Tamanho do ponto
          </label>
          <input
            id="marker-size"
            type="range"
            min={MIN_MARKER_SIZE}
            max={MAX_MARKER_SIZE}
            value={markerSize}
            onChange={(e) => setMarkerSize(Number(e.target.value))}
            className="w-32"
          />
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              value={markerSize}
              onChange={(e) => {
                if (e.target.value === '') return
                const v = Number(e.target.value)
                if (Number.isNaN(v)) return
                setMarkerSize(Math.min(MAX_MARKER_SIZE, Math.max(MIN_MARKER_SIZE, v)))
              }}
              className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <span className="text-gray-500 dark:text-gray-400">px</span>
          </div>
        </div>

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
          title="Com o modo seta ligado, arrastar um ponto move só o número (com uma seta até o ponto real)"
        >
          <MoveUpRight size={14} />
          Modo seta
        </button>

        <div className="flex items-center gap-3">
          <label htmlFor="arrow-thickness" className="font-medium text-gray-600 dark:text-gray-300">
            Grossura da seta
          </label>
          <input
            id="arrow-thickness"
            type="range"
            min={MIN_ARROW_THICKNESS}
            max={MAX_ARROW_THICKNESS}
            step={0.5}
            value={arrowThickness}
            onChange={(e) => setArrowThickness(Number(e.target.value))}
            className="w-32"
          />
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              step={0.5}
              value={arrowThickness}
              onChange={(e) => {
                if (e.target.value === '') return
                const v = Number(e.target.value)
                if (Number.isNaN(v)) return
                setArrowThickness(Math.min(MAX_ARROW_THICKNESS, Math.max(MIN_ARROW_THICKNESS, v)))
              }}
              className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <span className="text-gray-500 dark:text-gray-400">px</span>
          </div>
        </div>
      </div>
    </div>
  )
}
