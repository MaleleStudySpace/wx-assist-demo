import { readSessionJson, writeSessionJson } from './demoSessionStore'

// 数据版本：mock/*.json 有结构性改动时 +1 —— 旧 sessionStorage 缓存会自动失效，避免页面一直显示老数据
const DATA_VERSION = 2
const TASK_KEY = `mock-skill-tasks:v${DATA_VERSION}`
const HISTORY_KEY = `mock-scheduler-history:v${DATA_VERSION}`

export async function loadMockSchedulerData() {
  let tasks = readSessionJson(TASK_KEY, null)
  let history = readSessionJson(HISTORY_KEY, null)
  if (tasks && history) return { tasks, history }
  try {
    const [taskRes, historyRes] = await Promise.all([
      fetch('/api/skill-tasks').then(r => r.json()),
      fetch('/api/scheduler/history').then(r => r.json()),
    ])
    tasks = tasks || taskRes.tasks || []
    history = history || historyRes.tasks || []
  } catch {
    tasks = tasks || []
    history = history || []
  }
  writeSessionJson(TASK_KEY, tasks)
  writeSessionJson(HISTORY_KEY, history)
  return { tasks, history }
}

export function getMockTasks() { return readSessionJson(TASK_KEY, []) }
export function getMockHistory() { return readSessionJson(HISTORY_KEY, []) }
export function saveMockTasks(tasks) { return writeSessionJson(TASK_KEY, tasks) }
export function saveMockHistory(history) { return writeSessionJson(HISTORY_KEY, history) }

export function upsertMockTask(task) {
  const tasks = getMockTasks()
  const next = task.id ? tasks.map(item => item.id === task.id ? { ...item, ...task } : item) : [...tasks, { ...task, id: `demo-task-${Date.now()}`, created_at: new Date().toISOString(), run_count: 0, error_count: 0, status: 'idle' }]
  saveMockTasks(next)
  return next
}

export function removeMockTask(id) {
  const next = getMockTasks().filter(task => task.id !== id)
  saveMockTasks(next)
  return next
}

export function toggleMockTask(id, enabled) {
  const next = getMockTasks().map(task => task.id === id ? { ...task, enabled, status: enabled ? 'idle' : 'disabled' } : task)
  saveMockTasks(next)
  return next
}

export function addMockHistory(record) {
  const next = [{ ...record, id: record.id || `demo-history-${Date.now()}`, created_at: record.created_at || new Date().toISOString() }, ...getMockHistory()]
  saveMockHistory(next)
  return next
}

export function executeMockTask(task, skill) {
  const failed = task.status === 'error'
  const now = new Date().toISOString()
  const record = {
    task_type: 'cron', source: 'scheduler', group_name: task.name, task_name: task.name,
    skill: task.skill, status: failed ? 'failed' : 'completed', progress: failed ? '执行失败' : '已完成模拟执行',
    result: failed ? '' : (skill?.demo_output || 'Demo 已完成模拟执行。'),
    error: failed ? 'Demo 模拟：该任务本轮没有可用数据，请稍后重试。' : '',
    push_status: failed ? 'failed' : (task.push?.enabled === false ? 'skipped' : 'success'),
    push_error: failed ? '任务未生成结果' : '', config: JSON.stringify(task.args || {}),
    created_at: now, started_at: now, finished_at: now,
  }
  addMockHistory(record)
  const nextTasks = getMockTasks().map(item => item.id === task.id ? {
    ...item, run_count: (item.run_count || 0) + 1, error_count: (item.error_count || 0) + (failed ? 1 : 0),
    last_run: now, status: failed ? 'error' : 'idle',
  } : item)
  saveMockTasks(nextTasks)
  return { record, tasks: nextTasks, history: getMockHistory() }
}
