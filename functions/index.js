// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: "https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

exports.sendNotificationOnMessage = functions.database
  .ref("/protocol-messages/{pushId}")
  .onCreate(async (snapshot, context) => {
    const msg = snapshot.val();
    if (!msg) return;

    const payload = {
      notification: {
        title: msg.user || "Protocol Chat",
        body: msg.message || "New message",
        icon: "/logo-192.png"
      }
    };

    // Send to all FCM tokens stored in your database
    const tokensSnapshot = await db.ref("/fcmTokens").once("value");
    const tokens = tokensSnapshot.val() ? Object.values(tokensSnapshot.val()) : [];

    if (tokens.length > 0) {
      await admin.messaging().sendToDevice(tokens, payload);
    }
  });
