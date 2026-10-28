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
import Magnifier, { MAGNIFIER_HEIGHT, MAGNIFIER_SIZE } from './Magnifier'

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
  // Lupa flutuante sobre o quadro enquanto um ponto está sendo arrastado: 'editing' no lado
  // arrastado e 'reference' no outro, cada uma centrada no ponto daquela imagem.
  magnifier: { variant: 'editing' | 'reference'; point: Coordinate } | null
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
// Parte do marcador que foi pega para arrastar: o número (comportamento de sempre), a
// bolinha da minúcia (move só o ponto real) ou a linha (move ponto e número juntos).
type MarkerPart = 'label' | 'anchor' | 'line'
// Área de toque da bolinha da minúcia e da linha (px na tela): só um pouco maior que o
// desenho, para não "roubar" cliques de quem está marcando um ponto bem ao lado.
const ANCHOR_HIT_SIZE = 11
const LINE_HIT_THICKNESS = 8
// Espessura da borda do quadro (border-4) e folgas (px) entre a borda e os marcadores.
const FRAME_BORDER = 4
// O número fica sempre dentro do quadro, a esta distância da borda (além do próprio raio).
const LABEL_EDGE_GAP = 8
// A bolinha da minúcia pode chegar bem perto da borda.
const POINT_EDGE_INSET = 4
// Distância (px) entre o ponto e a lupa flutuante.
const MAGNIFIER_GAP = 28

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
// "bolinha da minúcia" — toda vermelha, sem borda
const ANCHOR_DOT_SIZE = LINE_THICKNESS * 2 + 2
const NUMBER_COLOR = '#dc2626' // vermelho
const DOT_COLOR = '#ffffff' // branco
const ANCHOR_DOT_COLOR = '#dc2626'
export const FRAME_COLOR: Record<ImageSlot, string> = { A: '#dc2626', B: '#2563eb' }

// Como a imagem fica posicionada no quadro. Sem recorte, ela gira/escala em torno do próprio
// centro. Com recorte, tudo gira/escala em torno do centro da área recortada, que é
// ajustada (zoom "fit") para preencher o quadro — assim só aparece o que foi recortado e
// espelhar/girar nunca manda o recorte para fora do quadro.
interface Geometry {
  baseW: number
  baseH: number
  // Ponto fixo da imagem (px, no palco): fica no centro do quadro (mais o pan).
  pivotX: number
  pivotY: number
  // Zoom efetivo: o zoom do usuário vezes o ajuste do recorte ao quadro.
  zoom: number
  panX: number
  panY: number
  rotation: number
  flipped: boolean
  vw: number
  vh: number
}

function computeGeometry(
  base: { width: number; height: number },
  viewport: { width: number; height: number },
  t: Pick<ImageTransform, 'zoom' | 'panX' | 'panY' | 'rotation' | 'flipped'>,
  mask: CropMask | null,
): Geometry {
  let pivotPctX = 50
  let pivotPctY = 50
  let fit = 1
  if (mask && mask.points.length >= 3 && base.width > 0 && base.height > 0 && viewport.width > 0) {
    const xs = mask.points.map((p) => p.x)
    const ys = mask.points.map((p) => p.y)
    pivotPctX = (Math.min(...xs) + Math.max(...xs)) / 2
    pivotPctY = (Math.min(...ys) + Math.max(...ys)) / 2
    // O contorno, já girado como está na tela, precisa caber inteiro no quadro.
    const rad = (t.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    let halfW = 0
    let halfH = 0
    for (const p of mask.points) {
      const dx = ((p.x - pivotPctX) / 100) * base.width
      const dy = ((p.y - pivotPctY) / 100) * base.height
      halfW = Math.max(halfW, Math.abs(dx * cos - dy * sin))
      halfH = Math.max(halfH, Math.abs(dx * sin + dy * cos))
    }
    if (halfW > 0 && halfH > 0) fit = Math.min(viewport.width / 2 / halfW, viewport.height / 2 / halfH)
  }
  return {
    baseW: base.width,
    baseH: base.height,
    pivotX: (pivotPctX / 100) * base.width,
    pivotY: (pivotPctY / 100) * base.height,
    zoom: t.zoom * fit,
    panX: (t.panX / 100) * base.width,
    panY: (t.panY / 100) * base.height,
    rotation: t.rotation,
    flipped: t.flipped,
    vw: viewport.width,
    vh: viewport.height,
  }
}

// De pixels locais do quadro (relativos ao canto do próprio quadro) para % da imagem.
function geometryLocalToPercent(g: Geometry, x: number, y: number): Coordinate {
  const offsetX = x - g.vw / 2 - g.panX
  const offsetY = y - g.vh / 2 - g.panY
  const rad = (g.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const afterRotX = offsetX * cos + offsetY * sin
  const afterRotY = -offsetX * sin + offsetY * cos
  const flipFactor = g.flipped ? -1 : 1
  const localX = (afterRotX / g.zoom) * flipFactor
  const localY = afterRotY / g.zoom
  return {
    x: ((g.pivotX + localX) / g.baseW) * 100,
    y: ((g.pivotY + localY) / g.baseH) * 100,
  }
}

// Inversa de geometryLocalToPercent.
function geometryPercentToLocal(g: Geometry, c: Coordinate): { x: number; y: number } {
  const localX = (c.x / 100) * g.baseW - g.pivotX
  const localY = (c.y / 100) * g.baseH - g.pivotY
  const flipFactor = g.flipped ? -1 : 1
  const afterRotX = localX * flipFactor * g.zoom
  const afterRotY = localY * g.zoom
  const rad = (g.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: g.vw / 2 + g.panX + afterRotX * cos - afterRotY * sin,
    y: g.vh / 2 + g.panY + afterRotX * sin + afterRotY * cos,
  }
}

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
  magnifier,
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
  // Qual parte do marcador está sendo arrastada, e onde tudo estava no início do arraste
  // (em pixels locais do quadro, e o ponto/deslocamento em % da imagem).
  const dragPartRef = useRef<{
    part: MarkerPart
    startPointer: { x: number; y: number }
    startPoint: { x: number; y: number }
    startLabel: { x: number; y: number }
    startCoord: Coordinate
    startOffset: Coordinate
  } | null>(null)
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
  // No recorte "Quadrado": mantém a seleção sempre quadrada ao mexer nos cantos e nos lados.
  const [keepSquare, setKeepSquare] = useState(true)
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

  // Geometria da imagem no quadro (ver Geometry). Em modo de recorte a imagem inteira aparece
  // sem zoom/pan e sem o recorte já aplicado, para poder escolher qualquer área dela.
  const geom = computeGeometry(
    baseSize,
    viewportSize,
    cropMode ? { ...transform, zoom: 1, panX: 0, panY: 0 } : transform,
    cropMode ? null : cropMask,
  )

  const ghostScale =
    otherNatural && viewportSize.width > 0
      ? Math.min(viewportSize.width / otherNatural.w, viewportSize.height / otherNatural.h)
      : 0
  const ghostBaseSize = {
    width: (otherNatural?.w ?? 0) * ghostScale,
    height: (otherNatural?.h ?? 0) * ghostScale,
  }
  const ghostGeom = computeGeometry(ghostBaseSize, viewportSize, otherTransform, otherCropMask)

  // Pixels locais do quadro (relativos ao canto dele) <-> % da imagem ORIGINAL, que é o
  // espaço onde a máscara de recorte (não-destrutiva) e os pontos marcados vivem para sempre.
  const localToPercent = (x: number, y: number): Coordinate => geometryLocalToPercent(geom, x, y)
  const percentToLocal = (coord: Coordinate): { x: number; y: number } => geometryPercentToLocal(geom, coord)

  // "polygon(...)" em % (o mesmo espaço em que os pontos marcados vivem), aplicado
  // dentro do palco já transformado — por isso a máscara acompanha pan/zoom/rotação
  // automaticamente, sem precisar recalcular nada quando o usuário ajusta a imagem.
  function buildClipPath(mask: CropMask | null): string | undefined {
    if (!mask || mask.points.length < 3) return undefined
    return `polygon(${mask.points.map((p) => `${p.x}% ${p.y}%`).join(', ')})`
  }

  // Trava um ponto (pixels locais) dentro da área visível do quadro, a `inset` px da borda.
  function clampToFrame(p: { x: number; y: number }, inset: number) {
    const min = FRAME_BORDER + inset
    return {
      x: clamp(p.x, min, Math.max(min, viewportSize.width - min)),
      y: clamp(p.y, min, Math.max(min, viewportSize.height - min)),
    }
  }

  // O número nunca sai do quadro: fica sempre a uma distância da borda (raio + folga).
  const LABEL_INSET = MARKER_SIZE / 2 + LABEL_EDGE_GAP

  // Posição do mouse -> % da imagem, com o número travado dentro do quadro. Feito em pixels
  // da tela (e não em % da imagem), então vale com qualquer zoom, giro ou espelhamento.
  function screenToPercent(clientX: number, clientY: number): Coordinate | null {
    if (!viewportRef.current || baseSize.width === 0) return null
    const local = clampToFrame(clientToViewportLocal(clientX, clientY), LABEL_INSET)
    return localToPercent(local.x, local.y)
  }

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
    // Em modo de recorte a imagem aparece inteira, sem zoom/pan (ver geom): a seleção
    // anterior é posicionada nessa mesma visão.
    const cropGeom = computeGeometry(baseSize, viewportSize, { ...transform, zoom: 1, panX: 0, panY: 0 }, null)
    const localPoints = cropMask?.points.map((p) => geometryPercentToLocal(cropGeom, p)) ?? null
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

  // "Manter quadrado" ligado: a seleção continua um quadrado ao arrastar qualquer canto ou lado.
  // O lado arrastado segue o mouse e o lado oposto fica parado; a outra dimensão cresce/encolhe
  // junto, centrada (num canto, a partir do canto oposto). Nunca passa da borda do quadro.
  function resizeSquare(handle: CropHandle, r: CropRect, moveX: number, moveY: number): CropRect {
    const vw = viewportSize.width
    const vh = viewportSize.height
    const side = (wanted: number, maxSide: number) => clamp(wanted, MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, maxSide))

    if (isCropEdgeHandle(handle)) {
      const cx = r.x + r.width / 2
      const cy = r.y + r.height / 2
      if (handle === 'n' || handle === 's') {
        const maxByWidth = 2 * Math.min(cx, vw - cx)
        if (handle === 'n') {
          const bottom = r.y + r.height
          const s = side(bottom - moveY, Math.min(bottom, maxByWidth))
          return { x: cx - s / 2, y: bottom - s, width: s, height: s }
        }
        const s = side(moveY - r.y, Math.min(vh - r.y, maxByWidth))
        return { x: cx - s / 2, y: r.y, width: s, height: s }
      }
      const maxByHeight = 2 * Math.min(cy, vh - cy)
      if (handle === 'w') {
        const right = r.x + r.width
        const s = side(right - moveX, Math.min(right, maxByHeight))
        return { x: right - s, y: cy - s / 2, width: s, height: s }
      }
      const s = side(moveX - r.x, Math.min(vw - r.x, maxByHeight))
      return { x: r.x, y: cy - s / 2, width: s, height: s }
    }

    const opposite = CROP_CORNER_OPPOSITE[handle]
    const ax = opposite.x === 'left' ? r.x : r.x + r.width
    const ay = opposite.y === 'top' ? r.y : r.y + r.height
    const dirX = moveX >= ax ? 1 : -1
    const dirY = moveY >= ay ? 1 : -1
    const availX = dirX > 0 ? vw - ax : ax
    const availY = dirY > 0 ? vh - ay : ay
    const s = side(Math.max(Math.abs(moveX - ax), Math.abs(moveY - ay)), Math.min(availX, availY))
    return { x: dirX > 0 ? ax : ax - s, y: dirY > 0 ? ay : ay - s, width: s, height: s }
  }

  // Ao ligar "Manter quadrado" com uma seleção que não é quadrada, ela vira o maior quadrado
  // que cabe nela, no mesmo centro.
  function toggleKeepSquare() {
    const next = !keepSquare
    setKeepSquare(next)
    if (next && cropRect) {
      const s = Math.min(cropRect.width, cropRect.height)
      const cx = cropRect.x + cropRect.width / 2
      const cy = cropRect.y + cropRect.height / 2
      setCropRect({ x: cx - s / 2, y: cy - s / 2, width: s, height: s })
    }
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

    if (keepSquare) {
      setCropRect(resizeSquare(handle, startRect, moveX, moveY))
      return
    }

    // Sem "Manter quadrado", cada lado se move de forma independente: arrastar uma borda ou
    // um canto nunca mexe nos lados opostos, então dá pra recortar só de cima, só de um lado, etc.
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
    // O recorte novo passa a preencher o quadro (ver Geometry): zoom e posição recomeçam do ajuste.
    setTransform((t) => ({ ...t, zoom: 1, panX: 0, panY: 0 }))
    setCropMode(false)
    setCropRect(null)
    setFreehandPoints([])
  }

  function revertCrop() {
    onRevertCrop()
    setTransform((t) => ({ ...t, zoom: 1, panX: 0, panY: 0 }))
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
    return {
      x: viewportRect.left + viewportRect.width / 2 + panXpx,
      y: viewportRect.top + viewportRect.height / 2 + panYpx,
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

  function handleMarkerPointerDown(e: PointerEvent<Element>, id: number, part: MarkerPart = 'label') {
    if (adjustMode) return
    e.stopPropagation()
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético/já liberado — o arraste ainda funciona via listeners no marcador.
    }
    draggingMinutiaId.current = id
    const m = minutiae.find((mm) => mm.id === id)
    const coord = m?.[coordKey]
    const offset = m?.[offsetKey] ?? { x: 0, y: 0 }
    // O arraste é relativo ao ponto onde o marcador foi pego (tudo em pixels da tela), então
    // o marcador fica sempre exatamente debaixo do mouse, sem pular.
    dragPartRef.current = coord
      ? {
          part,
          startPointer: clientToViewportLocal(e.clientX, e.clientY),
          startPoint: percentToLocal(coord),
          startLabel: percentToLocal({ x: coord.x + offset.x, y: coord.y + offset.y }),
          startCoord: coord,
          startOffset: offset,
        }
      : null
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

  function handleMarkerPointerMove(e: PointerEvent<Element>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    const pending = pendingClickRef.current
    if (pending) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD_PX) return
      pendingClickRef.current = null
      onStartEdit(draggingMinutiaId.current)
    }
    const drag = dragPartRef.current
    if (!drag || baseSize.width === 0) return
    const id = draggingMinutiaId.current
    const pointer = clientToViewportLocal(e.clientX, e.clientY)
    const moveX = pointer.x - drag.startPointer.x
    const moveY = pointer.y - drag.startPointer.y

    // Limites (pixels locais) dentro dos quais cada coisa pode ficar sem sair do quadro: o
    // número fica a uma folga da borda; a bolinha da minúcia pode chegar bem perto dela.
    const limits = (inset: number) => {
      const min = FRAME_BORDER + inset
      return { minX: min, maxX: Math.max(min, viewportSize.width - min), minY: min, maxY: Math.max(min, viewportSize.height - min) }
    }
    const labelLim = limits(LABEL_INSET)
    const pointLim = limits(POINT_EDGE_INSET)

    if (drag.part === 'anchor') {
      // Bolinha da minúcia: move só o ponto real; o número fica parado onde está
      // (o deslocamento do número é recalculado para ele não sair do lugar).
      const p = {
        x: clamp(drag.startPoint.x + moveX, pointLim.minX, pointLim.maxX),
        y: clamp(drag.startPoint.y + moveY, pointLim.minY, pointLim.maxY),
      }
      const point = localToPercent(p.x, p.y)
      const labelX = drag.startCoord.x + drag.startOffset.x
      const labelY = drag.startCoord.y + drag.startOffset.y
      onMovePoint(id, point)
      onMoveLabel(id, { x: labelX - point.x, y: labelY - point.y })
      return
    }

    if (drag.part === 'label' && arrowMode) {
      // Modo linha: arrastar o número move só ele (o ponto real fica parado).
      const l = {
        x: clamp(drag.startLabel.x + moveX, labelLim.minX, labelLim.maxX),
        y: clamp(drag.startLabel.y + moveY, labelLim.minY, labelLim.maxY),
      }
      const label = localToPercent(l.x, l.y)
      onMoveLabel(id, { x: label.x - drag.startCoord.x, y: label.y - drag.startCoord.y })
      return
    }

    // A linha (ou o número, fora do modo linha) move o conjunto todo — ponto e número juntos,
    // sem deixar nenhum dos dois sair do quadro.
    const dx = clamp(
      moveX,
      Math.max(labelLim.minX - drag.startLabel.x, pointLim.minX - drag.startPoint.x),
      Math.min(labelLim.maxX - drag.startLabel.x, pointLim.maxX - drag.startPoint.x),
    )
    const dy = clamp(
      moveY,
      Math.max(labelLim.minY - drag.startLabel.y, pointLim.minY - drag.startPoint.y),
      Math.min(labelLim.maxY - drag.startLabel.y, pointLim.maxY - drag.startPoint.y),
    )
    onMovePoint(id, localToPercent(drag.startPoint.x + dx, drag.startPoint.y + dy))
  }

  function handleMarkerPointerUp(e: PointerEvent<Element>) {
    if (draggingMinutiaId.current === null) return
    e.stopPropagation()
    draggingMinutiaId.current = null
    dragPartRef.current = null
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
      <div className={`relative flex flex-col gap-2 md:items-start md:justify-center ${slot === 'B' ? 'md:flex-row-reverse' : 'md:flex-row'}`}>
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
              {cropShape === 'square' && (
                <button
                  onClick={toggleKeepSquare}
                  className={`flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 font-medium shadow-sm ring-1 ${
                    keepSquare
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700'
                  }`}
                  title="Ligado: a seleção continua um quadrado ao mexer nos cantos e nos lados. Desligado: cada lado se move separado dos outros."
                >
                  <Square size={14} />
                  Manter quadrado
                </button>
              )}
              <span className="text-gray-400 dark:text-gray-500">
                {cropShape === 'square'
                  ? keepSquare
                    ? 'Arraste um canto ou o meio de um lado pra aumentar ou diminuir o quadrado, ou o centro pra mover.'
                    : 'Arraste um canto ou o meio de um lado pra ajustar só aquele lado, ou o centro pra mover.'
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
                  onClick={revertCrop}
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

      {/* Quadrado grande, quase a tela toda: nunca passa da altura da janela (menos o cabeçalho). */}
      <div className="w-full min-w-0 flex-1 self-center md:self-start" style={{ maxWidth: 'max(480px, calc(100vh - 8rem))' }}>
      <div
        ref={viewportRef}
        onClick={handleMarkClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative aspect-square w-full overflow-hidden rounded-lg border-4 bg-white select-none ${
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
            // A exportação não entende o clip-path da imagem; ela lê esta marcação para recortá-la de verdade (ver cropExport.ts).
            data-crop-mask={!cropMode && buildClipPath(cropMask) ? JSON.stringify(cropMask!.points) : undefined}
            style={{
              left: `calc(50% - ${geom.pivotX}px)`,
              top: `calc(50% - ${geom.pivotY}px)`,
              width: baseSize.width,
              height: baseSize.height,
              transform: `translate(${geom.panX}px, ${geom.panY}px) rotate(${geom.rotation}deg) scale(${geom.zoom}) scaleX(${geom.flipped ? -1 : 1})`,
              // Tudo gira/escala em torno do centro do recorte (ou da imagem, sem recorte).
              transformOrigin: `${geom.pivotX}px ${geom.pivotY}px`,
            }}
          >
            <img
              ref={imgRef}
              src={image}
              alt={title}
              draggable={false}
              onLoad={handleImgLoad}
              className="block h-full w-full select-none pointer-events-none"
              style={{
                filter: buildFilter(transform),
                // O recorte vai só na imagem (que ocupa o palco inteiro, então as % são as
                // mesmas) — não no palco, senão ele também esconderia os pontos, linhas e
                // números arrastados para a área recortada, sem como pegá-los de volta.
                // Em modo de recorte, a imagem original inteira precisa aparecer (inclusive a
                // parte já recortada antes), pra poder reincluí-la — por isso o clip fica suspenso.
                clipPath: cropMode ? undefined : buildClipPath(cropMask),
              }}
            />
          </div>
        )}

        {/* Linhas, bolinhas e números ficam numa camada própria, com tamanho e posição já em
            pixels da tela (sem transform/contra-escala por cima da imagem). Assim o tamanho
            deles é sempre o mesmo, a área de toque é exatamente o desenho, e a exportação
            (que não resolve bem transforms aninhados) sai com tudo alinhado. */}
        {image && baseSize.width > 0 && viewportSize.width > 0 && (
          <div
            className="pointer-events-none absolute"
            style={{ left: -FRAME_BORDER, top: -FRAME_BORDER, width: viewportSize.width, height: viewportSize.height }}
          >
            <svg
              className="absolute left-0 top-0"
              width={viewportSize.width}
              height={viewportSize.height}
              style={{ overflow: 'visible' }}
            >
              {minutiae.map((m) => {
                const coord = m[coordKey]
                const offset = m[offsetKey]
                if (!coord || (offset.x === 0 && offset.y === 0)) return null
                const p = percentToLocal(coord)
                const l = percentToLocal({ x: coord.x + offset.x, y: coord.y + offset.y })
                return (
                  <g key={m.id}>
                    <line x1={p.x} y1={p.y} x2={l.x} y2={l.y} stroke={NUMBER_COLOR} strokeWidth={LINE_THICKNESS} />
                    {/* Área de toque invisível, só um pouco mais grossa que a linha, para arrastá-la. */}
                    <line
                      x1={p.x}
                      y1={p.y}
                      x2={l.x}
                      y2={l.y}
                      stroke="transparent"
                      strokeWidth={LINE_HIT_THICKNESS}
                      onPointerDown={(e) => handleMarkerPointerDown(e, m.id, 'line')}
                      onPointerMove={handleMarkerPointerMove}
                      onPointerUp={handleMarkerPointerUp}
                      onPointerCancel={handleMarkerPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        pointerEvents: adjustMode ? 'none' : 'stroke',
                        cursor: 'move',
                        touchAction: 'none',
                      }}
                    />
                  </g>
                )
              })}
            </svg>

            {minutiae.map((m) => {
              const coord = m[coordKey]
              if (!coord) return null
              const offset = m[offsetKey]
              const hasOffset = offset.x !== 0 || offset.y !== 0
              const p = percentToLocal(coord)
              const l = percentToLocal({ x: coord.x + offset.x, y: coord.y + offset.y })
              const numberVisible = showNumbers && !m.hideNumber
              return (
                <div key={m.id}>
                  {hasOffset && (
                    // Área de toque: um pouquinho maior que a bolinha, e redonda como ela.
                    <div
                      onPointerDown={(e) => handleMarkerPointerDown(e, m.id, 'anchor')}
                      onPointerMove={handleMarkerPointerMove}
                      onPointerUp={handleMarkerPointerUp}
                      onPointerCancel={handleMarkerPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute flex items-center justify-center rounded-full"
                      style={{
                        left: p.x - ANCHOR_HIT_SIZE / 2,
                        top: p.y - ANCHOR_HIT_SIZE / 2,
                        width: ANCHOR_HIT_SIZE,
                        height: ANCHOR_HIT_SIZE,
                        pointerEvents: 'auto',
                        cursor: adjustMode ? cursor : 'move',
                        touchAction: 'none',
                      }}
                      title={`Minúcia do ponto ${displayId(m.id)} — arraste para mover só o ponto`}
                    >
                      <div
                        className="rounded-full"
                        style={{
                          width: ANCHOR_DOT_SIZE,
                          height: ANCHOR_DOT_SIZE,
                          backgroundColor: ANCHOR_DOT_COLOR,
                        }}
                      />
                    </div>
                  )}
                  <div
                    onPointerDown={(e) => handleMarkerPointerDown(e, m.id)}
                    onPointerMove={handleMarkerPointerMove}
                    onPointerUp={handleMarkerPointerUp}
                    onPointerCancel={handleMarkerPointerUp}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute flex items-center justify-center rounded-full shadow"
                    style={{
                      left: l.x - MARKER_SIZE / 2,
                      top: l.y - MARKER_SIZE / 2,
                      width: MARKER_SIZE,
                      height: MARKER_SIZE,
                      pointerEvents: 'auto',
                      cursor: adjustMode ? cursor : arrowMode ? 'crosshair' : 'move',
                      touchAction: 'none',
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
              )
            })}
          </div>
        )}

        {adjustMode && showGhost && otherImage && ghostBaseSize.width > 0 && (
          <div className="pointer-events-none absolute inset-0 opacity-45">
            <div
              className="absolute"
              style={{
                left: `calc(50% - ${ghostGeom.pivotX}px)`,
                top: `calc(50% - ${ghostGeom.pivotY}px)`,
                width: ghostBaseSize.width,
                height: ghostBaseSize.height,
                transform: `translate(${ghostGeom.panX}px, ${ghostGeom.panY}px) rotate(${ghostGeom.rotation}deg) scale(${ghostGeom.zoom}) scaleX(${ghostGeom.flipped ? -1 : 1})`,
                transformOrigin: `${ghostGeom.pivotX}px ${ghostGeom.pivotY}px`,
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
            className="absolute"
            // Mesma origem das contas do recorte (canto da borda do quadro), não da área interna.
            style={{ left: -FRAME_BORDER, top: -FRAME_BORDER, width: viewportSize.width, height: viewportSize.height }}
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
            className="absolute cursor-crosshair"
            onPointerDown={handleFreehandPointerDown}
            onPointerMove={handleFreehandPointerMove}
            onPointerUp={handleFreehandPointerUp}
            onPointerCancel={handleFreehandPointerUp}
            style={{ left: -FRAME_BORDER, top: -FRAME_BORDER, width: viewportSize.width, height: viewportSize.height, touchAction: 'none' }}
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

        {/* Lupa flutuante sobre o quadro (não atrapalha o mouse): fica do lado oposto do ponto —
            ponto na metade de cima, lupa embaixo dele; ponto na metade de baixo, lupa em cima. */}
        {magnifier && image && !cropMode && baseSize.width > 0 && viewportSize.width > 0 && (() => {
          const p = percentToLocal(magnifier.point)
          const edge = FRAME_BORDER + 6
          const left = clamp(p.x - MAGNIFIER_SIZE / 2, edge, viewportSize.width - MAGNIFIER_SIZE - edge)
          const below = p.y < viewportSize.height / 2
          const top = clamp(
            below ? p.y + MAGNIFIER_GAP : p.y - MAGNIFIER_GAP - MAGNIFIER_HEIGHT,
            edge,
            viewportSize.height - MAGNIFIER_HEIGHT - edge,
          )
          return (
            <div className="pointer-events-none absolute z-30" style={{ left: left - FRAME_BORDER, top: top - FRAME_BORDER }}>
              <Magnifier
                image={image}
                point={magnifier.point}
                label={`${magnifier.variant === 'editing' ? 'Editando' : 'Referência'} · Imagem ${slot}`}
                variant={magnifier.variant}
                color={FRAME_COLOR[slot]}
                rotation={transform.rotation}
                flipped={transform.flipped}
                inverted={transform.inverted}
                levelsBlack={transform.levelsBlack}
                darken={transform.darken}
                lighten={transform.lighten}
                scale={baseSize.width * geom.zoom}
                natural={naturalSizeRef.current}
              />
            </div>
          )
        })()}
      </div>
      </div>
      </div>
    </div>
  )
})

export default ImagePanel
