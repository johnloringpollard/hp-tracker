# Daily Fit Challenge

A simple shared daily fitness check-in app.

## Deploy

The app is hosted by GitHub Pages at:

https://johnloringpollard.github.io/hp-tracker/

Check-ins and browser push subscriptions are stored in the Firebase project
selected by `.firebaserc`. Deploy the Firestore rules after signing in:

```sh
npx firebase-tools deploy --only firestore:rules
```

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

The public VAPID key is safe to commit and must match in `index.html`, the
notification script, and the workflow. Keep the private key only in the
`VAPID_PRIVATE_KEY` repository secret.

The app intentionally permits public check-in reads and writes because it has
no sign-in screen. Use Firebase Authentication and stricter rules before
storing sensitive or private data.
