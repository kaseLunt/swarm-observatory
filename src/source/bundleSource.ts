import type { DecodedRun } from '../decode/decodeBundle'

export async function fetchDet(baseUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(`${baseUrl}/bundle.det`)
  if (!res.ok) throw new Error(`fetch ${baseUrl}/bundle.det: ${res.status}`)
  return res.arrayBuffer()
}

export async function fetchBundle(baseUrl: string): Promise<{ det: ArrayBuffer; manifestText: string }> {
  const [det, manRes] = await Promise.all([fetchDet(baseUrl), fetch(`${baseUrl}/manifest.json`)])
  if (!manRes.ok) throw new Error(`fetch ${baseUrl}/manifest.json: ${manRes.status}`)
  return { det, manifestText: await manRes.text() }
}

export function decodeInWorker(det: ArrayBuffer, onProgress?: (f: number) => void): Promise<DecodedRun> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../decode/worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (m: MessageEvent<{ type: string; run?: DecodedRun; fraction?: number; code?: string; message?: string }>) => {
      if (m.data.type === 'progress') onProgress?.(m.data.fraction!)
      else if (m.data.type === 'done') { resolve(m.data.run!); w.terminate() }
      else { reject(new Error(`${m.data.code}: ${m.data.message}`)); w.terminate() }
    }
    w.onerror = (e) => { reject(new Error('worker error: ' + (e.message ?? 'unknown'))); w.terminate() }
    w.postMessage({ det }, { transfer: [det] })
  })
}
