import admin from "firebase-admin";
import twilio from "twilio";
import webpush from "web-push";

const people = ["Alex", "Alban", "Brian", "Cara", "Dave", "Jad", "John", "Kevin", "Lindsay", "Lloyd", "Marshall", "Ron"];

const {
  DAILYFIT_URL = "https://johnloringpollard.github.io/hp-tracker/",
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
  VAPID_PUBLIC_KEY = "BI1EhQtI0yo7ZvCMtAt9QGANGxtYRJ_fHpC0iaGcHgZUGQ3m0OBAd7yHQX7TziCgxIpTZlcocENSxWmi8yWOnns",
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

function getDurationSeconds(entry) {
  if (!entry || typeof entry !== "object") return null;

  const seconds = Number(entry.seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);

  const legacyMinutes = Number(entry.minutes);
  if (Number.isFinite(legacyMinutes) && legacyMinutes > 0) {
    return Math.round(legacyMinutes * 60);
  }

  return null;
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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

async function getReigningChampion(key) {
  const snapshot = await admin.firestore().collection("checkins").get();
  let champion = null;

  snapshot.forEach(dayDoc => {
    if (dayDoc.id > key) return;

    const checkins = dayDoc.data();

    people.forEach(person => {
      if (!isDone(checkins[person])) return;

      const seconds = getDurationSeconds(checkins[person]);
      if (!seconds) return;

      if (
        !champion
        || seconds < champion.seconds
        || (seconds === champion.seconds && person.localeCompare(champion.person) < 0)
      ) {
        champion = { person, seconds };
      }
    });
  });

  return champion;
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
  const champion = await getReigningChampion(key);
  const championText = champion
    ? ` The reigning champion is ${champion.person} with ${formatDuration(champion.seconds)}.`
    : "";

  if (missing.length === 0 && SEND_COMPLETE_TEXT !== "true") {
    console.log("Everyone is done; SEND_COMPLETE_TEXT is false, so no SMS sent.");
    return;
  }

  const message = missing.length === 0
    ? `Daily Fit: Everyone completed today's challenge.${championText} ${DAILYFIT_URL}`
    : `Daily Fit: Still missing today: ${missing.join(", ")}.${championText} ${DAILYFIT_URL}`;
  const pushPayload = {
    title: "Daily Fit",
    body: missing.length === 0
      ? `Everyone completed today's challenge.${championText}`
      : `Still missing today: ${missing.join(", ")}.${championText}`,
    url: DAILYFIT_URL
  };

  console.log(`Checked ${key}. ${missing.length === 0 ? "Everyone is done." : `Missing: ${missing.join(", ")}`}`);
  if (champion) {
    console.log(`Reigning champion: ${champion.person} with ${formatDuration(champion.seconds)}.`);
  }

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
