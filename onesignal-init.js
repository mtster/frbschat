// onesignal-init.js - put at the site root (https://frbschat.pages.dev/onesignal-init.js)
// Initializes OneSignal and provides small helper functions used by app.js

window.OneSignal = window.OneSignal || [];
OneSignal.push(function() {
  OneSignal.init({
    appId: "9df95e3e-85af-47ed-864f-d4ccba6468e4", // <<---- keep this unless your OneSignal App ID differs
    allowLocalhostAsSecureOrigin: true,
    notifyButton: { enable: false }
  });
});

// Trigger OneSignal's slidedown/native prompt from UI
window.enableOneSignal = async function() {
  try {
    if (!window.OneSignal) return;
    // Use slidedown if available (recommended), otherwise attempt native prompt
    if (OneSignal.Slidedown && OneSignal.Slidedown.prompt) {
      OneSignal.Slidedown.prompt();
      return;
    }
    if (OneSignal.showNativePrompt) {
      OneSignal.showNativePrompt();
      return;
    }
    if (OneSignal.registerForPushNotifications) {
      OneSignal.registerForPushNotifications();
      return;
    }
    console.warn('OneSignal prompt API not available yet.');
  } catch (e) {
    console.warn('enableOneSignal error', e);
  }
};

// Attach an external id for this browser/device — used to target specific users from server
window.onsignalLogin = async function(externalId) {
  try {
    if (!window.OneSignal) return;
    // Try the modern method if available, else fallback
    if (OneSignal.setExternalUserId) {
      await OneSignal.setExternalUserId(String(externalId));
    } else if (OneSignal.login) {
      await OneSignal.login(String(externalId));
    } else {
      // fallback via push queue
      OneSignal.push(function() {
        OneSignal.setExternalUserId && OneSignal.setExternalUserId(String(externalId));
      });
    }
    console.log('OneSignal: external id set', externalId);
  } catch (e) {
    console.warn('onsignalLogin error', e);
  }
};

// Remove external id on logout (if you use logout)
window.onsignalLogout = async function() {
  try {
    if (!window.OneSignal) return;
    if (OneSignal.removeExternalUserId) {
      await OneSignal.removeExternalUserId();
    } else if (OneSignal.logout) {
      await OneSignal.logout();
    }
    console.log('OneSignal: external id removed');
  } catch (e) {
    console.warn('onsignalLogout error', e);
  }
};
