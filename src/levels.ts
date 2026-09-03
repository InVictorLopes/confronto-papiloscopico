// Ajuste de "níveis" simplificado (inspirado no Ctrl+L do Photoshop), com dois
// controles independentes e cada um com uma direção intuitiva — "aumentar" sempre
// deixa a imagem mais escura, nos dois casos:
//
// 1) Ponto preto (blackPoint, 0-254): remapeia o preto de entrada, deixando os
//    tons escuros mais escuros e aumentando o contraste ao redor deles — sem
//    mexer no branco. Ao contrário do filtro contrast() puro (que sempre estica
//    em torno de 50% cinza e por isso estoura pra branco em imagens já claras),
//    aqui o pivô é o próprio ponto preto escolhido.
// 2) Escurecer os claros (darken, 0-254): multiplica a imagem inteira por um
//    fator < 1 (a partir do preto), escurecendo tudo de forma uniforme — útil
//    quando a foto inteira está clara/apagada demais.
//
// Os dois se combinam multiplicando os fatores de brightness().
export function buildLevelsFilterParts(blackPoint: number, darken: number): string[] {
  const b = Math.min(Math.max(blackPoint, 0), 254) / 255
  const gamma = (1 + b) / (1 - b)
  const beta1 = 1 / (1 + b)

  const d = Math.min(Math.max(darken, 0), 254) / 255
  const beta2 = 1 - d

  const beta = beta1 * beta2

  const parts: string[] = []
  if (Math.abs(beta - 1) > 0.001) parts.push(`brightness(${beta})`)
  if (Math.abs(gamma - 1) > 0.001) parts.push(`contrast(${gamma})`)
  return parts
}
