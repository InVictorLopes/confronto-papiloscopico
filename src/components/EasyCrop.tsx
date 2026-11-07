import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import {
  Check,
  Crop,
  Download,
  Expand,
  Hand,
  Loader2,
  Maximize,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

// Recorte fácil: recorta a imagem DE VERDADE (gera um arquivo novo só com a área escolhida),
// como recortar fora do sistema e carregar de novo. Diferente do "Recortar" da barra de
// ajuste, que é só uma máscara não-destrutiva sobre a imagem original.

interface EasyCropProps {
  image: string
  title: string
  slot: 'A' | 'B'
  hasPoints: boolean
  onApply: (dataUrl: string) => void
  onClose: () => void
}

type Rect = { x: number; y: number; w: number; h: number } // px da imagem
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Shape = 'free' | 'square'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 40
const MIN_SEL = 4 // px da imagem — menor que isso conta como clique, não seleção
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw']
const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
}
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Mantém o formato da imagem: PNG continua PNG (sem perda); o resto sai em JPEG de alta qualidade.
function outputType(src: string) {
  return src.startsWith('data:image/png') ? { mime: 'image/png', ext: 'png' } : { mime: 'image/jpeg', ext: 'jpg' }
}

function canvasToDataUrl(c: HTMLCanvasElement, src: string) {
  const { mime } = outputType(src)
  return mime === 'image/png' ? c.toDataURL(mime) : c.toDataURL(mime, 0.95)
}

// Retângulo entre um ponto fixo (âncora) e o ponto atual, dentro da imagem. No modo quadrado,
// o lado é o maior dos dois deslocamentos, limitado ao espaço disponível naquela direção.
function rectFromAnchor(ax: number, ay: number, px: number, py: number, W: number, H: number, shape: Shape): Rect {
  if (shape === 'free') {
    const x0 = clamp(Math.min(ax, px), 0, W), x1 = clamp(Math.max(ax, px), 0, W)
    const y0 = clamp(Math.min(ay, py), 0, H), y1 = clamp(Math.max(ay, py), 0, H)
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  const sx = px >= ax ? 1 : -1, sy = py >= ay ? 1 : -1
  const room = Math.min(sx > 0 ? W - ax : ax, sy > 0 ? H - ay : ay)
  const side = Math.min(Math.max(Math.abs(px - ax), Math.abs(py - ay)), room)
  return { x: sx > 0 ? ax : ax - side, y: sy > 0 ? ay : ay - side, w: side, h: side }
}

export default function EasyCrop({ image, title, slot, hasPoints, onApply, onClose }: EasyCropProps) {
  const [src, setSrc] = useState(image)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  // Posição do canto superior esquerdo da imagem dentro da área de visualização (px da tela).
  // A imagem é posicionada direto (sem barras de rolagem) para o zoom ficar sempre ancorado no
  // cursor, mesmo quando a imagem ainda é menor que a área.
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [shape, setShape] = useState<Shape>('free')
  const [panTool, setPanTool] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [rotated, setRotated] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<
    | { mode: 'new' | 'resize'; ax: number; ay: number; handle?: Handle; start: Rect }
    | { mode: 'move'; px: number; py: number; start: Rect }
    | { mode: 'pan'; cx: number; cy: number; start: { x: number; y: number } }
    | null
  >(null)

  const panning = panTool || spaceDown

  useEffect(() => {
    let alive = true
    loadImage(src).then((img) => alive && setNat({ w: img.naturalWidth, h: img.naturalHeight }))
    return () => {
      alive = false
    }
  }, [src])

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = () => setView({ w: vp.clientWidth, h: vp.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  const fit = nat && view.w ? Math.min(view.w / nat.w, view.h / nat.h) * 0.94 : 0
  const scale = fit * zoom
  const stageW = nat ? nat.w * scale : 0
  const stageH = nat ? nat.h * scale : 0

  // Nunca deixa a imagem sumir da área: pelo menos 60px dela continuam visíveis.
  const clampPan = useCallback(
    (p: { x: number; y: number }, w: number, h: number) => ({
      x: clamp(p.x, 60 - w, view.w - 60),
      y: clamp(p.y, 60 - h, view.h - 60),
    }),
    [view.w, view.h],
  )

  // "Ver tudo": imagem inteira, centralizada.
  const resetView = useCallback(() => {
    if (!nat || !fit) return
    setZoom(1)
    setPan({ x: (view.w - nat.w * fit) / 2, y: (view.h - nat.h * fit) / 2 })
  }, [nat, fit, view.w, view.h])

  // Centraliza ao abrir e depois de girar (quando a imagem muda de tamanho).
  useLayoutEffect(() => {
    resetView()
    // Só quando a imagem ou a área ficam conhecidas pela primeira vez — não a cada zoom.
  }, [nat, view.w > 0])

  // Zoom mantendo embaixo do ponto (vx, vy) da área o mesmo ponto da imagem.
  const zoomAt = useCallback(
    (next: number, vx?: number, vy?: number) => {
      if (!nat || !fit || !pan) return
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM)
      const cx = vx ?? view.w / 2
      const cy = vy ?? view.h / 2
      const k = z / zoom
      setZoom(z)
      setPan(clampPan({ x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k }, nat.w * fit * z, nat.h * fit * z))
    },
    [nat, fit, pan, zoom, view.w, view.h, clampPan],
  )

  // Roda do mouse: zoom em volta do cursor.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const r = vp!.getBoundingClientRect()
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoom, zoomAt])

  // Amplia até a seleção ocupar a área, centralizada nela.
  function fitSelection() {
    if (!sel || !nat || !fit) return
    const z = clamp(Math.min((view.w * 0.85) / (sel.w * fit), (view.h * 0.85) / (sel.h * fit)), MIN_ZOOM, MAX_ZOOM)
    const s = fit * z
    setZoom(z)
    setPan(
      clampPan(
        { x: view.w / 2 - (sel.x + sel.w / 2) * s, y: view.h / 2 - (sel.y + sel.h / 2) * s },
        nat.w * s,
        nat.h * s,
      ),
    )
  }

  function toImage(clientX: number, clientY: number) {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: clamp((clientX - r.left) / scale, 0, nat!.w), y: clamp((clientY - r.top) / scale, 0, nat!.h) }
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!nat || busy) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer sintético — o arraste ainda funciona pelos eventos do próprio palco.
    }
    if (panning || e.button === 1) {
      if (pan) dragRef.current = { mode: 'pan', cx: e.clientX, cy: e.clientY, start: pan }
      return
    }
    const p = toImage(e.clientX, e.clientY)
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    if (handle && sel) {
      const [hx, hy] = HANDLE_POS[handle]
      // Âncora = lado/canto oposto à alça pega.
      dragRef.current = { mode: 'resize', handle, ax: sel.x + (1 - hx) * sel.w, ay: sel.y + (1 - hy) * sel.h, start: sel }
      return
    }
    if (sel && p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h) {
      dragRef.current = { mode: 'move', px: p.x, py: p.y, start: sel }
      return
    }
    dragRef.current = { mode: 'new', ax: p.x, ay: p.y, start: { x: p.x, y: p.y, w: 0, h: 0 } }
    setSel({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || !nat) return
    if (d.mode === 'pan') {
      setPan(clampPan({ x: d.start.x + e.clientX - d.cx, y: d.start.y + e.clientY - d.cy }, stageW, stageH))
      return
    }
    const p = toImage(e.clientX, e.clientY)
    if (d.mode === 'move') {
      setSel({
        ...d.start,
        x: clamp(d.start.x + p.x - d.px, 0, nat.w - d.start.w),
        y: clamp(d.start.y + p.y - d.py, 0, nat.h - d.start.h),
      })
      return
    }
    if (d.mode === 'resize' && d.handle && !CORNERS.includes(d.handle)) {
      // Alça de lado (só no modo livre): mexe só naquele lado.
      const s = d.start
      if (d.handle === 'n' || d.handle === 's') {
        const y0 = Math.min(d.ay, p.y), y1 = Math.max(d.ay, p.y)
        setSel({ ...s, y: y0, h: y1 - y0 })
      } else {
        const x0 = Math.min(d.ax, p.x), x1 = Math.max(d.ax, p.x)
        setSel({ ...s, x: x0, w: x1 - x0 })
      }
      return
    }
    setSel(rectFromAnchor(d.ax, d.ay, p.x, p.y, nat.w, nat.h, shape))
  }

  function handlePointerUp() {
    const d = dragRef.current
    dragRef.current = null
    if (d && d.mode !== 'pan') setSel((s) => (s && (s.w < MIN_SEL || s.h < MIN_SEL) ? null : s))
  }

  function changeShape(next: Shape) {
    setShape(next)
    // Ao mudar para quadrado, transforma a seleção atual num quadrado centrado nela.
    if (next === 'square' && sel && nat) {
      const side = Math.min(Math.max(sel.w, sel.h), nat.w, nat.h)
      setSel({
        x: clamp(sel.x + sel.w / 2 - side / 2, 0, nat.w - side),
        y: clamp(sel.y + sel.h / 2 - side / 2, 0, nat.h - side),
        w: side,
        h: side,
      })
    }
  }

  function selectAll() {
    if (!nat) return
    if (shape === 'square') {
      const side = Math.min(nat.w, nat.h)
      setSel({ x: (nat.w - side) / 2, y: (nat.h - side) / 2, w: side, h: side })
    } else setSel({ x: 0, y: 0, w: nat.w, h: nat.h })
  }

  async function rotate(dir: 1 | -1) {
    if (!nat || busy) return
    setBusy('Girando a imagem…')
    try {
      const img = await loadImage(src)
      const c = document.createElement('canvas')
      c.width = img.naturalHeight
      c.height = img.naturalWidth
      const ctx = c.getContext('2d')!
      ctx.translate(c.width / 2, c.height / 2)
      ctx.rotate((dir * Math.PI) / 2)
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      const next = canvasToDataUrl(c, src)
      c.width = c.height = 0
      setSel(null)
      setZoom(1)
      setRotated(true)
      setSrc(next)
    } finally {
      setBusy(null)
    }
  }

  // Gera o arquivo recortado (resolução cheia). Sem seleção, usa a imagem inteira (ex: só girou).
  async function buildResult(): Promise<string> {
    const img = await loadImage(src)
    const r = sel
      ? { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) }
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    const c = document.createElement('canvas')
    c.width = Math.max(1, r.w)
    c.height = Math.max(1, r.h)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    const url = canvasToDataUrl(c, src)
    c.width = c.height = 0
    return url
  }

  const canUse = !!sel || rotated

  async function apply() {
    if (!canUse || busy) return
    if (
      hasPoints &&
      !window.confirm(
        'Usar o recorte troca a imagem deste quadro por uma nova, só com a área recortada.\n\nOs pontos marcados neste confronto serão apagados (as posições não valem para a imagem nova). Continuar?',
      )
    )
      return
    setBusy('Gerando o recorte…')
    try {
      onApply(await buildResult())
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    if (!canUse || busy) return
    setBusy('Gerando o arquivo…')
    try {
      const url = await buildResult()
      const a = document.createElement('a')
      a.href = url
      a.download = `recorte_imagem_${slot === 'A' ? 'questionada' : 'padrao'}.${outputType(src).ext}`
      a.click()
    } finally {
      setBusy(null)
    }
  }

  // Teclado: Esc fecha, Enter usa o recorte, setas movem a seleção (Shift = 10px), espaço segura a mão.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        setSpaceDown(true)
        return
      }
      // Enter num botão em foco é o clique daquele botão, não "Usar recorte".
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        apply()
        return
      }
      const step = e.shiftKey ? 10 : 1
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      }
      if (delta[e.key] && sel && nat) {
        e.preventDefault()
        const [dx, dy] = delta[e.key]
        // Forma funcional: segurando a tecla, as repetições chegam mais rápido que a tela atualiza.
        setSel((s) => s && { ...s, x: clamp(s.x + dx, 0, nat.w - s.w), y: clamp(s.y + dy, 0, nat.h - s.h) })
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const btn =
    'flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ring-1 bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-600'
  const btnOn = 'flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ring-1 bg-blue-600 text-white ring-blue-600'
  const handles = shape === 'square' ? CORNERS : HANDLES

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-1 sm:p-2" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Recorte fácil — ${title}`}
        className="flex h-[97vh] w-[99vw] max-w-[1800px] flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <Scissors size={18} className="text-blue-600" />
            Recorte fácil — {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <div className="flex items-center gap-1">
            <button onClick={() => changeShape('free')} className={shape === 'free' ? btnOn : btn} title="Seleção retangular livre">
              <Crop size={14} />
              Livre
            </button>
            <button onClick={() => changeShape('square')} className={shape === 'square' ? btnOn : btn} title="Seleção sempre quadrada">
              <Square size={14} />
              Quadrado
            </button>
          </div>
          <span className="hidden h-5 w-px bg-gray-200 sm:block dark:bg-gray-600" />
          <div className="flex items-center gap-1">
            <button onClick={() => rotate(-1)} disabled={!!busy} className={btn} title="Girar 90° para a esquerda">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => rotate(1)} disabled={!!busy} className={btn} title="Girar 90° para a direita">
              <RotateCw size={14} />
            </button>
          </div>
          <span className="hidden h-5 w-px bg-gray-200 sm:block dark:bg-gray-600" />
          <div className="flex items-center gap-1">
            <button onClick={() => zoomAt(zoom / 1.25)} className={btn} title="Diminuir zoom">
              <ZoomOut size={14} />
            </button>
            <span className="w-14 text-center text-xs tabular-nums text-gray-600 dark:text-gray-300">{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomAt(zoom * 1.25)} className={btn} title="Aumentar zoom">
              <ZoomIn size={14} />
            </button>
            <button onClick={resetView} className={btn} title="Mostrar a imagem inteira">
              <Maximize size={14} />
              Ver tudo
            </button>
            <button onClick={fitSelection} disabled={!sel} className={btn} title="Ampliar até a seleção ocupar a tela">
              <Expand size={14} />
              Ampliar seleção
            </button>
            <button
              onClick={() => setPanTool((v) => !v)}
              className={panTool ? btnOn : btn}
              title="Mão: arraste para mover a imagem (também funciona segurando a barra de espaço)"
            >
              <Hand size={14} />
              Mover imagem
            </button>
          </div>
          <span className="hidden h-5 w-px bg-gray-200 sm:block dark:bg-gray-600" />
          <div className="flex items-center gap-1">
            <button onClick={selectAll} disabled={!nat} className={btn}>
              Selecionar tudo
            </button>
            <button onClick={() => setSel(null)} disabled={!sel} className={btn}>
              Limpar seleção
            </button>
          </div>
        </div>

        <div ref={viewportRef} className="relative flex-1 overflow-hidden bg-gray-200 dark:bg-gray-900">
          {nat && scale > 0 && pan && (
            <>
              <div
                ref={stageRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="absolute overflow-hidden select-none"
                style={{
                  left: pan.x,
                  top: pan.y,
                  width: stageW,
                  height: stageH,
                  cursor: panning ? (dragRef.current?.mode === 'pan' ? 'grabbing' : 'grab') : 'crosshair',
                  touchAction: 'none',
                }}
              >
                <img src={src} alt={title} draggable={false} className="pointer-events-none block h-full w-full" />
                {sel && (
                  <div
                    className="absolute"
                    style={{
                      left: sel.x * scale,
                      top: sel.y * scale,
                      width: sel.w * scale,
                      height: sel.h * scale,
                      boxShadow: '0 0 0 100000px rgba(0,0,0,0.55)',
                      outline: '2px solid #ffffff',
                      cursor: panning ? undefined : 'move',
                    }}
                  >
                    {/* Linhas de terço, só como guia visual. */}
                    <div className="pointer-events-none absolute inset-0">
                      {[1, 2].map((i) => (
                        <div key={`v${i}`} className="absolute top-0 h-full w-px bg-white/40" style={{ left: `${(i * 100) / 3}%` }} />
                      ))}
                      {[1, 2].map((i) => (
                        <div key={`h${i}`} className="absolute left-0 h-px w-full bg-white/40" style={{ top: `${(i * 100) / 3}%` }} />
                      ))}
                    </div>
                    {!panning &&
                      handles.map((h) => (
                        <div
                          key={h}
                          data-handle={h}
                          className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                          style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: HANDLE_CURSOR[h] }}
                        >
                          <span className="pointer-events-none block h-3 w-3 rounded-sm border-2 border-blue-600 bg-white" />
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
          {(!nat || busy) && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm text-gray-700 dark:bg-gray-900/60 dark:text-gray-200">
              <Loader2 size={18} className="animate-spin" />
              {busy ?? 'Carregando a imagem…'}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {sel ? (
              <>
                Seleção: <strong className="tabular-nums">{Math.round(sel.w)} × {Math.round(sel.h)} px</strong> · arraste
                dentro para mover, nas alças para ajustar · setas movem 1 px (Shift: 10 px)
              </>
            ) : (
              <>
                Arraste sobre a imagem para marcar a área a recortar · roda do mouse: zoom · espaço ou{' '}
                <em>Mover imagem</em>: arrastar a imagem
              </>
            )}
            {nat && <span className="ml-2 tabular-nums text-gray-400">(imagem: {nat.w} × {nat.h} px)</span>}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              onClick={download}
              disabled={!canUse || !!busy}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 ring-1 ring-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400 dark:ring-blue-500/40 dark:hover:bg-gray-700"
              title="Salvar o recorte como arquivo no computador"
            >
              <Download size={16} />
              Baixar recorte
            </button>
            <button
              onClick={apply}
              disabled={!canUse || !!busy}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              title="Trocar a imagem deste quadro pelo recorte (Enter)"
            >
              <Check size={16} />
              Usar recorte
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
