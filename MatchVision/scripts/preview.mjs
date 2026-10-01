// Serves the production build (with the service worker) to try the installable app locally.
// npm run preview                 -> http://localhost:4300
// npm run preview -- --host 0.0.0.0  -> also from the LAN (offline/install need HTTPS there)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist/MatchVision/browser', import.meta.url)))
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const host = option('--host', '127.0.0.1')
const port = Number(option('--port', 4300))

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

async function file(path) {
  try { return (await stat(path)).isFile() ? path : null } catch { return null }
}

createServer(async (req, res) => {
  let url = '/'
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch {}
  const wanted = normalize(join(root, url))
  // Unknown paths are app routes (/login, /game/3...): Angular handles them from index.html
  const path = (wanted.startsWith(root + sep) && await file(wanted)) || join(root, 'index.html')
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
  res.end(await readFile(path))
}).listen(port, host, () => console.log(`MatchVision (build di produzione) su http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`))
