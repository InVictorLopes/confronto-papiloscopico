import type { Coordinate, CropMask } from './types'

// Sugestão de pontos (BETA): a análise roda num Web Worker (public/nbis/suggest-worker.js)
// com o MINDTCT/NBIS compilado para WebAssembly. Nada sai do navegador.

export interface SuggestedPair {
  a: Coordinate // % da imagem A original
  b: Coordinate // % da imagem B original
  type: 'ending' | 'bifurcation'
  quality: number // 0-100: a menor das duas qualidades
  residual: number
}

export type SuggestStatus = 'ok' | 'weak' | 'few'

export interface SuggestResult {
  status: SuggestStatus
  pairs: SuggestedPair[]
  consistent: number // pares consistentes entre as duas imagens
  available?: number // pares novos (que ainda não foram marcados)
  countA: number
  countB: number
  scaleKnown: boolean
  // Espaçamento das cristas em % da largura de cada imagem (null se não foi medido).
  periodPct: { a: number | null; b: number | null }
  // Centro usado na numeração de relógio, em % da imagem A.
  center?: Coordinate
  rotation?: number
  scale?: number
}

export interface SuggestInput {
  imageA: string
  imageB: string
  cropA: CropMask | null
  cropB: CropMask | null
  existing: { a: Coordinate | null; b: Coordinate | null }[]
  count: number
}

export interface SuggestJob {
  promise: Promise<SuggestResult>
  cancel: () => void
}

const WORKER_URL = `${import.meta.env.BASE_URL}nbis/suggest-worker.js`
// Lado maior das imagens enviadas ao worker. As coordenadas voltam em %, então reduzir
// uma imagem enorme não altera onde os pontos caem.
const MAX_SIDE = 3000

interface RgbaImage {
  w: number
  h: number
  data: ArrayBuffer
}

function loadRgba(dataUrl: string): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * k))
      const h = Math.max(1, Math.round(img.naturalHeight * k))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Não foi possível processar a imagem neste navegador.'))
        return
      }
      ctx.fillStyle = '#fff' // PNG com transparência: fundo branco
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve({ w, h, data: ctx.getImageData(0, 0, w, h).data.buffer })
    }
    img.onerror = () => reject(new Error('Não foi possível ler uma das imagens.'))
    img.src = dataUrl
  })
}

export function suggestPoints(input: SuggestInput, onProgress: (text: string) => void): SuggestJob {
  let worker: Worker | null = null
  let cancelled = false
  let rejectJob: (e: Error) => void = () => {}

  const promise = new Promise<SuggestResult>((resolve, reject) => {
    rejectJob = reject
    Promise.all([loadRgba(input.imageA), loadRgba(input.imageB)])
      .then(([a, b]) => {
        if (cancelled) return
        worker = new Worker(WORKER_URL)
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data
          if (msg.type === 'progress') onProgress(msg.text)
          else if (msg.type === 'result') {
            resolve(msg as SuggestResult)
            worker?.terminate()
          } else if (msg.type === 'error') {
            reject(new Error(msg.message))
            worker?.terminate()
          }
        }
        worker.onerror = () => {
          reject(new Error('Falha ao carregar o módulo de análise.'))
          worker?.terminate()
        }
        worker.postMessage(
          {
            type: 'run',
            a,
            b,
            cropA: input.cropA?.points ?? null,
            cropB: input.cropB?.points ?? null,
            existing: input.existing,
            count: input.count,
          },
          [a.data, b.data],
        )
      })
      .catch(reject)
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      worker?.terminate()
      rejectJob(new Error('cancelado'))
    },
  }
}
