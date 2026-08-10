export interface Coordinate {
  x: number // Porcentagem de 0 a 100
  y: number // Porcentagem de 0 a 100
}

export interface Minutia {
  id: number
  color: string
  coordA: Coordinate | null
  coordB: Coordinate | null
}

export type ComparisonStep = 'WAITING_A' | 'WAITING_B'

export interface AppState {
  imageA: string | null // URL do Blob/Base64
  imageB: string | null
  minutiae: Minutia[]
  currentStep: ComparisonStep
  globalCounter: number
}

export type ImageSlot = 'A' | 'B'

export interface ImageTransform {
  zoom: number
  rotation: number // graus
  panX: number // porcentagem do tamanho base da imagem
  panY: number
  flipped: boolean // espelhado horizontalmente
  inverted: boolean // cores em negativo
}

export const DEFAULT_IMAGE_TRANSFORM: ImageTransform = {
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  flipped: false,
  inverted: false,
}
