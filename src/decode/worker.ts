import { decodeBundle, transferablesOf } from './decodeBundle'
import { DecodeError } from '../lib/bytes'

self.onmessage = (msg: MessageEvent<{ det: ArrayBuffer }>) => {
  try {
    self.postMessage({ type: 'progress', fraction: 0 })
    const run = decodeBundle(msg.data.det)
    self.postMessage({ type: 'progress', fraction: 1 })
    self.postMessage({ type: 'done', run }, { transfer: transferablesOf(run) })
  } catch (e) {
    const code = e instanceof DecodeError ? e.code : 'Unknown'
    self.postMessage({ type: 'error', code, message: e instanceof Error ? e.message : String(e) })
  }
}
