(function () {
'use strict';
var L = 'ABCDEF';
var $app = document.getElementById('app'), $top = document.getElementById('top'), $toast = document.getElementById('toast'), $chat = document.getElementById('chat-root');

var ST = {
  user: null, aiOk: true, offline: false,
  screen: 'landing', params: {}, timer: null,
  quiz: null, last: null, draft: null,
  authForm: { role: 'student', name: '', email: '', password: '', code: '' }
};

/* ---------- helpers ---------- */
function h(tag, props) {
  var el = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
  }
  for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function add(el, kid) {
  if (kid == null || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
  el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
}
var ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  file: '<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>', send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>', plus: '<path d="M12 5v14M5 12h14"/>'
};
function icon(n, size) {
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 18); s.setAttribute('height', size || 18);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[n];
  return s;
}
function logo() {
  var s = document.createElement('span');
  s.innerHTML = '<svg viewBox="0 0 34 24" width="34" height="24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="6" cy="12" r="4.5"/><circle cx="17" cy="12" r="4.5" fill="currentColor"/><circle cx="28" cy="12" r="4.5"/></svg>';
  return s.firstChild;
}
var toastT;
function toast(msg) {
  $toast.textContent = msg; $toast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { $toast.classList.remove('show'); }, 3600);
}
function dateFmt(ts) { try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } }
function pct(s, t) { return t ? Math.round(100 * s / t) : 0; }
function band(p) { return p >= 75 ? 'good' : p >= 50 ? 'warn' : 'bad'; }
function inline(str) {
  var f = document.createDocumentFragment();
  str.split(/(\*\*[^*]+\*\*)/g).forEach(function (p) {
    if (!p) return;
    if (/^\*\*[^*]+\*\*$/.test(p)) f.append(h('strong', null, p.slice(2, -2))); else f.append(p);
  });
  return f;
}
function fmt(text) {
  var f = document.createDocumentFragment(), list = null;
  text.split('\n').forEach(function (line) {
    var t = line.trim();
    if (!t) { list = null; return; }
    var m = t.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = h('ul'); f.append(list); } list.append(h('li', { dir: 'auto' }, inline(m[2]))); }
    else { list = null; f.append(h('p', { dir: 'auto' }, inline(t.replace(/^#+\s*/, '')))); }
  });
  return f;
}

/* ---------- server calls ---------- */
function api(method, url, body, signal) {
  var opt = { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) opt.body = JSON.stringify(body);
  if (signal) opt.signal = signal;
  return fetch(url, opt).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || ('http_' + r.status)); e.code = j.error || ('http_' + r.status); e.status = r.status; throw e; }
      return j;
    });
  }, function (e) {
    if (e && e.name === 'AbortError') throw e;
    var er = new Error('network'); er.code = 'network'; throw er;
  });
}
var ERR = {
  network: 'Cannot reach the server. Check your connection and try again.',
  bad_credentials: 'Wrong email or password.',
  email_taken: 'An account with this email already exists. Log in instead.',
  invalid_email: 'Enter a valid email address.',
  weak_password: 'Use a password of at least 8 characters.',
  name_required: 'Enter your name.',
  bad_teacher_code: 'That teacher code is not correct. Ask whoever runs this site for it.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  login_required: 'Your session ended. Log in again.',
  wrong_role: 'This page is not available for your account.',
  submit_first: 'Submit the exam first to see explanations.',
  ai_not_configured: 'No AI key is set yet. Open Settings and paste an API key.',
  ai_auth: 'The AI provider rejected the API key. Check it in Settings.',
  ai_busy: 'The AI service is busy or its free limit was reached. Wait a minute and try again.',
  ai_bad_json: 'The AI reply could not be read. Try again, or split the PDF into smaller files.',
  ai_unreachable: 'The AI service could not be reached. Check the AI address in Settings.',
  ai_error: 'The AI service failed. Try again in a moment.',
  bad_url: 'That address is not valid. It must start with https://',
  title_required: 'Give the exam a title.',
  bad_questions: 'Some questions are incomplete. Each needs text, at least two options and a correct answer.',
  too_large: 'This exam is too large. Split the PDF into smaller exams.'
};
function errText(code) { return ERR[code] || 'Something went wrong. Try again.'; }
function fail(e) {
  if (e && e.code === 'login_required' && ST.user) {
    ST.user = null; toast('Your session ended. Please log in again.'); go('auth', { mode: 'login' }); return true;
  }
  return false;
}

/* ---------- routing ---------- */
var SCREENS = {};
function leave() {
  if (ST.screen === 'sQuiz') document.removeEventListener('keydown', quizKeys);
  if (ST.screen === 'tNew' && ST.draft) { if (ST.draft.ctl) ST.draft.ctl.abort(); ST.draft = null; }
  if (ST.timer) { clearInterval(ST.timer); ST.timer = null; }
  closeChat();
}
function go(screen, params) {
  leave(); ST.screen = screen; ST.params = params || {};
  renderTop(); $app.replaceChildren(SCREENS[screen]());
  window.scrollTo(0, 0);
}
function home() { go(!ST.user ? 'landing' : ST.user.role === 'teacher' ? 'tHome' : 'sHome'); }
function logout() {
  api('POST', '/api/auth/logout', {}).catch(function () {}).then(function () { ST.user = null; ST.quiz = null; ST.last = null; go('landing'); });
}
function renderTop() {
  var brand = h('button', { class: 'brand', type: 'button', 'aria-label': 'Examline home', onclick: function () { if (ST.screen !== 'sQuiz') home(); } }, logo(), h('span', null, 'Examline'));
  var right = h('div', { class: 'top-r' });
  if (ST.user && ST.screen !== 'sQuiz') {
    right.append(h('span', { class: 'who-name', dir: 'auto' }, ST.user.name),
      h('span', { class: 'chip' }, ST.user.role === 'teacher' ? 'Teacher' : 'Student'));
    if (ST.user.role === 'teacher') right.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: function () { go('tSettings'); } }, 'Settings'));
    right.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: logout }, 'Log out'));
  } else if (!ST.user && ST.screen === 'landing') {
    right.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: function () { go('auth', { mode: 'login' }); } }, 'Log in'));
  }
  $top.replaceChildren(brand, right);
}
function enter() {
  if (ST.user.role === 'teacher') {
    api('GET', '/api/me').then(function (r) { ST.aiOk = r.aiConfigured !== false; }).catch(function () {}).then(function () { go('tHome'); });
  } else go('sHome');
}

/* ---------- landing ---------- */
SCREENS.landing = function () {
  var answers = [2, 0, 3, 1];
  var sheet = h('div', { class: 'sheet', 'aria-hidden': 'true' }, answers.map(function (a, r) {
    return h('div', { class: 'sheet-row' }, h('span', { class: 'sheet-n' }, String(r + 1)), [0, 1, 2, 3].map(function (k) { return h('span', { class: 'sheet-b' + (k === a ? ' on' : '') }, L[k]); }));
  }));
  return h('div', { class: 'wrap', style: 'gap:24px' },
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Upload an MCQ PDF. Students sit it online.'),
        h('p', { class: 'lede' }, 'Questions are read straight from the PDF, answered on screen and marked on submission. When a student gets one wrong, an AI tutor explains why the right answer is right.'),
        h('div', { class: 'cta', style: 'margin-top:22px' },
          h('button', { class: 'btn primary', type: 'button', onclick: function () { go('auth', { mode: 'signup' }); } }, 'Create an account'),
          h('button', { class: 'btn', type: 'button', onclick: function () { go('auth', { mode: 'login' }); } }, 'Log in'))),
      sheet),
    ST.offline ? h('div', { class: 'banner warn' }, ERR.network) : null,
    h('div', { class: 'info' },
      h('div', { class: 'card' }, h('p', { class: 'eyebrow' }, 'Students'), h('h2', null, 'Sit the exam, learn from mistakes'), h('p', { class: 'meta' }, 'Answer on screen, get your mark straight away, and open an explanation for any question.')),
      h('div', { class: 'card' }, h('p', { class: 'eyebrow' }, 'Teachers'), h('h2', null, 'Upload once, see every mark'), h('p', { class: 'meta' }, 'Turn a PDF into an exam, then see each student’s mark and exactly which questions they missed.'))));
};

/* ---------- sign up / log in ---------- */
SCREENS.auth = function () {
  var mode = ST.params.mode === 'signup' ? 'signup' : 'login', F = ST.authForm;
  var err = h('div', { class: 'banner bad', hidden: true, role: 'alert' });
  var btn = h('button', { class: 'btn primary', type: 'submit' }, mode === 'signup' ? 'Create account' : 'Log in');
  function show(m) { err.textContent = m || ''; err.hidden = !m; }
  function field(id, label, type, key, auto, hint) {
    return h('div', { class: 'field' }, h('label', { for: id }, label),
      h('input', { class: 'input', id: id, type: type, value: F[key], autocomplete: auto, maxlength: type === 'password' ? 128 : 120, dir: type === 'email' ? 'ltr' : 'auto', oninput: function (e) { F[key] = e.target.value; } }),
      hint ? h('span', { class: 'hint' }, hint) : null);
  }
  var seg = mode === 'signup' ? h('div', { class: 'field' }, h('span', { class: 'meta', id: 'role-lbl' }, 'I am a'),
    h('div', { class: 'seg', role: 'group', 'aria-labelledby': 'role-lbl', style: 'align-self:flex-start' }, ['student', 'teacher'].map(function (r) {
      return h('button', { type: 'button', 'aria-pressed': String(F.role === r), onclick: function () { F.role = r; go('auth', { mode: 'signup' }); } }, r === 'student' ? 'Student' : 'Teacher');
    }))) : null;
  var form = h('form', {
    novalidate: true,
    onsubmit: function (e) {
      e.preventDefault(); show('');
      if (mode === 'signup' && !F.name.trim()) return show(ERR.name_required);
      if (!F.email.trim()) return show(ERR.invalid_email);
      if (!F.password) return show(mode === 'signup' ? ERR.weak_password : ERR.bad_credentials);
      btn.disabled = true;
      var body = mode === 'signup' ? { role: F.role, name: F.name, email: F.email, password: F.password, teacherCode: F.code } : { email: F.email, password: F.password };
      api('POST', '/api/auth/' + mode, body).then(function (r) { F.password = ''; F.code = ''; ST.user = r.user; enter(); })
        .catch(function (er) { btn.disabled = false; show(errText(er.code)); });
    }
  }, seg,
    mode === 'signup' ? field('auth-name', 'Full name', 'text', 'name', 'name') : null,
    field('auth-email', 'Email', 'email', 'email', 'email'),
    field('auth-pw', 'Password', 'password', 'password', mode === 'signup' ? 'new-password' : 'current-password', mode === 'signup' ? 'At least 8 characters.' : null),
    mode === 'signup' && F.role === 'teacher' ? field('auth-code', 'Teacher code', 'password', 'code', 'off', 'The secret code from whoever runs this site. Students do not need one.') : null,
    err, h('div', null, btn));
  return h('div', { class: 'auth card' },
    h('h1', null, mode === 'signup' ? 'Create your account' : 'Log in'),
    form,
    h('p', { class: 'meta' }, mode === 'signup' ? 'Already have an account? ' : 'New here? ',
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { go('auth', { mode: mode === 'signup' ? 'login' : 'signup' }); } }, mode === 'signup' ? 'Log in' : 'Create an account')));
};

/* ---------- teacher: home ---------- */
SCREENS.tHome = function () {
  var list = h('ul', { class: 'list' }), S = { loading: true, exams: [], err: null, confirm: null };
  function fill() {
    var kids = [];
    if (S.loading) kids.push(h('div', { class: 'empty' }, 'Loading exams…'));
    else if (S.err) kids.push(h('div', { class: 'banner bad' }, S.err));
    else if (!S.exams.length) kids.push(h('div', { class: 'empty' }, h('p', null, 'No exams yet.'), h('p', { class: 'meta' }, 'Upload a PDF of multiple-choice questions to create the first one.')));
    S.exams.forEach(function (ex) {
      var confirming = S.confirm === ex.id;
      kids.push(h('li', { class: 'row' },
        h('div', { class: 'row-main' }, h('h3', { dir: 'auto' }, ex.title),
          h('p', { class: 'meta' }, ex.count + ' questions · ' + ex.submissions + ' submitted · ' + dateFmt(ex.createdAt))),
        h('div', { class: 'row-actions' },
          confirming ? [h('span', { class: 'meta' }, 'Delete this exam and its marks?'),
            h('button', { class: 'btn danger sm', type: 'button', onclick: function () { del(ex.id); } }, 'Delete'),
            h('button', { class: 'btn sm', type: 'button', onclick: function () { S.confirm = null; fill(); } }, 'Cancel')]
          : [h('button', { class: 'btn primary sm', type: 'button', onclick: function () { go('tResults', { examId: ex.id }); } }, 'Results'),
            h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Delete ' + ex.title, onclick: function () { S.confirm = ex.id; fill(); } }, icon('trash', 16))])));
    });
    list.replaceChildren.apply(list, kids);
  }
  function load() {
    api('GET', '/api/teacher/exams').then(function (r) { S.exams = r.exams; S.loading = false; S.err = null; fill(); })
      .catch(function (e) { if (fail(e)) return; S.loading = false; S.err = errText(e.code); fill(); });
  }
  function del(id) {
    api('DELETE', '/api/teacher/exams/' + id).then(function () { S.confirm = null; toast('Exam deleted'); load(); })
      .catch(function (e) { if (!fail(e)) toast(errText(e.code)); });
  }
  fill(); load();
  return h('div', { class: 'wrap' },
    h('div', { class: 'page-h' }, h('h1', null, 'Your exams'),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { ST.draft = { status: 'idle', title: '', key: '', questions: [] }; go('tNew'); } }, icon('plus'), 'New exam')),
    !ST.aiOk ? h('div', { class: 'banner warn' }, 'No AI key is set yet, so PDFs cannot be read and explanations will not work. ',
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { go('tSettings'); } }, 'Add an API key')) : null,
    list);
};

/* ---------- teacher: settings (AI key) ---------- */
var PRESETS = {
  gemini: { label: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
  groq: { label: 'Groq (free plan)', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  custom: { label: 'Other (OpenAI-compatible)', base: '', model: '' }
};
SCREENS.tSettings = function () {
  var box = h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:16px' }, h('p', { class: 'meta' }, 'Loading…'));
  function build(cfg) {
    var sel = h('select', { class: 'input', id: 'ai-preset', onchange: function (e) { var p = PRESETS[e.target.value]; if (p.base) { base.value = p.base; model.value = p.model; } } },
      Object.keys(PRESETS).map(function (k) { return h('option', { value: k, selected: PRESETS[k].base === cfg.base }, PRESETS[k].label); }));
    var base = h('input', { class: 'input', id: 'ai-base', type: 'url', value: cfg.base, autocomplete: 'off', spellcheck: 'false' });
    var model = h('input', { class: 'input', id: 'ai-model', type: 'text', value: cfg.model, autocomplete: 'off', spellcheck: 'false' });
    var key = h('input', { class: 'input', id: 'ai-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: cfg.configured ? 'Saved key ' + cfg.keyHint + ' (leave empty to keep it)' : 'Paste your API key' });
    var out = h('div', { class: 'banner', hidden: true, role: 'status' });
    function say(kind, m) { out.className = 'banner ' + kind; out.textContent = m; out.hidden = false; }
    function save() {
      var body = { base: base.value, model: model.value }; if (key.value.trim()) body.apiKey = key.value;
      return api('PUT', '/api/teacher/ai', body).then(function (r) { ST.aiOk = r.configured; key.value = ''; key.placeholder = r.configured ? 'Saved key ' + r.keyHint + ' (leave empty to keep it)' : 'Paste your API key'; return r; });
    }
    var saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: function () {
      save().then(function () { say('good', 'Saved.'); }).catch(function (e) { if (!fail(e)) say('bad', errText(e.code)); }); } }, 'Save');
    var testBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
      testBtn.disabled = true; say('', 'Testing…');
      save().then(function () { return api('POST', '/api/teacher/ai/test', {}); })
        .then(function () { say('good', 'Connected. The AI answered.'); })
        .catch(function (e) { if (!fail(e)) say('bad', errText(e.code)); })
        .then(function () { testBtn.disabled = false; }); } }, 'Save and test connection');
    var clr = h('button', { class: 'btn ghost danger', type: 'button', onclick: function () {
      api('PUT', '/api/teacher/ai', { clearKey: true }).then(function (r) { ST.aiOk = r.configured; say('good', 'The saved key was removed.'); go('tSettings'); })
        .catch(function (e) { if (!fail(e)) say('bad', errText(e.code)); }); } }, 'Remove saved key');
    box.replaceChildren(
      h('p', { class: 'meta' }, cfg.configured ? 'AI key: set (' + (cfg.source === 'env' ? 'from the .env file' : 'saved in the app') + ', ending ' + cfg.keyHint + ').' : 'AI key: not set yet.'),
      h('div', { class: 'field' }, h('label', { for: 'ai-preset' }, 'AI provider'), sel),
      h('div', { class: 'set-grid' },
        h('div', { class: 'field' }, h('label', { for: 'ai-base' }, 'Address'), base),
        h('div', { class: 'field' }, h('label', { for: 'ai-model' }, 'Model'), model)),
      h('div', { class: 'field' }, h('label', { for: 'ai-key' }, 'API key'), key,
        h('span', { class: 'hint' }, 'Get a free Gemini key at ',
          h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'aistudio.google.com/apikey'),
          '. The key is stored on your server and never sent to students’ browsers.')),
      out, h('div', { class: 'cta' }, saveBtn, testBtn, cfg.source === 'database' ? clr : null));
  }
  api('GET', '/api/teacher/ai').then(build).catch(function (e) { if (!fail(e)) box.replaceChildren(h('div', { class: 'banner bad' }, errText(e.code))); });
  return h('div', { class: 'wrap' },
    h('button', { class: 'back', type: 'button', onclick: home }, icon('back', 16), 'All exams'),
    h('h1', { style: 'font-size:clamp(1.7rem,4vw,2.3rem);font-weight:800' }, 'AI connection'),
    h('p', { class: 'meta' }, 'Examline uses an AI service to read questions out of PDFs and to explain answers to students. Free tiers have daily limits and some providers may use free-tier content to improve their products, so avoid uploading confidential material.'),
    box);
};

/* ---------- teacher: new exam (PDF -> questions) ---------- */
function readPdf(file, onPage, signal) {
  if (!window.pdfjsLib) return Promise.reject({ user: 'The PDF reader could not be loaded. Reload the page.' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
  return file.arrayBuffer().then(function (buf) {
    return pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  }).then(function (pdf) {
    var pages = [];
    function next(p) {
      if (signal.aborted) return Promise.reject({ code: 'cancelled' });
      if (p > pdf.numPages) { try { pdf.destroy(); } catch (e) {} return Promise.resolve(pages); }
      return pdf.getPage(p).then(function (page) { return page.getTextContent(); }).then(function (tc) {
        var out = '', lastY = null, prevEnd = null;
        tc.items.forEach(function (it) {
          if (typeof it.str !== 'string') return;
          var x = it.transform[4], y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) { out += '\n'; prevEnd = null; }
          else if (prevEnd !== null && x - prevEnd > 1.5 && out.slice(-1) !== ' ') out += ' ';
          out += it.str; prevEnd = x + (it.width || 0); lastY = y;
          if (it.hasEOL) { out += '\n'; lastY = null; prevEnd = null; }
        });
        pages.push(out.trim()); onPage(p, pdf.numPages);
        return next(p + 1);
      });
    }
    return next(1);
  });
}
function makeChunks(pages) {
  var chunks = [], cur = [], len = 0, MAX = 12000;
  for (var i = 0; i < pages.length; i++) {
    if (cur.length && len + pages[i].length > MAX) { chunks.push(cur.join('\n\n')); cur = [pages[i - 1]]; len = pages[i - 1].length; }
    cur.push(pages[i]); len += pages[i].length;
  }
  if (cur.length) chunks.push(cur.join('\n\n'));
  return chunks;
}
function findKey(pages) {
  var full = pages.join('\n\n'), re = /(answer\s*key|answers\s*:|answer\s*sheet|solutions?\s*:|الإجابات|مفتاح\s*الإجابة)/ig, m, idx = -1;
  while ((m = re.exec(full))) { idx = m.index; }
  return idx > full.length * 0.4 ? full.slice(idx, idx + 6000) : '';
}
function setProg(frac, label, sub) {
  var b = document.getElementById('prog-bar'), l = document.getElementById('prog-label'), s = document.getElementById('prog-sub');
  if (b) b.style.width = Math.round(frac * 100) + '%';
  if (l) l.textContent = label; if (s) s.textContent = sub;
}
function runExtraction() {
  var D = ST.draft;
  D.status = 'reading'; D.ctl = new AbortController(); D.err = null; drawNew();
  var signal = D.ctl.signal;
  readPdf(D.file, function (p, n) { if (ST.draft !== D) return; setProg(0.15 * p / n, 'Reading the PDF', 'Page ' + p + ' of ' + n); }, signal)
    .then(function (pages) {
      var chars = pages.join('').replace(/\s/g, '').length;
      if (chars < 80) throw { user: 'This PDF has no selectable text, so it may be a scan or photo. Upload a text-based PDF, for example one exported from Word or Google Docs.' };
      var chunks = makeChunks(pages), autoKey = findKey(pages), all = [];
      D.status = 'extracting'; drawNew();
      function step(i) {
        if (i >= chunks.length) return Promise.resolve(all);
        setProg(0.15 + 0.85 * i / chunks.length, 'Finding questions', 'Part ' + (i + 1) + ' of ' + chunks.length + ' · ' + all.length + ' found so far');
        return api('POST', '/api/teacher/extract', { chunk: chunks[i], key: D.key.trim(), autoKey: autoKey }, signal).then(function (r) {
          all = all.concat(r.questions || []); return step(i + 1);
        });
      }
      return step(0);
    }).then(function (all) {
      if (ST.draft !== D) return;
      var seen = {}, out = [];
      all.forEach(function (q) {
        var k = q.q.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '').slice(0, 90);
        if (seen[k]) return; seen[k] = 1; out.push(q);
      });
      if (!out.length) throw { user: 'No multiple-choice questions were found in this PDF. Check that the file contains questions with lettered options.' };
      D.questions = out; D.status = 'review'; drawNew();
    }).catch(function (e) {
      if (ST.draft !== D) return;
      if (e && e.code === 'login_required') { fail(e); return; }
      D.status = 'idle'; D.errCode = e && e.code;
      if (e && (e.code === 'cancelled' || e.name === 'AbortError')) D.err = null;
      else if (e && e.user) D.err = e.user;
      else if (e && e.code) D.err = errText(e.code);
      else D.err = 'The PDF could not be read. Make sure it is a valid, unprotected PDF.';
      drawNew();
    });
}
var $newBox = null;
SCREENS.tNew = function () { $newBox = h('div', { class: 'wrap' }); drawNew(); return $newBox; };
function drawNew() {
  var D = ST.draft; if (!D || !$newBox) return;
  var kids = [h('button', { class: 'back', type: 'button', onclick: function () { go('tHome'); } }, icon('back', 16), 'All exams')];
  if (D.status === 'idle') kids.push(newIdle(D));
  else if (D.status === 'reading' || D.status === 'extracting') kids.push(newBusy(D));
  else kids.push(newReview(D));
  $newBox.replaceChildren.apply($newBox, kids);
}
function sizeText(f) { return f.size < 1048576 ? Math.round(f.size / 1024) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB'; }
function newIdle(D) {
  var fileInfo = h('p', { class: 'meta', id: 'file-info' }, D.file ? D.file.name + ' · ' + sizeText(D.file) : 'No file chosen yet');
  var go1 = h('button', { class: 'btn primary', type: 'button', disabled: !D.file || !ST.aiOk, onclick: function () {
    D.title = document.getElementById('exam-title').value; D.key = document.getElementById('exam-key').value; runExtraction(); } }, icon('file'), 'Read questions from PDF');
  function setFile(f) {
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { toast('Choose a PDF file'); return; }
    D.file = f; if (!D.title) D.title = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    var t = document.getElementById('exam-title'); if (t && !t.value) t.value = D.title;
    fileInfo.textContent = f.name + ' · ' + sizeText(f); go1.disabled = !ST.aiOk; D.err = null;
    var eb = document.getElementById('new-err'); if (eb) eb.hidden = true;
  }
  var input = h('input', { type: 'file', id: 'pdf-file', accept: 'application/pdf,.pdf', onchange: function (e) { setFile(e.target.files[0]); } });
  var drop = h('label', { class: 'drop', for: 'pdf-file',
    ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: function () { drop.classList.remove('over'); },
    ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); } },
    icon('upload', 28), h('strong', null, 'Drop a PDF here or choose a file'),
    h('span', { class: 'meta' }, 'Text-based PDFs with multiple-choice questions (not scans or photos).'), input);
  return h('div', { class: 'wrap' },
    h('h1', { style: 'font-size:clamp(1.7rem,4vw,2.3rem);font-weight:800' }, 'New exam'),
    !ST.aiOk ? h('div', { class: 'banner warn' }, 'No AI key is set yet. ', h('button', { class: 'linkbtn', type: 'button', onclick: function () { go('tSettings'); } }, 'Add an API key'), ' to read questions from PDFs.') : null,
    h('div', { class: 'banner bad', id: 'new-err', hidden: !D.err, role: 'alert' }, D.err || '',
      D.errCode === 'ai_not_configured' || D.errCode === 'ai_auth' ? h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', type: 'button', onclick: function () { go('tSettings'); } }, 'Open AI settings')) : null),
    drop, fileInfo,
    h('div', { class: 'field' }, h('label', { for: 'exam-title' }, 'Exam title'),
      h('input', { class: 'input', id: 'exam-title', type: 'text', maxlength: 120, dir: 'auto', value: D.title, oninput: function (e) { D.title = e.target.value; } })),
    h('div', { class: 'field' }, h('label', { for: 'exam-key' }, 'Answer key (optional)'),
      h('textarea', { class: 'textarea', id: 'exam-key', placeholder: '1-B, 2-D, 3-A, 4-C', oninput: function (e) { D.key = e.target.value; } }, D.key),
      h('span', { class: 'hint' }, 'Paste it if the PDF does not include one. Without a key, the AI works out the answers and you check them in the next step.')),
    h('div', null, go1));
}
function newBusy(D) {
  return h('div', { class: 'card prog' },
    h('h2', { style: 'font-size:1.4rem' }, D.status === 'reading' ? 'Reading the PDF' : 'Finding questions'),
    h('div', { class: 'bar' }, h('i', { id: 'prog-bar' })),
    h('p', { id: 'prog-label', class: 'eyebrow' }, D.status === 'reading' ? 'Reading the PDF' : 'Finding questions'),
    h('p', { id: 'prog-sub', class: 'meta' }, 'Starting…'),
    h('div', null, h('button', { class: 'btn', type: 'button', onclick: function () { D.ctl.abort(); } }, icon('stop', 16), 'Stop')));
}
function reviewCounts(D) {
  var need = 0, ai = 0;
  D.questions.forEach(function (q) { if (q.answer == null) need++; else if (q.from === 'ai') ai++; });
  return { need: need, ai: ai };
}
function newReview(D) {
  var banner = h('div'), pubBtn;
  function paint() {
    var c = reviewCounts(D), ok = D.questions.length > 0 && c.need === 0 && D.title.trim().length > 0;
    banner.className = ''; banner.replaceChildren();
    if (c.need) { banner.className = 'banner bad'; banner.append(c.need + ' question' + (c.need > 1 ? 's need' : ' needs') + ' a correct answer. Pick one in each marked question before publishing.'); }
    else if (c.ai) { banner.className = 'banner warn'; banner.append('The AI chose the answer for ' + c.ai + ' question' + (c.ai > 1 ? 's' : '') + ' because no answer key was found. Check them before publishing.'); }
    else { banner.className = 'banner good'; banner.append('Every question has an answer from the key.'); }
    if (pubBtn) pubBtn.disabled = !ok || !!D.busy;
  }
  var list = h('div', { class: 'wrap', style: 'gap:14px' }, D.questions.map(function (q, i) { return qEditor(D, q, i, paint); }));
  pubBtn = h('button', { class: 'btn primary', type: 'button', onclick: function () { publishExam(D); } }, 'Publish exam');
  var out = h('div', { class: 'wrap' },
    h('h1', { style: 'font-size:clamp(1.7rem,4vw,2.3rem);font-weight:800' }, 'Check the questions'),
    h('p', { class: 'meta' }, D.questions.length + ' questions found. Fix anything that looks wrong, then publish.'),
    h('div', { class: 'field' }, h('label', { for: 'rev-title' }, 'Exam title'),
      h('input', { class: 'input', id: 'rev-title', type: 'text', maxlength: 120, dir: 'auto', value: D.title, oninput: function (e) { D.title = e.target.value; paint(); } })),
    h('div', { class: 'banner bad', hidden: !D.pubErr, role: 'alert' }, D.pubErr || ''),
    banner, list,
    h('div', { class: 'sticky-bar' },
      h('button', { class: 'btn', type: 'button', onclick: function () { ST.draft = { status: 'idle', title: D.title, key: D.key, file: D.file, questions: [] }; drawNew(); } }, 'Start over'), pubBtn));
  paint(); return out;
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 260) + 'px'; }
function qEditor(D, q, i, paint) {
  var chip = h('span', { class: 'pill' });
  function paintChip() {
    if (q.answer == null) { chip.className = 'pill bad'; chip.textContent = 'Pick the correct answer'; }
    else if (q.from === 'ai') { chip.className = 'pill warn'; chip.textContent = 'Answer chosen by the AI'; }
    else if (q.from === 'teacher') { chip.className = 'pill'; chip.textContent = 'Answer set by you'; }
    else { chip.className = 'pill good'; chip.textContent = 'Answer from key'; }
  }
  paintChip();
  var ta = h('textarea', { class: 'textarea', rows: 2, dir: 'auto', 'aria-label': 'Question ' + (i + 1) + ' text', oninput: function (e) { q.q = e.target.value; grow(e.target); } }, q.q);
  setTimeout(function () { grow(ta); }, 0);
  return h('div', { class: 'card edit-q' },
    h('div', { class: 'edit-head' }, h('span', { class: 'eyebrow' }, 'Question ' + (i + 1)),
      h('div', { class: 'row-actions' }, chip, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Remove question ' + (i + 1), onclick: function () { D.questions.splice(i, 1); drawNew(); } }, icon('trash', 16)))),
    ta,
    q.options.map(function (o, k) {
      return h('div', { class: 'edit-opt' },
        h('input', { type: 'radio', name: 'ans-' + i, 'aria-label': 'Option ' + L[k] + ' is correct', checked: q.answer === k, onchange: function () { q.answer = k; q.from = 'teacher'; paintChip(); paint(); } }),
        h('span', { class: 'num' }, L[k]),
        h('input', { class: 'input', type: 'text', dir: 'auto', 'aria-label': 'Option ' + L[k] + ' text', value: o, oninput: function (e) { q.options[k] = e.target.value; } }));
    }));
}
function publishExam(D) {
  var qs = D.questions.map(function (q) {
    var opts = [], ans = null;
    q.options.forEach(function (o, k) { var t = String(o).trim(); if (t) { if (k === q.answer) ans = opts.length; opts.push(t); } });
    return { q: q.q.trim(), options: opts, answer: ans };
  }).filter(function (q) { return q.q && q.options.length >= 2 && q.answer != null; });
  D.busy = true; D.pubErr = null;
  api('POST', '/api/teacher/exams', { title: D.title.trim(), source: D.file ? D.file.name : '', questions: qs }).then(function () {
    ST.draft = null; toast('Exam published'); go('tHome');
  }).catch(function (e) {
    D.busy = false; if (fail(e)) return;
    D.pubErr = errText(e.code); if (ST.draft === D) drawNew();
  });
}

/* ---------- teacher: results ---------- */
function stat(label, val) { return h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, label), h('b', null, val)); }
function mistakes(exam, entry) {
  var wrong = [];
  exam.questions.forEach(function (q, i) { var a = (entry.answers || [])[i]; if (a !== q.answer) wrong.push({ q: q, i: i, a: a == null ? -1 : a }); });
  if (!wrong.length) return h('p', { class: 'ans-good', style: 'font-weight:600' }, 'No mistakes. Full marks.');
  return h('div', { class: 'miss' }, h('p', { class: 'eyebrow' }, wrong.length + ' wrong answer' + (wrong.length > 1 ? 's' : '')),
    wrong.map(function (w) {
      return h('div', { class: 'miss-item' },
        h('div', { class: 'q', dir: 'auto' }, (w.i + 1) + '. ' + w.q.q),
        h('div', { class: w.a < 0 ? 'meta' : 'ans-bad', dir: 'auto' }, w.a < 0 ? 'No answer given' : 'Student answered ' + L[w.a] + '. ' + w.q.options[w.a]),
        h('div', { class: 'ans-good', dir: 'auto' }, 'Correct answer ' + L[w.q.answer] + '. ' + w.q.options[w.q.answer]));
    }));
}
SCREENS.tResults = function () {
  var P = ST.params, data = null, loadErr = null;
  P.sort = P.sort || 'latest'; P.open = P.open || null;
  var stats = h('div', { class: 'stats' }), tableBox = h('div', { class: 'card' }, h('p', { class: 'meta' }, 'Loading results…'));
  var head = h('div');
  var sel = h('select', { class: 'input', id: 'sort-sel', 'aria-label': 'Sort students', style: 'width:auto', onchange: function (e) { P.sort = e.target.value; fill(); } },
    [['latest', 'Latest first'], ['name', 'Name A–Z'], ['high', 'Highest mark'], ['low', 'Lowest mark']].map(function (o) { return h('option', { value: o[0], selected: o[0] === P.sort }, o[1]); }));
  function fill() {
    if (loadErr) { tableBox.replaceChildren(h('div', { class: 'banner bad' }, loadErr)); return; }
    if (!data) return;
    var exam = data.exam;
    head.replaceChildren(h('p', { class: 'eyebrow' }, 'Results'), h('h1', { dir: 'auto', style: 'font-size:clamp(1.7rem,4vw,2.3rem);font-weight:800' }, exam.title), h('p', { class: 'meta' }, exam.questions.length + ' questions'));
    var r = data.rows.map(function (x) { x.p = pct(x.score, x.total); return x; });
    r.sort(function (a, b) {
      if (P.sort === 'name') return a.name.localeCompare(b.name);
      if (P.sort === 'high') return b.p - a.p;
      if (P.sort === 'low') return a.p - b.p;
      return b.at - a.at;
    });
    var n = r.length, avg = n ? Math.round(r.reduce(function (s, x) { return s + x.p; }, 0) / n) : 0;
    var hi = n ? Math.max.apply(null, r.map(function (x) { return x.p; })) : 0, lo = n ? Math.min.apply(null, r.map(function (x) { return x.p; })) : 0;
    stats.replaceChildren(stat('Submitted', String(n)), stat('Average', n ? avg + '%' : '–'), stat('Highest', n ? hi + '%' : '–'), stat('Lowest', n ? lo + '%' : '–'));
    if (!n) { tableBox.replaceChildren(h('div', { class: 'empty', style: 'border:0' }, h('p', null, 'No one has submitted yet.'), h('p', { class: 'meta' }, 'Marks appear here as soon as students finish.'))); return; }
    var tb = h('tbody');
    r.forEach(function (x) {
      var open = P.open === x.userId;
      tb.append(h('tr', null,
        h('td', null, h('button', { class: 'who', type: 'button', 'aria-expanded': String(open), onclick: function () { P.open = open ? null : x.userId; fill(); } }, h('span', { dir: 'auto' }, x.name), h('span', { class: 'meta' }, open ? 'Hide' : 'Show mistakes')),
          h('div', { class: 'meta', dir: 'ltr' }, x.email)),
        h('td', { class: 'num' }, x.score + ' / ' + x.total),
        h('td', null, h('span', { class: 'pill ' + band(x.p) }, x.p + '%')),
        h('td', { class: 'num' }, String(x.tries || 1)),
        h('td', { class: 'meta' }, dateFmt(x.at))));
      if (open) tb.append(h('tr', { class: 'detail' }, h('td', { colspan: 5 }, mistakes(exam, x))));
    });
    tableBox.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Student', 'Mark', 'Percent', 'Attempts', 'Submitted'].map(function (t) { return h('th', null, t); }))), tb)));
  }
  function load() {
    api('GET', '/api/teacher/exams/' + P.examId + '/results').then(function (r) { data = r; loadErr = null; fill(); })
      .catch(function (e) { if (fail(e)) return; loadErr = e.code === 'not_found' ? 'This exam was not found.' : errText(e.code); fill(); });
  }
  load();
  ST.timer = setInterval(function () { if (!document.hidden) load(); }, 10000);
  return h('div', { class: 'wrap' },
    h('button', { class: 'back', type: 'button', onclick: function () { go('tHome'); } }, icon('back', 16), 'All exams'),
    h('div', { class: 'page-h' }, head, h('div', { class: 'field' }, h('label', { for: 'sort-sel', class: 'meta' }, 'Sort by'), sel)),
    stats, tableBox);
};

/* ---------- student: home ---------- */
SCREENS.sHome = function () {
  var list = h('ul', { class: 'list' }), S = { loading: true, exams: [], mine: {}, err: null };
  function fill() {
    var kids = [];
    if (S.loading) kids.push(h('div', { class: 'empty' }, 'Loading exams…'));
    else if (S.err) kids.push(h('div', { class: 'banner bad' }, S.err));
    else if (!S.exams.length) kids.push(h('div', { class: 'empty' }, h('p', null, 'No exams yet.'), h('p', { class: 'meta' }, 'When your teacher uploads a PDF, the exam appears here.')));
    S.exams.forEach(function (ex) {
      var e = S.mine[ex.id];
      kids.push(h('li', { class: 'row' },
        h('div', { class: 'row-main' }, h('h3', { dir: 'auto' }, ex.title), h('p', { class: 'meta' }, ex.count + ' questions'),
          e ? h('p', { style: 'margin-top:6px' }, h('span', { class: 'pill ' + band(pct(e.score, e.total)) }, 'Last mark ' + e.score + ' / ' + e.total + ' · ' + pct(e.score, e.total) + '%')) : null),
        h('div', { class: 'row-actions' },
          e ? h('button', { class: 'btn sm', type: 'button', onclick: function () { go('sResult', { examId: ex.id }); } }, 'Review') : null,
          h('button', { class: 'btn primary sm', type: 'button', onclick: function () { startExam(ex.id); } }, e ? 'Retake' : 'Start exam'))));
    });
    list.replaceChildren.apply(list, kids);
  }
  Promise.all([api('GET', '/api/exams'), api('GET', '/api/results/mine')]).then(function (r) {
    S.exams = r[0].exams; S.mine = r[1].results; S.loading = false; fill();
  }).catch(function (e) { if (fail(e)) return; S.loading = false; S.err = errText(e.code); fill(); });
  fill();
  return h('div', { class: 'wrap' }, h('div', { class: 'page-h' }, h('div', null, h('p', { class: 'eyebrow' }, 'Welcome'), h('h1', { dir: 'auto' }, ST.user.name))), list);
};
function startExam(id) {
  api('GET', '/api/exams/' + id).then(function (r) {
    ST.quiz = { exam: r.exam, answers: r.exam.questions.map(function () { return -1; }), idx: 0 }; go('sQuiz');
  }).catch(function (e) { if (!fail(e)) toast(errText(e.code)); });
}

/* ---------- student: quiz ---------- */
var quizApi = null;
function quizKeys(e) {
  if (ST.screen !== 'sQuiz' || CHAT.open || !quizApi) return;
  var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key.toLowerCase(), q = ST.quiz.exam.questions[ST.quiz.idx], i = -1;
  if (k.length === 1) { i = L.toLowerCase().indexOf(k); if (i < 0 && /^[1-6]$/.test(k)) i = +k - 1; }
  if (i >= 0 && i < q.options.length) { quizApi.choose(i); e.preventDefault(); return; }
  if (k === 'arrowright') quizApi.move(1); else if (k === 'arrowleft') quizApi.move(-1);
}
SCREENS.sQuiz = function () {
  var Q = ST.quiz, exam = Q.exam, n = exam.questions.length;
  var bar = h('i'), meta = h('p', { class: 'meta' }), card = h('section', { class: 'card qcard', 'aria-live': 'polite' }), nav = h('div', { class: 'dots' });
  var prev = h('button', { class: 'btn', type: 'button', onclick: function () { move(-1); } }, 'Previous');
  var next = h('button', { class: 'btn primary', type: 'button', onclick: function () { if (Q.idx === n - 1) askSubmit(); else move(1); } }, 'Next');
  var box = h('div', { hidden: true });
  var submitBtn = h('button', { class: 'btn primary', type: 'button', onclick: askSubmit }, 'Submit exam');
  var quitBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: function () { showQuit(); } }, 'Leave exam');
  function answered() { return Q.answers.filter(function (a) { return a >= 0; }).length; }
  function paintMeta() { var a = answered(); bar.style.width = Math.round(100 * a / n) + '%'; meta.textContent = a + ' of ' + n + ' answered'; }
  function paintSel() {
    var cur = Q.answers[Q.idx];
    card.querySelectorAll('.opt').forEach(function (b, i) { b.classList.toggle('selected', i === cur); b.setAttribute('aria-checked', String(i === cur)); });
  }
  function drawCard() {
    var q = exam.questions[Q.idx];
    card.replaceChildren(h('p', { class: 'eyebrow' }, 'Question ' + (Q.idx + 1) + ' of ' + n),
      h('h2', { class: 'q-text', dir: 'auto' }, q.q),
      h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Answer choices' }, q.options.map(function (o, i) {
        return h('button', { type: 'button', class: 'opt', role: 'radio', 'aria-checked': 'false', onclick: function () { choose(i); } },
          h('span', { class: 'bubble' }, L[i]), h('span', { class: 'opt-text', dir: 'auto' }, o));
      })),
      h('div', { class: 'pager' }, prev, next));
    prev.disabled = Q.idx === 0; next.textContent = Q.idx === n - 1 ? 'Finish' : 'Next';
    paintSel();
  }
  function drawNav() {
    nav.replaceChildren.apply(nav, Q.answers.map(function (a, i) {
      return h('button', { type: 'button', class: 'dot' + (a >= 0 ? ' done' : '') + (i === Q.idx ? ' cur' : ''), 'aria-label': 'Question ' + (i + 1) + (a >= 0 ? ', answered' : ', not answered'), onclick: function () { jump(i); } }, String(i + 1));
    }));
  }
  function choose(i) { Q.answers[Q.idx] = i; paintSel(); drawNav(); paintMeta(); }
  function jump(i) { Q.idx = i; drawCard(); drawNav(); }
  function move(d) { var i = Math.max(0, Math.min(n - 1, Q.idx + d)); if (i !== Q.idx) jump(i); }
  function hideBox() { box.hidden = true; box.className = ''; box.replaceChildren(); }
  function askSubmit() {
    var left = n - answered();
    box.className = 'confirm'; box.hidden = false;
    box.replaceChildren(h('p', { style: 'font-weight:600' }, left ? left + ' question' + (left > 1 ? 's have' : ' has') + ' no answer. Submit anyway?' : 'Submit your answers? You cannot change them afterwards.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary sm', type: 'button', onclick: finish }, 'Submit'), h('button', { class: 'btn sm', type: 'button', onclick: hideBox }, 'Keep working')));
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function showQuit() {
    box.className = 'confirm'; box.hidden = false;
    box.replaceChildren(h('p', { style: 'font-weight:600' }, 'Leave the exam? Your answers will be lost.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn danger sm', type: 'button', onclick: function () { ST.quiz = null; go('sHome'); } }, 'Leave'), h('button', { class: 'btn sm', type: 'button', onclick: hideBox }, 'Stay')));
  }
  function finish() {
    box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    api('POST', '/api/exams/' + exam.id + '/submit', { answers: Q.answers }).then(function (r) {
      ST.last = { exam: r.exam, entry: r.entry }; ST.quiz = null; go('sResult', { fresh: true });
    }).catch(function (e) {
      if (fail(e)) return;
      box.className = 'confirm'; box.hidden = false;
      box.replaceChildren(h('p', { style: 'font-weight:600' }, errText(e.code) + ' Your answers are still here.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary sm', type: 'button', onclick: finish }, 'Try again'), h('button', { class: 'btn sm', type: 'button', onclick: hideBox }, 'Keep working')));
    });
  }
  quizApi = { choose: choose, move: move };
  document.addEventListener('keydown', quizKeys);
  drawCard(); drawNav(); paintMeta();
  return h('div', { class: 'wrap' },
    h('div', { class: 'page-h' }, h('div', null, h('p', { class: 'eyebrow' }, 'Exam'), h('h1', { dir: 'auto', style: 'font-size:clamp(1.4rem,3.4vw,2rem)' }, exam.title)), quitBtn),
    h('div', { class: 'bar' }, bar),
    h('div', { class: 'quiz' }, card,
      h('aside', { class: 'side' }, h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Answer sheet'), meta), nav,
        h('p', { class: 'meta' }, 'Keys: A–F to answer, ← → to move.'), submitBtn, box))));
};

/* ---------- student: marked paper ---------- */
SCREENS.sResult = function () {
  var P = ST.params;
  if (P.fresh && ST.last) return drawResult(ST.last.exam, ST.last.entry, true);
  var box = h('div', { class: 'wrap' }, h('div', { class: 'empty' }, 'Loading your paper…'));
  api('GET', '/api/exams/' + P.examId + '/review').then(function (r) {
    if (ST.screen === 'sResult') box.replaceChildren(drawResult(r.exam, r.entry, false));
  }).catch(function (e) { if (!fail(e)) box.replaceChildren(h('button', { class: 'back', type: 'button', onclick: home }, icon('back', 16), 'All exams'), h('div', { class: 'empty' }, 'This result is not available.')); });
  return box;
};
function drawResult(exam, entry, fresh) {
  var p = pct(entry.score, entry.total), wrong = [];
  exam.questions.forEach(function (q, i) { if ((entry.answers || [])[i] !== q.answer) wrong.push(i); });
  var filter = wrong.length ? 'wrong' : 'all', listBox = h('div', { class: 'wrap', style: 'gap:14px' }), seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter questions' });
  function paintList() {
    seg.replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(filter === 'wrong'), onclick: function () { filter = 'wrong'; paintList(); } }, 'Mistakes (' + wrong.length + ')'),
      h('button', { type: 'button', 'aria-pressed': String(filter === 'all'), onclick: function () { filter = 'all'; paintList(); } }, 'All questions (' + exam.questions.length + ')'));
    var idxs = filter === 'wrong' ? wrong : exam.questions.map(function (_, i) { return i; });
    if (!idxs.length) { listBox.replaceChildren(h('div', { class: 'banner good' }, 'No mistakes. Full marks.')); return; }
    listBox.replaceChildren.apply(listBox, idxs.map(function (i) { return reviewCard(exam, entry, i); }));
  }
  var msg = p >= 90 ? 'Excellent work.' : p >= 75 ? 'Good work.' : p >= 50 ? 'A fair start. Go through the mistakes below.' : 'Keep going. Start with the mistakes below.';
  var ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 200 90'); ring.setAttribute('preserveAspectRatio', 'none'); ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML = '<path pathLength="1" d="M14 46 C 8 16, 76 4, 128 10 C 178 16, 196 52, 148 72 C 100 90, 10 80, 14 46 Z"/>';
  var out = h('div', { class: 'wrap' },
    h('button', { class: 'back', type: 'button', onclick: home }, icon('back', 16), 'All exams'),
    h('section', { class: 'card score' },
      h('div', { class: 'ringbox ' + (p >= 50 ? 'good' : '') }, ring, h('div', { class: 'big num' }, String(entry.score), h('small', null, ' / ' + entry.total))),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0' },
        h('p', { class: 'eyebrow', dir: 'auto' }, exam.title), h('p', { style: 'font:800 1.8rem var(--f-display)' }, p + '%'), h('p', { class: 'meta' }, msg),
        fresh ? h('p', null, h('span', { class: 'pill good' }, 'Saved. Your teacher can see this mark.')) : h('p', { class: 'meta' }, 'Submitted ' + dateFmt(entry.at)),
        h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', type: 'button', onclick: function () { startExam(exam.id); } }, 'Retake exam')))),
    h('div', { class: 'page-h' }, h('h2', { style: 'font-size:1.5rem' }, 'Your paper'), seg), listBox);
  paintList();
  return out;
}
function reviewCard(exam, entry, i) {
  var q = exam.questions[i], a = (entry.answers || [])[i], ok = a === q.answer;
  var st = ok ? ['pill good', 'Correct'] : (a == null || a < 0 ? ['pill warn', 'No answer'] : ['pill bad', 'Wrong']);
  return h('article', { class: 'card rq' },
    h('div', { class: 'rq-h' }, h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'eyebrow' }, 'Question ' + (i + 1)), h('span', { class: st[0] }, st[1])),
      h('button', { class: 'btn sm' + (ok ? '' : ' primary'), type: 'button', onclick: function () { openChat(exam, i, a == null ? -1 : a); } }, icon('chat', 16), 'Explanation')),
    h('p', { class: 'q-text', dir: 'auto' }, q.q),
    h('div', { class: 'opts' }, q.options.map(function (o, k) {
      var cls = 'opt static' + (k === q.answer ? ' is-correct' : (k === a ? ' is-wrong' : '')), tag = k === q.answer ? (k === a ? 'Your answer · correct' : 'Correct answer') : (k === a ? 'Your answer' : '');
      return h('div', { class: cls }, h('span', { class: 'bubble' }, k === q.answer ? icon('check', 16) : (k === a ? icon('cross', 16) : L[k])),
        h('span', { class: 'opt-text', dir: 'auto' }, o, tag ? h('span', { class: 'tag' }, tag) : null));
    })));
}

/* ---------- Explanation chat ---------- */
var CHAT = { open: false, turns: [], ctl: null, busy: false, log: null, input: null, sendBtn: null, stopBtn: null, ctx: null, keyFn: null };
function openChat(exam, qi, chosen) {
  closeChat();
  var q = exam.questions[qi];
  CHAT.open = true; CHAT.turns = []; CHAT.busy = false; CHAT.ctx = { examId: exam.id, qi: qi, chosen: chosen };
  CHAT.log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  CHAT.input = h('textarea', { class: 'textarea', id: 'chat-in', rows: 1, 'aria-label': 'Ask a follow-up question', dir: 'auto', placeholder: 'Ask a follow-up…',
    onkeydown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollow(); } } });
  CHAT.sendBtn = h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Send', onclick: sendFollow }, icon('send', 18));
  CHAT.stopBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Stop', hidden: true, onclick: function () { if (CHAT.ctl) CHAT.ctl.abort(); } }, icon('stop', 18));
  var panel = h('aside', { class: 'chat', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Explanation for question ' + (qi + 1) },
    h('div', { class: 'chat-h' }, h('h2', null, 'Explanation · Question ' + (qi + 1)), h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Close', onclick: closeChat }, icon('cross', 16))),
    h('div', { class: 'chat-recap', dir: 'auto' }, q.q), CHAT.log,
    h('div', { class: 'chat-f' }, CHAT.input, CHAT.stopBtn, CHAT.sendBtn));
  var back = h('div', { class: 'chat-back', onmousedown: function (e) { if (e.target === back) closeChat(); } }, panel);
  CHAT.keyFn = function (e) { if (e.key === 'Escape') closeChat(); };
  document.addEventListener('keydown', CHAT.keyFn);
  $chat.replaceChildren(back);
  ask('Why is option ' + L[q.answer] + ' the right answer, and why are the other options wrong?');
}
function closeChat() {
  if (!CHAT.open) return;
  CHAT.open = false; if (CHAT.ctl) CHAT.ctl.abort();
  document.removeEventListener('keydown', CHAT.keyFn); $chat.replaceChildren();
}
function addMsg(cls, text) {
  var m = h('div', { class: 'msg ' + cls }); if (text) m.textContent = text;
  CHAT.log.append(m); CHAT.log.scrollTop = CHAT.log.scrollHeight; return m;
}
function setBusy(b) { CHAT.busy = b; if (!CHAT.sendBtn) return; CHAT.sendBtn.hidden = b; CHAT.stopBtn.hidden = !b; CHAT.input.disabled = b; }
function sendFollow() {
  if (CHAT.busy) return;
  var t = CHAT.input.value.trim(); if (!t) return;
  CHAT.input.value = ''; ask(t);
}
function ask(text) {
  var me = addMsg('me'); me.textContent = text;
  CHAT.turns.push({ role: 'user', content: text });
  var bubble = addMsg('ai'); bubble.append(h('span', { class: 'think' }, 'Thinking…'));
  var ctl = new AbortController(); CHAT.ctl = ctl; setBusy(true);
  var alive = function () { return CHAT.open && CHAT.ctl === ctl; };
  var msgs = CHAT.turns.slice(-11); if (msgs[0].role === 'assistant') msgs.shift();
  api('POST', '/api/exams/' + CHAT.ctx.examId + '/explain', { qi: CHAT.ctx.qi, chosen: CHAT.ctx.chosen, messages: msgs }, ctl.signal).then(function (r) {
    if (!alive()) return;
    CHAT.turns.push({ role: 'assistant', content: r.text }); bubble.replaceChildren(fmt(r.text));
    CHAT.log.scrollTop = CHAT.log.scrollHeight;
  }).catch(function (e) {
    if (!alive()) return;
    bubble.remove();
    if (e && e.name === 'AbortError') { me.remove(); CHAT.turns.pop(); return; }
    if (fail(e)) return;
    var em = addMsg('ai err', errText(e.code));
    if (['submit_first', 'wrong_role', 'ai_not_configured', 'ai_auth'].indexOf(e.code) < 0) {
      em.append(h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', type: 'button', onclick: function () { em.remove(); me.remove(); CHAT.turns.pop(); ask(text); } }, 'Try again')));
    }
  }).then(function () { if (alive()) { setBusy(false); if (CHAT.input && !CHAT.input.disabled) CHAT.input.focus({ preventScroll: true }); } });
}

/* ---------- boot ---------- */
function boot() {
  renderTop(); $app.replaceChildren(SCREENS.landing());
  api('GET', '/api/me').then(function (r) {
    if (r.user) { ST.user = r.user; ST.aiOk = r.aiConfigured !== false; home(); }
  }).catch(function () { ST.offline = true; $app.replaceChildren(SCREENS.landing()); });
}
boot();
})();
