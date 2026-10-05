/**
 * Vercel Serverless Function: /api/keepalive
 *
 * Runs on a cron schedule (see vercel.json) to keep the Supabase project
 * active. Supabase free-tier projects pause after 7 days of inactivity;
 * a lightweight DB query every 5 days prevents that.
 *
 * Required environment variables (set in Vercel dashboard):
 *   VITE_SUPABASE_URL   – your Supabase project URL
 *   VITE_SUPABASE_KEY   – your Supabase anon key
 */
export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY env vars' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Lightweight query: fetch a single row from categories (always exists, tiny)
    const res = await fetch(`${supabaseUrl}/rest/v1/categories?select=id&limit=1`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      return new Response(
        JSON.stringify({ ok: false, status: res.status, body }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ ok: true, pingedAt: new Date().toISOString() }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
