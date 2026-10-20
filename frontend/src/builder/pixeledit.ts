import type { Pixels } from '../retouch'

/** Largest per-channel difference between pixel i and the colour (r, g, b). */
const diff = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number) => Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b))

/**
 * "Magic wand" erase: makes the pixels similar in colour to the one at (sx, sy) transparent.
 * contiguous = only the connected region (clean a background), otherwise every matching pixel in the image.
 * `grow` extends the erased area by that many pixels (removes the light fringe around an object).
 * Returns the number of pixels erased (0 when the clicked pixel is already transparent).
 */
export function floodErase(img: Pixels, sx: number, sy: number, tol: number, contiguous = true, grow = 1): number {
  const { w, h, data } = img
  sx = Math.floor(sx); sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0
  const s = (sy * w + sx) * 4
  if (data[s + 3] < 8) return 0
  const [r, g, b] = [data[s], data[s + 1], data[s + 2]]
  const hit = new Uint8Array(w * h)
  const match = (p: number) => data[p * 4 + 3] >= 8 && diff(data, p * 4, r, g, b) <= tol

  if (contiguous) {
    const stack = [sy * w + sx]
    hit[stack[0]] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w, y = (p - x) / w
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (!hit[q] && match(q)) { hit[q] = 1; stack.push(q) }
      }
    }
  } else {
    for (let p = 0; p < w * h; p++) if (match(p)) hit[p] = 1
  }

  let mark = hit
  for (let k = 0; k < grow; k++) {
    const next = new Uint8Array(mark)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mark[y * w + x]) continue
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && ny >= 0 && nx < w && ny < h) next[ny * w + nx] = 1
    }
    mark = next
  }
  let n = 0
  for (let p = 0; p < w * h; p++) if (mark[p] && data[p * 4 + 3] > 0) { data[p * 4 + 3] = 0; n++ }
  return n
}

/**
 * Removes small detached specks (leftovers of the slicing): connected opaque regions smaller than `minFrac` of the
 * largest one are erased. Returns how many regions were removed.
 */
export function despeckle(img: Pixels, minFrac = 0.04): number {
  const { w, h, data } = img
  const label = new Int32Array(w * h)
  const areas: number[] = [0]
  let next = 1
  for (let start = 0; start < w * h; start++) {
    if (label[start] || data[start * 4 + 3] <= 40) continue
    const id = next++
    let area = 0
    const stack = [start]
    label[start] = id
    while (stack.length) {
      const p = stack.pop()!
      area++
      const x = p % w, y = (p - x) / w
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (!label[q] && data[q * 4 + 3] > 40) { label[q] = id; stack.push(q) }
      }
    }
    areas[id] = area
  }
  const biggest = Math.max(0, ...areas)
  let removed = 0
  const drop = new Set<number>()
  areas.forEach((a, id) => { if (id && a < biggest * minFrac) drop.add(id) })
  for (let p = 0; p < w * h; p++) if (drop.has(label[p])) data[p * 4 + 3] = 0
  removed = drop.size
  return removed
}

/** Shrinks the opaque area by `px` pixels (cuts the pale halo left around cut-outs). */
export function erodeAlpha(img: Pixels, px = 1): void {
  const { w, h, data } = img
  for (let k = 0; k < px; k++) {
    const a = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) a[p] = data[p * 4 + 3]
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = a[y * w + x]
      for (let dy = -1; dy <= 1 && m; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : a[ny * w + nx]
        if (v < m) m = v
      }
      data[(y * w + x) * 4 + 3] = m
    }
  }
}

export const toImageData = (p: Pixels) => new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.w, p.h)
