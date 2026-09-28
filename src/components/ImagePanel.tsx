import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  type SyntheticEvent,
} from 'react'
import {
  Check,
  Contrast,
  Crop,
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
  Square,
  Sun,
  SunDim,
  SunMedium,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Coordinate, CropMask, ImageSlot, ImageTransform, Minutia } from '../types'
import { DEFAULT_IMAGE_TRANSFORM, displayId } from '../types'
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
  // Recorte não-destrutivo: máscara aplicada (contorno em % da imagem original) e a
  // do outro lado (pro molde fantasma refletir o que realmente aparece lá).
  cropMask: CropMask | null
  otherCropMask: CropMask | null
  canCreate: boolean
  onUpload: (file: File) => void
  onApplyCrop: (mask: CropMask) => void
  onRevertCrop: () => void
  onCreatePoint: (coord: Coordinate) => void
  onMovePoint: (id: number, coord: Coordinate) => void
  onMoveLabel: (id: number, offset: Coordinate) => void
  onStartEdit: (id: number) => void
  onEndEdit: () => void
  adjustMode: boolean
  onAdjustModeChange: (open: boolean) => void
  // A barra de ajuste do OUTRO lado está aberta: reserva um espaço igual aqui para
  // que os dois quadros continuem sempre do mesmo tamanho.
  reserveSidebar: boolean
  // Há espaço livre na lateral da página: a barra fica nesse espaço, fora da área dos
  // quadros, e os quadros não encolhem. Sem espaço, ela ocupa uma coluna ao lado do quadro.
  sidebarOutside: boolean
}

// Largura da barra de ajuste lateral (fica do lado de fora de cada quadro).
export const SIDEBAR_WIDTH = 176
// Distância entre a barra e o quadro quando ela fica no espaço livre da lateral.
export const SIDEBAR_GAP = 12

const MIN_ZOOM = 0.5
// Alto o bastante para ampliar um dedo dentro de uma página inteira de prontuário
// (A4 a 600 dpi) até o mesmo tamanho de uma imagem questionada já recortada.
const MAX_ZOOM = 50
const MIN_LEVEL = 0
const MAX_LEVEL = 254
const LEVEL_STEP = 15
// Distância mínima (px) que o mouse precisa andar sobre um marcador para contar como arraste, e não clique.
const DRAG_THRESHOLD_PX = 4
// Tamanho mínimo (px, na tela) da seleção de recorte.
const MIN_CROP_SIZE = 30

type CropShape = 'square' | 'free'
type CropRect = { x: number; y: number; width: number; height: number }
// Cantos (redimensionam os dois lados juntos) + barras do meio de cada lado
// (mexem só naquele lado — ex: recortar só a parte de baixo, mantendo o resto).
type CropCornerHandle = 'nw' | 'ne' | 'sw' | 'se'
type CropEdgeHandle = 'n' | 's' | 'e' | 'w'
type CropHandle = CropCornerHandle | CropEdgeHandle
const CROP_CORNER_OPPOSITE: Record<CropCornerHandle, { x: 'left' | 'right'; y: 'top' | 'bottom' }> = {
  nw: { x: 'right', y: 'bottom' },
  ne: { x: 'left', y: 'bottom' },
  sw: { x: 'right', y: 'top' },
  se: { x: 'left', y: 'top' },
}
function isCropEdgeHandle(handle: CropHandle): handle is CropEdgeHandle {
  return handle === 'n' || handle === 's' || handle === 'e' || handle === 'w'
}

// Botão de -/+ compartilhado por zoom, rotação, ponto preto e escurecer.
const STEP_BTN_CLASS =
  'rounded-full bg-gray-100 p-1 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'

// Marcação padronizada do laudo — tamanhos e cores fixos, não editáveis pelo usuário.
const MARKER_SIZE = 24 // px — diâmetro da bolinha do número
const LINE_THICKNESS = 2.5 // px — peso da linha entre o número e o ponto real
// "bolinha da minúcia" — miolo vermelho com o dobro da espessura da linha, mais 1px de borda branca de cada lado
const ANCHOR_DOT_SIZE = LINE_THICKNESS * 2 + 2
const NUMBER_COLOR = '#dc2626' // vermelho
const DOT_COLOR = '#ffffff' // branco
const ANCHOR_DOT_COLOR = '#dc2626'
export const FRAME_COLOR: Record<ImageSlot, string> = { A: '#dc2626', B: '#2563eb' }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrapAngle(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

function buildFilter(t: ImageTransform): string | undefined {
  const parts: string[] = []
  if (t.inverted) parts.push('invert(1)')
  parts.push(...buildLevelsFilterParts(t.levelsBlack, t.darken, t.lighten))
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
  cropMask,
  otherCropMask,
  canCreate: allowCreate,
  onUpload,
  onApplyCrop,
  onRevertCrop,
  onCreatePoint,
  onMovePoint,
  onMoveLabel,
  onStartEdit,
  onEndEdit,
  adjustMode,
  onAdjustModeChange: setAdjustMode,
  reserveSidebar,
  sidebarOutside,
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
  const pendingClickRef = useRef<{ x: number; y: number } | null>(null)
  const cropDragRef = useRef<
    | { mode: 'move'; startX: number; startY: number; startRect: CropRect }
    | { mode: 'resize'; handle: CropHandle; startRect: CropRect }
    | null
  >(null)

  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [otherNatural, setOtherNatural] = useState<{ w: number; h: number } | null>(null)
  const [rotateDragMode, setRotateDragMode] = useState(false)
  const [showGhost, setShowGhost] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropShape, setCropShape] = useState<CropShape>('square')
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  // Recorte livre: caminho desenhado à mão (em pixels locais do palco), fechado ao soltar o mouse.
  const [freehandPoints, setFreehandPoints] = useState<Coordinate[]>([])
  const [freehandDrawing, setFreehandDrawing] = useState(false)

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
    setCropMode(false)
    setCropRect(null)
    setFreehandPoints([])
    setFreehandDrawing(false)
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

  // Mesma conta de toPercentUnclamped, mas a partir de um ponto já em pixels locais do
  // palco (relativo ao próprio viewport, sem precisar de getBoundingClientRect) — usado
  // para converter o recorte desenhado na tela em % da imagem ORIGINAL, que é o espaço
  // onde a máscara de recorte (não-destrutiva) e os pontos marcados vivem para sempre.
  const localToPercent = useCallback(
    (x: number, y: number): Coordinate => {
      const stageLeft = (viewportSize.width - baseSize.width) / 2
      const stageTop = (viewportSize.height - baseSize.height) / 2
      const centerLocalX = stageLeft + baseSize.width / 2
      const centerLocalY = stageTop + baseSize.height / 2

      const offsetX = x - centerLocalX
      const offsetY = y - centerLocalY

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
    [baseSize, viewportSize, panXpx, panYpx, transform.rotation, transform.zoom, transform.flipped],
  )

  // Inversa de localToPercent: de % da imagem original para pixels locais do palco, na
  // transformação (zoom/pan/rotação) ATUAL — usado para reabrir o recorte já existente
  // com a seleção na mesma posição de antes (se nada girou/moveu desde então).
  const percentToLocal = useCallback(
    (coord: Coordinate): { x: number; y: number } => {
      const stageLeft = (viewportSize.width - baseSize.width) / 2
      const stageTop = (viewportSize.height - baseSize.height) / 2
      const centerLocalX = stageLeft + baseSize.width / 2
      const centerLocalY = stageTop + baseSize.height / 2

      const localX = (coord.x / 100) * baseSize.width - baseSize.width / 2
      const localY = (coord.y / 100) * baseSize.height - baseSize.height / 2

      const flipFactor = transform.flipped ? -1 : 1
      const afterRotX = localX * flipFactor * transform.zoom
      const afterRotY = localY * transform.zoom

      const rad = (transform.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const afterPanX = afterRotX * cos - afterRotY * sin
      const afterPanY = afterRotX * sin + afterRotY * cos

      const offsetX = afterPanX + panXpx
      const offsetY = afterPanY + panYpx

      return { x: offsetX + centerLocalX, y: offsetY + centerLocalY }
    },
    [baseSize, viewportSize, panXpx, panYpx, transform.rotation, transform.zoom, transform.flipped],
  )

  // "polygon(...)" em % (o mesmo espaço em que os pontos marcados vivem), aplicado
  // dentro do palco já transformado — por isso a máscara acompanha pan/zoom/rotação
  // automaticamente, sem precisar recalcular nada quando o usuário ajusta a imagem.
  function buildClipPath(mask: CropMask | null): string | undefined {
    if (!mask || mask.points.length < 3) return undefined
    return `polygon(${mask.points.map((p) => `${p.x}% ${p.y}%`).join(', ')})`
  }

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
    if (adjustMode || cropMode || !allowCreate || !image) return
    const coord = screenToPercent(e.clientX, e.clientY)
    if (coord) onCreatePoint(coord)
  }

  function clientToViewportLocal(clientX: number, clientY: number) {
    const r = viewportRef.current!.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  function centeredCropRect(): CropRect {
    const side = Math.min(viewportSize.width, viewportSize.height) * 0.7
    return { x: (viewportSize.width - side) / 2, y: (viewportSize.height - side) / 2, width: side, height: side }
  }

  // Se os 4 pontos da máscara atual (já convertidos pra pixels locais, na transformação
  // de agora) ainda formam um retângulo alinhado aos eixos, dá pra reabrir a ferramenta
  // "Quadrado" com cantos/bordas arrastáveis de novo, exatamente de onde parou. Se não
  // (o recorte era livre, ou a imagem girou desde então), retorna null.
  function rectFromAxisAlignedPoints(points: { x: number; y: number }[]): CropRect | null {
    if (points.length !== 4) return null
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const tol = 1
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]
    const isRect = points.every((p) => corners.some((c) => Math.abs(c.x - p.x) < tol && Math.abs(c.y - p.y) < tol))
    if (!isRect || maxX - minX < MIN_CROP_SIZE || maxY - minY < MIN_CROP_SIZE) return null
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  // Recorte não-destrutivo: abrir a ferramenta sempre mostra a imagem ORIGINAL inteira
  // (o clip-path do recorte já aplicado fica suspenso enquanto cropMode é true, ver JSX),
  // então a parte que tinha sido recortada antes volta a aparecer e pode ser reincluída
  // livremente. Se já havia um recorte, a seleção começa exatamente onde ele estava.
  function startCrop() {
    const localPoints = cropMask?.points.map(percentToLocal) ?? null
    const rect = localPoints ? rectFromAxisAlignedPoints(localPoints) : null
    if (rect) {
      setCropShape('square')
      setCropRect(rect)
      setFreehandPoints([])
    } else if (localPoints) {
      setCropShape('free')
      setCropRect(null)
      setFreehandPoints(localPoints)
    } else {
      setCropShape('square')
      setCropRect(centeredCropRect())
      setFreehandPoints([])
    }
    setFreehandDrawing(false)
    setCropMode(true)
  }

  function cancelCrop() {
    setCropMode(false)
    setCropRect(null)
    setFreehandPoints([])
    setFreehandDrawing(false)
  }

  // Troca de ferramenta: "Quadrado" é um retângulo com cantos/bordas arrastáveis (cada lado
  // mexe independente dos outros); "Livre" é desenhar o contorno do recorte à mão com o mouse.
  // São ferramentas diferentes, então trocar limpa o que estava sendo feito na outra.
  function changeCropShape(shape: CropShape) {
    setCropShape(shape)
    setFreehandPoints([])
    setFreehandDrawing(false)
    setCropRect(shape === 'square' ? centeredCropRect() : null)
  }

  function handleCropRectPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!cropRect) return
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no elemento.
    }
    cropDragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, startRect: cropRect }
  }

  function handleCropHandlePointerDown(e: PointerEvent<HTMLDivElement>, handle: CropHandle) {
    if (!cropRect) return
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no elemento.
    }
    cropDragRef.current = { mode: 'resize', handle, startRect: cropRect }
  }

  function handleCropPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current
    if (!drag) return
    e.stopPropagation()

    if (drag.mode === 'move') {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const x = clamp(drag.startRect.x + dx, 0, Math.max(0, viewportSize.width - drag.startRect.width))
      const y = clamp(drag.startRect.y + dy, 0, Math.max(0, viewportSize.height - drag.startRect.height))
      setCropRect({ ...drag.startRect, x, y })
      return
    }

    const { handle, startRect } = drag
    const pointer = clientToViewportLocal(e.clientX, e.clientY)
    const moveX = clamp(pointer.x, 0, viewportSize.width)
    const moveY = clamp(pointer.y, 0, viewportSize.height)

    // Cada lado se move de forma independente: arrastar uma borda ou um canto nunca mexe
    // nos lados opostos, então dá pra recortar só de cima, só de um lado, só um canto, etc.
    if (isCropEdgeHandle(handle)) {
      if (handle === 'n') {
        const bottom = startRect.y + startRect.height
        const y = Math.min(moveY, bottom - MIN_CROP_SIZE)
        setCropRect({ ...startRect, y, height: bottom - y })
      } else if (handle === 's') {
        const height = clamp(moveY - startRect.y, MIN_CROP_SIZE, viewportSize.height - startRect.y)
        setCropRect({ ...startRect, height })
      } else if (handle === 'w') {
        const right = startRect.x + startRect.width
        const x = Math.min(moveX, right - MIN_CROP_SIZE)
        setCropRect({ ...startRect, x, width: right - x })
      } else {
        const width = clamp(moveX - startRect.x, MIN_CROP_SIZE, viewportSize.width - startRect.x)
        setCropRect({ ...startRect, width })
      }
      return
    }

    const opposite = CROP_CORNER_OPPOSITE[handle]
    const anchor = {
      x: opposite.x === 'left' ? startRect.x : startRect.x + startRect.width,
      y: opposite.y === 'top' ? startRect.y : startRect.y + startRect.height,
    }

    let width = Math.abs(moveX - anchor.x)
    let x = Math.min(anchor.x, moveX)
    if (width < MIN_CROP_SIZE) {
      width = MIN_CROP_SIZE
      x = moveX >= anchor.x ? anchor.x : anchor.x - MIN_CROP_SIZE
    }
    let height = Math.abs(moveY - anchor.y)
    let y = Math.min(anchor.y, moveY)
    if (height < MIN_CROP_SIZE) {
      height = MIN_CROP_SIZE
      y = moveY >= anchor.y ? anchor.y : anchor.y - MIN_CROP_SIZE
    }
    x = clamp(x, 0, Math.max(0, viewportSize.width - width))
    y = clamp(y, 0, Math.max(0, viewportSize.height - height))
    setCropRect({ x, y, width, height })
  }

  function handleCropPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!cropDragRef.current) return
    e.stopPropagation()
    cropDragRef.current = null
  }

  // Recorte livre: começar a arrastar sempre inicia um traço novo (descarta o anterior),
  // pra poder redesenhar o contorno quantas vezes quiser antes de aplicar.
  function handleFreehandPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o desenho ainda funciona via listeners no elemento.
    }
    const pt = clientToViewportLocal(e.clientX, e.clientY)
    setFreehandPoints([{ x: clamp(pt.x, 0, viewportSize.width), y: clamp(pt.y, 0, viewportSize.height) }])
    setFreehandDrawing(true)
  }

  function handleFreehandPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!freehandDrawing) return
    e.stopPropagation()
    const pt = clientToViewportLocal(e.clientX, e.clientY)
    const x = clamp(pt.x, 0, viewportSize.width)
    const y = clamp(pt.y, 0, viewportSize.height)
    setFreehandPoints((prev) => {
      const last = prev[prev.length - 1]
      // Só guarda o ponto se andou o suficiente — evita acumular milhares de pontos por traço.
      if (last && Math.hypot(x - last.x, y - last.y) < 2) return prev
      return [...prev, { x, y }]
    })
  }

  function handleFreehandPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!freehandDrawing) return
    e.stopPropagation()
    setFreehandDrawing(false)
  }

  // Recorte não-destrutivo: só converte a seleção (em pixels locais do palco, na
  // transformação atual) pra % da imagem original e manda pro componente pai — nenhum
  // pixel é assado num PNG novo, então nada se perde e os pontos marcados não mudam.
  function applyCrop() {
    if (cropShape === 'free') {
      if (freehandPoints.length < 3) return
      onApplyCrop({ points: freehandPoints.map((p) => localToPercent(p.x, p.y)) })
    } else {
      if (!cropRect) return
      const corners = [
        { x: cropRect.x, y: cropRect.y },
        { x: cropRect.x + cropRect.width, y: cropRect.y },
        { x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height },
        { x: cropRect.x, y: cropRect.y + cropRect.height },
      ]
      onApplyCrop({ points: corners.map((c) => localToPercent(c.x, c.y)) })
    }
    setCropMode(false)
    setCropRect(null)
    setFreehandPoints([])
  }

  // "Concluir ajuste" enquanto uma seleção de recorte ainda está aberta (sem ter clicado em
  // "Aplicar recorte") precisa decidir por ela — senão o quadro de recorte fica aparecendo
  // sozinho por cima da imagem depois que a barra de ajuste já sumiu. Aplica se dá pra
  // aplicar (já tem uma seleção válida); senão só cancela o recorte em aberto.
  function finishAdjust() {
    if (cropMode) {
      const canApply = cropShape === 'free' ? freehandPoints.length >= 3 : !!cropRect
      if (canApply) applyCrop()
      else cancelCrop()
    }
    setAdjustMode(false)
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
    // Enquanto esse lado espera um ponto novo, um clique em cima (ou perto) de um
    // marcador existente precisa marcar o ponto novo — não abrir a edição do anterior.
    // Por isso a edição só começa depois que o mouse realmente se move um pouco.
    if (allowCreate && image) {
      pendingClickRef.current = { x: e.clientX, y: e.clientY }
    } else {
      pendingClickRef.current = null
      onStartEdit(id)
    }
  }

  function handleMarkerPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    const pending = pendingClickRef.current
    if (pending) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD_PX) return
      pendingClickRef.current = null
      onStartEdit(draggingMinutiaId.current)
    }
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
    if (pendingClickRef.current) {
      // Foi um clique (sem arrastar): marca o ponto novo exatamente onde clicou.
      pendingClickRef.current = null
      if (e.type === 'pointerup') {
        const coord = screenToPercent(e.clientX, e.clientY)
        if (coord) onCreatePoint(coord)
      }
      return
    }
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
              onClick={() => (adjustMode ? finishAdjust() : setAdjustMode(true))}
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
          accept="image/*,application/pdf,.pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Quadro + barra de ajuste lateral: à esquerda do quadro A e à direita do quadro B. */}
      <div className={`relative flex flex-col gap-2 md:items-start ${slot === 'B' ? 'md:flex-row-reverse' : 'md:flex-row'}`}>
      {(adjustMode || (reserveSidebar && !sidebarOutside)) && (
        <div
          className={
            sidebarOutside
              ? 'absolute top-0'
              : `relative shrink-0 md:w-[var(--sidebar-w)] ${adjustMode ? '' : 'hidden md:block'}`
          }
          style={
            sidebarOutside
              ? {
                  width: SIDEBAR_WIDTH,
                  [slot === 'A' ? 'right' : 'left']: `calc(100% + ${SIDEBAR_GAP}px)`,
                }
              : ({ '--sidebar-w': `${SIDEBAR_WIDTH}px` } as CSSProperties)
          }
        >
        {adjustMode && (
        <div className="flex flex-col gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
          {cropMode ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
                <button
                  onClick={() => changeCropShape('square')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                    cropShape === 'square'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  title="Recorte retangular — arraste cada canto ou lado independente dos outros"
                >
                  <Square size={14} />
                  Quadrado
                </button>
                <button
                  onClick={() => changeCropShape('free')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                    cropShape === 'free'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  title="Recorte livre — desenhe o contorno do recorte com o mouse"
                >
                  <Crop size={14} />
                  Livre
                </button>
              </div>
              <span className="text-gray-400 dark:text-gray-500">
                {cropShape === 'square'
                  ? 'Arraste um canto ou o meio de um lado pra ajustar só aquele lado, ou o centro pra mover.'
                  : 'Desenhe o contorno do recorte clicando e arrastando o mouse sobre a imagem.'}
              </span>
              <button
                onClick={cancelCrop}
                className="flex w-full items-center justify-center gap-1 rounded-md bg-white px-2 py-1.5 font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700"
              >
                <X size={14} />
                Cancelar
              </button>
              <button
                onClick={applyCrop}
                disabled={cropShape === 'free' && freehandPoints.length < 3}
                className="flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={14} />
                Aplicar recorte
              </button>
            </div>
          ) : (
            <>
          <div className="flex flex-col gap-1">
            {/* Zoom */}
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <span className="w-full font-medium text-gray-500 dark:text-gray-400">Zoom</span>
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
              <span className="w-full font-medium text-gray-500 dark:text-gray-400">Rotação</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(transform.rotation)}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, rotation: Number(e.target.value) }))
                }
                className="w-full"
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
              className="flex flex-wrap items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600"
              title="Ponto preto: escurece as sombras e aumenta o contraste ao redor delas, sem mexer nos claros"
            >
              <span className="flex w-full items-center gap-1 font-medium text-gray-500 dark:text-gray-400">
                <SunDim size={14} />
                Ponto preto
              </span>
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                value={transform.levelsBlack}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, levelsBlack: clamp(Number(e.target.value), MIN_LEVEL, MAX_LEVEL) }))
                }
                className="w-full"
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
              className="flex flex-wrap items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600"
              title="Escurecer: deixa a foto inteira mais escura por igual (sombras e claros juntos) — útil quando ela está apagada/clara demais"
            >
              <span className="flex w-full items-center gap-1 font-medium text-gray-500 dark:text-gray-400">
                <Sun size={14} />
                Escurecer
              </span>
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                value={transform.darken}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, darken: clamp(Number(e.target.value), MIN_LEVEL, MAX_LEVEL) }))
                }
                className="w-full"
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

            {/* Clarear */}
            <div
              className="flex flex-wrap items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600"
              title="Clarear: deixa a foto inteira mais clara por igual (sombras e claros juntos) — útil quando ela está escura demais"
            >
              <span className="flex w-full items-center gap-1 font-medium text-gray-500 dark:text-gray-400">
                <SunMedium size={14} />
                Clarear
              </span>
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                value={transform.lighten}
                onChange={(e) =>
                  setTransform((t) => ({ ...t, lighten: clamp(Number(e.target.value), MIN_LEVEL, MAX_LEVEL) }))
                }
                className="w-full"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, lighten: clamp(t.lighten - LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Diminuir clarear"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                value={transform.lighten}
                onChange={(e) => {
                  if (e.target.value === '') return
                  const v = Number(e.target.value)
                  if (Number.isNaN(v)) return
                  setTransform((t) => ({ ...t, lighten: clamp(v, MIN_LEVEL, MAX_LEVEL) }))
                }}
                className="w-12 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={() =>
                  setTransform((t) => ({ ...t, lighten: clamp(t.lighten + LEVEL_STEP, MIN_LEVEL, MAX_LEVEL) }))
                }
                className={STEP_BTN_CLASS}
                title="Aumentar clarear"
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

            {/* Recortar */}
            <div className="flex items-center gap-1 rounded-md bg-white p-1 shadow-sm ring-1 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600">
              <button
                onClick={startCrop}
                className="flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-0.5 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                title={
                  cropMask
                    ? 'Ajustar o recorte — a imagem inteira (inclusive a parte já recortada) continua disponível'
                    : 'Recortar a imagem (quadrado ou livre)'
                }
              >
                <Crop size={14} />
                Recortar
              </button>
              {cropMask && (
                <button
                  onClick={onRevertCrop}
                  className="flex items-center justify-center rounded p-1 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  title="Reverter recorte — volta a mostrar a imagem inteira, sem nenhum recorte aplicado"
                >
                  <Undo2 size={14} />
                </button>
              )}
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

          <button
            onClick={finishAdjust}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Check size={14} />
            Concluir ajuste
          </button>
            </>
          )}
        </div>
        )}
        </div>
      )}

      <div className="min-w-0 flex-1">
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
            <span className="text-sm font-medium text-gray-400 dark:text-gray-600">Clique para carregar a imagem ou PDF</span>
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
              // Em modo de recorte, a imagem original inteira precisa aparecer (inclusive a
              // parte já recortada antes), pra poder reincluí-la — por isso o clip fica suspenso.
              clipPath: cropMode ? undefined : buildClipPath(cropMask),
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
                    // O non-scaling-stroke só neutraliza o esticamento do viewBox; o zoom
                    // (scale do CSS no palco) ainda engrossaria a linha — por isso a divisão,
                    // para ela ter a mesma espessura na tela nas duas imagens, com qualquer zoom.
                    strokeWidth={LINE_THICKNESS / transform.zoom}
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
                        title={`Ponto ${displayId(m.id)}`}
                      >
                        {numberVisible ? displayId(m.id) : ''}
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
                clipPath: buildClipPath(otherCropMask),
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

        {cropMode && cropRect && (
          <div
            className="absolute inset-0"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={handleCropPointerMove}
            onPointerUp={handleCropPointerUp}
            onPointerCancel={handleCropPointerUp}
          >
            <div
              onPointerDown={handleCropRectPointerDown}
              className="absolute cursor-move"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.width,
                height: cropRect.height,
                // Trecho fora da seleção fica escurecido (sombra gigante fora do próprio recorte);
                // dentro dela, a imagem aparece normal — sem precisar de elementos extras.
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                border: '2px dashed #ffffff',
                touchAction: 'none',
              }}
            >
              {(['nw', 'ne', 'sw', 'se'] as CropHandle[]).map((handle) => (
                <div
                  key={handle}
                  onPointerDown={(e) => handleCropHandlePointerDown(e, handle)}
                  className="absolute h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow"
                  style={{
                    left: handle.includes('w') ? -8 : undefined,
                    right: handle.includes('e') ? -8 : undefined,
                    top: handle.includes('n') ? -8 : undefined,
                    bottom: handle.includes('s') ? -8 : undefined,
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                    touchAction: 'none',
                  }}
                />
              ))}
              {/* Barras do meio de cada lado: mexem só naquela borda (ex.: só a parte de baixo). */}
              {(['n', 's', 'e', 'w'] as CropHandle[]).map((handle) => {
                const horizontal = handle === 'n' || handle === 's'
                const style: CSSProperties = horizontal
                  ? { left: '50%', width: 28, height: 10, marginLeft: -14, cursor: 'ns-resize', touchAction: 'none' }
                  : { top: '50%', width: 10, height: 28, marginTop: -14, cursor: 'ew-resize', touchAction: 'none' }
                if (handle === 'n') style.top = -5
                if (handle === 's') style.bottom = -5
                if (handle === 'w') style.left = -5
                if (handle === 'e') style.right = -5
                return (
                  <div
                    key={handle}
                    onPointerDown={(e) => handleCropHandlePointerDown(e, handle)}
                    className="absolute rounded-full border-2 border-white bg-blue-600 shadow"
                    style={style}
                  />
                )
              })}
            </div>
          </div>
        )}

        {cropMode && cropShape === 'free' && (
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={handleFreehandPointerDown}
            onPointerMove={handleFreehandPointerMove}
            onPointerUp={handleFreehandPointerUp}
            onPointerCancel={handleFreehandPointerUp}
            style={{ touchAction: 'none' }}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {freehandPoints.length > 2 && (
                <path
                  d={`M0 0 H${viewportSize.width} V${viewportSize.height} H0 Z ${freehandPoints
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                    .join(' ')} Z`}
                  fill="rgba(0,0,0,0.55)"
                  fillRule="evenodd"
                />
              )}
              {freehandPoints.length > 0 && (
                <polyline
                  points={freehandPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
              {/* Fecha visualmente o traço de volta pro início assim que solta o mouse. */}
              {freehandPoints.length > 2 && !freehandDrawing && (
                <line
                  x1={freehandPoints[freehandPoints.length - 1].x}
                  y1={freehandPoints[freehandPoints.length - 1].y}
                  x2={freehandPoints[0].x}
                  y2={freehandPoints[0].y}
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
            </svg>
          </div>
        )}
      </div>
      </div>
      </div>
    </div>
  )
})

export default ImagePanel
