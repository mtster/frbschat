// protocolchatbinding.js
// Cloudflare Pages Function: sends VAPID-signed WebPush requests to subscribers stored in KV (SUBSCRIBERS).
// Exports onRequestPost(context) — call this with { nickname, message } body.
//
// REQUIREMENTS:
// - env.VAPID_PRIVATE_KEY  -> PKCS#8 PEM string (-----BEGIN PRIVATE KEY----- ...)
// - env.VAPID_PUBLIC_KEY   -> base64url public key (same as client uses)
// - env.VAPID_SUBJECT      -> a subject like "mailto:you@example.com"
// - env.SUBSCRIBERS        -> Workers KV namespace (already set up)
//
// Behavior:
// - For each subscription in KV, POST an empty body to subscription.endpoint with VAPID Authorization header.
// - If endpoint responds 404 or 410, delete the subscription from KV.
// - Returns 200 when done.

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const nickname = body.nickname || body.user || body.name;
    const message = body.message || body.text || body.msg;

    if (!nickname || !message) {
      return new Response("Missing fields", { status: 400 });
    }

    // list subscribers
    const subsList = await env.SUBSCRIBERS.list({ limit: 1000 });
    if (!subsList.keys || subsList.keys.length === 0) {
      return new Response("No subscribers", { status: 200 });
    }

    const payload = JSON.stringify({
      title: "New Message",
      body: `${nickname}: ${message}`,
      tag: "chat-message",
    });

    // prepare VAPID signing key (cached)
    const vapidKey = await getVapidSigningKey(env);

    // iterate subs
    for (const k of subsList.keys) {
      try {
        const raw = await env.SUBSCRIBERS.get(k.name);
        if (!raw) continue;
        let entry;
        try { entry = JSON.parse(raw); } catch (e) { entry = raw; }

        const subscription = entry.subscription || entry;
        if (!subscription || !subscription.endpoint) continue;

        // We send an authenticated empty POST (Apple requires VAPID)
        const aud = (new URL(subscription.endpoint)).origin;
        const jwt = await buildVapidJWT(vapidKey, aud, env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY);

        const headers = {
          'Authorization': `WebPush ${jwt}`,
          'Crypto-Key': `p256ecdsa=${env.VAPID_PUBLIC_KEY}`,
          'TTL': '60',
          'Content-Length': '0'
        };

        // Send the push (empty body). Our service worker fetches latest message if payload missing.
        const res = await fetch(subscription.endpoint, {
          method: 'POST',
          headers
        });

        // Delete stale subscriptions when push service returns 404/410
        if (res.status === 404 || res.status === 410) {
          try { await env.SUBSCRIBERS.delete(k.name); } catch (e) { /* ignore */ }
        }

      } catch (err) {
        // Log but continue with other subscriptions
        console.error('push error for key', k.name, err && (err.message || err));
      }
    }

    return new Response("Push sent", { status: 200 });

  } catch (err) {
    return new Response("Server error: " + (err && err.message), { status: 500 });
  }
}

/* ----------------------- VAPID / JWT helpers ----------------------- */

/*
 We import the VAPID private key from env.VAPID_PRIVATE_KEY (PKCS#8 PEM).
 Then we sign a short-lived JWT for each push request.
*/

let cachedSigningKey = null; // CryptoKey
let cachedPrivatePem = null;

async function getVapidSigningKey(env) {
  // If same PEM already imported, reuse
  const pem = env.VAPID_PRIVATE_KEY || '';
  if (!pem) throw new Error('VAPID_PRIVATE_KEY env secret is missing');

  if (cachedSigningKey && cachedPrivatePem === pem) return cachedSigningKey;
  cachedPrivatePem = pem;

  // Convert PEM to ArrayBuffer
  const keyBuf = pemToArrayBuffer(pem);

  // import as pkcs8
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuf,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  cachedSigningKey = cryptoKey;
  return cryptoKey;
}

function pemToArrayBuffer(pem) {
  // Accepts PKCS8 PEM: -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----
  const m = pem.trim().match(/-----BEGIN [A-Z ]+-----([A-Za-z0-9+/=\r\n]+)-----END [A-Z ]+-----/);
  const b64 = m ? m[1].replace(/[\r\n\s]/g, '') : pem.replace(/\s/g, '');
  // decode base64 to ArrayBuffer
  const binary = atob(b64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

function base64UrlEncode(uint8) {
  let str = '';
  for (let i = 0; i < uint8.length; i++) str += String.fromCharCode(uint8[i]);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textEncodeUtf8(str) {
  return new TextEncoder().encode(str);
}

// Build VAPID JWT and return compact serialized JWT string
async function buildVapidJWT(privateCryptoKey, audience, subject, publicKey) {
  // header
  const header = { alg: 'ES256', typ: 'JWT' };
  // payload: aud (origin), exp (now + 12h), sub (subject)
  const exp = Math.floor(Date.now() / 1000) + (12 * 60 * 60);
  const payload = { aud: audience, exp, sub: subject };

  const header64 = base64UrlEncode(textEncodeUtf8(JSON.stringify(header)));
  const payload64 = base64UrlEncode(textEncodeUtf8(JSON.stringify(payload)));
  const signingInput = textEncodeUtf8(header64 + '.' + payload64);

  // sign using ECDSA-SHA256 -> returns ASN.1/DER encoded signature; convert to raw R|S (JOSE)
  const derSig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateCryptoKey, signingInput);
  const joseSig = derToJose(new Uint8Array(derSig), 32); // 32 bytes for P-256 each R,S
  const sig64 = base64UrlEncode(joseSig);

  return `${header64}.${payload64}.${sig64}`;
}

// Convert ASN.1/DER ECDSA signature to JOSE raw R|S (each fixed length keySize bytes)
function derToJose(derSig, keySize) {
  // parse DER sequence of two integers
  const sig = derSig;
  if (sig[0] !== 0x30) throw new Error('Invalid DER signature (no 0x30)');
  let offset = 2;
  if (sig[1] & 0x80) {
    const lenOfLen = sig[1] & 0x7f;
    offset = 2 + lenOfLen;
  }

  if (sig[offset] !== 0x02) throw new Error('Invalid DER signature (no integer for r)');
  let rlen = sig[offset + 1];
  let rstart = offset + 2;
  let rend = rstart + rlen;
  let r = sig.slice(rstart, rend);

  offset = rend;
  if (sig[offset] !== 0x02) throw new Error('Invalid DER signature (no integer for s)');
  let slen = sig[offset + 1];
  let sstart = offset + 2;
  let send = sstart + slen;
  let s = sig.slice(sstart, send);

  // Remove leading zeros
  if (r[0] === 0x00) r = r.slice(1);
  if (s[0] === 0x00) s = s.slice(1);

  // Pad to keySize
  const rPadded = new Uint8Array(keySize);
  const sPadded = new Uint8Array(keySize);
  rPadded.set(r, keySize - r.length);
  sPadded.set(s, keySize - s.length);

  // return concatenated r|s
  const out = new Uint8Array(keySize * 2);
  out.set(rPadded, 0);
  out.set(sPadded, keySize);
  return out;
}
