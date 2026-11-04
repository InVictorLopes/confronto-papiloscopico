/* Sugestão de pontos (BETA) — roda em Web Worker, 100% local.
 *
 * Fluxo: normaliza a escala das duas imagens pelo espaçamento das cristas -> detecta minúcias
 * (MINDTCT/NBIS, domínio público, compilado para WebAssembly) -> alinha as duas imagens por
 * votação (rotação, escala e deslocamento) -> pareia os pontos -> escolhe os melhores pares,
 * espalhados pela imagem.
 *
 * Entrada (postMessage): { type: 'run', a, b, cropA, cropB, existing, count }
 *   a, b: { w, h, data: ArrayBuffer RGBA }   cropA/cropB: [{x,y}] em % da imagem, ou null
 *   existing: [{ a: {x,y}|null, b: {x,y}|null }] em %      count: nº de pontos desejado
 * Saída: { type: 'progress', text } | { type: 'result', ... } | { type: 'error', message }
 *   Os pares voltam numerados como um relógio: a partir das 12h, no sentido horário.
 */
importScripts('nbis.js')

const TARGET_PERIOD = 9 // espaçamento das cristas (px) a que o MINDTCT foi calibrado (~500 ppi)
const TARGET_PPI = 500
const MAXN = 3000 // minúcias por imagem
const MAX_NORM_SIDE = 3200 // limite do lado maior depois da normalização
const MIN_PAIRS = 12 // abaixo disso as imagens não são tratadas como correspondentes
const ALIGN_TOP = 400 // minúcias de melhor qualidade usadas na votação de alinhamento
const SCALES = [0.7, 0.75, 0.8, 0.86, 0.92, 0.96, 1, 1.04, 1.09, 1.16, 1.24, 1.33, 1.43]

let modulePromise = null
function getModule() {
  if (!modulePromise) modulePromise = NbisModule({ locateFile: (f) => new URL(f, self.location.href).href })
  return modulePromise
}

// ---------- Imagem ----------
function toGray(rgba, w, h) {
  const d = new Uint8ClampedArray(rgba)
  const g = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = (299 * d[i * 4] + 587 * d[i * 4 + 1] + 114 * d[i * 4 + 2]) / 1000
  return g
}

// Reduz com média por caixa e amplia com interpolação bilinear.
function resizeGray(g, w, h, f) {
  const nw = Math.max(8, Math.round(w * f)), nh = Math.max(8, Math.round(h * f))
  const out = new Uint8Array(nw * nh)
  if (f < 1) {
    const sx = w / nw, sy = h / nh
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)))
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)))
        let s = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g[yy * w + xx]
        out[y * nw + x] = s / ((y1 - y0) * (x1 - x0))
      }
    }
  } else {
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(h - 1.001, (y + 0.5) / f - 0.5), y0 = Math.max(0, Math.floor(sy)), fy = Math.max(0, sy - y0)
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(w - 1.001, (x + 0.5) / f - 0.5), x0 = Math.max(0, Math.floor(sx)), fx = Math.max(0, sx - x0)
        const i = y0 * w + x0
        out[y * nw + x] = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy
      }
    }
  }
  return { g: out, w: nw, h: nh }
}

// ---------- Espaçamento das cristas ----------
// Em blocos com orientação coerente, amostra o perfil de intensidade perpendicular às cristas
// e acha o primeiro pico da autocorrelação (com precisão de sub-pixel). Mediana dos blocos.
function ridgePeriodAt(g, w, h, B, cohMin) {
  const half = B >> 1, out = []
  const at = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y)
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return null
    const fx = x - x0, fy = y - y0, i = y0 * w + x0
    return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy
  }
  for (let cy = half; cy < h - half; cy += B) for (let cx = half; cx < w - half; cx += B) {
    let gxx = 0, gyy = 0, gxy = 0, mn = 255, mx = 0
    for (let y = cy - half + 1; y < cy + half - 1; y++) for (let x = cx - half + 1; x < cx + half - 1; x++) {
      const gx = g[y * w + x + 1] - g[y * w + x - 1], gy = g[(y + 1) * w + x] - g[(y - 1) * w + x]
      gxx += gx * gx; gyy += gy * gy; gxy += gx * gy
      const v = g[y * w + x]; if (v < mn) mn = v; if (v > mx) mx = v
    }
    const tot = gxx + gyy
    if (!tot || mx - mn < 60) continue
    if (Math.hypot(gxx - gyy, 2 * gxy) / tot < cohMin) continue // orientação pouco coerente
    const th = 0.5 * Math.atan2(2 * gxy, gxx - gyy), nx = Math.cos(th), ny = Math.sin(th), tx = -ny, ty = nx
    const L = Math.max(B, 96), ac = new Float64Array(L >> 1)
    let lines = 0
    for (let off = -half / 2; off <= half / 2; off += 3) {
      const p = []
      for (let i = 0; i < L; i++) {
        const v = at(cx + (i - L / 2) * nx + off * tx, cy + (i - L / 2) * ny + off * ty)
        if (v === null) { p.length = 0; break }
        p.push(v)
      }
      if (p.length !== L) continue
      const m = p.reduce((a, v) => a + v, 0) / L
      for (let i = 0; i < L; i++) p[i] -= m
      for (let l = 0; l < ac.length; l++) { let s = 0; for (let i = 0; i + l < L; i++) s += p[i] * p[i + l]; ac[l] += s / (L - l) }
      lines++
    }
    if (!lines) continue
    let l = 1
    while (l < ac.length - 1 && ac[l] > 0) l++ // sai do pico central
    let bl = -1, bv = 0
    for (; l < ac.length - 1; l++) {
      if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > bv) { bv = ac[l]; bl = l; if (ac[l] > 0.3 * ac[0]) break }
    }
    if (bl > 2 && bv > 0.15 * ac[0]) {
      const y0 = ac[bl - 1], y1 = ac[bl], y2 = ac[bl + 1], den = y0 - 2 * y1 + y2
      out.push(den < 0 ? bl + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : bl)
    }
  }
  if (out.length < 3) return null
  out.sort((a, b) => a - b)
  return out[out.length >> 1]
}
function ridgePeriodOn(g, w, h) {
  const sizes = [...new Set([Math.min(128, Math.max(40, Math.round(Math.min(w, h) / 6))), 96, 64, 48])]
  for (const cohMin of [0.5, 0.35]) for (const B of sizes) { const p = ridgePeriodAt(g, w, h, B, cohMin); if (p) return p }
  return null
}
// Mede numa versão reduzida (limita o custo em imagens grandes) e, se falhar, na original.
function ridgePeriod(g, w, h) {
  const maxSide = Math.max(w, h), rs = []
  if (maxSide > 1000) rs.push(1000 / maxSide)
  if (maxSide <= 2500 || !rs.length) rs.push(1)
  for (const r of rs) {
    const im = r === 1 ? { g, w, h } : resizeGray(g, w, h, r)
    const p = ridgePeriodOn(im.g, im.w, im.h)
    if (p) return p / r
  }
  return null
}

// ---------- Detecção (MINDTCT em WebAssembly) ----------
function detect(M, im) {
  const p = M._malloc(im.g.length)
  M.HEAPU8.set(im.g, p)
  const po = M._malloc(MAXN * 5 * 4)
  const n = M._mt_detect(p, im.w, im.h, TARGET_PPI / 25.4, po, MAXN)
  const arr = n > 0 ? Array.from(new Int32Array(M.HEAP32.buffer, po, n * 5)) : []
  M._free(p); M._free(po)
  const list = []
  for (let i = 0; i < Math.max(n, 0); i++) list.push({ x: arr[i * 5], y: arr[i * 5 + 1], t: arr[i * 5 + 2], type: arr[i * 5 + 3], q: arr[i * 5 + 4] })
  return list
}

// ---------- Alinhamento, pareamento e escolha ----------
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

// Votação (Hough) por pares do mesmo tipo: b = S·R(th)·a + t, com a escala em torno de 1
// (a diferença grossa de escala já foi removida na normalização).
function align(A, B) {
  const top = (L) => (L.length > ALIGN_TOP ? [...L].sort((p, q) => q.q - p.q).slice(0, ALIGN_TOP) : L)
  const TA = top(A), TB_ = top(B), votes = new Map(), TBIN = 6, XB = 16
  let best = null
  for (const S of SCALES) {
    votes.clear()
    for (const a of TA) for (const b of TB_) {
      if (a.type !== b.type) continue
      const th = (((a.t - b.t) % 360) + 360) % 360, r = (th * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
      const tx = b.x - S * (c * a.x - s * a.y), ty = b.y - S * (s * a.x + c * a.y)
      const k = Math.round(th / TBIN) + '|' + Math.round(tx / XB) + '|' + Math.round(ty / XB)
      const v = votes.get(k) || { n: 0, th: 0, tx: 0, ty: 0 }
      v.n++; v.th += th; v.tx += tx; v.ty += ty
      votes.set(k, v)
    }
    for (const v of votes.values()) if (!best || v.n > best.votes) best = { th: v.th / v.n, tx: v.tx / v.n, ty: v.ty / v.n, s: S, votes: v.n }
  }
  return best
}

function predict(T, a) {
  if (T.M) return [T.M[0] * a.x + T.M[1] * a.y + T.tx, T.M[2] * a.x + T.M[3] * a.y + T.ty]
  const r = (T.th * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return [T.s * (c * a.x - s * a.y) + T.tx, T.s * (s * a.x + c * a.y) + T.ty]
}

function pairUp(A, B, T, tol, angTol) {
  const rot = T.M ? (Math.atan2(T.M[2], T.M[0]) * 180) / Math.PI : T.th, cand = []
  A.forEach((a, i) => {
    const [px, py] = predict(T, a)
    B.forEach((b, j) => {
      const d = Math.hypot(b.x - px, b.y - py)
      if (d < tol && a.type === b.type && angDiff(a.t - rot, b.t) < angTol) cand.push({ i, j, d })
    })
  })
  cand.sort((p, q) => p.d - q.d)
  const ui = new Set(), uj = new Set(), out = []
  for (const p of cand) if (!ui.has(p.i) && !uj.has(p.j)) { ui.add(p.i); uj.add(p.j); out.push(p) }
  return out
}

function fitRigid(A, B, pairs) {
  const n = pairs.length
  let ax = 0, ay = 0, bx = 0, by = 0
  for (const p of pairs) { ax += A[p.i].x; ay += A[p.i].y; bx += B[p.j].x; by += B[p.j].y }
  ax /= n; ay /= n; bx /= n; by /= n
  let sc = 0, ss = 0, vv = 0
  for (const p of pairs) {
    const u = A[p.i].x - ax, v = A[p.i].y - ay, x = B[p.j].x - bx, y = B[p.j].y - by
    sc += u * x + v * y; ss += u * y - v * x; vv += u * u + v * v
  }
  const th = (Math.atan2(ss, sc) * 180) / Math.PI, r = (th * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const S = Math.min(1.4, Math.max(0.7, Math.hypot(sc, ss) / (vv || 1)))
  return { th, s: S, tx: bx - S * (c * ax - s * ay), ty: by - S * (s * ax + c * ay) }
}

// Ajuste afim: admite esticamento e cisalhamento que a similaridade não cobre.
function fitAffine(A, B, pairs) {
  const n = pairs.length
  let ax = 0, ay = 0, bx = 0, by = 0
  for (const p of pairs) { ax += A[p.i].x; ay += A[p.i].y; bx += B[p.j].x; by += B[p.j].y }
  ax /= n; ay /= n; bx /= n; by /= n
  let suu = 0, suv = 0, svv = 0, sux = 0, svx = 0, suy = 0, svy = 0
  for (const p of pairs) {
    const u = A[p.i].x - ax, v = A[p.i].y - ay, x = B[p.j].x - bx, y = B[p.j].y - by
    suu += u * u; suv += u * v; svv += v * v; sux += u * x; svx += v * x; suy += u * y; svy += v * y
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-6) return null
  const a = (svv * sux - suv * svx) / det, b = (suu * svx - suv * sux) / det
  const c = (svv * suy - suv * svy) / det, d = (suu * svy - suv * suy) / det
  const dd = a * d - b * c
  if (dd < 0.5 || dd > 2) return null // não aceitar deformação absurda
  return { M: [a, b, c, d], tx: bx - a * ax - b * ay, ty: by - c * ax - d * ay }
}

function refine(A, B, T0) {
  let T = T0, pairs = []
  for (const tol of [14, 10, 7]) {
    pairs = pairUp(A, B, T, tol, 20)
    if (pairs.length < 4) break
    T = { ...fitRigid(A, B, pairs), votes: T0.votes }
  }
  for (const tol of [9, 7]) { // últimas voltas com afim, se houver pares suficientes
    if (pairs.length < 10) break
    const Ta = fitAffine(A, B, pairs)
    if (!Ta) break
    const np = pairUp(A, B, Ta, tol, 22)
    if (np.length < pairs.length * 0.8) break
    T = { ...Ta, th: (Math.atan2(Ta.M[2], Ta.M[0]) * 180) / Math.PI, s: Math.sqrt(Math.abs(Ta.M[0] * Ta.M[3] - Ta.M[1] * Ta.M[2])), votes: T0.votes }
    pairs = np
  }
  return { T, pairs }
}

// Os k melhores pares por qualidade, escolhidos para ficarem espalhados (farthest-point).
function pick(A, pairs, k) {
  const sc = pairs.map((p) => ({ ...p, q: p.q })).sort((a, b) => b.q - a.q)
  const pool = sc.slice(0, Math.max(k * 3, Math.ceil(sc.length / 2)))
  if (!pool.length) return []
  const chosen = [pool[0]]
  while (chosen.length < Math.min(k, pool.length)) {
    let bp = null, bd = -1
    for (const p of pool) {
      if (chosen.includes(p)) continue
      const d = Math.min(...chosen.map((c) => Math.hypot(A[p.i].x - A[c.i].x, A[p.i].y - A[c.i].y)))
      if (d > bd) { bd = d; bp = p }
    }
    chosen.push(bp)
  }
  return chosen
}

// ---------- Auxiliares ----------
function insidePolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Prepara uma imagem: cinza, escala pelas cristas e detecção. Devolve as minúcias já em
// coordenadas da imagem normalizada (nw x nh).
function prepare(M, side, label, post) {
  post(`Analisando a imagem ${label}…`)
  const gray = toGray(side.data, side.w, side.h)
  const period = ridgePeriod(gray, side.w, side.h)
  let f = period ? TARGET_PERIOD / period : 1
  f = Math.min(5, Math.max(0.2, f))
  f = Math.min(f, MAX_NORM_SIDE / Math.max(side.w, side.h))
  const im = Math.abs(f - 1) < 0.05 ? { g: gray, w: side.w, h: side.h } : resizeGray(gray, side.w, side.h, f)
  post(`Detectando minúcias na imagem ${label}…`)
  return { list: detect(M, im), w: im.w, h: im.h, period, scaleKnown: !!period }
}

function run(M, msg, post) {
  const count = Math.max(3, Math.min(30, msg.count || 12))
  const PA = prepare(M, msg.a, 'A', post)
  const PB = prepare(M, msg.b, 'B', post)

  // Só entram minúcias dentro do recorte (a área fora dele está oculta para o perito).
  const within = (P, crop) => (crop && crop.length > 2 ? P.list.filter((m) => insidePolygon((m.x / P.w) * 100, (m.y / P.h) * 100, crop)) : P.list)
  const A = within(PA, msg.cropA), B = within(PB, msg.cropB)

  // Espaçamento das cristas em % da largura de cada imagem: a lupa usa para mostrar a mesma
  // região (em nº de cristas) nas duas imagens, mesmo com resoluções diferentes.
  const periodPct = { a: PA.period ? (PA.period / msg.a.w) * 100 : null, b: PB.period ? (PB.period / msg.b.w) * 100 : null }
  const base = { type: 'result', countA: A.length, countB: B.length, periodPct, scaleKnown: PA.scaleKnown && PB.scaleKnown }
  if (A.length < 8 || B.length < 8) return { ...base, status: 'few', pairs: [], consistent: 0 }

  post('Alinhando as duas imagens…')
  const T0 = align(A, B)
  if (!T0) return { ...base, status: 'weak', pairs: [], consistent: 0 }
  const { T, pairs } = refine(A, B, T0)
  const rotation = T.th, scale = T.s

  if (pairs.length < MIN_PAIRS) return { ...base, status: 'weak', pairs: [], consistent: pairs.length, rotation, scale }

  // Não repete pontos que o perito já marcou (perto de um existente, em A ou em B).
  const EX = TARGET_PERIOD * 1.6
  const exA = (msg.existing || []).filter((e) => e.a).map((e) => ({ x: (e.a.x / 100) * PA.w, y: (e.a.y / 100) * PA.h }))
  const exB = (msg.existing || []).filter((e) => e.b).map((e) => ({ x: (e.b.x / 100) * PB.w, y: (e.b.y / 100) * PB.h }))
  const near = (pt, list) => list.some((e) => Math.hypot(e.x - pt.x, e.y - pt.y) < EX)
  const fresh = pairs
    .map((p) => ({ ...p, q: Math.min(A[p.i].q, B[p.j].q) }))
    .filter((p) => !near(A[p.i], exA) && !near(B[p.j], exB))

  const chosen = pick(A, fresh, count)

  // Numeração de relógio: em volta do centro dos pares encontrados, a partir das 12h e no
  // sentido horário. Os pontos são os da imagem A (a numeração vale para os dois lados).
  const cx = pairs.reduce((s, p) => s + A[p.i].x, 0) / pairs.length
  const cy = pairs.reduce((s, p) => s + A[p.i].y, 0) / pairs.length
  const clockAngle = (p) => {
    const ang = Math.atan2(A[p.i].x - cx, -(A[p.i].y - cy)) // 0 = 12h; cresce no sentido horário (y da imagem cresce para baixo)
    return ang < 0 ? ang + 2 * Math.PI : ang
  }
  chosen.sort((p, q) => clockAngle(p) - clockAngle(q))

  const out = chosen.map((p) => {
    const a = A[p.i], b = B[p.j], [px, py] = predict(T, a)
    return {
      a: { x: (a.x / PA.w) * 100, y: (a.y / PA.h) * 100 },
      b: { x: (b.x / PB.w) * 100, y: (b.y / PB.h) * 100 },
      type: a.type === 1 ? 'ending' : 'bifurcation',
      quality: p.q,
      residual: Math.hypot(b.x - px, b.y - py),
    }
  })
  const center = { x: (cx / PA.w) * 100, y: (cy / PA.h) * 100 }
  return { ...base, status: 'ok', pairs: out, consistent: pairs.length, available: fresh.length, rotation, scale, center }
}

self.onmessage = async (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'run') return
  const post = (text) => self.postMessage({ type: 'progress', text })
  try {
    const M = await getModule()
    self.postMessage(run(M, msg, post))
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
