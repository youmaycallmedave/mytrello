export const prerender = false

import type { APIRoute } from 'astro'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const GET: APIRoute = async ({ request }) => {
  // Verify cron secret
  const url = new URL(request.url)
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
    || url.searchParams.get('secret')
  if (secret !== import.meta.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sb = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Fetch all data
  const [{ data: projectsData }, { data: timeEntries }] = await Promise.all([
    sb.from('projects_data').select('*'),
    sb.from('time_entries').select('*').order('started_at', { ascending: false })
  ])

  const date = new Date().toISOString().slice(0, 10)
  const fileName = `backup-${date}.json`
  const backupJson = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    projectsData,
    timeEntries
  }, null, 2)

  // Save to Supabase Storage
  await sb.storage
    .from('backups')
    .upload(fileName, backupJson, {
      contentType: 'application/json',
      upsert: true
    })

  // Send email via Resend
  const resend = new Resend(import.meta.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'My Trello <onboarding@resend.dev>',
    to: import.meta.env.BACKUP_EMAIL,
    subject: `My Trello — бэкап ${date}`,
    html: `
      <p>Привет!</p>
      <p>Еженедельный автоматический бэкап <strong>My Trello</strong>.</p>
      <p>Дата: <strong>${date}</strong></p>
      <p>Файл содержит все проекты, заметки и записи таймера.</p>
      <p>Сохрани его в надёжном месте.</p>
    `,
    attachments: [
      {
        filename: fileName,
        content: Buffer.from(backupJson).toString('base64')
      }
    ]
  })

  return new Response(JSON.stringify({ ok: true, fileName }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
