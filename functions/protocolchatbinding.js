// protocolchatbinding.js - Cloudflare Worker to broadcast push notifications to subscriptions in KV
// This worker sends an empty WebPush to each subscription (no encrypted payload).
// It builds a VAPID JWT signed with the VAPID private key stored in env.VAPID_PRIVATE_KEY.
//
// Required Wrangler environment variables / bindings:
// - SUBSCRIPTIONS (KV Namespace binding)
// - VAPID_PUBLIC_KEY (base64url, uncompressed public key, 65 or 64 bytes)
// - VAPID_PRIVATE_KEY (base64url, 32 bytes)
// - VAPID_SUBJECT (mailto: or https: contact string for VAPID 'sub' claim)
//
// NOTE: For iOS 16.4+ PWAs, push notifications only work when the user has added the PWA to the home
// screen and the service worker is registered with scope that covers the site. The client should
// subscribe with the same VAPID public key returned from the /subscribe endpoint.

function base64UrlToUint8Array(base64UrlString) {
  base64UrlString = base64UrlString.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64UrlString.length % 4;
  if (pad === 2) base64UrlString += '==';
  else if (pad === 3) base64UrlString += '=';
  else if (pad !== 0) base64UrlString += '='.repeat(4 - pad);
  const binary = atob(base64UrlString);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64Url(uint8Array) {
  let str = '';
  for (let i = 0; i < uint8Array.length; i++) str += String.fromCharCode(uint8Array[i]);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function derToJose(derSignature, keySize = 64) {
  const bytes = new Uint8Array(derSignature);
  if (bytes[0] !== 0x30) throw new Error('Invalid DER signature: expected sequence (0x30)');
  let offset = 2;
  if (bytes[1] & 0x80) {
    const lenOfLen = bytes[1] & 0x7f;
    offset = 2 + lenOfLen;
  }
  if (bytes[offset] !== 0x02) throw new Error('Invalid DER signature: expected integer for r');
  const rLen = bytes[offset + 1];
  const rStart = offset + 2;
  const r = bytes.slice(rStart, rStart + rLen);
  const sIndex = rStart + rLen;
  if (bytes[sIndex] !== 0x02) throw new Error('Invalid DER signature: expected integer for s');
  const sLen = bytes[sIndex + 1];
  const sStart = sIndex + 2;
  const s = bytes.slice(sStart, sStart + sLen);

  const out = new Uint8Array(keySize);
  const rOffset = (keySize / 2) - r.length;
  const sOffset = keySize - s.length;
  out.set(r, rOffset);
  out.set(s, sOffset);
  return out;
}

async function importPrivateKeyFromVapid(publicKeyB64Url, privateKeyB64Url) {
  let pubBytes = base64UrlToUint8Array(publicKeyB64Url);
  if (pubBytes.length === 65 && pubBytes[0] === 4) {
    pubBytes = pubBytes.slice(1);
  }
  if (pubBytes.length !== 64) throw new Error('VAPID public key has wrong length: ' + pubBytes.length);
  const x = pubBytes.slice(0, 32);
  const y = pubBytes.slice(32, 64);
  const d = base64UrlToUint8Array(privateKeyB64Url);
  if (d.length !== 32) throw new Error('VAPID private key has wrong length: ' + d.length);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
    d: uint8ArrayToBase64Url(d)
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

function encodeUtf8(input) {
  return new TextEncoder().encode(input);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type':'application/json' } });
  }

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured in worker environment' }), { status: 500, headers: { 'Content-Type':'application/json' } });
  }

  const listIter = await env.SUBSCRIPTIONS.list({ cursor: undefined, limit: 1000 });
  const keys = listIter.keys || [];
  let privateKey;
  try {
    privateKey = await importPrivateKeyFromVapid(vapidPublic, vapidPrivate);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to import VAPID key: ' + err.message }), { status: 500, headers: { 'Content-Type':'application/json' } });
  }

  async function buildVapidJWT(audience) {
    const header = { alg: 'ES256', typ: 'JWT' };
    const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours
    const payload = { aud: audience, exp: exp, sub: vapidSubject };
    const encHeader = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const encPayload = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = encHeader + '.' + encPayload;
    const signatureDer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encodeUtf8(signingInput));
    const sig = derToJose(signatureDer, 64);
    const encSig = uint8ArrayToBase64Url(sig);
    return signingInput + '.' + encSig;
  }

  const results = [];
  for (const k of keys) {
    try {
      const rec = await env.SUBSCRIPTIONS.get(k.name);
      if (!rec) continue;
      const parsed = JSON.parse(rec);
      const subscription = parsed.subscription;
      if (!subscription || !subscription.endpoint) continue;
      const endpointOrigin = new URL(subscription.endpoint).origin;
      const jwt = await buildVapidJWT(endpointOrigin);
      const headers = {
        'TTL': '60',
        'Authorization': 'WebPush ' + jwt,
        'Crypto-Key': 'p256ecdsa=' + vapidPublic
      };
      const resp = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: headers,
      });
      results.push({ id: k.name, status: resp.status });
    } catch (err) {
      results.push({ id: k.name, error: err.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: { 'Content-Type':'application/json' } });
}
