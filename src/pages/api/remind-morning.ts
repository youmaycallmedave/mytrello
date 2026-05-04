export const prerender = false

import type { APIRoute } from 'astro'
import { createClient } from '@supabase/supabase-js'

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID

async function sendTg(text: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' })
  })
}

export const GET: APIRoute = async ({ request }) => {
  return new Response(JSON.stringify({ ok: true, disabled: true }), { headers: { 'Content-Type': 'application/json' } })
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
    || new URL(request.url).searchParams.get('secret')
  if (secret !== import.meta.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sb = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: rows } = await sb.from('projects_data').select('data').limit(1)
  const appData = rows?.[0]?.data
  if (!appData) return new Response('No data', { status: 200 })

  const boards: any[] = appData.boards || []
  const allProjects = boards.flatMap((b: any) => b.projects || [])

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const inProgress = allProjects.filter((p: any) => p.status === 'inprogress')
  const todo = allProjects.filter((p: any) => p.status === 'todo')
  const deadlineToday = allProjects.filter((p: any) =>
    p.deadline && p.deadline.slice(0, 10) === todayStr && p.status !== 'done'
  )
  const deadlineSoon = allProjects.filter((p: any) => {
    if (!p.deadline || p.status === 'done') return false
    const d = new Date(p.deadline)
    const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000)
    return diff > 0 && diff <= 3
  })

  let msg = `☀️ <b>Good morning! Here's your day:</b>\n\n`

  if (deadlineToday.length) {
    msg += `🔴 <b>Deadline TODAY:</b>\n`
    deadlineToday.forEach((p: any) => { msg += `  • ${p.title}\n` })
    msg += '\n'
  }

  if (deadlineSoon.length) {
    msg += `⚠️ <b>Deadline in 1–3 days:</b>\n`
    deadlineSoon.forEach((p: any) => {
      const diff = Math.ceil((new Date(p.deadline).getTime() - today.getTime()) / 86400000)
      msg += `  • ${p.title} (${diff}d)\n`
    })
    msg += '\n'
  }

  if (inProgress.length) {
    msg += `🔵 <b>In Progress (${inProgress.length}):</b>\n`
    inProgress.forEach((p: any) => { msg += `  • ${p.title}\n` })
    msg += '\n'
  }

  if (todo.length) {
    msg += `📋 <b>To Do (${todo.length}):</b>\n`
    todo.slice(0, 5).forEach((p: any) => { msg += `  • ${p.title}\n` })
    if (todo.length > 5) msg += `  ...and ${todo.length - 5} more\n`
    msg += '\n'
  }

  if (!inProgress.length && !todo.length && !deadlineToday.length) {
    msg += `✅ All clear — no active tasks. Have a great day!`
  }

  await sendTg(msg)
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
}
