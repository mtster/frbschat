// functions/protocolchatbinding.js
// Cloudflare Pages Function / Worker: when a message is posted, send a OneSignal push.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const user = body.user || body.nickname || 'Someone';
    const message = body.message || body.text || '';
    if (!message) return new Response('Missing message', { status: 400 });

    const ONESIGNAL_APP_ID = env.ONESIGNAL_APP_ID;
    const ONESIGNAL_API_KEY = env.ONESIGNAL_API_KEY;

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      return new Response(JSON.stringify({ error: 'OneSignal credentials not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }

    // Build a simple message: heading = sender, content = message
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      // Send to all subscribed users. If you later want per-user targeting,
      // switch to include_external_user_ids: [ "alice" ] or similar.
      included_segments: ["Subscribed Users"],
      headings: { en: String(user) },
      contents: { en: String(message).slice(0, 250) }, // OneSignal content length safe-guard
      data: { user, ts: Date.now() }
    };

    const resp = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Use the REST API Key stored in env (DO NOT commit this to repo)
        'Authorization': `Key ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const respBody = await resp.text();
    // Return OneSignal result for debugging if needed
    return new Response(respBody, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
