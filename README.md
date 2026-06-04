# Daily Fit Challenge

A simple shared daily fitness check-in app.

## Deploy

This repo is designed to run as a static GitHub Pages site. Check-ins are saved to Firebase Firestore.

## Daily SMS check

GitHub Actions runs a daily Firestore check at 8pm America/New_York and sends the result by SMS through Twilio.

Add these repository secrets in GitHub:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `SMS_RECIPIENTS` as comma-separated E.164 numbers, such as `+15551234567,+15557654321`
