import {
  useCallback,
  useEffect,
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
  Move,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Coordinate, ImageSlot, ImageTransform, Minutia } from '../types'
import { DEFAULT_IMAGE_TRANSFORM } from '../types'

interface ImagePanelProps {
  slot: ImageSlot
  title: string
  image: string | null
  minutiae: Minutia[]
  transform: ImageTransform
  onTransformChange: Dispatch<SetStateAction<ImageTransform>>
  otherImage: string | null
  otherTransform: ImageTransform
  canCreate: boolean
  onUpload: (file: File) => void
  onCreatePoint: (coord: Coordinate) => void
  onMovePoint: (id: number, coord: Coordinate) => void
  onStartEdit: (id: number) => void
  onEndEdit: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrapAngle(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export default function ImagePanel({
  slot,
  title,
  image,
  minutiae,
  transform,
  onTransformChange: setTransform,
  otherImage,
  otherTransform,
  canCreate: allowCreate,
  onUpload,
  onCreatePoint,
  onMovePoint,
  onStartEdit,
  onEndEdit,
}: ImagePanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const naturalSizeRef = useRef<{ w: number; h: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; startPanXpx: number; startPanYpx: number } | null>(
    null,
  )
  const draggingMinutiaId = useRef<number | null>(null)

  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [otherNatural, setOtherNatural] = useState<{ w: number; h: number } | null>(null)
  const [adjustMode, setAdjustMode] = useState(false)
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

  const screenToPercent = useCallback(
    (clientX: number, clientY: number): Coordinate | null => {
      if (!viewportRef.current || baseSize.width === 0) return null
      const viewportRect = viewportRef.current.getBoundingClientRect()
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

      const percentX = ((localX + baseSize.width / 2) / baseSize.width) * 100
      const percentY = ((localY + baseSize.height / 2) / baseSize.height) * 100

      return { x: clamp(percentX, 0, 100), y: clamp(percentY, 0, 100) }
    },
    [baseSize, panXpx, panYpx, transform.rotation, transform.zoom, transform.flipped],
  )

  function handleMarkClick(e: MouseEvent<HTMLDivElement>) {
    if (adjustMode || !allowCreate || !image) return
    const coord = screenToPercent(e.clientX, e.clientY)
    if (coord) onCreatePoint(coord)
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!adjustMode) return
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no viewport.
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanXpx: panXpx, startPanYpx: panYpx }
    setIsDragging(true)
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || baseSize.width === 0) return
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
    const coord = screenToPercent(e.clientX, e.clientY)
    if (coord) onMovePoint(draggingMinutiaId.current, coord)
  }

  function handleMarkerPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    draggingMinutiaId.current = null
    onEndEdit()
  }

  const coordKey = slot === 'A' ? 'coordA' : 'coordB'

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
        <h2 className="font-semibold text-gray-700">
          {title} <span className="text-xs font-normal text-gray-400">(Imagem {slot})</span>
        </h2>
        <div className="flex items-center gap-1">
          {image && (
            <button
              onClick={() => setAdjustMode((m) => !m)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium shadow-sm ring-1 ${
                adjustMode
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
              }`}
            >
              {adjustMode ? <Check size={14} /> : <Move size={14} />}
              {adjustMode ? 'Concluir ajuste' : 'Ajustar imagem'}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50"
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
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs ring-1 ring-gray-200">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransform((t) => ({ ...t, zoom: clamp(t.zoom / 1.2, MIN_ZOOM, MAX_ZOOM) }))}
              className="rounded bg-white p-1 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100"
              title="Diminuir zoom"
            >
              <ZoomOut size={14} />
            </button>
            <span className="w-10 text-center text-gray-500">{Math.round(transform.zoom * 100)}%</span>
            <button
              onClick={() => setTransform((t) => ({ ...t, zoom: clamp(t.zoom * 1.2, MIN_ZOOM, MAX_ZOOM) }))}
              className="rounded bg-white p-1 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100"
              title="Aumentar zoom"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransform((t) => ({ ...t, rotation: wrapAngle(t.rotation - 90) }))}
              className="rounded bg-white p-1 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100"
              title="Girar 90° à esquerda"
            >
              <RotateCcw size={14} />
            </button>
            <input
              type="range"
              min={-180}
              max={180}
              value={Math.round(transform.rotation)}
              onChange={(e) =>
                setTransform((t) => ({ ...t, rotation: Number(e.target.value) }))
              }
              className="w-20"
            />
            <button
              onClick={() => setTransform((t) => ({ ...t, rotation: wrapAngle(t.rotation + 90) }))}
              className="rounded bg-white p-1 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100"
              title="Girar 90° à direita"
            >
              <RotateCw size={14} />
            </button>
            <span className="w-9 text-center text-gray-500">{Math.round(transform.rotation)}°</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransform((t) => ({ ...t, flipped: !t.flipped }))}
              className={`rounded p-1 shadow-sm ring-1 ${
                transform.flipped
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'
              }`}
              title="Espelhar horizontalmente (frontal/traseira)"
            >
              <FlipHorizontal2 size={14} />
            </button>
            <button
              onClick={() => setTransform((t) => ({ ...t, inverted: !t.inverted }))}
              className={`rounded p-1 shadow-sm ring-1 ${
                transform.inverted
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'
              }`}
              title="Inverter cores (negativo)"
            >
              <Contrast size={14} />
            </button>
          </div>

          <button
            onClick={() => setTransform(DEFAULT_IMAGE_TRANSFORM)}
            className="flex items-center gap-1 rounded bg-white px-2 py-1 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100"
            title="Redefinir posição, zoom, rotação, espelhamento e cor"
          >
            <RefreshCw size={12} />
            Redefinir
          </button>

          {otherImage && (
            <button
              onClick={() => setShowGhost((v) => !v)}
              className={`flex items-center gap-1 rounded px-2 py-1 shadow-sm ring-1 ${
                showGhost
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'
              }`}
              title="Sobrepor a outra imagem como molde para alinhar"
            >
              {showGhost ? <Eye size={14} /> : <EyeOff size={14} />}
              Molde
            </button>
          )}

          <span className="text-gray-400">Arraste a imagem para mover</span>
        </div>
      )}

      <div
        ref={viewportRef}
        onClick={handleMarkClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative aspect-[4/5] w-full overflow-hidden rounded-lg border-2 bg-gray-100 select-none ${
          allowCreate && image && !adjustMode ? 'border-blue-500' : 'border-gray-300'
        }`}
        style={{ cursor, touchAction: adjustMode ? 'none' : 'auto' }}
      >
        {!image && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-300 hover:text-gray-400"
          >
            <Fingerprint size={96} strokeWidth={1} />
            <span className="text-sm font-medium text-gray-400">Clique para carregar a imagem</span>
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
              style={{ filter: transform.inverted ? 'invert(1)' : undefined }}
            />

            {minutiae.map((m) => {
              const coord = m[coordKey]
              if (!coord) return null
              const flipFactor = transform.flipped ? -1 : 1
              return (
                <div
                  key={m.id}
                  onPointerDown={(e) => handleMarkerPointerDown(e, m.id)}
                  onPointerMove={handleMarkerPointerMove}
                  onPointerUp={handleMarkerPointerUp}
                  onPointerCancel={handleMarkerPointerUp}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{ left: `${coord.x}%`, top: `${coord.y}%`, cursor: adjustMode ? cursor : 'move' }}
                >
                  <div
                    style={{
                      // A rotação precisa ser desfeita primeiro (mais interna) e só então a
                      // escala/espelhamento — rotação e espelhamento não comutam.
                      transform: `scale(${1 / transform.zoom}) scaleX(${flipFactor}) rotate(${-transform.rotation}deg)`,
                    }}
                  >
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow"
                      style={{ backgroundColor: m.color }}
                      title={`Ponto ${m.id}`}
                    >
                      {m.id}
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
                style={{ filter: otherTransform.inverted ? 'invert(1)' : undefined }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
