import { useRef, useState } from 'react'
import html2canvas from 'html2canvas-pro'
import { Fingerprint } from 'lucide-react'
import type { AppState, Coordinate, ImageSlot, ImageTransform } from './types'
import { DEFAULT_IMAGE_TRANSFORM } from './types'
import ImagePanel from './components/ImagePanel'
import ControlPanel from './components/ControlPanel'
import MinutiaeTable from './components/MinutiaeTable'
import Magnifier from './components/Magnifier'
import { DEFAULT_MARKER_COLOR } from './colorPalette'

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
  const [state, setState] = useState<AppState>(initialState)
  const [exporting, setExporting] = useState(false)
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

  async function handleExport() {
    if (!captureRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: 2,
      })
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.95)
      const link = document.createElement('a')
      link.href = jpegUrl
      link.download = `confronto-papiloscopico-${new Date().toISOString().slice(0, 10)}.jpg`
      link.click()
    } finally {
      setExporting(false)
    }
  }

  const hasImages = !!state.imageA && !!state.imageB
  const completedPairs = state.minutiae.filter((m) => m.coordA && m.coordB).length

  const editingMinutia = editing ? state.minutiae.find((m) => m.id === editing.id) ?? null : null

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Fingerprint className="text-blue-600" size={28} />
        <div>
          <h1 className="text-lg font-bold text-gray-800">Confronto Papiloscópico</h1>
          <p className="text-xs text-gray-500">
            Processamento 100% local — nenhuma imagem é enviada a servidores
          </p>
        </div>
      </header>

      <ControlPanel
        currentStep={state.currentStep}
        completedPairs={completedPairs}
        hasImages={hasImages}
        onUndo={handleUndo}
        canUndo={state.minutiae.length > 0}
        onExport={handleExport}
        canExport={hasImages && completedPairs > 0}
        exporting={exporting}
      />

      {editing && editingMinutia && editingMinutia.coordA && editingMinutia.coordB && state.imageA && state.imageB && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-6 rounded-xl bg-white/95 p-4 shadow-2xl ring-1 ring-gray-200 backdrop-blur">
            <Magnifier
              image={state.imageA}
              point={editingMinutia.coordA}
              label={editing.slot === 'A' ? 'Editando · Imagem A' : 'Referência · Imagem A'}
              variant={editing.slot === 'A' ? 'editing' : 'reference'}
              rotation={transformA.rotation}
              flipped={transformA.flipped}
              inverted={transformA.inverted}
            />
            <Magnifier
              image={state.imageB}
              point={editingMinutia.coordB}
              label={editing.slot === 'B' ? 'Editando · Imagem B' : 'Referência · Imagem B'}
              variant={editing.slot === 'B' ? 'editing' : 'reference'}
              rotation={transformB.rotation}
              flipped={transformB.flipped}
              inverted={transformB.inverted}
            />
          </div>
        </div>
      )}

      <div ref={captureRef} className="flex flex-col gap-4 bg-gray-50 p-2 md:flex-row">
        <ImagePanel
          slot="A"
          title="Imagem Questionada"
          image={state.imageA}
          minutiae={state.minutiae}
          transform={transformA}
          onTransformChange={setTransformA}
          otherImage={state.imageB}
          otherTransform={transformB}
          canCreate={state.currentStep === 'WAITING_A'}
          onUpload={(file) => handleUpload('A', file)}
          onCreatePoint={handleCreatePointA}
          onMovePoint={(id, coord) => handleMovePoint('A', id, coord)}
          onStartEdit={(id) => handleStartEdit('A', id)}
          onEndEdit={handleEndEdit}
        />
        <ImagePanel
          slot="B"
          title="Imagem Padrão"
          image={state.imageB}
          minutiae={state.minutiae}
          transform={transformB}
          onTransformChange={setTransformB}
          otherImage={state.imageA}
          otherTransform={transformA}
          canCreate={state.currentStep === 'WAITING_B'}
          onUpload={(file) => handleUpload('B', file)}
          onCreatePoint={handleCreatePointB}
          onMovePoint={(id, coord) => handleMovePoint('B', id, coord)}
          onStartEdit={(id) => handleStartEdit('B', id)}
          onEndEdit={handleEndEdit}
        />
      </div>

      <MinutiaeTable
        minutiae={state.minutiae}
        onChangeColor={handleChangeColor}
        onDelete={handleDelete}
      />
    </div>
  )
}
