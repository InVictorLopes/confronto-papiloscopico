export interface Coordinate {
  x: number // Porcentagem de 0 a 100
  y: number // Porcentagem de 0 a 100
}

export interface Minutia {
  id: number
  coordA: Coordinate | null
  coordB: Coordinate | null
  // Deslocamento do número em relação ao ponto real, em % da imagem (0,0 = sobre o ponto).
  labelOffsetA: Coordinate
  labelOffsetB: Coordinate
  hideNumber: boolean
}

export const ZERO_OFFSET: Coordinate = { x: 0, y: 0 }

export type ComparisonStep = 'WAITING_A' | 'WAITING_B'

export interface AppState {
  imageA: string | null // URL do Blob/Base64
  imageB: string | null
  minutiae: Minutia[]
  currentStep: ComparisonStep
}

// Formato do arquivo de "edição salva" (JSON), para reabrir e corrigir depois.
export interface ProjectFile {
  version: 1
  state: AppState
  transformA: ImageTransform
  transformB: ImageTransform
}

export type ImageSlot = 'A' | 'B'

export interface ImageTransform {
  zoom: number
  rotation: number // graus
  panX: number // porcentagem do tamanho base da imagem
  panY: number
  flipped: boolean // espelhado horizontalmente
  inverted: boolean // cores em negativo
  contrast: number // porcentagem, 100 = original, maior = preto mais escuro
}

export const DEFAULT_IMAGE_TRANSFORM: ImageTransform = {
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  flipped: false,
  inverted: false,
  contrast: 100,
}
