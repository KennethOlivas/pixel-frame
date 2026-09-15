import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Ship every runtime asset from our own origin. The module worker's sibling
// imports also have to be copied; a CDN worker would break offline operation.
const root = new URL('../', import.meta.url)
const destination = new URL('public/ffmpeg/', root)
await mkdir(destination, { recursive: true })
await cp(new URL('node_modules/@ffmpeg/core/dist/esm/', root), destination, { recursive: true })
await cp(new URL('node_modules/@ffmpeg/ffmpeg/dist/esm/', root), new URL('worker/', destination), { recursive: true })
console.log(`Local FFmpeg runtime ready: ${fileURLToPath(destination)}`)
