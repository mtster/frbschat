export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    // Accept GET ?key=... or POST { "keyName": "..." }
    let keyName;
    if (request.method === "GET") {
      keyName = url.searchParams.get("key");
    } else if (request.method === "POST") {
      const { keyName: bodyKey } = await request.json();
      keyName = bodyKey;
    }

    if (!keyName) {
      return new Response(JSON.stringify({ error: "Missing keyName" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const subData = await env.SUBSCRIBERS.get(keyName);
    if (!subData) {
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const parsed = JSON.parse(subData);
    const subscription = parsed.subscription;
    if (!subscription || !subscription.endpoint) {
      return new Response(JSON.stringify({ error: "Subscription missing endpoint" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const endpoint = subscription.endpoint;

    // Try sending an empty push
    const pushRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "TTL": "60",
        "Content-Length": "0"
      }
    });

    const bodyText = await pushRes.text();

    return new Response(
      JSON.stringify(
        {
          endpoint,
          status: pushRes.status,
          headers: Object.fromEntries(pushRes.headers.entries()),
          body: bodyText.slice(0, 500) // limit output
        },
        null,
        2
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
