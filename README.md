# Daily Fit Challenge

A simple shared daily fitness check-in app.

## Deploy

This repo is designed to run as a static GitHub Pages site. Check-ins are saved to Firebase Firestore.

## Daily notification check

GitHub Actions runs a daily Firestore check at 8pm America/New_York and sends the result with Web Push and optionally SMS through Twilio.

Add these repository secrets in GitHub:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`, such as `mailto:you@example.com`

Optional Twilio SMS secrets:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `SMS_RECIPIENTS` as comma-separated E.164 numbers, such as `+15551234567,+15557654321`

The app stores browser push subscriptions in Firestore at `pushSubscriptions/{subscriptionId}`. Add Firestore rules for that collection:

```js
match /pushSubscriptions/{subscriptionId} {
  allow read: if false;
  allow create, update: if request.resource.data.keys().hasOnly([
    'endpoint', 'subscription', 'updatedAt', 'userAgent'
  ])
  && request.resource.data.endpoint is string
  && request.resource.data.subscription is map;
  allow delete: if true;
}
```
