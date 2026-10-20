declare module 'imagetracerjs' {
  interface Tracer {
    imagedataToSVG(img: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): string
  }
  const ImageTracer: Tracer
  export default ImageTracer
}
