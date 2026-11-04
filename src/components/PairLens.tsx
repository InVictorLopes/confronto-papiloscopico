import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react'
import type { Coordinate } from '../types'
import type { SuggestedPair } from '../suggest'

export const COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5a5', '#f032e6', '#7a8a00',
  '#b8531a', '#008080', '#9a6324', '#800000', '#2a7a4b', '#6b3fa0', '#c2185b', '#1f6f8b',
  '#a31621', '#4c7a34', '#7a4e00', '#2d5be3',
]

export function qualityLabel(q: number) {
  return q >= 60 ? 'Alta' : q >= 30 ? 'Média' : 'Baixa'
}

// Região mostrada na lupa, em nº de cristas de lado (o espaçamento vem da medição de cada imagem).
const RIDGES_DEFAULT = 14
const RIDGES_MIN = 4
const RIDGES_MAX = 60
// Sem medição das cristas, 1 "crista" equivale a esta fração da largura da imagem.
const FALLBACK_PERIOD_PCT = 1
// Quanto o scroll aproxima/afasta por "clique" da roda.
const WHEEL_SPEED = 0.0015

type Side = 'a' | 'b'
interface View {
  cx: number // centro da lupa, em % da largura da imagem
  cy: number // idem, em % da altura
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface LensProps {
  side: Side
  src: string
  alt: string
  ratio: number | null // largura/altura da imagem
  point: Coordinate
  view: View
  region: number // largura mostrada, em % da largura da imagem
  color: string
  // Os outros pontos sugeridos: aparecem quando caem dentro da região mostrada.
  others: { index: number; coord: Coordinate; color: string; selected: boolean }[]
  onJump: (index: number) => void
  onPan: (side: Side, dxFrac: number, dyFrac: number) => void
  onZoom: (deltaY: number, u: number, v: number) => void
  onMovePoint: (side: Side, coord: Coordinate) => void
}

// Um recorte ampliado de uma imagem: arrastar o fundo move a imagem, o scroll aproxima, e o
// círculo do ponto pode ser arrastado para corrigir a posição.
function Lens({ side, src, alt, ratio, point, view, region, color, others, onJump, onPan, onZoom, onMovePoint }: LensProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'point'; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<'pan' | 'point' | null>(null)
  const imgW = 10000 / region // largura da imagem inteira, em % do quadro da lupa

  // Posição de um ponto (em % da imagem) dentro do quadro da lupa, em % do quadro.
  const toBox = (c: Coordinate) => ({
    x: 50 + ((c.x - view.cx) / region) * 100,
    y: ratio ? 50 + ((c.y - view.cy) / (region * ratio)) * 100 : 50,
  })
  const marker = toBox(point)

  // O scroll precisa de listener nativo: o do React é passivo e não consegue segurar a página.
  const zoomRef = useRef(onZoom)
  zoomRef.current = onZoom
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const r = el!.getBoundingClientRect()
      zoomRef.current(e.deltaY, (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function start(e: ReactPointerEvent, kind: 'pan' | 'point') {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, x: e.clientX, y: e.clientY }
    setDragging(kind)
  }

  function move(e: ReactPointerEvent) {
    const d = drag.current
    const box = boxRef.current
    if (!d || !box || !ratio) return
    const r = box.getBoundingClientRect()
    if (d.kind === 'pan') {
      onPan(side, (e.clientX - d.x) / r.width, (e.clientY - d.y) / r.height)
      d.x = e.clientX
      d.y = e.clientY
    } else {
      const u = (e.clientX - r.left) / r.width - 0.5
      const v = (e.clientY - r.top) / r.height - 0.5
      onMovePoint(side, {
        x: clamp(view.cx + u * region, 0, 100),
        y: clamp(view.cy + v * region * ratio, 0, 100),
      })
    }
  }

  function end(e: ReactPointerEvent) {
    if (drag.current) e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
    setDragging(null)
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">{alt}</p>
      <div
        ref={boxRef}
        className={`relative aspect-square touch-none select-none overflow-hidden rounded-lg bg-white ring-1 ring-gray-300 dark:ring-gray-600 ${
          dragging === 'pan' ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ width: 'min(100%, var(--lens-size))' }}
        onPointerDown={(e) => start(e, 'pan')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={
            ratio
              ? {
                  width: `${imgW}%`,
                  left: `${50 - (view.cx / 100) * imgW}%`,
                  // top em % refere-se à altura do quadro, que é quadrado: mesma base da largura.
                  top: `${50 - (view.cy / 100) * (imgW / ratio)}%`,
                }
              : { opacity: 0 }
          }
        />
        {ratio &&
          others.map((o) => {
            const at = toBox(o.coord)
            if (at.x < -3 || at.x > 103 || at.y < -3 || at.y > 103) {
              // Fora da região mostrada: um marcador na borda, do lado em que o ponto está.
              const dx = at.x - 50
              const dy = at.y - 50
              const t = Math.min(44 / Math.abs(dx || 1e-9), 44 / Math.abs(dy || 1e-9))
              return (
                <button
                  key={o.index}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onJump(o.index)}
                  title={`Ponto ${o.index + 1} (fora da região mostrada) — clique para ir até ele`}
                  aria-label={`Ir para o ponto ${o.index + 1}, fora da região mostrada`}
                  className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[11px] font-bold leading-none text-white"
                  style={{
                    left: `${50 + dx * t}%`,
                    top: `${50 + dy * t}%`,
                    background: o.color,
                    opacity: o.selected ? 0.9 : 0.5,
                    boxShadow: '0 0 0 1.5px rgba(255,255,255,.9)',
                  }}
                >
                  {o.index + 1}
                </button>
              )
            }
            return (
              <button
                key={o.index}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onJump(o.index)}
                title={`Ir para o ponto ${o.index + 1}`}
                aria-label={`Ir para o ponto ${o.index + 1}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                style={{ left: `${at.x}%`, top: `${at.y}%`, opacity: o.selected ? 1 : 0.45 }}
              >
                <span
                  className="block h-5 w-5 rounded-full"
                  style={{
                    border: `2px ${o.selected ? 'solid' : 'dashed'} ${o.color}`,
                    boxShadow: '0 0 0 1px rgba(255,255,255,.9)',
                  }}
                />
                <span
                  className="absolute left-full top-0 -translate-y-1/2 rounded px-1 text-[11px] font-bold leading-4 text-white"
                  style={{ background: o.color }}
                >
                  {o.index + 1}
                </span>
              </button>
            )
          })}
        {ratio && (
          <span
            role="presentation"
            title="Arraste para ajustar a posição do ponto"
            onPointerDown={(e) => start(e, 'point')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full"
            style={{
              left: `${marker.x}%`,
              top: `${marker.y}%`,
              border: `2px solid ${color}`,
              boxShadow: '0 0 0 1px rgba(255,255,255,.9)',
              background: dragging === 'point' ? `${color}33` : undefined,
            }}
          />
        )}
      </div>
    </div>
  )
}

function useRatio(src: string): number | null {
  const [ratio, setRatio] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) setRatio(img.naturalWidth / img.naturalHeight)
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  return ratio
}

interface PairLensProps {
  pairs: SuggestedPair[]
  original: SuggestedPair[]
  index: number
  srcA: string
  srcB: string
  periodPct: { a: number | null; b: number | null }
  selected: boolean
  selectedSet: Set<number>
  onToggle: () => void
  onIndex: (i: number) => void
  onMovePoint: (index: number, side: Side, coord: Coordinate) => void
  onRestore: (index: number) => void
  onClose: () => void
}

export default function PairLens({
  pairs,
  original,
  index,
  srcA,
  srcB,
  periodPct,
  selected,
  selectedSet,
  onToggle,
  onIndex,
  onMovePoint,
  onRestore,
  onClose,
}: PairLensProps) {
  const pair = pairs[index]
  const color = COLORS[index % COLORS.length]
  const ratioA = useRatio(srcA)
  const ratioB = useRatio(srcB)
  const [ridges, setRidgesState] = useState(RIDGES_DEFAULT)
  // Espelho do zoom atual: vários eventos de scroll podem chegar antes da próxima renderização.
  const ridgesRef = useRef(RIDGES_DEFAULT)
  const setRidges = (v: number) => {
    ridgesRef.current = v
    setRidgesState(v)
  }
  const [together, setTogether] = useState(true)
  const [view, setView] = useState<{ a: View; b: View }>(() => ({
    a: { cx: pair.a.x, cy: pair.a.y },
    b: { cx: pair.b.x, cy: pair.b.y },
  }))

  // A cada ponto novo, a lupa recentra nele (nas duas imagens).
  useEffect(() => {
    const p = pairs[index]
    setView({ a: { cx: p.a.x, cy: p.a.y }, b: { cx: p.b.x, cy: p.b.y } })
  }, [index]) // só recentra ao trocar de ponto; arrastar o círculo não pode puxar a visão junto

  const period = { a: periodPct.a ?? FALLBACK_PERIOD_PCT, b: periodPct.b ?? FALLBACK_PERIOD_PCT }
  const regionOf = (side: Side, r = ridges) => Math.min(100, period[side] * r)
  const ratio = { a: ratioA, b: ratioB }
  const othersFor = (side: Side) =>
    pairs.flatMap((p, i) =>
      i === index ? [] : [{ index: i, coord: p[side], color: COLORS[i % COLORS.length], selected: selectedSet.has(i) }],
    )

  function pan(side: Side, dxFrac: number, dyFrac: number) {
    setView((prev) => {
      const next = { a: { ...prev.a }, b: { ...prev.b } }
      for (const s of ['a', 'b'] as const) {
        if (s !== side && !together) continue
        const rt = ratio[s]
        if (!rt) continue
        // Arrastar a imagem para a direita faz o centro da visão andar para a esquerda.
        next[s].cx = clamp(prev[s].cx - dxFrac * regionOf(s), 0, 100)
        next[s].cy = clamp(prev[s].cy - dyFrac * regionOf(s) * rt, 0, 100)
      }
      return next
    })
  }

  // O zoom é sempre dos dois lados e mantém sob o cursor o ponto da imagem que estava ali.
  function zoom(deltaY: number, u: number, v: number) {
    const cur = ridgesRef.current
    const next = clamp(cur * Math.exp(deltaY * WHEEL_SPEED), RIDGES_MIN, RIDGES_MAX)
    if (next === cur) return
    setView((prev) => {
      const out = { a: { ...prev.a }, b: { ...prev.b } }
      for (const s of ['a', 'b'] as const) {
        const rt = ratio[s]
        if (!rt) continue
        const dr = regionOf(s, cur) - regionOf(s, next)
        out[s].cx = clamp(prev[s].cx + u * dr, 0, 100)
        out[s].cy = clamp(prev[s].cy + v * dr * rt, 0, 100)
      }
      return out
    })
    setRidges(next)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + pairs.length) % pairs.length)
      else if (e.key === 'ArrowRight') onIndex((index + 1) % pairs.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, pairs.length, onIndex, onClose])

  const o = original[index]
  const moved = !!o && (o.a.x !== pair.a.x || o.a.y !== pair.a.y || o.b.x !== pair.b.x || o.b.y !== pair.b.y)

  return (
    <div className="absolute inset-0 z-10 flex flex-col rounded-xl bg-white dark:bg-gray-800">
      <div className="flex flex-col items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onIndex((index - 1 + pairs.length) % pairs.length)}
            aria-label="Ponto anterior"
            className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ChevronLeft size={22} />
          </button>
          <h3 className="flex flex-wrap items-center justify-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <span className="rounded px-1.5 text-white" style={{ background: color }}>
              {index + 1}
            </span>
            Ponto {index + 1} de {pairs.length}
            <span className="font-normal text-gray-500 dark:text-gray-400">
              · {pair.type === 'ending' ? 'fim de crista' : 'bifurcação'} · qualidade {qualityLabel(pair.quality).toLowerCase()} ({pair.quality})
              {moved && ' · posição ajustada'}
            </span>
          </h3>
          <button
            onClick={() => onIndex((index + 1) % pairs.length)}
            aria-label="Próximo ponto"
            className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <X size={18} />
          Sair do modo lupa
        </button>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-600 dark:text-gray-300">
          <label className="flex items-center gap-2">
            Aproximação
            <input
              type="range"
              min={RIDGES_MIN}
              max={RIDGES_MAX}
              step="any"
              value={RIDGES_MAX + RIDGES_MIN - ridges}
              onChange={(e) => setRidges(RIDGES_MAX + RIDGES_MIN - Number(e.target.value))}
              aria-label="Aproximação da lupa"
              className="w-32"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} />
            Mover as duas imagens juntas
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={selected} onChange={onToggle} />
            Incluir este ponto
          </label>
          {moved && (
            <button
              onClick={() => onRestore(index)}
              className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700"
            >
              <RotateCcw size={13} />
              Restaurar posição
            </button>
          )}
        </div>
      </div>

      {/* No celular as duas lupas ficam empilhadas e precisam caber juntas; no computador, lado a lado. */}
      <div className="grid flex-1 content-start gap-3 overflow-y-auto px-3 pb-3 pt-2 [--lens-size:27vh] md:grid-cols-2 md:[--lens-size:calc(97vh_-_270px)]">
        <Lens
          side="a"
          src={srcA}
          alt="Imagem Questionada (A)"
          ratio={ratioA}
          point={pair.a}
          view={view.a}
          region={regionOf('a')}
          color={color}
          others={othersFor('a')}
          onJump={onIndex}
          onPan={pan}
          onZoom={zoom}
          onMovePoint={(s, c) => onMovePoint(index, s, c)}
        />
        <Lens
          side="b"
          src={srcB}
          alt="Imagem Padrão (B)"
          ratio={ratioB}
          point={pair.b}
          view={view.b}
          region={regionOf('b')}
          color={color}
          others={othersFor('b')}
          onJump={onIndex}
          onPan={pan}
          onZoom={zoom}
          onMovePoint={(s, c) => onMovePoint(index, s, c)}
        />
      </div>
      <p className="border-t border-gray-200 px-4 py-2 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Arraste a imagem para se mover · role o mouse para aproximar · arraste o círculo para ajustar o ponto · ← → trocam de ponto · Esc sai
      </p>
    </div>
  )
}
