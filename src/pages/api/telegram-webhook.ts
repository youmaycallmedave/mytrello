export const prerender = false

import type { APIRoute } from 'astro'
import { createClient } from '@supabase/supabase-js'

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID
const TELEGRAM_BOARD_NAME = '📱 Telegram'

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function tgApi(method: string, body: object) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.json()
}

async function sendMessage(chat_id: number | string, text: string, extra: object = {}) {
  return tgApi('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra })
}

async function answerCallback(callback_query_id: string, text?: string) {
  return tgApi('answerCallbackQuery', { callback_query_id, text })
}

async function editMessage(chat_id: number | string, message_id: number, text: string, extra: object = {}) {
  return tgApi('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', ...extra })
}

export const POST: APIRoute = async ({ request }) => {
  let update: any
  try { update = await request.json() } catch { return new Response('ok') }

  const sb = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // ── Handle callback buttons (status change / delete) ──────────────────────
  if (update.callback_query) {
    const cq = update.callback_query
    const chatId = cq.message.chat.id
    if (String(chatId) !== String(TG_CHAT)) {
      await answerCallback(cq.id, '⛔ Access denied')
      return new Response('ok')
    }

    const [action, projectId] = (cq.data as string).split(':')

    const { data: rows } = await sb.from('projects_data').select('id, data').limit(1)
    const row = rows?.[0]
    const appData = row?.data
    if (!appData) { await answerCallback(cq.id, 'Error'); return new Response('ok') }

    const boards: any[] = appData.boards || []
    let found: any = null
    for (const b of boards) {
      const p = (b.projects || []).find((p: any) => p.id === projectId)
      if (p) { found = p; break }
    }

    if (!found) { await answerCallback(cq.id, 'Project not found'); return new Response('ok') }

    if (action === 'delete') {
      for (const b of boards) {
        b.projects = (b.projects || []).filter((p: any) => p.id !== projectId)
      }
      await sb.from('projects_data').update({ data: appData }).eq('id', row.id)
      await answerCallback(cq.id, '🗑 Deleted')
      await editMessage(chatId, cq.message.message_id, `🗑 <s>${found.title}</s>\n<i>Deleted</i>`)
      return new Response('ok')
    }

    const statusMap: Record<string, string> = {
      'status_todo': 'todo',
      'status_inprogress': 'inprogress',
      'status_done': 'done'
    }
    if (statusMap[action]) {
      found.status = statusMap[action]
      await sb.from('projects_data').update({ data: appData }).eq('id', row.id)
      const labels: Record<string, string> = { todo: '📋 To Do', inprogress: '🔵 In Progress', done: '✅ Done' }
      await answerCallback(cq.id, labels[found.status])
      await editMessage(chatId, cq.message.message_id,
        `📌 <b>${found.title}</b>\nStatus: ${labels[found.status]}`,
        { reply_markup: projectKeyboard(projectId) }
      )
    }

    return new Response('ok')
  }

  // ── Handle text messages ──────────────────────────────────────────────────
  const msg = update.message
  if (!msg?.text) return new Response('ok')

  const chatId = msg.chat.id
  if (String(chatId) !== String(TG_CHAT)) return new Response('ok')

  const text = msg.text.trim()

  // Ignore commands except /start /help
  if (text === '/start' || text === '/help') {
    await sendMessage(chatId,
      `👋 <b>My Trello Bot</b>\n\nJust send me any text — I'll create a project in your <b>${TELEGRAM_BOARD_NAME}</b> board.\n\nExample:\n<i>Design landing page for client</i>`)
    return new Response('ok')
  }

  if (text.startsWith('/')) return new Response('ok')

  // Create project
  const { data: rows } = await sb.from('projects_data').select('id, data').limit(1)
  const row = rows?.[0]
  const appData = row?.data
  if (!appData) { await sendMessage(chatId, '❌ No data found'); return new Response('ok') }

  const boards: any[] = appData.boards || []

  // Find or create Telegram board
  let tgBoard = boards.find((b: any) => b.name === TELEGRAM_BOARD_NAME)
  if (!tgBoard) {
    tgBoard = { id: uid(), name: TELEGRAM_BOARD_NAME, projects: [] }
    boards.push(tgBoard)
    appData.boards = boards
  }

  const newProject = {
    id: uid(),
    title: text,
    status: 'todo',
    tasks: [],
    createdAt: new Date().toISOString(),
    source: 'telegram'
  }

  tgBoard.projects.unshift(newProject)
  await sb.from('projects_data').update({ data: appData }).eq('id', row.id)

  await sendMessage(chatId,
    `✅ <b>Added to ${TELEGRAM_BOARD_NAME}:</b>\n📌 ${text}`,
    { reply_markup: projectKeyboard(newProject.id) }
  )

  return new Response('ok')
}

function projectKeyboard(projectId: string) {
  return {
    inline_keyboard: [[
      { text: '🔵 In Progress', callback_data: `status_inprogress:${projectId}` },
      { text: '✅ Done',        callback_data: `status_done:${projectId}` },
      { text: '🗑',             callback_data: `delete:${projectId}` }
    ]]
  }
}
