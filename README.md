# Examline

Teachers upload an MCQ PDF, students sit it online and see their mark and mistakes, and every question has an **Explanation** button that opens an AI chat. Teachers see each student's mark and mistakes.

Runs on its own: Node.js server + **Firebase Firestore** database + any OpenAI-compatible AI API (default: Google Gemini free tier). Sign-up / log-in for students and teachers is built in.

## 1. Install
Requires Node 20+.
```
npm install
cp .env.example .env
```

## 2. Firebase (database)
1. Go to https://console.firebase.google.com, create a project.
2. Build > **Firestore Database** > Create database (production mode).
3. Project settings > **Service accounts** > **Generate new private key**. Save the file as `firebase-service-account.json` in this folder (it is git-ignored; never share it).
4. Optional but recommended: Firestore > Rules, paste the contents of `firestore.rules` and publish. (The server uses the Admin SDK, so it still works; browsers get no direct access.)

## 3. AI key (free)
Get a free key at https://aistudio.google.com/apikey and put it in `.env` as `AI_API_KEY`, **or** leave it empty and paste it later in the app: log in as a teacher > **Settings**. Other OpenAI-compatible providers (Groq, etc.) work too: change base URL and model there.

## 4. Teacher code
Set `TEACHER_SIGNUP_CODE` in `.env` to a secret of your own. Teachers need it to create an account; students don't.

## 5. Run
```
npm start
```
Open http://localhost:3000, sign up as a teacher, upload a PDF, review the extracted questions, publish. Students sign up and take the exam.

Forgot a password (no email recovery yet):
```
npm run reset-password -- someone@example.com NewPassword123
```

## Deploying
Any Node host (Render, Railway, Fly, a VPS) or the included `Dockerfile`. Set the `.env` values as environment variables, using `FIREBASE_SERVICE_ACCOUNT_JSON` (the JSON on one line) instead of a file, and set `TRUST_PROXY=1` behind an HTTPS proxy.

## Notes and limits
- Tested against an in-memory stand-in for Firestore and a mock AI server, **not** against live Firebase or live Gemini. Expect to verify the first real run; the default model name `gemini-3.8-flash` may need changing in Settings.
- Free-tier Gemini prompts may be used by Google to improve its products; don't upload sensitive material.
- Firestore's free quota is generous but finite; the server caches reads to conserve it.
- Accounts are stored in Firestore by this app (not Firebase Authentication). Passwords are scrypt-hashed.
- Students never receive correct answers until they submit; grading happens on the server.
