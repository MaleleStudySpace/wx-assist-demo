const EVENT_PREFIX = 'wx-assist-demo:'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function readSessionJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : clone(fallback)
  } catch {
    return clone(fallback)
  }
}

export function writeSessionJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${key}`, { detail: value }))
  } catch {}
  return value
}

export function subscribeSession(key, callback) {
  const eventName = `${EVENT_PREFIX}${key}`
  const handler = event => callback(event.detail)
  window.addEventListener(eventName, handler)
  return () => window.removeEventListener(eventName, handler)
}

export async function loadDemoPlatforms() {
  const cached = readSessionJson('platforms', null)
  if (cached) return cached
  try {
    const res = await fetch('/api/platforms')
    const data = await res.json()
    const platforms = data.platforms || []
    writeSessionJson('platforms', platforms)
    return platforms
  } catch {
    return []
  }
}

export function getDemoPlatforms() {
  return readSessionJson('platforms', [])
}

export function updateDemoPlatform(name, updater) {
  const current = getDemoPlatforms()
  const next = current.map(platform => {
    if (platform.name !== name) return platform
    const patch = typeof updater === 'function' ? updater(platform) : updater
    return { ...platform, ...patch, status: { ...platform.status, ...(patch.status || {}) }, config: { ...platform.config, ...(patch.config || {}) } }
  })
  return writeSessionJson('platforms', next)
}

export function resetDemoPlatforms() {
  try { sessionStorage.removeItem('platforms') } catch {}
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}platforms`, { detail: null }))
}
