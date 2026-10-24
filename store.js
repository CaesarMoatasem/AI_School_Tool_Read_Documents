'use strict';
/*
 * Examline data layer, backed by Firebase Firestore (through the Firebase Admin SDK).
 * Only the server talks to Firestore. Browsers never get database credentials.
 *
 * Collections
 *   settings/{key}            { value }
 *   users/{userId}            { role, name, email, pass, createdAt }
 *   emails/{sha256(email)}    { userId }                  (guarantees one account per email)
 *   sessions/{sha256(token)}  { userId, expiresAt }
 *   exams/{examId}            { title, source, createdBy, createdAt, count, questions: [{ q, options, answer }] }
 *   results/{examId}_{userId} { examId, userId, name, email, score, total, answers, tries, submittedAt }
 *
 * Every query below filters on a single field, so Firestore needs no composite indexes.
 */
const fs = require('fs');
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function connectFirestore(env) {
  const { initializeApp, cert, applicationDefault, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    let opts;
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      opts = { credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)) };
    } else if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      let text;
      try { text = fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'); } catch (e) {
        throw new Error('The Firebase key file was not found at ' + env.FIREBASE_SERVICE_ACCOUNT_PATH
          + '\nFirebase console > Project settings > Service accounts > Generate new private key,'
          + '\nthen save the downloaded file to that path. See the README, step 2.');
      }
      try { opts = { credential: cert(JSON.parse(text)) }; } catch (e) {
        throw new Error('The Firebase key file at ' + env.FIREBASE_SERVICE_ACCOUNT_PATH
          + ' is not valid JSON. Download it again from the Firebase console. See the README, step 2.');
      }
    } else if (env.FIRESTORE_EMULATOR_HOST) {
      opts = { projectId: env.FIREBASE_PROJECT_ID || 'demo-examline' };
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
      opts = { credential: applicationDefault() };
    } else {
      throw new Error('Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (or FIREBASE_SERVICE_ACCOUNT_JSON) in .env. See the README, step 2.');
    }
    initializeApp(opts);
  }
  const db = getFirestore();
  try { db.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* already configured */ }
  return db;
}

function createFirestoreStore(env, injectedDb) {
  const db = injectedDb || connectFirestore(env || process.env);
  const col = (name) => db.collection(name);

  const taken = () => { const e = new Error('email_taken'); e.code = 'email_taken'; return e; };

  /* ----- settings ----- */
  async function loadSettings() {
    const snap = await col('settings').get();
    const out = {};
    snap.docs.forEach((d) => { out[d.id] = d.data().value; });
    return out;
  }
  const setSetting = (k, v) => col('settings').doc(k).set({ value: String(v) });
  const delSetting = (k) => col('settings').doc(k).delete();

  /* ----- users ----- */
  async function createUser(u) {
    const emailRef = col('emails').doc(sha(u.email));
    const userRef = col('users').doc(u.id);
    await db.runTransaction(async (t) => {
      const existing = await t.get(emailRef);
      if (existing.exists) throw taken();
      t.set(emailRef, { userId: u.id });
      t.set(userRef, { role: u.role, name: u.name, email: u.email, pass: u.pass, createdAt: u.createdAt });
    });
  }
  async function getUserByEmail(email) {
    const snap = await col('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return Object.assign({ id: d.id }, d.data());
  }
  async function getUserById(id) {
    const d = await col('users').doc(id).get();
    return d.exists ? Object.assign({ id: d.id }, d.data()) : null;
  }
  const setUserPassword = (id, pass) => col('users').doc(id).update({ pass });

  /* ----- sessions ----- */
  const createSession = (tokenHash, userId, expiresAt) => col('sessions').doc(tokenHash).set({ userId, expiresAt });
  async function getSession(tokenHash) {
    const d = await col('sessions').doc(tokenHash).get();
    return d.exists ? d.data() : null;
  }
  const deleteSession = (tokenHash) => col('sessions').doc(tokenHash).delete();
  async function deleteWhere(query) {
    for (;;) {
      const snap = await query.limit(400).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  const deleteSessionsForUser = (userId) => deleteWhere(col('sessions').where('userId', '==', userId));
  const purgeExpiredSessions = (now) => deleteWhere(col('sessions').where('expiresAt', '<=', now));

  /* ----- exams ----- */
  const createExam = (e) => col('exams').doc(e.id).set({
    title: e.title, source: e.source, createdBy: e.createdBy, createdAt: e.createdAt,
    count: e.questions.length, questions: e.questions,
  });
  async function getExam(id) {
    const d = await col('exams').doc(id).get();
    return d.exists ? Object.assign({ id: d.id }, d.data()) : null;
  }
  async function listExams() {
    const snap = await col('exams').orderBy('createdAt', 'desc').select('title', 'createdAt', 'count').get();
    return snap.docs.map((d) => ({ id: d.id, title: d.get('title'), createdAt: d.get('createdAt'), count: d.get('count') }));
  }
  async function countSubmissions(examId) {
    const r = await col('results').where('examId', '==', examId).count().get();
    return r.data().count;
  }
  async function deleteExam(id) {
    await col('exams').doc(id).delete();
    await deleteWhere(col('results').where('examId', '==', id));
  }

  /* ----- results ----- */
  const resultId = (examId, userId) => examId + '_' + userId;
  async function saveResult(r) {
    const ref = col('results').doc(resultId(r.examId, r.userId));
    let tries = 1;
    await db.runTransaction(async (t) => {
      const cur = await t.get(ref);
      tries = (cur.exists ? cur.data().tries || 0 : 0) + 1;
      t.set(ref, {
        examId: r.examId, userId: r.userId, name: r.name, email: r.email,
        score: r.score, total: r.total, answers: r.answers, tries, submittedAt: r.at,
      });
    });
    return tries;
  }
  async function getResult(examId, userId) {
    const d = await col('results').doc(resultId(examId, userId)).get();
    return d.exists ? d.data() : null;
  }
  async function listResultsByUser(userId) {
    const snap = await col('results').where('userId', '==', userId).get();
    return snap.docs.map((d) => d.data());
  }
  async function listResultsByExam(examId) {
    const snap = await col('results').where('examId', '==', examId).get();
    return snap.docs.map((d) => d.data());
  }

  return {
    loadSettings, setSetting, delSetting,
    createUser, getUserByEmail, getUserById, setUserPassword,
    createSession, getSession, deleteSession, deleteSessionsForUser, purgeExpiredSessions,
    createExam, getExam, listExams, countSubmissions, deleteExam,
    saveResult, getResult, listResultsByUser, listResultsByExam,
  };
}

module.exports = { createFirestoreStore, sha };
