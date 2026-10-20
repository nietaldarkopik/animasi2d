import ImageTracer from 'imagetracerjs'

/** Raster -> SVG tracing runs here so the page stays responsive while a big hair image is being traced. */
export interface TraceRequest { id: number; width: number; height: number; data: Uint8ClampedArray; options: Record<string, unknown> }
export type TraceReply = { id: number; svg: string } | { id: number; error: string }

const post = (m: TraceReply) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { id, width, height, data, options } = e.data
  try {
    post({ id, svg: ImageTracer.imagedataToSVG({ width, height, data }, options) })
  } catch (err) {
    post({ id, error: String((err as Error)?.message ?? err) })
  }
}
