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
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
    || new URL(request.url).searchParams.get('secret')
  if (secret !== import.meta.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sb = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayStart = new Date(todayStr).toISOString()
  const todayEnd = new Date(todayStr + 'T23:59:59').toISOString()

  const [{ data: rows }, { data: timeEntries }] = await Promise.all([
    sb.from('projects_data').select('data').limit(1),
    sb.from('time_entries').select('duration_seconds, project_id')
      .gte('started_at', todayStart)
      .lte('started_at', todayEnd)
  ])

  const appData = rows?.[0]?.data
  if (!appData) return new Response('No data', { status: 200 })

  const boards: any[] = appData.boards || []
  const allProjects = boards.flatMap((b: any) => b.projects || [])

  const inProgress = allProjects.filter((p: any) => p.status === 'inprogress')
  const todo = allProjects.filter((p: any) => p.status === 'todo')

  // Check journal for today
  const journal: any[] = appData.journal || []
  const hasJournalToday = journal.some((e: any) => e.date === todayStr || e.createdAt?.slice(0, 10) === todayStr)

  // Time tracking stats
  const workEntries = (timeEntries || []).filter(e => e.project_id !== '__distraction__')
  const distrEntries = (timeEntries || []).filter(e => e.project_id === '__distraction__')
  const workSecs = workEntries.reduce((s, e) => s + e.duration_seconds, 0)
  const distrSecs = distrEntries.reduce((s, e) => s + e.duration_seconds, 0)

  function fmtH(secs: number) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  let msg = `🌙 <b>Evening report</b>\n\n`

  // Time summary
  msg += `⏱ <b>Today's time:</b>\n`
  msg += `  🔵 Work: ${workSecs > 0 ? fmtH(workSecs) : '—'}\n`
  msg += `  ⏸ Distractions: ${distrSecs > 0 ? fmtH(distrSecs) : '—'}\n\n`

  // Journal reminder
  if (!hasJournalToday) {
    msg += `📔 <b>Journal not filled today</b> — don't forget to write!\n\n`
  } else {
    msg += `✅ Journal filled\n\n`
  }

  // Unfinished tasks
  if (inProgress.length || todo.length) {
    msg += `📋 <b>Still open:</b>\n`
    inProgress.forEach((p: any) => { msg += `  🔵 ${p.title}\n` })
    todo.slice(0, 5).forEach((p: any) => { msg += `  ○ ${p.title}\n` })
    if (todo.length > 5) msg += `  ...and ${todo.length - 5} more\n`
    msg += '\n'
  } else {
    msg += `🎉 All tasks done for today!\n\n`
  }

  // Upcoming deadlines (next 3 days)
  const today = new Date()
  const urgent = allProjects.filter((p: any) => {
    if (!p.deadline || p.status === 'done') return false
    const diff = Math.ceil((new Date(p.deadline).getTime() - today.getTime()) / 86400000)
    return diff >= 0 && diff <= 3
  })
  if (urgent.length) {
    msg += `⚠️ <b>Deadlines soon:</b>\n`
    urgent.forEach((p: any) => {
      const diff = Math.ceil((new Date(p.deadline).getTime() - today.getTime()) / 86400000)
      const label = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`
      msg += `  • ${p.title} — ${label}\n`
    })
  }

  await sendTg(msg)
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
}
