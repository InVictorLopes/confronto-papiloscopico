import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  type SyntheticEvent,
} from 'react'
import {
  Check,
  Contrast,
  Eye,
  EyeOff,
  Fingerprint,
  FlipHorizontal2,
  Hand,
  Minus,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Sun,
  SunDim,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Coordinate, ImageSlot, ImageTransform, Minutia } from '../types'
import { DEFAULT_IMAGE_TRANSFORM } from '../types'
import { buildLevelsFilterParts } from '../levels'

interface ImagePanelProps {
  slot: ImageSlot
  title: string
  image: string | null
  minutiae: Minutia[]
  showNumbers: boolean
  arrowMode: boolean
  transform: ImageTransform
  onTransformChange: Dispatch<SetStateAction<ImageTransform>>
  otherImage: string | null
  otherTransform: ImageTransform
  canCreate: boolean
  onUpload: (file: File) => void
  onCreatePoint: (coord: Coordinate) => void
  onMovePoint: (id: number, coord: Coordinate) => void
  onMoveLabel: (id: number, offset: Coordinate) => void
  onStartEdit: (id: number) => void
  onEndEdit: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const MIN_LEVEL = 0
const MAX_LEVEL = 254
const LEVEL_STEP = 15

// Botão de -/+ compartilhado por zoom, rotação, ponto preto e escurecer.
const STEP_BTN_CLASS =
  'rounded-full bg-gray-100 p-1 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'

// Marcação padronizada do laudo — tamanhos e cores fixos, não editáveis pelo usuário.
const MARKER_SIZE = 24 // px — diâmetro da bolinha do número
const LINE_THICKNESS = 3 // px — peso da linha entre o número e o ponto real
const ANCHOR_DOT_SIZE = LINE_THICKNESS * 3 // "bolinha da minúcia" — acompanha a espessura da linha, só um pouco maior
const NUMBER_COLOR = '#dc2626' // vermelho
const DOT_COLOR = '#ffffff' // branco
const ANCHOR_DOT_COLOR = '#dc2626'
const FRAME_COLOR: Record<ImageSlot, string> = { A: '#dc2626', B: '#2563eb' }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrapAngle(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

function buildFilter(t: ImageTransform): string | undefined {
  const parts: string[] = []
  if (t.inverted) parts.push('invert(1)')
  parts.push(...buildLevelsFilterParts(t.levelsBlack, t.darken))
  return parts.length ? parts.join(' ') : undefined
}

const ImagePanel = forwardRef<HTMLDivElement, ImagePanelProps>(function ImagePanel({
  slot,
  title,
  image,
  minutiae,
  showNumbers,
  arrowMode,
  transform,
  onTransformChange: setTransform,
  otherImage,
  otherTransform,
  canCreate: allowCreate,
  onUpload,
  onCreatePoint,
  onMovePoint,
  onMoveLabel,
  onStartEdit,
  onEndEdit,
}: ImagePanelProps, frameRef) {
  const viewportRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(frameRef, () => viewportRef.current as HTMLDivElement)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const naturalSizeRef = useRef<{ w: number; h: number } | null>(null)
  const dragRef = useRef<
    | { mode: 'pan'; startX: number; startY: number; startPanXpx: number; startPanYpx: number }
    | { mode: 'rotate'; startAngleDeg: number; startRotation: number }
    | null
  >(null)
  const draggingMinutiaId = useRef<number | null>(null)

  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [otherNatural, setOtherNatural] = useState<{ w: number; h: number } | null>(null)
  const [adjustMode, setAdjustMode] = useState(false)
  const [rotateDragMode, setRotateDragMode] = useState(false)
  const [showGhost, setShowGhost] = useState(true)
  const [isDragging, setIsDragging] = useState(false)

  const recomputeBaseSize = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    const vw = vp.offsetWidth
    const vh = vp.offsetHeight
    setViewportSize({ width: vw, height: vh })
    const nat = naturalSizeRef.current
    if (!nat) return
    const scale = Math.min(vw / nat.w, vh / nat.h)
    setBaseSize({ width: nat.w * scale, height: nat.h * scale })
  }, [])

  // Reseta o estado de exibição sempre que uma nova imagem é carregada nesse slot
  // (a transformação em si é redefinida pelo componente pai)
  useEffect(() => {
    setAdjustMode(false)
    setRotateDragMode(false)
    setBaseSize({ width: 0, height: 0 })
    naturalSizeRef.current = null
  }, [image])

  // Carrega as dimensões naturais da imagem do outro lado, usadas para a sobreposição fantasma
  useEffect(() => {
    if (!otherImage) {
      setOtherNatural(null)
      return
    }
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setOtherNatural({ w: probe.naturalWidth, h: probe.naturalHeight })
    }
    probe.src = otherImage
    return () => {
      cancelled = true
    }
  }, [otherImage])

  // Imagens em cache (ex: mesma data URL já decodificada) podem já estar
  // "completas" quando o listener onLoad é anexado, e o evento nunca dispara.
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth) {
      naturalSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight }
      recomputeBaseSize()
    }
  }, [image, recomputeBaseSize])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const ro = new ResizeObserver(() => recomputeBaseSize())
    ro.observe(vp)
    return () => ro.disconnect()
  }, [recomputeBaseSize])

  // Zoom com a roda do mouse apenas durante o ajuste
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !adjustMode) return
    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      setTransform((t) => ({ ...t, zoom: clamp(t.zoom * (1 - e.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM) }))
    }
    vp.addEventListener('wheel', handleWheel, { passive: false })
    return () => vp.removeEventListener('wheel', handleWheel)
  }, [adjustMode])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  function handleImgLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    naturalSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight }
    recomputeBaseSize()
  }

  const panXpx = (transform.panX / 100) * baseSize.width
  const panYpx = (transform.panY / 100) * baseSize.height

  const ghostScale =
    otherNatural && viewportSize.width > 0
      ? Math.min(viewportSize.width / otherNatural.w, viewportSize.height / otherNatural.h)
      : 0
  const ghostBaseSize = {
    width: (otherNatural?.w ?? 0) * ghostScale,
    height: (otherNatural?.h ?? 0) * ghostScale,
  }
  const otherPanXpx = (otherTransform.panX / 100) * ghostBaseSize.width
  const otherPanYpx = (otherTransform.panY / 100) * ghostBaseSize.height

  // Converte uma posição de tela para porcentagem da imagem, SEM travar nada —
  // usado tanto para o ponto real quanto para descobrir onde ficam os cantos do
  // quadro (viewport) em espaço de porcentagem, já considerando zoom/pan/rotação.
  const toPercentUnclamped = useCallback(
    (clientX: number, clientY: number): Coordinate => {
      const viewportRect = viewportRef.current!.getBoundingClientRect()
      const stageLeft = (viewportRect.width - baseSize.width) / 2
      const stageTop = (viewportRect.height - baseSize.height) / 2
      const centerScreenX = viewportRect.left + stageLeft + baseSize.width / 2
      const centerScreenY = viewportRect.top + stageTop + baseSize.height / 2

      const offsetX = clientX - centerScreenX
      const offsetY = clientY - centerScreenY

      const afterPanX = offsetX - panXpx
      const afterPanY = offsetY - panYpx

      const rad = (transform.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const afterRotX = afterPanX * cos + afterPanY * sin
      const afterRotY = -afterPanX * sin + afterPanY * cos

      const flipFactor = transform.flipped ? -1 : 1
      const localX = (afterRotX / transform.zoom) * flipFactor
      const localY = afterRotY / transform.zoom

      return {
        x: ((localX + baseSize.width / 2) / baseSize.width) * 100,
        y: ((localY + baseSize.height / 2) / baseSize.height) * 100,
      }
    },
    [baseSize, panXpx, panYpx, transform.rotation, transform.zoom, transform.flipped],
  )

  const screenToPercent = useCallback(
    (clientX: number, clientY: number): Coordinate | null => {
      if (!viewportRef.current || baseSize.width === 0) return null
      const viewportRect = viewportRef.current.getBoundingClientRect()

      // O ponto (ou o número, no modo linha) nunca pode sair do quadro visível —
      // então os limites são os 4 cantos do PRÓPRIO QUADRO convertidos pra
      // porcentagem da imagem (não apenas 0-100%, que seria só a foto, ignorando
      // zoom/pan/rotação, e permitia arrastar pra fora do quadro quando com zoom).
      const corners = [
        toPercentUnclamped(viewportRect.left, viewportRect.top),
        toPercentUnclamped(viewportRect.right, viewportRect.top),
        toPercentUnclamped(viewportRect.left, viewportRect.bottom),
        toPercentUnclamped(viewportRect.right, viewportRect.bottom),
      ]
      let minX = Math.min(...corners.map((c) => c.x))
      let maxX = Math.max(...corners.map((c) => c.x))
      let minY = Math.min(...corners.map((c) => c.y))
      let maxY = Math.max(...corners.map((c) => c.y))

      // A bolinha do número tem um tamanho fixo NA TELA (não escala com o zoom),
      // então o próprio raio dela precisa ficar de fora do quadro — senão metade
      // dela ainda vaza pela borda mesmo com o centro travado exatamente na borda.
      const radiusPx = MARKER_SIZE / 2
      const insetXPercent = (radiusPx / (baseSize.width * transform.zoom)) * 100
      const insetYPercent = (radiusPx / (baseSize.height * transform.zoom)) * 100
      if (maxX - minX > insetXPercent * 2) {
        minX += insetXPercent
        maxX -= insetXPercent
      } else {
        const mid = (minX + maxX) / 2
        minX = maxX = mid
      }
      if (maxY - minY > insetYPercent * 2) {
        minY += insetYPercent
        maxY -= insetYPercent
      } else {
        const mid = (minY + maxY) / 2
        minY = maxY = mid
      }

      const { x: percentX, y: percentY } = toPercentUnclamped(clientX, clientY)
      return { x: clamp(percentX, minX, maxX), y: clamp(percentY, minY, maxY) }
    },
    [baseSize, toPercentUnclamped, transform.zoom],
  )

  function handleMarkClick(e: MouseEvent<HTMLDivElement>) {
    if (adjustMode || !allowCreate || !image) return
    const coord = screenToPercent(e.clientX, e.clientY)
    if (coord) onCreatePoint(coord)
  }

  // Centro da imagem na tela (mesmo pivô usado pelo giro), considerando o pan atual.
  function screenCenter() {
    const viewportRect = viewportRef.current!.getBoundingClientRect()
    const stageLeft = (viewportRect.width - baseSize.width) / 2
    const stageTop = (viewportRect.height - baseSize.height) / 2
    return {
      x: viewportRect.left + stageLeft + baseSize.width / 2 + panXpx,
      y: viewportRect.top + stageTop + baseSize.height / 2 + panYpx,
    }
  }

  function angleFromCenterDeg(clientX: number, clientY: number) {
    const center = screenCenter()
    return (Math.atan2(clientY - center.y, clientX - center.x) * 180) / Math.PI
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!adjustMode) return
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no viewport.
    }
    if (rotateDragMode) {
      dragRef.current = {
        mode: 'rotate',
        startAngleDeg: angleFromCenterDeg(e.clientX, e.clientY),
        startRotation: transform.rotation,
      }
    } else {
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startPanXpx: panXpx, startPanYpx: panYpx }
    }
    setIsDragging(true)
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || baseSize.width === 0) return
    if (dragRef.current.mode === 'rotate') {
      const { startAngleDeg, startRotation } = dragRef.current
      const delta = angleFromCenterDeg(e.clientX, e.clientY) - startAngleDeg
      setTransform((t) => ({ ...t, rotation: wrapAngle(startRotation + delta) }))
      return
    }
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const newPanXpx = dragRef.current.startPanXpx + dx
    const newPanYpx = dragRef.current.startPanYpx + dy
    setTransform((t) => ({
      ...t,
      panX: (newPanXpx / baseSize.width) * 100,
      panY: (newPanYpx / baseSize.height) * 100,
    }))
  }

  function handlePointerUp() {
    dragRef.current = null
    setIsDragging(false)
  }

  function handleMarkerPointerDown(e: PointerEvent<HTMLDivElement>, id: number) {
    if (adjustMode) return
    e.stopPropagation()
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no marcador.
    }
    draggingMinutiaId.current = id
    onStartEdit(id)
  }

  function handleMarkerPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    const cursor = screenToPercent(e.clientX, e.clientY)
    if (!cursor) return
    if (arrowMode) {
      const m = minutiae.find((mm) => mm.id === draggingMinutiaId.current)
      const point = m?.[coordKey]
      if (!point) return
      onMoveLabel(draggingMinutiaId.current, { x: cursor.x - point.x, y: cursor.y - point.y })
    } else {
      // O que o usuário está arrastando na tela é a bolinha (que fica em
      // coord+offset quando o ponto já tem uma linha) — não o próprio coord.
      // Por isso o offset entra na conta: a bolinha (já travada no quadro por
      // `cursor`) é o que deve ficar em cima do mouse, não o coord sozinho.
      const m = minutiae.find((mm) => mm.id === draggingMinutiaId.current)
      const offset = m?.[offsetKey] ?? { x: 0, y: 0 }
      onMovePoint(draggingMinutiaId.current, { x: cursor.x - offset.x, y: cursor.y - offset.y })
    }
  }

  function handleMarkerPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    draggingMinutiaId.current = null
    onEndEdit()
  }

  const coordKey = slot === 'A' ? 'coordA' : 'coordB'
  const offsetKey = slot === 'A' ? 'labelOffsetA' : 'labelOffsetB'

  const cursor = adjustMode
    ? isDragging
      ? 'grabbing'
      : 'grab'
    : allowCreate && image
      ? 'crosshair'
      : 'default'

  return (
    <div className="flex flex-1 flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h2 className="font-semibold text-gray-700 dark:text-gray-200">
          {title} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">(Imagem {slot})</span>
        </h2>
        <div className="flex items-center gap-1">
          {image && (
            <button
              onClick={() => setAdjustMode((m) => !m)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium shadow-sm ring-1 ${
                adjustMode
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700'
              }`}
            >
              {adjustMode ? <Check size={14} /> : <Move size={14} />}
              {adjustMode ? 'Concluir ajuste' : 'Ajustar imagem'}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700"
          >
            <Upload size={14} />
            {image ? 'Trocar imagem' : 'Carregar imagem'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {adjustMode && (
        <div className="flex flex-col gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
          <div className="grid grid-cols-2 gap-1">
            {/* Zoom */}
            <div className="flex items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <span className="font-medium text-gray-500 dark:text-gray-400">Zoom</span>
              <button
                onClick={() => setTransform((t) => ({ ...t, zoom: clamp(t.zoom / 1.2, MIN_ZOOM, MAX_ZOOM) }))}
                className={STEP_BTN_CLASS}
                title="Diminuir zoom"
              >
                <ZoomOut size={14} />
              </button>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={Math.round(transform.zoom * 100)}
                  onChange={(e) => {
                    if (e.target.value === '') return
                    const v = Number(e.target.value)
                    if (Number.isNaN(v)) return
                    setTransform((t) => ({ ...t, zoom: clamp(v, MIN_ZOOM * 100, MAX_ZOOM * 100) / 100 }))
                  }}
                  className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
                <span className="text-gray-500 dark:text-gray-400">%</span>
              </div>
              <button
                onClick={() => setTransform((t) => ({ ...t, zoom: clamp(t.zoom * 1.2, MIN_ZOOM, MAX_ZOOM) }))}
                className={STEP_BTN_CLASS}
                title="Aumentar zoom"
              >
                <ZoomIn size={14} />
              </button>
            </div>

            {/* Rotação */}
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <span className="font-medium text-gray-500 dark:text-gray-400">Rotação</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(transform.rotation)}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, rotation: Number(e.target.value) }))
                }
                className="w-14"
              />
              <button
                onClick={() => setTransform((t) => ({ ...t, rotation: wrapAngle(t.rotation - 90) }))}
                className={STEP_BTN_CLASS}
                title="Girar 90° à esquerda"
              >
                <RotateCcw size={14} />
              </button>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={Math.round(transform.rotation)}
                  onChange={(e) => {
                    if (e.target.value === '') return
                    const v = Number(e.target.value)
                    if (Number.isNaN(v)) return
                    setTransform((t) => ({ ...t, rotation: clamp(v, -180, 180) }))
                  }}
                  className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
                <span className="text-gray-500 dark:text-gray-400">°</span>
              </div>
              <button
                onClick={() => setTransform((t) => ({ ...t, rotation: wrapAngle(t.rotation + 90) }))}
                className={STEP_BTN_CLASS}
                title="Girar 90° à direita"
              >
                <RotateCw size={14} />
              </button>
              <button
                onClick={() => setRotateDragMode((v) => !v)}
                className={`rounded-full p-1 ${
                  rotateDragMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
                title={
                  rotateDragMode
                    ? 'Girar na foto: ativado — arraste dentro da foto para girar livremente (o arraste não move mais a foto até desligar aqui)'
                    : 'Girar na foto: ligar para poder girar arrastando dentro da própria foto, em vez de usar o controle deslizante'
                }
              >
                <Hand size={14} />
              </button>
            </div>

            {/* Ponto preto */}
            <div
              className="flex items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600"
              title="Ponto preto: escurece as sombras e aumenta o contraste ao redor delas, sem mexer nos claros"
            >
              <SunDim size={14} className="text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-gray-500 dark:text-gray-400">Ponto preto</span>
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                value={transform.levelsBlack}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, levelsBlack: clamp(Number(e.target.value), MIN_LEVEL, MAX_LEVEL) }))
                }
                className="w-14"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, levelsBlack: clamp(t.levelsBlack - LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Diminuir ponto preto"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                value={transform.levelsBlack}
                onChange={(e) => {
                  if (e.target.value === '') return
                  const v = Number(e.target.value)
                  if (Number.isNaN(v)) return
                  setTransform((t) => ({ ...t, levelsBlack: clamp(v, MIN_LEVEL, MAX_LEVEL) }))
                }}
                className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, levelsBlack: clamp(t.levelsBlack + LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Aumentar ponto preto"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Negativo */}
            <div className="flex items-center rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <button
                onClick={() => setTransform((t) => ({ ...t, inverted: !t.inverted }))}
                className={`flex w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                  transform.inverted
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                title="Inverter cores"
              >
                <Contrast size={14} />
                Negativo
              </button>
            </div>

            {/* Escurecer */}
            <div
              className="flex items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600"
              title="Escurecer: deixa a foto inteira mais escura por igual (sombras e claros juntos) — útil quando ela está apagada/clara demais"
            >
              <Sun size={14} className="text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-gray-500 dark:text-gray-400">Escurecer</span>
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                value={transform.darken}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, darken: clamp(Number(e.target.value), MIN_LEVEL, MAX_LEVEL) }))
                }
                className="w-14"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, darken: clamp(t.darken - LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Diminuir escurecer"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                value={transform.darken}
                onChange={(e) => {
                  if (e.target.value === '') return
                  const v = Number(e.target.value)
                  if (Number.isNaN(v)) return
                  setTransform((t) => ({ ...t, darken: clamp(v, MIN_LEVEL, MAX_LEVEL) }))
                }}
                className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, darken: clamp(t.darken + LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Aumentar escurecer"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Espelhar */}
            <div className="flex items-center rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <button
                onClick={() => setTransform((t) => ({ ...t, flipped: !t.flipped }))}
                className={`flex w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                  transform.flipped
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                title="Espelhar horizontalmente (frontal/traseira)"
              >
                <FlipHorizontal2 size={14} />
                Espelhar
              </button>
            </div>

            {/* Redefinir */}
            <div className="flex items-center rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <button
                onClick={() => setTransform(DEFAULT_IMAGE_TRANSFORM)}
                className="flex w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                title="Redefinir posição, zoom, rotação, espelhamento e níveis"
              >
                <RefreshCw size={12} />
                Redefinir
              </button>
            </div>

            {/* Molde */}
            {otherImage && (
              <div className="flex items-center rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
                <button
                  onClick={() => setShowGhost((v) => !v)}
                  className={`flex w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                    showGhost
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  title="Sobrepor a outra imagem como molde para alinhar"
                >
                  {showGhost ? <Eye size={14} /> : <EyeOff size={14} />}
                  Molde
                </button>
              </div>
            )}
          </div>

          <span className="text-gray-400 dark:text-gray-500">Arraste a imagem para mover</span>
        </div>
      )}

      <div
        ref={viewportRef}
        onClick={handleMarkClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative aspect-square w-full overflow-hidden rounded-lg border-4 bg-gray-100 select-none dark:bg-gray-900/60 ${
          allowCreate && image && !adjustMode ? 'ring-2 ring-offset-2 ring-amber-400 dark:ring-offset-gray-900' : ''
        }`}
        style={{ cursor, touchAction: adjustMode ? 'none' : 'auto', borderColor: FRAME_COLOR[slot] }}
      >
        {!image && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-300 hover:text-gray-400 dark:text-gray-700 dark:hover:text-gray-600"
          >
            <Fingerprint size={96} strokeWidth={1} />
            <span className="text-sm font-medium text-gray-400 dark:text-gray-600">Clique para carregar a imagem</span>
          </button>
        )}

        {image && (
          <div
            className="absolute"
            style={{
              left: `calc(50% - ${baseSize.width / 2}px)`,
              top: `calc(50% - ${baseSize.height / 2}px)`,
              width: baseSize.width,
              height: baseSize.height,
              transform: `translate(${panXpx}px, ${panYpx}px) rotate(${transform.rotation}deg) scale(${transform.zoom}) scaleX(${transform.flipped ? -1 : 1})`,
              transformOrigin: 'center center',
            }}
          >
            <img
              ref={imgRef}
              src={image}
              alt={title}
              draggable={false}
              onLoad={handleImgLoad}
              className="block h-full w-full select-none pointer-events-none"
              style={{ filter: buildFilter(transform) }}
            />

            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {minutiae.map((m) => {
                const coord = m[coordKey]
                const offset = m[offsetKey]
                if (!coord || (offset.x === 0 && offset.y === 0)) return null
                return (
                  <line
                    key={m.id}
                    x1={coord.x}
                    y1={coord.y}
                    x2={coord.x + offset.x}
                    y2={coord.y + offset.y}
                    stroke={NUMBER_COLOR}
                    strokeWidth={LINE_THICKNESS}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}
            </svg>

            {minutiae.map((m) => {
              const coord = m[coordKey]
              if (!coord) return null
              const offset = m[offsetKey]
              const hasOffset = offset.x !== 0 || offset.y !== 0
              const labelX = coord.x + offset.x
              const labelY = coord.y + offset.y
              const flipFactor = transform.flipped ? -1 : 1
              const counterTransform = `scale(${1 / transform.zoom}) scaleX(${flipFactor}) rotate(${-transform.rotation}deg)`
              const numberVisible = showNumbers && !m.hideNumber
              return (
                <div key={m.id}>
                  {hasOffset && (
                    <div
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                    >
                      <div style={{ transform: counterTransform }}>
                        <div
                          className="rounded-full border border-white shadow"
                          style={{
                            width: ANCHOR_DOT_SIZE,
                            height: ANCHOR_DOT_SIZE,
                            backgroundColor: ANCHOR_DOT_COLOR,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div
                    onPointerDown={(e) => handleMarkerPointerDown(e, m.id)}
                    onPointerMove={handleMarkerPointerMove}
                    onPointerUp={handleMarkerPointerUp}
                    onPointerCancel={handleMarkerPointerUp}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{
                      left: `${labelX}%`,
                      top: `${labelY}%`,
                      cursor: adjustMode ? cursor : arrowMode ? 'crosshair' : 'move',
                      touchAction: 'none',
                    }}
                  >
                    <div style={{ transform: counterTransform }}>
                      <div
                        className="flex items-center justify-center rounded-full shadow"
                        style={{
                          width: MARKER_SIZE,
                          height: MARKER_SIZE,
                          backgroundColor: DOT_COLOR,
                          border: `2px solid ${NUMBER_COLOR}`,
                          color: NUMBER_COLOR,
                          fontFamily: 'Arial, Helvetica, sans-serif',
                          fontWeight: 700,
                          fontSize: MARKER_SIZE * 0.55,
                        }}
                        title={`Ponto ${m.id}`}
                      >
                        {numberVisible ? m.id : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {adjustMode && showGhost && otherImage && ghostBaseSize.width > 0 && (
          <div className="pointer-events-none absolute inset-0 opacity-45">
            <div
              className="absolute"
              style={{
                left: `calc(50% - ${ghostBaseSize.width / 2}px)`,
                top: `calc(50% - ${ghostBaseSize.height / 2}px)`,
                width: ghostBaseSize.width,
                height: ghostBaseSize.height,
                transform: `translate(${otherPanXpx}px, ${otherPanYpx}px) rotate(${otherTransform.rotation}deg) scale(${otherTransform.zoom}) scaleX(${otherTransform.flipped ? -1 : 1})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={otherImage}
                alt=""
                draggable={false}
                className="block h-full w-full select-none"
                style={{ filter: buildFilter(otherTransform) }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

export default ImagePanel
