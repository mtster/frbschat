const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.notifyNewMessage = functions.database.ref('/protocol-messages/{pushId}')
    .onCreate(async (snapshot, context) => {
        const msg = snapshot.val();
        if (!msg) return null;

        const payload = {
            notification: {
                title: msg.user || "Protocol Chat",
                body: msg.message || "",
                icon: "/logo-192.png"
            },
            data: {
                user: msg.user || "",
                message: msg.message || ""
            }
        };

        return admin.messaging().sendToTopic('chat', payload);
    });
