// Converte uma página de PDF em imagem (data URL JPEG), tudo no próprio navegador.
// O pdf.js só é carregado quando um PDF é aberto, para não pesar o carregamento inicial.

// Resolução alvo da renderização: 600 dpi (1 pt = 1/72 pol), a mesma usada na digitalização
// dos prontuários — assim as cristas mantêm o detalhe original ao dar zoom.
const TARGET_DPI = 600
// Limite do maior lado em pixels, para não estourar a memória do canvas em páginas grandes.
const MAX_SIDE_PX = 8000

export function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export async function renderPdfPageToDataUrl(
  file: File,
  choosePage: (numPages: number) => number | null,
): Promise<string | null> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  try {
    const pageNumber = doc.numPages > 1 ? choosePage(doc.numPages) : 1
    if (pageNumber === null) return null

    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(TARGET_DPI / 72, MAX_SIDE_PX / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
    canvas.width = canvas.height = 0
    return dataUrl
  } finally {
    await loadingTask.destroy()
  }
}
