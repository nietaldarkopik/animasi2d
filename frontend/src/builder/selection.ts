import { clampXform, normDeg, partBox, rotv, toCanvas, type Box, type FracBox, type PartXform, type Placement } from './spec'

export interface Item { slot: string; pl: Placement; frac: FracBox }

export const unionBox = (boxes: Box[]): Box | null => (boxes.length ? { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) } : null)
export const centerOf = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 })
export const boxesIntersect = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
export const normBox = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) })

/** Visible box of every item (canvas units) and their union. */
export const boxesOf = (items: Item[]) => Object.fromEntries(items.map((i) => [i.slot, partBox(i.pl, i.frac)])) as Record<string, Box>

/** Parts whose visible box touches the rubber-band rectangle. */
export function marqueeHits(items: Item[], rect: Box): string[] {
  return items.filter((i) => boxesIntersect(partBox(i.pl, i.frac), rect)).map((i) => i.slot)
}

/** Everything moves by the same (dx, dy). */
export function moveItems(items: Item[], dx: number, dy: number): Record<string, PartXform> {
  return Object.fromEntries(items.map((i) => [i.slot, clampXform({ scale: i.pl.scale, dx: i.pl.dx + dx, dy: i.pl.dy + dy })]))
}

/**
 * Scales every item by `factor` about `pivot` (canvas units): each part grows by the factor AND its artwork moves away from /
 * toward the pivot by the same factor, so the whole selection keeps its layout (like resizing a group).
 */
export function scaleItems(items: Item[], factor: number, pivot: { x: number; y: number }): Record<string, PartXform> {
  const out: Record<string, PartXform> = {}
  for (const i of items) {
    const b0 = { x: i.pl.x + ((i.frac.x0 + i.frac.x1) / 2) * i.pl.w, y: i.pl.y + ((i.frac.y0 + i.frac.y1) / 2) * i.pl.h } // untransformed centre of the visible artwork
    const now = toCanvas(i.pl, b0)
    const want = { x: pivot.x + factor * (now.x - pivot.x), y: pivot.y + factor * (now.y - pivot.y) }
    const scale = i.pl.scale * factor
    const v = rotv(b0.x - i.pl.px, b0.y - i.pl.py, i.pl.rot)
    out[i.slot] = clampXform({ scale, dx: want.x - i.pl.px - scale * v.x, dy: want.y - i.pl.py - scale * v.y })
  }
  return out
}

/**
 * Rotates every item by `deg` about `pivot`: each part turns by `deg` (about its own artwork centre) and that centre
 * swings around the pivot by the same angle, so a group turns like one rigid object.
 */
export function rotateItems(items: Item[], deg: number, pivot: { x: number; y: number }): Record<string, PartXform> {
  const out: Record<string, PartXform> = {}
  for (const i of items) {
    const b0 = { x: i.pl.x + ((i.frac.x0 + i.frac.x1) / 2) * i.pl.w, y: i.pl.y + ((i.frac.y0 + i.frac.y1) / 2) * i.pl.h }
    const now = toCanvas(i.pl, b0)
    const swung = rotv(now.x - pivot.x, now.y - pivot.y, deg)
    const want = { x: pivot.x + swung.x, y: pivot.y + swung.y }
    const rot = normDeg(i.pl.rot + deg)
    const v = rotv(b0.x - i.pl.px, b0.y - i.pl.py, rot)
    out[i.slot] = clampXform({ scale: i.pl.scale, rot, dx: want.x - i.pl.px - i.pl.scale * v.x, dy: want.y - i.pl.py - i.pl.scale * v.y })
  }
  return out
}

/** Toggle `slot` in a selection (Shift/Ctrl+click). */
export const toggle = (sel: string[], slot: string) => (sel.includes(slot) ? sel.filter((s) => s !== slot) : [...sel, slot])
