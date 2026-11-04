import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, Search, Sparkles, X } from 'lucide-react'
import type { Coordinate, CropMask, Minutia } from '../types'
import { suggestPoints, type SuggestResult, type SuggestedPair } from '../suggest'
import PairLens, { COLORS, qualityLabel } from './PairLens'

interface SuggestDialogProps {
  imageA: string
  imageB: string
  cropA: CropMask | null
  cropB: CropMask | null
  minutiae: Minutia[]
  onAdd: (pairs: SuggestedPair[]) => void
  onClose: () => void
}

const COUNT_OPTIONS = [6, 8, 10, 12, 15, 20]

export function BetaBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-white ${className}`}
    >
      BETA
    </span>
  )
}

// Imagem que preenche o quadro (ampliando se for pequena) mantendo a proporção, para os
// marcadores em % cobrirem exatamente a imagem. A altura máxima vem de --img-h.
function OverlayImage({
  src,
  alt,
  zoomCursor,
  onBackgroundClick,
  children,
}: {
  src: string
  alt: string
  zoomCursor: boolean
  onBackgroundClick: (at: Coordinate) => void
  children: ReactNode
}) {
  const [ratio, setRatio] = useState<number | null>(null)
  return (
    <div
      className="relative mx-auto"
      style={
        ratio
          ? { aspectRatio: String(ratio), width: `min(100%, calc(var(--img-h) * ${ratio}))` }
          : { width: '100%' }
      }
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onBackgroundClick({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        className={`block h-full w-full select-none ${zoomCursor ? 'cursor-zoom-in' : ''}`}
      />
      {ratio && children}
    </div>
  )
}

function Marker({
  coord,
  label,
  color,
  active,
  selected,
  zoomCursor,
  onClick,
  onHover,
}: {
  coord: Coordinate
  label: number
  color: string
  active: boolean
  selected: boolean
  zoomCursor: boolean
  onClick: () => void
  onHover: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`Ponto sugerido ${label}${selected ? ', selecionado' : ', não selecionado'}`}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${zoomCursor ? 'cursor-zoom-in' : 'cursor-pointer'}`}
      style={{ left: `${coord.x}%`, top: `${coord.y}%`, opacity: selected ? 1 : 0.4 }}
    >
      <span
        className="block rounded-full"
        style={{
          width: active ? 26 : 20,
          height: active ? 26 : 20,
          border: `2px ${selected ? 'solid' : 'dashed'} ${color}`,
          boxShadow: '0 0 0 1px rgba(255,255,255,.9)',
        }}
      />
      <span
        className="absolute left-full top-0 -translate-y-1/2 rounded px-1 text-[11px] font-bold leading-4 text-white"
        style={{ background: color }}
      >
        {label}
      </span>
    </button>
  )
}

export default function SuggestDialog({ imageA, imageB, cropA, cropB, minutiae, onAdd, onClose }: SuggestDialogProps) {
  const [count, setCount] = useState(12)
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>('running')
  const [progress, setProgress] = useState('Preparando as imagens…')
  const [result, setResult] = useState<SuggestResult | null>(null)
  // Pares em edição: começam iguais ao resultado e mudam se o perito mover um ponto na lupa.
  const [pairs, setPairs] = useState<SuggestedPair[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const [lensMode, setLensMode] = useState(false)
  const [lensIndex, setLensIndex] = useState<number | null>(null)

  const original = result?.pairs ?? []

  // A análise roda ao abrir e a cada "Analisar de novo" (run), não a cada mudança de quantidade.
  // Os pontos já marcados são lidos no início de cada análise, para não repetir nenhum.
  useEffect(() => {
    setPhase('running')
    setProgress('Preparando as imagens…')
    setResult(null)
    setPairs([])
    setLensIndex(null)
    const existing = minutiae.map((m) => ({ a: m.coordA, b: m.coordB }))
    const job = suggestPoints({ imageA, imageB, cropA, cropB, existing, count }, setProgress)
    let alive = true
    job.promise
      .then((r) => {
        if (!alive) return
        setResult(r)
        setPairs(r.pairs)
        setSelected(new Set(r.pairs.map((_, i) => i)))
        setPhase('done')
      })
      .catch((e: Error) => {
        if (!alive || e.message === 'cancelado') return
        setError(e.message || 'Erro inesperado.')
        setPhase('error')
      })
    return () => {
      alive = false
      job.cancel()
    }
  }, [run])

  // Com a lupa aberta, o Esc é dela (volta para as imagens); fora dela, fecha o diálogo.
  useEffect(() => {
    if (lensIndex !== null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, lensIndex])

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function movePoint(i: number, side: 'a' | 'b', coord: Coordinate) {
    setPairs((prev) => prev.map((p, k) => (k === i ? { ...p, [side]: coord } : p)))
  }

  function restorePoint(i: number) {
    setPairs((prev) => prev.map((p, k) => (k === i ? original[i] : p)))
  }

  // No modo lupa, clicar num ponto abre a lupa; fora dele, inclui/tira o ponto da seleção.
  function clickPoint(i: number) {
    if (lensMode) setLensIndex(i)
    else toggle(i)
  }

  // Modo lupa: clicar na imagem abre o ponto sugerido mais próximo do clique.
  function clickImage(side: 'a' | 'b', at: Coordinate) {
    if (!lensMode) return
    let best = -1
    let bestD = 12 // só considera cliques a menos de 12% da largura de algum ponto
    pairs.forEach((p, i) => {
      const d = Math.hypot(p[side].x - at.x, p[side].y - at.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) setLensIndex(best)
  }

  const chosen = pairs.filter((_, i) => selected.has(i))

  const lensButton = (className: string) => (
    <button
      onClick={() => setLensMode((v) => !v)}
      aria-pressed={lensMode}
      title="Com o modo lupa ligado, clicar num ponto abre o par ampliado nas duas imagens"
      className={`items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${
        lensMode
          ? 'bg-blue-600 text-white ring-blue-600'
          : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-600'
      } ${className}`}
    >
      <Search size={14} />
      Modo lupa
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-1 sm:p-2"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sugestão de pontos"
        className="relative flex h-[97vh] w-[99vw] max-w-[2000px] flex-col rounded-xl bg-white shadow-2xl [--img-h:52vh] lg:[--img-h:max(220px,calc(97vh_-_300px))] dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <Sparkles size={18} className="text-amber-500" />
            Sugestão de pontos
            <BetaBadge />
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>
              <strong>Ferramenta em fase BETA.</strong> As sugestões são geradas automaticamente e podem conter erros ou
              omissões; servem só como apoio. Confira cada ponto nas duas imagens antes de adicioná-lo — a análise e a
              conclusão continuam sendo do perito. Todo o processamento é feito neste navegador: nenhuma imagem é
              enviada a servidores.
            </p>
          </div>

          {phase === 'running' && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 size={18} className="animate-spin" />
              <span role="status">{progress}</span>
            </div>
          )}

          {phase === 'error' && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
              Não foi possível analisar as imagens: {error}
            </p>
          )}

          {phase === 'done' && result && result.status === 'few' && (
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:ring-gray-600">
              Foram detectadas poucas minúcias (Imagem A: {result.countA}, Imagem B: {result.countB}). Confira a
              qualidade e a resolução das imagens, ou se o recorte não está pequeno demais.
            </p>
          )}

          {phase === 'done' && result && result.status === 'weak' && (
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:ring-gray-600">
              Não encontrei correspondência confiável entre as duas imagens ({result.consistent} pares consistentes; o
              mínimo é 12). Isso acontece quando as impressões não são do mesmo dedo, quando a qualidade é baixa ou
              quando a área em comum é pequena. Nenhum ponto foi sugerido.
            </p>
          )}

          {phase === 'done' && result && result.status === 'ok' && (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {pairs.length === 0
                    ? 'Todos os pares encontrados já estão marcados.'
                    : lensMode
                      ? `${pairs.length} pares sugeridos, numerados como um relógio (a partir das 12h, no sentido horário). Modo lupa: clique num ponto para vê-lo ampliado nas duas imagens.`
                      : `${pairs.length} pares sugeridos, numerados como um relógio (a partir das 12h, no sentido horário). Clique em um ponto (ou use a lista) para incluir ou tirar da seleção.`}
                </p>
                {/* Em telas largas o botão fica na coluna à direita da imagem padrão (ver abaixo). */}
                {pairs.length > 0 && lensButton('flex lg:hidden')}
              </div>
              {!result.scaleKnown && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                  Não consegui medir a escala de uma das imagens; confira as sugestões com mais atenção.
                </p>
              )}

              {pairs.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
                  <div className="grid gap-3 md:grid-cols-2">
                    {([['Imagem Questionada (A)', imageA, 'a'], ['Imagem Padrão (B)', imageB, 'b']] as const).map(
                      ([title, src, side]) => (
                        <div key={side} className="rounded-lg bg-gray-50 p-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                          <p className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">{title}</p>
                          <OverlayImage
                            src={src}
                            alt={title}
                            zoomCursor={lensMode}
                            onBackgroundClick={(at) => clickImage(side, at)}
                          >
                            {pairs.map((p, i) => (
                              <Marker
                                key={i}
                                coord={p[side]}
                                label={i + 1}
                                color={COLORS[i % COLORS.length]}
                                active={hover === i}
                                selected={selected.has(i)}
                                zoomCursor={lensMode}
                                onClick={() => clickPoint(i)}
                                onHover={(on) => setHover(on ? i : null)}
                              />
                            ))}
                          </OverlayImage>
                        </div>
                      ),
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {lensButton('hidden w-full justify-center py-2 lg:flex')}
                    <div className="overflow-y-auto rounded-lg ring-1 ring-gray-200 lg:max-h-[calc(97vh_-_300px)] dark:ring-gray-700">
                      <table className="w-full text-left text-xs tabular-nums text-gray-700 dark:text-gray-200">
                        <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Incluir</th>
                            <th className="px-2 py-1.5 font-medium">Pt.</th>
                            <th className="px-2 py-1.5 font-medium">Tipo</th>
                            <th className="px-2 py-1.5 font-medium">Qualidade</th>
                            <th className="px-1 py-1.5">
                              <span className="sr-only">Ampliar</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pairs.map((p, i) => (
                            <tr
                              key={i}
                              onMouseEnter={() => setHover(i)}
                              onMouseLeave={() => setHover(null)}
                              className={`border-t border-gray-100 dark:border-gray-700 ${hover === i ? 'bg-blue-50 dark:bg-gray-700/60' : ''}`}
                            >
                              <td className="px-2 py-1">
                                <input
                                  type="checkbox"
                                  checked={selected.has(i)}
                                  onChange={() => toggle(i)}
                                  aria-label={`Incluir a sugestão ${i + 1}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <span
                                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                                  style={{ background: COLORS[i % COLORS.length] }}
                                />
                                {i + 1}
                              </td>
                              <td className="px-2 py-1">{p.type === 'ending' ? 'Fim' : 'Bifurc.'}</td>
                              <td className="px-2 py-1">
                                {qualityLabel(p.quality)} ({p.quality})
                              </td>
                              <td className="px-1 py-1">
                                <button
                                  onClick={() => setLensIndex(i)}
                                  aria-label={`Ver o ponto ${i + 1} ampliado`}
                                  title="Ver ampliado nas duas imagens"
                                  className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-600"
                                >
                                  <Search size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            Quantidade
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              onClick={() => setRun((r) => r + 1)}
              disabled={phase === 'running'}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400 dark:hover:bg-gray-700"
            >
              Analisar de novo
            </button>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Fechar
            </button>
            <button
              onClick={() => onAdd(chosen)}
              disabled={phase !== 'done' || chosen.length === 0}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={16} />
              Adicionar {chosen.length > 0 ? chosen.length : ''} {chosen.length === 1 ? 'ponto' : 'pontos'}
            </button>
          </div>
        </div>

        {lensIndex !== null && pairs[lensIndex] && result && (
          <PairLens
            pairs={pairs}
            original={original}
            index={lensIndex}
            srcA={imageA}
            srcB={imageB}
            periodPct={result.periodPct}
            selected={selected.has(lensIndex)}
            selectedSet={selected}
            onToggle={() => toggle(lensIndex)}
            onIndex={setLensIndex}
            onMovePoint={movePoint}
            onRestore={restorePoint}
            onClose={() => setLensIndex(null)}
          />
        )}
      </div>
    </div>
  )
}
