'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- tiny .env loader (no extra dependency) ---------- */
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  text.split(/\r?\n/).forEach((line) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) return;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  });
}
loadEnv(path.join(__dirname, '.env'));

const express = require('express');
const { createAI } = require('./ai');
const { hashPassword, checkPassword } = require('./password');
const { sha } = require('./store');

const SESSION_MS = 14 * 24 * 3600 * 1000;
const COOKIE = 'examline_s';
const EXAM_ID = /^[a-f0-9]{6,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const newId = () => crypto.randomBytes(9).toString('hex');
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const DUMMY_HASH = hashPassword('not-a-real-password');

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    /* A stray "%" in any cookie would make decodeURIComponent throw, and that would
       turn every request into a 500 until the browser was cleared. Keep the raw value. */
    const raw = p.slice(i + 1).trim();
    let v;
    try { v = decodeURIComponent(raw); } catch (e) { v = raw; }
    out[p.slice(0, i).trim()] = v;
  });
  return out;
}

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, a] of hits) { const f = a.filter((t) => now - t < windowMs); if (f.length) hits.set(k, f); else hits.delete(k); }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const a = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (a.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    a.push(now);
    hits.set(req.ip, a);
    next();
  };
}

function cleanQuestions(arr) {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 500) return null;
  const out = [];
  for (const x of arr) {
    if (!x || typeof x.q !== 'string' || !Array.isArray(x.options)) return null;
    const q = x.q.trim();
    const options = x.options.map((o) => String(o == null ? '' : o).trim());
    if (!q || q.length > 3000 || options.length < 2 || options.length > 6) return null;
    if (options.some((o) => !o || o.length > 600)) return null;
    if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer >= options.length) return null;
    out.push({ q, options, answer: x.answer });
  }
  return out;
}

/* A tiny time-boxed cache. It keeps Firestore reads (and the free quota) low. */
function ttlCache(ms) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (Date.now() - e.at > ms) { m.delete(k); return undefined; } return e.v; },
    set(k, v) { if (m.size > 500) m.delete(m.keys().next().value); m.set(k, { at: Date.now(), v }); },
    del(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

async function createApp(store) {
  const TEACHER_CODE = process.env.TEACHER_SIGNUP_CODE || '';
  if (!TEACHER_CODE || TEACHER_CODE === 'change-me') {
    throw new Error('Set TEACHER_SIGNUP_CODE in your .env file (copy .env.example to .env). Teachers need this secret code to create an account.');
  }

  /* settings are kept in memory and written through to Firestore */
  const settings = await store.loadSettings();
  const getSetting = (k) => (k in settings ? settings[k] : null);
  const setSetting = async (k, v) => { await store.setSetting(k, v); settings[k] = String(v); };
  const delSetting = async (k) => { await store.delSetting(k); delete settings[k]; };
  const ai = createAI(getSetting);

  const sessionCache = ttlCache(30 * 1000);
  const examCache = ttlCache(60 * 1000);
  const listCache = ttlCache(30 * 1000);
  const resultsCache = ttlCache(60 * 1000);
  const explainCache = ttlCache(6 * 3600 * 1000);

  store.purgeExpiredSessions(Date.now()).catch((e) => console.error('Session cleanup failed:', e.message));
  setInterval(() => store.purgeExpiredSessions(Date.now()).catch(() => {}), 3600 * 1000).unref();

  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(sha(token), userId, Date.now() + SESSION_MS);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/' });
  }

  async function currentUser(req) {
    const t = parseCookies(req)[COOKIE];
    if (!t) return null;
    const key = sha(t);
    const cached = sessionCache.get(key);
    if (cached) return cached;
    const s = await store.getSession(key);
    if (!s || s.expiresAt <= Date.now()) return null;
    const u = await store.getUserById(s.userId);
    if (!u) return null;
    const user = { id: u.id, role: u.role, name: u.name, email: u.email };
    sessionCache.set(key, user);
    return user;
  }

  const needLogin = async (req, res, next) => {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'login_required' });
    req.user = u;
    next();
  };
  const needRole = (role) => async (req, res, next) => {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'login_required' });
    if (u.role !== role) return res.status(403).json({ error: 'wrong_role' });
    req.user = u;
    next();
  };
  const needTeacher = needRole('teacher');
  const needStudent = needRole('student');

  async function getExam(id) {
    if (!EXAM_ID.test(id)) return null;
    let e = examCache.get(id);
    if (e === undefined) { e = await store.getExam(id); if (e) examCache.set(id, e); }
    return e || null;
  }

  function aiFail(res, e) {
    const map = {
      ai_not_configured: [503, 'ai_not_configured'], ai_auth: [502, 'ai_auth'], ai_busy: [429, 'ai_busy'],
      ai_bad_json: [502, 'ai_bad_json'], ai_unreachable: [502, 'ai_unreachable'],
    };
    const hit = map[e && e.code];
    if (!hit) console.error('AI failure:', e && e.message);
    const [status, code] = hit || [502, 'ai_error'];
    return res.status(status).json({ error: code });
  }

  /* ---------- app ---------- */
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.headers['content-type'] || '').startsWith('application/json')) {
      return res.status(415).json({ error: 'json_required' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  const authLimiter = limiter(15, 15 * 60 * 1000);
  const explainLimiter = limiter(40, 10 * 60 * 1000);

  /* ----- accounts ----- */
  app.post('/api/auth/signup', authLimiter, async (req, res) => {
    const b = req.body || {};
    const role = b.role === 'teacher' ? 'teacher' : b.role === 'student' ? 'student' : null;
    const name = String(b.name || '').trim().slice(0, 60);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!role) return res.status(400).json({ error: 'invalid_role' });
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!EMAIL.test(email) || email.length > 120) return res.status(400).json({ error: 'invalid_email' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'weak_password' });
    if (role === 'teacher' && !safeEqual(b.teacherCode || '', TEACHER_CODE)) return res.status(403).json({ error: 'bad_teacher_code' });
    const id = newId();
    try {
      await store.createUser({ id, role, name, email, pass: hashPassword(password), createdAt: Date.now() });
    } catch (e) {
      if (e && e.code === 'email_taken') return res.status(409).json({ error: 'email_taken' });
      throw e;
    }
    await startSession(req, res, id);
    res.json({ user: { id, role, name, email } });
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const row = await store.getUserByEmail(email);
    const ok = checkPassword(password, row ? row.pass : DUMMY_HASH);
    if (!row || !ok) return res.status(401).json({ error: 'bad_credentials' });
    await startSession(req, res, row.id);
    res.json({ user: { id: row.id, role: row.role, name: row.name, email: row.email } });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const t = parseCookies(req)[COOKIE];
    if (t) { sessionCache.del(sha(t)); await store.deleteSession(sha(t)); }
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    const user = await currentUser(req);
    res.json({ user, aiConfigured: user && user.role === 'teacher' ? ai.configured() : undefined });
  });

  /* ----- exams (any logged-in user can list) ----- */
  app.get('/api/exams', needLogin, async (req, res) => {
    let list = listCache.get('all');
    if (!list) { list = await store.listExams(); listCache.set('all', list); }
    res.json({ exams: list });
  });

  /* ----- student: take an exam (answers are NOT sent) ----- */
  app.get('/api/exams/:id', needStudent, async (req, res) => {
    const row = await getExam(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ exam: { id: row.id, title: row.title, questions: row.questions.map((q) => ({ q: q.q, options: q.options })) } });
  });

  app.post('/api/exams/:id/submit', needStudent, async (req, res) => {
    const row = await getExam(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const qs = row.questions;
    const given = Array.isArray(req.body && req.body.answers) ? req.body.answers : [];
    const answers = qs.map((q, i) => (Number.isInteger(given[i]) && given[i] >= 0 && given[i] < q.options.length ? given[i] : -1));
    let score = 0;
    answers.forEach((a, i) => { if (a === qs[i].answer) score++; });
    const at = Date.now();
    const tries = await store.saveResult({ examId: row.id, userId: req.user.id, name: req.user.name, email: req.user.email, score, total: qs.length, answers, at });
    resultsCache.del(row.id);
    res.json({ exam: { id: row.id, title: row.title, questions: qs }, entry: { score, total: qs.length, at, tries, answers } });
  });

  app.get('/api/results/mine', needStudent, async (req, res) => {
    const out = {};
    (await store.listResultsByUser(req.user.id)).forEach((r) => { out[r.examId] = { score: r.score, total: r.total, tries: r.tries, at: r.submittedAt }; });
    res.json({ results: out });
  });

  app.get('/api/exams/:id/review', needStudent, async (req, res) => {
    const row = await getExam(req.params.id);
    const r = row && await store.getResult(row.id, req.user.id);
    if (!row || !r) return res.status(404).json({ error: 'not_found' });
    res.json({ exam: { id: row.id, title: row.title, questions: row.questions }, entry: { score: r.score, total: r.total, at: r.submittedAt, tries: r.tries, answers: r.answers } });
  });

  /* ----- student: Explanation chat (only after submitting that exam) ----- */
  app.post('/api/exams/:id/explain', needStudent, explainLimiter, async (req, res) => {
    const row = await getExam(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!(await store.getResult(row.id, req.user.id))) return res.status(403).json({ error: 'submit_first' });
    const qs = row.questions;
    const b = req.body || {};
    const qi = b.qi;
    if (!Number.isInteger(qi) || qi < 0 || qi >= qs.length) return res.status(400).json({ error: 'bad_request' });
    const chosen = Number.isInteger(b.chosen) && b.chosen >= 0 && b.chosen < qs[qi].options.length ? b.chosen : -1;
    const msgs = Array.isArray(b.messages) ? b.messages : [];
    if (msgs.length < 1 || msgs.length > 12 || !msgs[msgs.length - 1] || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });
    const turns = [];
    for (const m of msgs) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 3000) {
        return res.status(400).json({ error: 'bad_request' });
      }
      turns.push({ role: m.role, content: m.content });
    }
    const cacheKey = msgs.length === 1 ? [row.id, qi, chosen].join(':') : null;
    if (cacheKey) { const hit = explainCache.get(cacheKey); if (hit) return res.json({ text: hit }); }
    try {
      const text = await ai.explain(qs[qi], chosen, turns);
      if (cacheKey) explainCache.set(cacheKey, text);
      res.json({ text });
    } catch (e) { aiFail(res, e); }
  });

  /* ----- teacher ----- */
  app.get('/api/teacher/exams', needTeacher, async (req, res) => {
    const list = await store.listExams();
    const withCounts = await Promise.all(list.map(async (e) => Object.assign({}, e, { submissions: await store.countSubmissions(e.id) })));
    res.json({ exams: withCounts });
  });

  app.delete('/api/teacher/exams/:id', needTeacher, async (req, res) => {
    if (!EXAM_ID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    await store.deleteExam(req.params.id);
    examCache.del(req.params.id); resultsCache.del(req.params.id); listCache.clear(); explainCache.clear();
    res.json({ ok: true });
  });

  app.post('/api/teacher/extract', needTeacher, async (req, res) => {
    const b = req.body || {};
    const chunk = typeof b.chunk === 'string' ? b.chunk : '';
    if (chunk.length < 20 || chunk.length > 40000) return res.status(400).json({ error: 'bad_request' });
    try {
      res.json({ questions: await ai.extractQuestions(chunk, String(b.key || '').slice(0, 5000), String(b.autoKey || '').slice(0, 8000)) });
    } catch (e) { aiFail(res, e); }
  });

  app.post('/api/teacher/exams', needTeacher, async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120);
    const questions = cleanQuestions(b.questions);
    if (!title) return res.status(400).json({ error: 'title_required' });
    if (!questions) return res.status(400).json({ error: 'bad_questions' });
    if (JSON.stringify(questions).length > 900000) return res.status(413).json({ error: 'too_large' });
    const id = newId();
    await store.createExam({ id, title, source: String(b.source || '').slice(0, 200), createdBy: req.user.id, createdAt: Date.now(), questions });
    listCache.clear();
    res.json({ id });
  });

  app.get('/api/teacher/exams/:id/results', needTeacher, async (req, res) => {
    const row = await getExam(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    let rows = resultsCache.get(row.id);
    if (!rows) {
      rows = (await store.listResultsByExam(row.id)).map((r) => ({
        userId: r.userId, name: r.name, email: r.email, score: r.score, total: r.total, tries: r.tries, at: r.submittedAt, answers: r.answers,
      }));
      resultsCache.set(row.id, rows);
    }
    res.json({ exam: { id: row.id, title: row.title, questions: row.questions }, rows });
  });

  /* ----- teacher: AI settings ----- */
  const aiSummary = () => {
    const c = ai.config();
    return { configured: !!c.key, source: c.source, keyHint: c.key ? '…' + c.key.slice(-4) : '', base: c.base, model: c.model };
  };
  app.get('/api/teacher/ai', needTeacher, (req, res) => res.json(aiSummary()));

  app.put('/api/teacher/ai', needTeacher, async (req, res) => {
    const b = req.body || {};
    if (typeof b.base === 'string' && b.base.trim()) {
      let u;
      try { u = new URL(b.base.trim()); } catch (e) { return res.status(400).json({ error: 'bad_url' }); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return res.status(400).json({ error: 'bad_url' });
      await setSetting('ai_base', b.base.trim().replace(/\/+$/, ''));
    }
    if (typeof b.model === 'string' && b.model.trim()) await setSetting('ai_model', b.model.trim().slice(0, 100));
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) await setSetting('ai_key', b.apiKey.trim().slice(0, 300));
    if (b.clearKey === true) await delSetting('ai_key');
    res.json(aiSummary());
  });

  app.post('/api/teacher/ai/test', needTeacher, async (req, res) => {
    try {
      const reply = await ai.chat([{ role: 'user', content: 'Reply with the single word: ok' }], { temperature: 0, timeoutMs: 30000 });
      res.json({ ok: true, reply: reply.trim().slice(0, 40) });
    } catch (e) { aiFail(res, e); }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  /* ----- static client ----- */
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.locals.ai = ai;
  return app;
}

async function main() {
  const { createFirestoreStore } = require('./store');
  let app;
  try {
    app = await createApp(createFirestoreStore(process.env));
  } catch (e) {
    console.error('\nExamline cannot start yet.\n' + e.message + '\n');
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log('Examline is running on http://localhost:' + port);
    if (!app.locals.ai.configured()) console.log('Note: no AI key yet. Log in as a teacher and open Settings to add one (or set AI_API_KEY in .env).');
  });
}

if (require.main === module) main();
module.exports = { createApp };
