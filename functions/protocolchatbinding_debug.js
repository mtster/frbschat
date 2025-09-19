// functions/protocolchatbinding_debug.js
// Debug helper: builds VAPID JWT using the VAPID_PRIVATE_KEY PEM secret (from env),
// returns the JWT header+payload (no signature), Crypto-Key header, and the push endpoint response.
// Usage (GET): /_functions/protocolchatbinding_debug?key=<KV-key-from-list_subs>
// (or /protocolchatbinding_debug?key=... depending on your Pages routing)

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const keyName = url.searchParams.get('key');
    if (!keyName) {
      return new Response(JSON.stringify({ error: 'missing key query param' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

    // Fetch subscription from KV
    const raw = await env.SUBSCRIBERS.get(keyName);
    if (!raw) return new Response(JSON.stringify({ error: 'no such key in KV' }), { status: 404, headers: { 'Content-Type': 'application/json' }});

    const entry = JSON.parse(raw);
    const subscription = entry.subscription || entry;
    if (!subscription || !subscription.endpoint) {
      return new Response(JSON.stringify({ error: 'subscription missing endpoint' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

    // Prepare VAPID signing key
    const pem = env.VAPID_PRIVATE_KEY;
    const publicKey = env.VAPID_PUBLIC_KEY;
    const subject = env.VAPID_SUBJECT || '';

    if (!pem || !publicKey || !subject) {
      return new Response(JSON.stringify({ error: 'VAPID secrets missing (VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT required)' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }

    // Import PEM PKCS8 private key to CryptoKey
    const privKeyBuf = pemToArrayBuffer(pem);
    let cryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey('pkcs8', privKeyBuf, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to import VAPID_PRIVATE_KEY as pkcs8: ' + (e && e.message) }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }

    // Build VAPID JWT (header.payload.signature). We'll return header + payload (no signature).
    const aud = (new URL(subscription.endpoint)).origin;
    const header = { alg: 'ES256', typ: 'JWT' };
    const exp = Math.floor(Date.now()/1000) + (12*60*60);
    const payload = { aud, exp, sub: subject };

    const header64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const payload64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = header64 + '.' + payload64;

    // Sign the signingInput with ECDSA-SHA256
    const sigDer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(signingInput));
    const sigJo = derToJose(new Uint8Array(sigDer), 32); // JOSE raw
    const sig64 = base64UrlEncode(sigJo);

    const jwt = `${header64}.${payload64}.${sig64}`;

    // Build headers that your push worker would send
    const authHeader = `WebPush ${jwt}`;
    const cryptoKeyHeader = `p256ecdsa=${publicKey}`;

    // Try sending an empty POST to the endpoint with the VAPID headers
    let pushResponseInfo = null;
    try {
      const resp = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Crypto-Key': cryptoKeyHeader,
          'TTL': '60',
          'Content-Length': '0'
        },
        body: ''
      });
      const text = await safeText(resp);
      pushResponseInfo = {
        status: resp.status,
        statusText: resp.statusText,
        headers: Object.fromEntries(resp.headers.entries()),
        bodySnippet: text.slice(0, 600)
      };
    } catch (e) {
      pushResponseInfo = { error: 'fetch failed: ' + (e && e.message) };
    }

    // Return header/payload for inspection (note: we return both header64 and payload64 decoded for clarity)
    const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(header64)));
    const payloadJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload64)));

    return new Response(JSON.stringify({
      endpoint: subscription.endpoint,
      vapid: {
        header64,
        payload64,
        header: headerJson,
        payload: payloadJson,
        cryptoKeyHeader,
        authHeaderPrefix: 'WebPush (JWT not fully returned for safety)'
      },
      pushResponse: pushResponseInfo
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' }});

  } catch (err) {
    return new Response(JSON.stringify({ error: err && err.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
}

/* ---------- helpers ---------- */

function pemToArrayBuffer(pem) {
  const m = pem.trim().match(/-----BEGIN [A-Z ]+-----([A-Za-z0-9+/=\r\n]+)-----END [A-Z ]+-----/);
  const b64 = m ? m[1].replace(/[\r\n\s]/g, '') : pem.replace(/\s/g, '');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

function base64UrlEncode(bufOrUint8) {
  let bytes;
  if (bufOrUint8 instanceof Uint8Array) bytes = bufOrUint8;
  else if (bufOrUint8 instanceof ArrayBuffer) bytes = new Uint8Array(bufOrUint8);
  else throw new Error('base64UrlEncode expects ArrayBuffer or Uint8Array');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(b64url) {
  const pad = '='.repeat((4 - b64url.length % 4) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

function derToJose(derSig, keySize) {
  // parse DER signature into R|S raw bytes (keySize each)
  const sig = derSig;
  if (sig[0] !== 0x30) throw new Error('Invalid DER signature');
  let offset = 2;
  if (sig[1] & 0x80) {
    offset = 2 + (sig[1] & 0x7f);
  }
  if (sig[offset] !== 0x02) throw new Error('Invalid DER signature');
  const rlen = sig[offset + 1];
  let rstart = offset + 2;
  const rend = rstart + rlen;
  let r = sig.slice(rstart, rend);
  offset = rend;
  if (sig[offset] !== 0x02) throw new Error('Invalid DER signature');
  const slen = sig[offset + 1];
  const sstart = offset + 2;
  const send = sstart + slen;
  let s = sig.slice(sstart, send);

  if (r[0] === 0x00) r = r.slice(1);
  if (s[0] === 0x00) s = s.slice(1);

  const rPadded = new Uint8Array(keySize); rPadded.set(r, keySize - r.length);
  const sPadded = new Uint8Array(keySize); sPadded.set(s, keySize - s.length);
  const out = new Uint8Array(keySize * 2); out.set(rPadded, 0); out.set(sPadded, keySize);
  return out;
}

async function safeText(resp) {
  try { return await resp.text(); } catch (e) { return ''; }
}
