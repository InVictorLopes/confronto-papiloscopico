import type { Coordinate, CropMask } from './types'

// Área recortada de uma imagem, em % da imagem original (caixa em volta do contorno do recorte).
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export const FULL_BOX: Box = { left: 0, top: 0, width: 100, height: 100 }

// % da imagem original -> % da área recortada, e o caminho de volta.
export const toLocal = (p: Coordinate, b: Box): Coordinate => ({
  x: ((p.x - b.left) / b.width) * 100,
  y: ((p.y - b.top) / b.height) * 100,
})
export const toOriginal = (p: Coordinate, b: Box): Coordinate => ({
  x: b.left + (p.x / 100) * b.width,
  y: b.top + (p.y / 100) * b.height,
})

export function hasCrop(crop: CropMask | null): crop is CropMask {
  return !!crop && crop.points.length > 2
}

// Caixa (px da imagem original) em volta do contorno do recorte.
export function cropPixelBox(crop: CropMask, W: number, H: number) {
  const xs = crop.points.map((p) => (p.x / 100) * W)
  const ys = crop.points.map((p) => (p.y / 100) * H)
  const sx = Math.max(0, Math.floor(Math.min(...xs)))
  const sy = Math.max(0, Math.floor(Math.min(...ys)))
  const sw = Math.min(W, Math.ceil(Math.max(...xs))) - sx
  const sh = Math.min(H, Math.ceil(Math.max(...ys))) - sy
  return { sx, sy, sw, sh }
}

export interface CropView {
  src: string // imagem só com a área recortada (ou a original, sem recorte)
  box: Box
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Imagem para MOSTRAR o recorte fora do quadro principal (ex: na sugestão de pontos): só a área
// recortada, em resolução cheia, com o que fica fora do contorno transparente — o mesmo que o
// quadro mostra. A imagem original nunca é alterada.
export async function buildCropView(src: string, crop: CropMask | null): Promise<CropView> {
  if (!hasCrop(crop)) return { src, box: FULL_BOX }
  const img = await loadImage(src)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const { sx, sy, sw, sh } = cropPixelBox(crop, W, H)
  if (sw < 2 || sh < 2) return { src, box: FULL_BOX }
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  const ctx = c.getContext('2d')!
  ctx.beginPath()
  crop.points.forEach((p, i) => {
    const x = (p.x / 100) * W - sx
    const y = (p.y / 100) * H - sy
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const out = c.toDataURL('image/png')
  c.width = c.height = 0
  return { src: out, box: { left: (sx / W) * 100, top: (sy / H) * 100, width: (sw / W) * 100, height: (sh / H) * 100 } }
}
