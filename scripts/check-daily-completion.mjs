import admin from "firebase-admin";
import twilio from "twilio";
import webpush from "web-push";

const people = ["Pollard", "Harris", "Dan", "Biron", "Koster", "Kelly", "Billy", "Tyler"];

const {
  DAILYFIT_URL = "https://johnloringpollard.github.io/dailyfit/",
  FIREBASE_SERVICE_ACCOUNT_JSON,
  GITHUB_EVENT_NAME,
  SEND_COMPLETE_TEXT = "true",
  SMS_RECIPIENTS,
  TIME_ZONE = "America/New_York",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  TWILIO_MESSAGING_SERVICE_SID,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY = "BJ7PO8TgpP8R1bL_1ZMzUsWKF677IusRS90F7NjPXWF2FbtXjZxfRr5rir5KFmHLJbylXmH6lMlvKm_zESpX5Tk",
  VAPID_SUBJECT
} = process.env;

function requireEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function localParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function todayKey(timeZone) {
  const parts = localParts(timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localHour(timeZone) {
  return Number(localParts(timeZone).hour);
}

function parseRecipients(value) {
  return value
    .split(/[,\n]/)
    .map(number => number.trim())
    .filter(Boolean);
}

function isDone(entry) {
  return entry === true || Boolean(entry && entry.done === true);
}

function hasTwilioConfig() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && SMS_RECIPIENTS && (TWILIO_MESSAGING_SERVICE_SID || TWILIO_FROM_NUMBER));
}

function hasPushConfig() {
  return Boolean(VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY && VAPID_SUBJECT);
}

function initFirebase() {
  requireEnv("FIREBASE_SERVICE_ACCOUNT_JSON", FIREBASE_SERVICE_ACCOUNT_JSON);

  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function sendTexts(message) {
  const recipients = parseRecipients(SMS_RECIPIENTS);
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  await Promise.all(recipients.map(to => client.messages.create({
    body: message,
    to,
    ...(TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
      : { from: TWILIO_FROM_NUMBER })
  })));

  console.log(`Sent ${recipients.length} SMS notification${recipients.length === 1 ? "" : "s"}.`);
}

async function sendPushNotifications(payload) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const snapshot = await admin.firestore().collection("pushSubscriptions").get();
  const staleSubscriptionIds = [];

  const results = await Promise.allSettled(snapshot.docs.map(async subscriptionDoc => {
    const subscription = subscriptionDoc.data().subscription;

    if (!subscription) return;

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        staleSubscriptionIds.push(subscriptionDoc.id);
        return;
      }

      throw error;
    }
  }));

  await Promise.all(staleSubscriptionIds.map(id => (
    admin.firestore().doc(`pushSubscriptions/${id}`).delete()
  )));

  const failed = results.filter(result => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Failed to send ${failed.length} push notification${failed.length === 1 ? "" : "s"}.`);
  }

  console.log(`Sent ${snapshot.size - staleSubscriptionIds.length} push notification${snapshot.size === 1 ? "" : "s"}.`);
}

async function main() {
  if (GITHUB_EVENT_NAME === "schedule" && localHour(TIME_ZONE) !== 20) {
    console.log(`Skipping because it is not 8pm in ${TIME_ZONE}.`);
    return;
  }

  initFirebase();

  const key = todayKey(TIME_ZONE);
  const snapshot = await admin.firestore().doc(`checkins/${key}`).get();
  const checkins = snapshot.exists ? snapshot.data() : {};
  const missing = people.filter(person => !isDone(checkins[person]));

  if (missing.length === 0 && SEND_COMPLETE_TEXT !== "true") {
    console.log("Everyone is done; SEND_COMPLETE_TEXT is false, so no SMS sent.");
    return;
  }

  const message = missing.length === 0
    ? `Daily Fit: Everyone completed today's challenge. ${DAILYFIT_URL}`
    : `Daily Fit: Still missing today: ${missing.join(", ")}. ${DAILYFIT_URL}`;
  const pushPayload = {
    title: "Daily Fit",
    body: missing.length === 0
      ? "Everyone completed today's challenge."
      : `Still missing today: ${missing.join(", ")}`,
    url: DAILYFIT_URL
  };

  console.log(`Checked ${key}. ${missing.length === 0 ? "Everyone is done." : `Missing: ${missing.join(", ")}`}`);

  if (!hasTwilioConfig() && !hasPushConfig()) {
    throw new Error("Set Twilio SMS secrets, VAPID_PRIVATE_KEY, or both before running notifications.");
  }

  if (hasPushConfig()) {
    await sendPushNotifications(pushPayload);
  }

  if (hasTwilioConfig()) {
    await sendTexts(message);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
