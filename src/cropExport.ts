import type { Coordinate } from './types'

// O recorte na tela é só um clip-path (não-destrutivo), mas o html2canvas-pro ignora
// clip-path e exportaria a imagem inteira. Por isso, no DOM clonado que ele vai
// desenhar (callback onclone), cada imagem recortada é trocada por uma versão já
// recortada de verdade: só a área do contorno, com o resto transparente — o mesmo
// efeito visual da tela. A imagem original no estado do app nunca é alterada.

interface MaskedImage {
  url: string
  // Caixa da área recortada, em % da imagem original — onde a versão recortada é posicionada.
  box: { left: number; top: number; width: number; height: number }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function buildMaskedImage(src: string, points: Coordinate[]): Promise<MaskedImage | null> {
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const px = points.map((p) => ({ x: (p.x / 100) * w, y: (p.y / 100) * h }))

  // Só a caixa em volta do contorno é desenhada — num prontuário inteiro a 600 dpi,
  // gerar a página toda seria lento e pesado à toa.
  const left = Math.max(0, Math.floor(Math.min(...px.map((p) => p.x))))
  const top = Math.max(0, Math.floor(Math.min(...px.map((p) => p.y))))
  const right = Math.min(w, Math.ceil(Math.max(...px.map((p) => p.x))))
  const bottom = Math.min(h, Math.ceil(Math.max(...px.map((p) => p.y))))
  if (right <= left || bottom <= top) return null

  const canvas = document.createElement('canvas')
  canvas.width = right - left
  canvas.height = bottom - top
  const ctx = canvas.getContext('2d')!
  ctx.translate(-left, -top)
  ctx.beginPath()
  px.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0
  if (!blob) return null
  return {
    url: URL.createObjectURL(blob),
    box: {
      left: (left / w) * 100,
      top: (top / h) * 100,
      width: ((right - left) / w) * 100,
      height: ((bottom - top) / h) * 100,
    },
  }
}

// Aplica os recortes no documento clonado pela exportação. Devolve as URLs temporárias
// criadas, que devem ser liberadas (URL.revokeObjectURL) depois que a exportação terminar.
export async function applyCropMasksForExport(doc: Document): Promise<string[]> {
  const stages = Array.from(doc.querySelectorAll<HTMLElement>('[data-crop-mask]'))
  const urls: string[] = []
  await Promise.all(
    stages.map(async (stage) => {
      const img = stage.querySelector('img')
      if (!img) return
      const points = JSON.parse(stage.dataset.cropMask!) as Coordinate[]
      const masked = await buildMaskedImage(img.src, points)
      img.style.clipPath = ''
      if (!masked) {
        img.style.visibility = 'hidden'
        return
      }
      urls.push(masked.url)
      img.src = masked.url
      img.style.position = 'absolute'
      img.style.left = `${masked.box.left}%`
      img.style.top = `${masked.box.top}%`
      img.style.width = `${masked.box.width}%`
      img.style.height = `${masked.box.height}%`
    }),
  )
  return urls
}
