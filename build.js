/**
 * Build script for wx-assist demo.
 *
 * Copies the UI source from the main project, patches API_BASE to empty string
 * (same-origin) and the WebSocket URL to use window.location.host, then runs
 * npm install + npm run build. The output lands in demo/dist/.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ── Config ──────────────────────────────────────────────────────────
const MAIN_UI = path.resolve(__dirname, '..', 'webot-main', 'ui')
const DEMO_DIR = __dirname
const TEMP_DIR = path.join(DEMO_DIR, 'ui-temp')
const DIST_DIR = path.join(DEMO_DIR, 'dist')

// ── Step 1: Copy UI source ──────────────────────────────────────────
console.log('[1/5] Copying UI source from', MAIN_UI)

if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true })
}

// Copy recursively, skip node_modules and dist
function copyDir(src, dest, skip = ['node_modules', 'dist', '.vite']) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skip)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

if (!fs.existsSync(MAIN_UI)) {
  console.error('ERROR: Main project UI not found at', MAIN_UI)
  console.error('Make sure webot-main is at ../webot-main relative to this demo project.')
  process.exit(1)
}

copyDir(MAIN_UI, TEMP_DIR)
console.log('  → Copied to', TEMP_DIR)

// ── Step 2: Patch API_BASE ──────────────────────────────────────────
console.log('[2/5] Patching API_BASE for same-origin deployment')

const sharedPath = path.join(TEMP_DIR, 'src', 'components', 'SharedComponents.jsx')
if (fs.existsSync(sharedPath)) {
  let content = fs.readFileSync(sharedPath, 'utf-8')
  content = content.replace(
    /export const API_BASE\s*=\s*'http:\/\/127\.0\.0\.1:7327'/,
    "export const API_BASE = ''"
  )
  fs.writeFileSync(sharedPath, content, 'utf-8')
  console.log('  → Patched SharedComponents.jsx: API_BASE = ""')
} else {
  console.warn('  ⚠ SharedComponents.jsx not found, skipping API_BASE patch')
}

// ── Step 3: Patch WebSocket URL ─────────────────────────────────────
console.log('[3/5] Patching WebSocket URL for same-origin deployment')

const appPath = path.join(TEMP_DIR, 'src', 'App.jsx')
if (fs.existsSync(appPath)) {
  let content = fs.readFileSync(appPath, 'utf-8')
  // Replace: `ws://${API_BASE.replace(/^https?:\/\//, '')}/ws`
  // With: `ws://${window.location.host}/ws`
  content = content.replace(
    /`ws:\/\/\$\{API_BASE\.replace\([^)]+\)\}\/ws`/,
    '`ws://${window.location.host}/ws`'
  )
  // Also handle any other patterns like ws://127.0.0.1:7327/ws
  content = content.replace(
    /`ws:\/\/\$\{[^}]*API_BASE[^}]*\}\/ws`/g,
    '`ws://${window.location.host}/ws`'
  )
  fs.writeFileSync(appPath, content, 'utf-8')
  console.log('  → Patched App.jsx: WebSocket uses window.location.host')
} else {
  console.warn('  ⚠ App.jsx not found, skipping WebSocket URL patch')
}

// ── Step 4: npm install + build ─────────────────────────────────────
console.log('[4/5] Installing dependencies and building frontend...')

try {
  execSync('npm install', { cwd: TEMP_DIR, stdio: 'inherit' })
} catch (e) {
  console.error('ERROR: npm install failed')
  process.exit(1)
}

try {
  execSync('npm run build', { cwd: TEMP_DIR, stdio: 'inherit' })
} catch (e) {
  console.error('ERROR: npm run build failed')
  process.exit(1)
}

// ── Step 5: Move dist ───────────────────────────────────────────────
console.log('[5/5] Moving build output to demo/dist/')

const tempDist = path.join(TEMP_DIR, 'dist')
if (!fs.existsSync(tempDist)) {
  console.error('ERROR: Build output not found at', tempDist)
  process.exit(1)
}

// Clean old dist
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true })
}

// Move dist
fs.renameSync(tempDist, DIST_DIR)

// Clean temp
fs.rmSync(TEMP_DIR, { recursive: true, force: true })

console.log('\n✅ Build complete! Run `npm start` to launch the demo server.')
