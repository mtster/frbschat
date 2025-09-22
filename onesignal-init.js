// onesignal-init.js
// Put this in the root of your site and include it from index.html (see head snippet below).
window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal) {
  try {
    await OneSignal.init({
      appId: "9df95e3e-85af-47ed-864f-d4ccba6468e4", // <<--- YOUR APP ID
      allowLocalhostAsSecureOrigin: true, // keep true for local dev, harmless on prod
      notifyButton: { enable: false } // we will show our own prompt or use slidedown
      // If you store worker files not at root, add serviceWorkerPath here.
    });

    // Optional: show a gentle slidedown prompt (call from UI when appropriate instead)
    // OneSignal.Slidedown.prompt(); // call it on a user action

    // Expose simple helpers to set/remove the logged-in app user (External ID)
    // Call onsignalLogin(userId) after your user logs in.
    window.onsignalLogin = async function(userId, authHash) {
      // authHash only needed if you implemented identity verification on backend
      if (!userId) return;
      try {
        if (authHash) {
          // new user model expects OneSignal.login(externalId, authHash)
          await OneSignal.login(String(userId), String(authHash));
        } else {
          await OneSignal.login(String(userId));
        }
        console.log("OneSignal: external id set", userId);
      } catch (e) {
        console.warn("OneSignal login error:", e);
      }
    };

    // Call onsignalLogout() on your app logout to dissociate external id
    window.onsignalLogout = async function() {
      try {
        await OneSignal.logout();
        console.log("OneSignal: logged out");
      } catch (e) {
        console.warn("OneSignal logout error:", e);
      }
    };

    // Optional: push notification click handler to deep-link to chat
    OneSignal.on && OneSignal.on('notificationClick', function(event) {
      try {
        const data = event?.data || {};
        if (data && data.chatId) {
          // Example deep-link to your existing route handling:
          window.location.href = "/?chatId=" + encodeURIComponent(data.chatId);
        }
      } catch (e) { /* noop */ }
    });

    console.log("OneSignal initialized");
  } catch (err) {
    console.error("OneSignal init failed:", err);
  }
});
