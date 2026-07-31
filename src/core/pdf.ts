import { extname } from 'node:path'

import { PDFiumLibrary } from '@hyzyla/pdfium'
import type { PDFiumDocument } from '@hyzyla/pdfium'
import wasmPath from '@hyzyla/pdfium/pdfium.wasm' with { type: 'file' }

import type { RawImage } from './image'

export const PDF_ZOOM_MIN = 25
export const PDF_ZOOM_MAX = 400
export const PDF_ZOOM_STEP = 25

export interface PdfPan {
  x: number
  y: number
}

export interface PdfFile {
  readonly pageCount: number
  readonly bytes: number
  renderPage: (page: number, maxCols: number, maxRows: number, zoom: number) => Promise<RawImage>
  close: () => Promise<void>
}

let libraryPromise: Promise<PDFiumLibrary> | null = null
let work: Promise<void> = Promise.resolve()

function enqueue<T>(run: () => T | Promise<T>): Promise<T> {
  const result = work.then(run, run)
  work = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function library(): Promise<PDFiumLibrary> {
  libraryPromise ??= Bun.file(wasmPath)
    .arrayBuffer()
    .then(wasmBinary => PDFiumLibrary.init({ wasmBinary }))
  return libraryPromise
}

export function isPdfPath(path: string): boolean {
  return extname(path).toLowerCase() === '.pdf'
}

export function stepPdfZoom(zoom: number, direction: -1 | 1): number {
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom + direction * PDF_ZOOM_STEP))
}

export function pdfRenderSize(
  pageWidth: number,
  pageHeight: number,
  maxCols: number,
  maxRows: number,
  zoom: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    throw new TypeError('PDF page has no size')
  }
  if (!Number.isFinite(maxCols) || !Number.isFinite(maxRows) || !Number.isFinite(zoom)) {
    throw new TypeError('PDF render size is invalid')
  }
  const pixelWidth = Math.max(1, Math.floor(maxCols))
  const pixelHeight = Math.max(1, Math.floor(maxRows) * 2)
  const fit = Math.min(pixelWidth / pageWidth, pixelHeight / pageHeight)
  const scale = fit * (Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom)) / 100)
  const width = Math.max(1, Math.round(pageWidth * scale))
  const height = Math.max(1, Math.round(pageHeight * scale))
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new TypeError('PDF render size is invalid')
  }
  return { width, height }
}

export function clampPdfPan(
  pan: PdfPan,
  contentCols: number,
  contentRows: number,
  viewportCols: number,
  viewportRows: number,
): PdfPan {
  return {
    x: Math.min(Math.max(0, contentCols - viewportCols), Math.max(0, Math.floor(pan.x))),
    y: Math.min(Math.max(0, contentRows - viewportRows), Math.max(0, Math.floor(pan.y))),
  }
}

export function centerPdfPan(
  contentCols: number,
  contentRows: number,
  viewportCols: number,
  viewportRows: number,
): PdfPan {
  return clampPdfPan(
    {
      x: Math.floor((contentCols - viewportCols) / 2),
      y: Math.floor((contentRows - viewportRows) / 2),
    },
    contentCols,
    contentRows,
    viewportCols,
    viewportRows,
  )
}

export function openPdf(path: string): Promise<PdfFile> {
  return enqueue(async () => {
    const source = await Bun.file(path).bytes()
    const document: PDFiumDocument = await (await library()).loadDocument(source)
    const pageCount = document.getPageCount()
    if (pageCount < 1) {
      document.destroy()
      throw new Error('PDF has no pages')
    }

    let closeRequested = false
    let closing: Promise<void> | null = null

    const renderPage = (page: number, maxCols: number, maxRows: number, zoom: number) => {
      if (closeRequested) return Promise.reject(new Error('PDF is closed'))
      return enqueue(async () => {
        if (closeRequested) throw new Error('PDF is closed')
        if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
          throw new Error(`PDF page ${page + 1} is out of range`)
        }
        const pdfPage = document.getPage(page)
        const { originalWidth, originalHeight } = pdfPage.getOriginalSize()
        const size = pdfRenderSize(originalWidth, originalHeight, maxCols, maxRows, zoom)
        const rendered = await pdfPage.render({
          ...size,
          render: async ({ data }) => data,
        })
        return {
          width: rendered.width,
          height: rendered.height,
          pixels: rendered.data,
          bytes: source.byteLength,
        }
      })
    }

    const close = () => {
      if (closing) return closing
      closeRequested = true
      closing = enqueue(() => document.destroy())
      return closing
    }

    return { pageCount, bytes: source.byteLength, renderPage, close }
  })
}
