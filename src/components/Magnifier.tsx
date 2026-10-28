import { useEffect, useState } from 'react'
import type { Coordinate } from '../types'
import { buildLevelsFilterParts } from '../levels'

interface MagnifierProps {
  image: string
  point: Coordinate
  label: string
  variant: 'editing' | 'reference'
  color: string
  rotation?: number
  flipped?: boolean
  inverted?: boolean
  levelsBlack?: number
  darken?: number
  lighten?: number
  // Largura (px) com que a imagem inteira aparece hoje no quadro (já com zoom/recorte).
  scale?: number
  // Tamanho natural da imagem, se quem chama já souber (evita decodificar a imagem de novo).
  natural?: { w: number; h: number } | null
}

// Tamanho do círculo da lupa e altura total (círculo + rótulo) — usados pelo quadro para
// posicionar a lupa sem sair dele.
export const MAGNIFIER_SIZE = 205
export const MAGNIFIER_HEIGHT = 236
const SIZE = MAGNIFIER_SIZE
const ZOOM = 3.2
// Quanto a lupa amplia em relação ao que já aparece no quadro.
const MAGNIFY_FACTOR = 1.25

export default function Magnifier({
  image,
  point,
  label,
  variant,
  color,
  rotation = 0,
  flipped = false,
  inverted = false,
  levelsBlack = 0,
  darken = 0,
  lighten = 0,
  scale = 0,
  natural: naturalProp = null,
}: MagnifierProps) {
  const [probed, setProbed] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (naturalProp) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setProbed({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = image
    return () => {
      cancelled = true
    }
  }, [image, naturalProp])

  const natural = naturalProp ?? probed

  // A lupa acompanha o zoom do quadro (senão, numa página inteira de prontuário, o dedo
  // ficaria minúsculo nela), mas sem passar de 2x a resolução real da imagem — acima
  // disso não há mais detalhe para mostrar, só um elemento gigante e pesado.
  const maxBgWidth = natural ? natural.w * 2 : SIZE * ZOOM
  const bgWidth = Math.max(SIZE * ZOOM, Math.min(scale * MAGNIFY_FACTOR, maxBgWidth))
  const bgHeight = natural ? bgWidth * (natural.h / natural.w) : SIZE * ZOOM
  const originX = (point.x / 100) * bgWidth
  const originY = (point.y / 100) * bgHeight
  const bgLeft = SIZE / 2 - originX
  const bgTop = SIZE / 2 - originY

  // A cor é sempre a do quadro da imagem (A vermelho, B azul); o rótulo cheio indica
  // qual lado está sendo editado e o rótulo vazado, o de referência.
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="rounded border px-2 py-0.5 text-[11px] font-semibold"
        style={
          variant === 'editing'
            ? { backgroundColor: color, borderColor: color, color: '#ffffff' }
            : { backgroundColor: '#ffffff', borderColor: color, color }
        }
      >
        {label}
      </span>
      <div
        className="relative overflow-hidden rounded-full border-4 bg-gray-200 shadow-xl dark:bg-gray-700"
        style={{ width: SIZE, height: SIZE, borderColor: color }}
      >
        <div
          style={{
            position: 'absolute',
            width: bgWidth,
            height: bgHeight,
            left: bgLeft,
            top: bgTop,
            backgroundImage: `url(${image})`,
            backgroundSize: '100% 100%',
            // O pivô precisa ser o próprio ponto marcado (em coordenadas locais do
            // elemento), não o centro padrão do elemento — senão espelhar/girar desloca
            // o ponto para fora do centro da lupa.
            transformOrigin: `${originX}px ${originY}px`,
            transform: `rotate(${rotation}deg) scaleX(${flipped ? -1 : 1})`,
            filter:
              [inverted ? 'invert(1)' : null, ...buildLevelsFilterParts(levelsBlack, darken, lighten)]
                .filter(Boolean)
                .join(' ') || undefined,
          }}
        />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-500/80" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-red-500/80" />
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500" />
        </div>
      </div>
    </div>
  )
}
