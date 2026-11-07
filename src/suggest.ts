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

// Área da imagem original que foi enviada à análise, em % da imagem original.
interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface PreparedImage {
  rgba: RgbaImage
  box: Box
  // Contorno do recorte em % da ÁREA ENVIADA (não da imagem original), ou null.
  crop: Coordinate[] | null
}

// Com recorte, só a área recortada vai para a análise (em resolução cheia), igual a quando o
// perito recorta a imagem fora do sistema. Mandar a página inteira (PDF, prontuário) fazia a
// análise falhar: a página era reduzida para caber em MAX_SIDE (cristas finas demais) e o
// espaçamento das cristas, que define a escala, era medido na página toda — outros dedos,
// texto, linhas do formulário — em vez de só na digital recortada.
function prepareImage(dataUrl: string, crop: CropMask | null): Promise<PreparedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const W = img.naturalWidth
      const H = img.naturalHeight
      const pts = crop && crop.points.length > 2 ? crop.points : null

      // Caixa (px da imagem original) em volta do recorte; sem recorte, a imagem inteira.
      let sx = 0, sy = 0, sw = W, sh = H
      if (pts) {
        const xs = pts.map((p) => (p.x / 100) * W)
        const ys = pts.map((p) => (p.y / 100) * H)
        sx = Math.max(0, Math.floor(Math.min(...xs)))
        sy = Math.max(0, Math.floor(Math.min(...ys)))
        sw = Math.min(W, Math.ceil(Math.max(...xs))) - sx
        sh = Math.min(H, Math.ceil(Math.max(...ys))) - sy
        if (sw < 8 || sh < 8) {
          reject(new Error('O recorte de uma das imagens está pequeno demais para a análise.'))
          return
        }
      }

      const k = Math.min(1, MAX_SIDE / Math.max(sw, sh))
      const w = Math.max(1, Math.round(sw * k))
      const h = Math.max(1, Math.round(sh * k))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Não foi possível processar a imagem neste navegador.'))
        return
      }
      ctx.fillStyle = '#fff' // PNG com transparência e área fora do recorte: fundo branco
      ctx.fillRect(0, 0, w, h)
      // Contorno do recorte em % da área enviada (é nesse espaço que a análise trabalha).
      const local = pts
        ? pts.map((p) => ({ x: (((p.x / 100) * W - sx) / sw) * 100, y: (((p.y / 100) * H - sy) / sh) * 100 }))
        : null
      if (local) {
        // Recorte livre: o que fica fora do contorno vira branco, como numa imagem recortada.
        ctx.save()
        ctx.beginPath()
        local.forEach((p, i) => {
          const x = (p.x / 100) * w
          const y = (p.y / 100) * h
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
        ctx.clip()
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
      if (local) ctx.restore()
      resolve({
        rgba: { w, h, data: ctx.getImageData(0, 0, w, h).data.buffer },
        box: { left: (sx / W) * 100, top: (sy / H) * 100, width: (sw / W) * 100, height: (sh / H) * 100 },
        crop: local,
      })
    }
    img.onerror = () => reject(new Error('Não foi possível ler uma das imagens.'))
    img.src = dataUrl
  })
}

// % da imagem original -> % da área enviada, e o caminho de volta.
const toLocal = (p: Coordinate, b: Box): Coordinate => ({ x: ((p.x - b.left) / b.width) * 100, y: ((p.y - b.top) / b.height) * 100 })
const toOriginal = (p: Coordinate, b: Box): Coordinate => ({ x: b.left + (p.x / 100) * b.width, y: b.top + (p.y / 100) * b.height })

// O worker responde em % da área enviada; o resto do sistema trabalha em % da imagem original.
function mapResultToOriginal(r: SuggestResult, boxA: Box, boxB: Box): SuggestResult {
  return {
    ...r,
    pairs: r.pairs.map((p) => ({ ...p, a: toOriginal(p.a, boxA), b: toOriginal(p.b, boxB) })),
    periodPct: {
      a: r.periodPct.a === null ? null : (r.periodPct.a * boxA.width) / 100,
      b: r.periodPct.b === null ? null : (r.periodPct.b * boxB.width) / 100,
    },
    center: r.center ? toOriginal(r.center, boxA) : r.center,
  }
}

export function suggestPoints(input: SuggestInput, onProgress: (text: string) => void): SuggestJob {
  let worker: Worker | null = null
  let cancelled = false
  let rejectJob: (e: Error) => void = () => {}

  const promise = new Promise<SuggestResult>((resolve, reject) => {
    rejectJob = reject
    Promise.all([prepareImage(input.imageA, input.cropA), prepareImage(input.imageB, input.cropB)])
      .then(([pa, pb]) => {
        if (cancelled) return
        const a = pa.rgba
        const b = pb.rgba
        worker = new Worker(WORKER_URL)
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data
          if (msg.type === 'progress') onProgress(msg.text)
          else if (msg.type === 'result') {
            resolve(mapResultToOriginal(msg as SuggestResult, pa.box, pb.box))
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
            cropA: pa.crop,
            cropB: pb.crop,
            existing: input.existing.map((e) => ({
              a: e.a ? toLocal(e.a, pa.box) : null,
              b: e.b ? toLocal(e.b, pb.box) : null,
            })),
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
