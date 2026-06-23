/**
 * Build script for wx-assist demo.
 *
 * Builds the frontend from the bundled ui-src/ directory (already patched
 * with API_BASE='' and WebSocket using window.location.host).
 * No external references — the project is fully self-contained.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ── Config ──────────────────────────────────────────────────────────
const DEMO_DIR = __dirname
const UI_SRC = path.join(DEMO_DIR, 'ui-src')
const TEMP_DIR = path.join(DEMO_DIR, 'ui-temp')
const DIST_DIR = path.join(DEMO_DIR, 'dist')

// ── Step 1: Copy UI source (from bundled, already-patched ui-src/) ──
console.log('[1/3] Copying UI source from ui-src/')

if (!fs.existsSync(UI_SRC)) {
  console.error('ERROR: ui-src/ directory not found. This project must include the frontend source.')
  process.exit(1)
}

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

copyDir(UI_SRC, TEMP_DIR)
console.log('  → Copied to', TEMP_DIR)

// ── Step 2: npm install + build ─────────────────────────────────────
console.log('[2/3] Installing dependencies and building frontend...')

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

// ── Step 3: Move dist ───────────────────────────────────────────────
console.log('[3/3] Moving build output to demo/dist/')

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
