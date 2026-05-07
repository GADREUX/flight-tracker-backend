import admin from "firebase-admin"

let warnedMissingFirebaseConfig = false

function getMessaging() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")

  if (!projectId || !clientEmail || !privateKey) {
    if (!warnedMissingFirebaseConfig) {
      console.warn(
        "[FCM] Firebase credentials are missing. Push notifications are disabled until FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set."
      )
      warnedMissingFirebaseConfig = true
    }
    return null
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    })
  }

  return admin.messaging()
}

interface PushPayload {
  token: string
  title: string
  body: string
  data?: Record<string, string>
}

export async function sendPushNotification(payload: PushPayload) {
  try {
    const messaging = getMessaging()
    if (!messaging) {
      return { success: false, error: "Firebase is not configured" }
    }

    const message: admin.messaging.Message = {
      token: payload.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ?? {},
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: "https://flighttracker.app/icons/icon128.png",
          requireInteraction: true,
          actions: [
            { action: "view", title: "Ver voo" },
            { action: "dismiss", title: "Dispensar" },
          ],
        },
        fcmOptions: {
          link: "https://flighttracker.app/dashboard",
        },
      },
      android: {
        priority: "high",
      },
    }

    const response = await messaging.send(message)
    console.log(`[FCM] Notification sent - message ID: ${response}`)
    return { success: true, messageId: response }
  } catch (err: any) {
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
    ) {
      console.warn(`[FCM] Invalid token - cleaning up: ${payload.token.slice(0, 20)}...`)
      await invalidateToken(payload.token)
    } else {
      console.error("[FCM] Send failed:", err)
    }
    return { success: false, error: err.message }
  }
}

async function invalidateToken(token: string) {
  const { prisma } = await import("../db/prisma")
  await prisma.user.updateMany({
    where: { fcmToken: token },
    data: { fcmToken: null },
  })
}

export async function sendBatchNotification(
  tokens: string[],
  title: string,
  body: string
) {
  if (tokens.length === 0) return

  const messaging = getMessaging()
  if (!messaging) {
    return { success: false, error: "Firebase is not configured" }
  }

  const messages: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title, body },
    webpush: {
      notification: { title, body, icon: "https://flighttracker.app/icons/icon128.png" },
    },
  }

  const response = await messaging.sendEachForMulticast(messages)
  console.log(`[FCM] Batch: ${response.successCount} sent, ${response.failureCount} failed`)
  return response
}
