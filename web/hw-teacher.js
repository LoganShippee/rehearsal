'use strict';
/* Rehearsal Online Homework — Teacher Dashboard, Roster, Gradebook & Review Modal.
   Pure IIFE exposing window.HW_TEACHER. Depends on window.HW_TEACHER_API,
   window.HW_TEACHER_DRAWER, and .hwt-* styles in web/hw-teacher.css.
   Uses ONLY data-hwt / data-hwt-change / data-hwt-input attributes inside
   #hw-teacher-root, #hw-settings-card, #hw-sub-modal, and #hw-project-modal
   so web/app.js delegation (data-action / data-bind) never collides. */

(function () {
  const API = () => window.HW_TEACHER_API;
  const DRAWER = () => window.HW_TEACHER_DRAWER;

  const S_STATE = {
    rootEl: null,
    settingsEl: null,
    loading: false,
    initialized: false,
    error: '',
    me: null,
    capabilities: { googleSignInEnabled: false, billingEnabled: false },
    subTab: 'classes', // 'classes' | 'assignments' | 'gradebook' | 'account'

    classes: [],
    showArchivedClasses: false,
    selectedClassId: '',

    students: [],
    showArchivedStudents: false,

    assignments: [],
    showArchivedAssignments: false,

    gradebook: null,
    gbFilter: {
      search: '',
      part: '',
      status: 'all', // 'all' | 'flagged' | 'missing'
      assignmentId: '',
    },

    auth: {
      email: '',
      name: '',
      code: '',
      devCode: '',
      emailSent: false,
      ephemeral: false,
      busy: false,
      error: '',
      notice: '',
      serverUrl: '',
      showServerConfig: false,
      handoff: {
        active: false,
        state: '',
        pollSecret: '',
        url: '',
        expiresAt: 0,
        secondsLeft: 60,
        timer: null,
        countdownTimer: null,
      },
    },

    classForm: {
      open: false,
      name: '',
      localClassId: '',
      importRoster: true,
      busy: false,
    },

    rosterForm: {
      singleName: '',
      singlePart: '',
      singleEmail: '',
      showBulk: false,
      bulkText: '',
      importClassId: '',
      busy: false,
    },

    generatedCodes: null, // { classId, className, joinCode, items: [{ studentId, displayName, part, code }] }
    accountServerUrl: '',

    projectModal: {
      open: false,
      className: '',
      joinCode: '',
      portalUrl: '',
    },

    subModal: {
      open: false,
      loading: false,
      error: '',
      assignmentId: '',
      assignment: null,
      studentId: '',
      studentName: '',
      studentPart: '',
      attempts: [],
      activeIdx: 0,
      audioUrl: '',
      audioRevoke: null,
      audioError: '',
      audioLoading: false,
      audioRate: 1,
      overrideInput: '',
      commentInput: '',
      showSolfege: null,
      showCounts: null,
      busy: false,
    },
  };

  let escListenerInstalled = false;

  // ---------- Safe Rehearsal global bridges
  function escHtml(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showToast(msg, ms) {
    if (!msg) return;
    try {
      if (typeof toast === 'function') { toast(msg, ms); return; }
    } catch { }
    // Fallback silent if toast isn't mounted
  }

  function isNativeApp() {
    try {
      if (typeof IS_NATIVE !== 'undefined') return !!IS_NATIVE;
    } catch { }
    return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
  }

  function getLocalClasses() {
    try {
      if (typeof S !== 'undefined' && Array.isArray(S?.classes)) return S.classes;
    } catch { }
    return [];
  }

  function openDocPage(relPath) {
    if (!relPath) return;
    const url = API()?.getPublicDocUrl ? API().getPublicDocUrl(relPath) : (() => { try { return new URL(relPath, location.href).href; } catch { return relPath; } })();
    openExternalUrl(url);
  }

  function stopOAuthHandoff(clearUi = true) {
    const h = S_STATE.auth?.handoff;
    if (!h) return;
    if (h.timer) { clearInterval(h.timer); h.timer = null; }
    if (h.countdownTimer) { clearInterval(h.countdownTimer); h.countdownTimer = null; }
    if (clearUi) {
      h.active = false;
      h.state = '';
      h.pollSecret = '';
      h.url = '';
      h.expiresAt = 0;
      h.secondsLeft = 60;
    }
  }

  function openExternalUrl(url) {
    if (!url) return;
    try {
      if (typeof native === 'function' && native('openExternal', { url })) return;
    } catch { }
    window.open(url, '_blank', 'noopener');
  }

  function copyText(txt, label) {
    if (!txt) return;
    const okMsg = label ? `${label} copied.` : 'Copied to clipboard.';
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(txt).then(
        () => showToast(okMsg),
        () => fallbackCopy(txt, okMsg)
      );
      return;
    }
    fallbackCopy(txt, okMsg);
  }

  function fallbackCopy(txt, okMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(okMsg);
    } catch {
      showToast('Copy failed — select and copy manually.');
    }
  }

  // ---------- Plan & mode helpers
  function isOffline() {
    return !!(API()?.isOffline?.() || S_STATE.me?.offline || S_STATE.gradebook?.offline);
  }

  function currentPlan() {
    return S_STATE.me?.teacher?.plan || null;
  }

  function isReadOnly() {
    return !!currentPlan()?.readOnly;
  }

  function canWrite() {
    return !isOffline() && !isReadOnly();
  }

  function canDeleteOrExport() {
    return !isOffline();
  }

  function formatDateShort(ms) {
    if (!ms) return '';
    try {
      return new Date(Number(ms)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }

  function formatDateTimeShort(ms) {
    if (!ms) return '';
    try {
      return new Date(Number(ms)).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch { return ''; }
  }

  function daysUntil(ms) {
    if (!ms) return 0;
    return Math.max(0, Math.ceil((Number(ms) - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  function formatDuration(sec) {
    const n = Number(sec || 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return `${n.toFixed(1)}s`;
  }

  function formatCodeDisplay(raw) {
    if (API()?.formatCode) return API().formatCode(raw);
    const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
  }

  function getSelectedClass() {
    return S_STATE.classes.find(c => c.id === S_STATE.selectedClassId) || null;
  }

  function planBadgeInfo(plan) {
    if (!plan) return { cls: 'muted', label: 'No Plan' };
    if (plan.beta) return { cls: 'ok', label: 'Beta access' };
    switch (plan.status) {
      case 'trialing': return { cls: 'info', label: `Trial · ${plan.daysLeft ?? 0}d left` };
      case 'active': return { cls: 'ok', label: 'Active Pro' };
      case 'po_active': return { cls: 'ok', label: plan.poReference ? `School PO (${plan.poReference})` : 'School License' };
      case 'past_due': return { cls: 'warn', label: `Past-Due · ${plan.graceDaysLeft ?? 0}d grace` };
      case 'canceled': return { cls: 'danger', label: 'Canceled (Read-Only)' };
      case 'expired': return { cls: 'danger', label: 'Expired (Read-Only)' };
      default: return { cls: 'muted', label: plan.status || 'Plan' };
    }
  }

  // Small "Have a beta code?" box. Shown in the trial banner and the Account card
  // until the teacher has beta access. Errors show inline in .hwt-beta-err.
  function renderBetaCodeHTML(plan) {
    if (plan?.beta) {
      const until = plan.betaUntil || plan.betaEndsAt;
      return `<div class="small muted hwt-beta-note">Beta access${until ? ` until ${escHtml(formatDateShort(until))}` : ''}.</div>`;
    }
    return `
      <div class="hwt-beta-code">
        <label class="small" style="display:block;margin-bottom:4px">Have a beta code?</label>
        <div class="row" style="gap:6px">
          <input type="text" class="hwt-beta-input" placeholder="Beta code" autocomplete="off" spellcheck="false" maxlength="64" aria-label="Beta code">
          <button type="button" class="btn small" data-hwt="apply-beta-code">Apply</button>
        </div>
        <div class="small hwt-beta-err" role="alert"></div>
      </div>
    `;
  }

  // Students that count as real students (the built-in Test Student does not).
  function realStudents() {
    return S_STATE.students.filter(s => !s.isTest);
  }

  function typeLabel(t) {
    if (t === 'sight') return 'Sight Reading';
    if (t === 'score') return 'Score Practice';
    if (t === 'audio') return 'Audio Recording';
    return t || 'Assignment';
  }

  function inputModeLabel(m) {
    if (m === 'tap') return 'Tap';
    if (m === 'mic_rhythm') return 'Mic (Rhythm)';
    if (m === 'mic_pitch_rhythm') return 'Mic (Pitch + Rhythm)';
    if (m === 'audio') return 'Audio Recording';
    return m || '—';
  }

  // ---------- Audio Blob cleanup
  function revokeModalAudio() {
    const modal = document.getElementById('hw-sub-modal');
    if (modal) {
      modal.querySelectorAll('audio').forEach(a => {
        try { a.pause(); } catch { }
        try { a.removeAttribute('src'); } catch { }
        try { a.load(); } catch { }
      });
    }
    const sm = S_STATE.subModal;
    if (typeof sm.audioRevoke === 'function') {
      try { sm.audioRevoke(); } catch { }
    } else if (sm.audioUrl) {
      try { URL.revokeObjectURL(sm.audioUrl); } catch { }
    }
    sm.audioRevoke = null;
    sm.audioUrl = '';
    sm.audioError = '';
  }

  // ---------- Data loading
  async function loadSessionAndWorkspace(preserveTab) {
    const api = API();
    if (!api) {
      S_STATE.error = 'Online Homework API script failed to load.';
      renderAll();
      return;
    }

    S_STATE.auth.serverUrl = api.getApiBase();
    S_STATE.accountServerUrl = api.getApiBase();
    S_STATE.capabilities = await api.getCapabilities().catch(() => ({ googleSignInEnabled: false, billingEnabled: false }));

    const curTok = api.getToken();
    if (curTok && !api.isDemoMode() && /^(?:tok_)?demo_/i.test(curTok)) {
      api.clearSession();
    }

    if (!api.getToken()) {
      S_STATE.me = null;
      S_STATE.classes = [];
      S_STATE.students = [];
      S_STATE.assignments = [];
      S_STATE.gradebook = null;
      S_STATE.loading = false;
      S_STATE.initialized = true;
      renderAll();
      return;
    }

    S_STATE.loading = true;
    S_STATE.error = '';
    renderAll();

    const meRes = await api.getMe();
    if (!meRes || !meRes.ok) {
      S_STATE.loading = false;
      S_STATE.initialized = true;
      if (meRes?.status === 401 || !api.getToken()) {
        S_STATE.me = null;
        if (meRes?.status === 401) api.clearSession();
        S_STATE.auth.error = '';
      } else {
        S_STATE.error = meRes?.error || 'Could not load your teacher account.';
      }
      renderAll();
      return;
    }

    if (meRes.capabilities) S_STATE.capabilities = meRes.capabilities;
    S_STATE.me = meRes;
    if (!preserveTab && !S_STATE.subTab) S_STATE.subTab = 'classes';
    await loadClassesAndActiveData();
    S_STATE.loading = false;
    S_STATE.initialized = true;
    renderAll();
  }

  async function loadClassesAndActiveData() {
    const api = API();
    if (!api || !api.getToken()) return;

    const clsRes = await api.listClasses(S_STATE.showArchivedClasses);
    if (clsRes?.ok) {
      S_STATE.classes = Array.isArray(clsRes.classes) ? clsRes.classes : [];
      if (!S_STATE.selectedClassId || !S_STATE.classes.some(c => c.id === S_STATE.selectedClassId)) {
        S_STATE.selectedClassId = S_STATE.classes[0]?.id || '';
      }
    } else if (clsRes?.error) {
      S_STATE.error = clsRes.error;
    }

    await loadClassDetails(S_STATE.selectedClassId);
  }

  async function loadClassDetails(classId) {
    const api = API();
    if (!api || !classId) {
      S_STATE.students = [];
      S_STATE.assignments = [];
      S_STATE.gradebook = null;
      return;
    }

    const [stuRes, asgnRes, gbRes] = await Promise.all([
      api.listStudents(classId, S_STATE.showArchivedStudents),
      api.listAssignments(classId, S_STATE.showArchivedAssignments),
      api.getGradebook(classId),
    ]);

    const errs = [];
    if (stuRes?.ok) S_STATE.students = Array.isArray(stuRes.students) ? stuRes.students : [];
    else { S_STATE.students = []; if (stuRes?.error) errs.push(stuRes.error); }

    if (asgnRes?.ok) S_STATE.assignments = Array.isArray(asgnRes.assignments) ? asgnRes.assignments : [];
    else { S_STATE.assignments = []; if (asgnRes?.error) errs.push(asgnRes.error); }

    if (gbRes?.ok) S_STATE.gradebook = gbRes;
    else { S_STATE.gradebook = null; if (gbRes?.error) errs.push(gbRes.error); }

    if (errs.length) S_STATE.error = errs[0];
  }

  async function refreshAll() {
    await loadSessionAndWorkspace(true);
    showToast('Online Homework refreshed.');
  }

  // ---------- Modals management
  function closeProjectModal() {
    S_STATE.projectModal.open = false;
    const el = document.getElementById('hw-project-modal');
    if (el) el.remove();
  }

  function openProjectModal(cls) {
    const api = API();
    if (!cls || !api) return;
    S_STATE.projectModal = {
      open: true,
      className: cls.name,
      joinCode: formatCodeDisplay(cls.joinCode),
      portalUrl: api.getStudentPortalUrl(cls.joinCode),
    };
    renderProjectModal();
  }

  function closeSubModal() {
    revokeModalAudio();
    S_STATE.subModal.open = false;
    const el = document.getElementById('hw-sub-modal');
    if (el) el.remove();
  }

  async function openSubmissionModal(studentId, assignmentId) {
    const api = API();
    if (!api) return;

    revokeModalAudio();
    const gbStu = S_STATE.gradebook?.students?.find(s => s.id === studentId);
    const stuObj = gbStu || S_STATE.students.find(s => s.id === studentId);

    S_STATE.subModal = {
      open: true,
      loading: true,
      error: '',
      assignmentId,
      assignment: null,
      studentId,
      studentName: stuObj?.displayName || 'Student',
      studentPart: stuObj?.part || '',
      studentIsTest: !!stuObj?.isTest,
      attempts: [],
      activeIdx: 0,
      audioUrl: '',
      audioRevoke: null,
      audioError: '',
      audioLoading: false,
      audioRate: 1,
      overrideInput: '',
      commentInput: '',
      showSolfege: null,
      showCounts: null,
      busy: false,
    };
    renderSubModal();

    const res = await api.listSubmissions(assignmentId);
    if (!S_STATE.subModal.open || S_STATE.subModal.assignmentId !== assignmentId || S_STATE.subModal.studentId !== studentId) {
      return;
    }
    if (!res || !res.ok) {
      S_STATE.subModal.loading = false;
      S_STATE.subModal.error = res?.error || 'Could not load submission details.';
      renderSubModal();
      return;
    }

    const allSubs = Array.isArray(res.submissions) ? res.submissions : [];
    const stuSubs = allSubs
      .filter(s => s.studentId === studentId)
      .sort((a, b) => Number(a.attemptNum || 0) - Number(b.attemptNum || 0));

    S_STATE.subModal.loading = false;
    S_STATE.subModal.assignment = res.assignment || null;
    S_STATE.subModal.attempts = stuSubs;
    const defaultIdx = pickCountedAttemptIndex(stuSubs, res.assignment?.gradePolicy || 'best');
    await selectAttemptInModal(defaultIdx);
  }

  function pickCountedAttemptIndex(attempts, policy) {
    if (!attempts.length) return 0;
    if (policy === 'last') return attempts.length - 1;
    let bestIdx = 0;
    let bestScore = -1;
    attempts.forEach((s, i) => {
      const eff = s.effectivePct != null ? Number(s.effectivePct) : (s.overallPct != null ? Number(s.overallPct) : null);
      if (eff != null && eff >= bestScore) {
        bestScore = eff;
        bestIdx = i;
      }
    });
    return bestIdx;
  }

  async function selectAttemptInModal(idx) {
    const sm = S_STATE.subModal;
    revokeModalAudio();
    if (!sm.attempts.length) {
      sm.activeIdx = 0;
      sm.overrideInput = '';
      sm.commentInput = '';
      renderSubModal();
      return;
    }

    const clamped = Math.max(0, Math.min(idx, sm.attempts.length - 1));
    sm.activeIdx = clamped;
    const sub = sm.attempts[clamped];
    sm.overrideInput = sub.teacherOverridePct != null ? String(sub.teacherOverridePct) : '';
    sm.commentInput = sub.teacherComment || '';
    sm.audioLoading = !!sub.audioAvailable && !isOffline();
    renderSubModal();

    if (sub.audioAvailable && !isOffline()) {
      const targetSubId = sub.id;
      const audioRes = await API().fetchSubmissionAudioUrl(targetSubId);
      const curSub = S_STATE.subModal.attempts[S_STATE.subModal.activeIdx];
      if (!S_STATE.subModal.open || !curSub || curSub.id !== targetSubId) {
        // User switched attempt or closed modal while fetching — immediately revoke leaked URL
        if (audioRes?.revoke) try { audioRes.revoke(); } catch { }
        else if (audioRes?.url) try { URL.revokeObjectURL(audioRes.url); } catch { }
        return;
      }
      S_STATE.subModal.audioLoading = false;
      if (audioRes?.ok && audioRes.url) {
        S_STATE.subModal.audioUrl = audioRes.url;
        S_STATE.subModal.audioRevoke = audioRes.revoke || (() => { try { URL.revokeObjectURL(audioRes.url); } catch { } });
      } else {
        S_STATE.subModal.audioError = audioRes?.error || 'Could not load audio recording.';
      }
      renderSubModal();
    }
  }

  function getNavigableStudentsForAssignment(assignmentId) {
    const students = getFilteredGradebookStudents();
    return students.filter(st => {
      const cell = st.cells?.[assignmentId];
      return cell && cell.status !== 'missing' && cell.attempts > 0;
    });
  }

  // ---------- Rendering: Main Tab & Sign-In
  function renderAll() {
    renderMain();
    renderSettingsCardContent();
    if (S_STATE.projectModal.open) renderProjectModal();
    if (S_STATE.subModal.open) renderSubModal();
  }

  function renderMain() {
    const root = S_STATE.rootEl || document.getElementById('hw-teacher-root');
    if (!root || !document.body.contains(root)) return;
    S_STATE.rootEl = root;
    bindRootEvents(root);

    const api = API();
    if (!api) {
      root.innerHTML = `<div class="card"><div class="empty">Online Homework API could not load.</div></div>`;
      return;
    }

    if (S_STATE.loading && !S_STATE.me) {
      root.innerHTML = `<div class="card"><div class="empty">Loading Online Homework…</div></div>`;
      return;
    }

    if (!api.getToken() || !S_STATE.me?.teacher) {
      root.innerHTML = renderSignInHTML();
      return;
    }

    root.innerHTML = renderWorkspaceHTML();
  }

  function renderSignInHTML() {
    const api = API();
    const a = S_STATE.auth;
    const isDemo = api.isDemoMode();
    const nativeApp = isNativeApp();
    const gClientId = window.HW_GOOGLE_CLIENT_ID || '';
    const googleEnabled = isDemo || !!S_STATE.capabilities?.googleSignInEnabled || !!gClientId;

    let googleSection = '';
    if (isDemo) {
      googleSection = `
        <div class="row">
          <button type="button" class="btn" data-hwt="auth-google" ${a.busy ? 'disabled' : ''}>Sign in with Google (Local Preview)</button>
          <button type="button" class="btn" data-hwt="auth-google-handoff" ${a.busy || a.handoff?.active ? 'disabled' : ''}>Test Desktop Browser Handoff</button>
        </div>
      `;
    } else if (googleEnabled && nativeApp) {
      googleSection = `
        <button type="button" class="btn" data-hwt="auth-google-handoff" ${a.busy || a.handoff?.active ? 'disabled' : ''}>Sign in with Google (Opens Browser)</button>
        <div class="small muted">Opens your system browser using a secure 60-second sign-in handoff so school Google accounts work smoothly.</div>
      `;
    } else if (googleEnabled) {
      googleSection = `
        <button type="button" class="btn" data-hwt="auth-google" ${a.busy ? 'disabled' : ''}>Sign in with Google</button>
      `;
    }

    const handoffBox = a.handoff?.active ? `
      <div class="hwt-handoff-box">
        <div><strong>Waiting for Google Sign-In in your browser… ${Math.max(0, Number(a.handoff.secondsLeft || 0))}s left</strong></div>
        <div class="small">Finish signing in inside the opened browser tab, then return here — your workspace will load automatically.</div>
        <div class="row">
          <button type="button" class="btn small primary" data-hwt="auth-handoff-reopen">Re-open Browser Window</button>
          <button type="button" class="btn small" data-hwt="auth-handoff-cancel">Cancel</button>
        </div>
      </div>
    ` : '';

    let qsDemo = false;
    try { qsDemo = new URLSearchParams(location.search).get('demo') === '1'; } catch { }

    return `
      <div class="hwt-auth-card">
        <div>
          <h2>Online Homework — Teacher Sign-In</h2>
          <p class="desc" style="margin-bottom:0">Create classes, print simple student sign-in codes, assign Sight Reading or Score Practice, and listen to student recordings. Your local classroom tools stay free forever on this device.</p>
        </div>

        <div class="hwt-trial-hero">
          <div class="hwt-trial-head">
            <strong>30-Day Free Trial — No Credit Card Required</strong>
            <span class="hwt-pill ok">Up to 200 students</span>
          </div>
          <div class="hwt-trial-points">Try every homework feature right away by entering your school email below. After 30 days, continue for $5/mo or $49/yr (or a School Purchase Order).</div>
        </div>

        ${qsDemo ? `<div class="hwt-banner info">
          <div><b>Preview Mode Active</b> — Exploring sample classes and students from <code>?demo=1</code>.</div>
        </div>` : ''}

        ${a.error ? `<div class="hwt-banner readonly">${escHtml(a.error)}</div>` : ''}
        ${a.notice ? `<div class="hwt-banner info">${escHtml(a.notice)}</div>` : ''}

        <div class="hwt-auth-grid">
          <label class="fld">
            <span>School Email</span>
            <input type="email" placeholder="teacher@school.edu" value="${escHtml(a.email)}" data-hwt-input="auth-email" ${a.emailSent ? 'readonly' : ''}>
          </label>
          <label class="fld">
            <span>Your Name (first time)</span>
            <input type="text" placeholder="Ms. Rivera" value="${escHtml(a.name)}" data-hwt-input="auth-name">
          </label>
        </div>

        ${a.emailSent ? `
          <div style="display:flex;flex-direction:column;gap:10px">
            <label class="fld">
              <span>6-Digit Sign-In Code</span>
              <input type="text" inputmode="numeric" maxlength="8" placeholder="123456" value="${escHtml(a.code)}" data-hwt-input="auth-code" style="font-size:18px;letter-spacing:0.18em;max-width:220px">
            </label>
            ${a.devCode ? `
              <div class="hwt-devcode">
                <span>Sign-in code: <b>${escHtml(a.devCode)}</b></span>
                <button type="button" class="btn small primary" data-hwt="auth-use-devcode" ${a.busy ? 'disabled' : ''}>Fill &amp; Sign In (${escHtml(a.devCode)})</button>
              </div>
            ` : ''}
            <div class="row">
              <button type="button" class="btn primary" data-hwt="auth-verify" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Signing in…' : 'Verify & Sign In'}</button>
              <button type="button" class="btn" data-hwt="auth-resend" ${a.busy ? 'disabled' : ''}>Resend Code</button>
              <button type="button" class="btn ghost" data-hwt="auth-reset-email" ${a.busy ? 'disabled' : ''}>Change Email</button>
            </div>
          </div>
        ` : `
          <div class="row">
            <button type="button" class="btn primary" data-hwt="auth-send-code" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Sending…' : 'Start Free Trial / Send Sign-In Code'}</button>
            <button type="button" class="btn hwt-demo-btn" data-hwt="open-demo">See How It Works &amp; Student Demo ↗</button>
          </div>
          <div class="small muted">New here? Entering your school email automatically starts your free 30-day trial — no password or credit card needed.</div>
        `}

        <label class="chk">
          <input type="checkbox" data-hwt-change="auth-ephemeral" ${a.ephemeral ? 'checked' : ''}>
          Shared / classroom computer (sign out automatically when browser closes)
        </label>

        ${googleSection ? `
          <div class="hwt-divider">or</div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
            ${googleSection}
          </div>
        ` : ''}
        ${handoffBox}

        <div class="hwt-privacy-note">
          <b>Privacy &amp; Data Note:</b> Student login codes are protected like passwords, student audio recordings auto-delete after 90 days (or anytime you click Delete Audio Now), and your classroom setup stays private on this device.
          <div class="row" style="margin-top:6px;gap:12px">
            <a href="${escHtml(api.getPublicDocUrl('privacy.html'))}" target="_blank" rel="noopener" data-hwt="open-doc" data-href="privacy.html">Privacy Policy</a>
            <a href="${escHtml(api.getPublicDocUrl('privacy-sdpc.html'))}" target="_blank" rel="noopener" data-hwt="open-doc" data-href="privacy-sdpc.html">1-Page SDPC Summary</a>
            <a href="${escHtml(api.getPublicDocUrl('it-whitelisting.html'))}" target="_blank" rel="noopener" data-hwt="open-doc" data-href="it-whitelisting.html">IT Admin Info</a>
          </div>
        </div>
      </div>
    `;
  }

  function renderWorkspaceHTML() {
    const api = API();
    const teacher = S_STATE.me.teacher;
    const plan = teacher.plan || {};
    const badge = planBadgeInfo(plan);
    const isDemo = api.isDemoMode();
    const offline = isOffline();

    return `
      <div class="hwt-header">
        <div class="hwt-header-info">
          <h2>
            <span>${escHtml(teacher.name || teacher.email)}</span>
            <span class="hwt-pill ${badge.cls}">${escHtml(badge.label)}</span>
            ${isDemo ? `<span class="hwt-pill info">Local Preview</span>` : ''}
            ${S_STATE.me.ephemeral ? `<span class="hwt-pill muted">Shared Computer</span>` : ''}
          </h2>
          <div class="small muted">${escHtml(teacher.email)} · ${Number(S_STATE.me.activeStudentCount || 0)} active student${Number(S_STATE.me.activeStudentCount || 0) === 1 ? '' : 's'}</div>
        </div>
        <div class="hwt-header-actions">
          <button type="button" class="btn primary" data-hwt="open-assign-picker" ${canWrite() ? '' : 'disabled'}>+ Assign Homework</button>
          <button type="button" class="btn" data-hwt="refresh" ${S_STATE.loading ? 'disabled' : ''}>${S_STATE.loading ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" class="btn" data-hwt="logout">Sign Out</button>
        </div>
      </div>

      ${renderBannersHTML(plan, offline)}
      ${S_STATE.error ? `<div class="hwt-banner readonly"><div>${escHtml(S_STATE.error)}</div><button type="button" class="btn small" data-hwt="dismiss-error">Dismiss</button></div>` : ''}

      <nav class="hwt-subtabs" role="tablist">
        <button type="button" class="hwt-subtab ${S_STATE.subTab === 'classes' ? 'on' : ''}" data-hwt="subtab" data-subtab="classes">Classes &amp; Roster</button>
        <button type="button" class="hwt-subtab ${S_STATE.subTab === 'assignments' ? 'on' : ''}" data-hwt="subtab" data-subtab="assignments">Assignments</button>
        <button type="button" class="hwt-subtab ${S_STATE.subTab === 'gradebook' ? 'on' : ''}" data-hwt="subtab" data-subtab="gradebook">Gradebook</button>
        <button type="button" class="hwt-subtab ${S_STATE.subTab === 'account' ? 'on' : ''}" data-hwt="subtab" data-subtab="account">Account &amp; Plan</button>
      </nav>

      ${renderActiveSubTabHTML()}
    `;
  }

  function renderBannersHTML(plan, offline) {
    const api = API();
    const out = [];

    if (offline) {
      const info = api.getCacheInfo?.() || {};
      const when = info.updatedAt ? `Last synced ${formatDateTimeShort(info.updatedAt)}.` : 'Showing cached data.';
      out.push(`
        <div class="hwt-banner offline">
          <div><b>Offline Cache Mode:</b> You are viewing cached classes, assignments, and grades (${escHtml(when)}). Edits, new assignments, audio playback, and deletions are paused until back online, while Gradebook CSV export still works.</div>
          ${api.isDemoMode() ? `<button type="button" class="btn small" data-hwt="toggle-demo-offline">Go Back Online</button>` : ''}
        </div>
      `);
    }

    if (plan.readOnly) {
      out.push(`
        <div class="hwt-banner readonly">
          <div><b>Read-Only Mode:</b> ${escHtml(plan.reason || 'Your Online Homework plan is inactive. Creating or editing classes, assignments, and grades is disabled, while viewing the Gradebook, playing audio, exporting CSV/FERPA JSON data, and deleting records still work.')}</div>
          <button type="button" class="btn small primary" data-hwt="goto-account">View Plan / Upgrade</button>
        </div>
      `);
    } else if (plan.status === 'past_due' || plan.inGrace) {
      out.push(`
        <div class="hwt-banner warn">
          <div><b>Payment Grace Period:</b> ${escHtml(plan.warning || `Payment issue — ${plan.graceDaysLeft ?? 0} days left before read-only mode.`)}</div>
          <button type="button" class="btn small primary" data-hwt="billing-portal">Update Billing</button>
        </div>
      `);
    } else if (plan.status === 'trialing') {
      out.push(`
        <div class="hwt-banner info">
          <div><b>Free 30-Day Trial:</b> ${Number(plan.daysLeft || 0)} day${Number(plan.daysLeft || 0) === 1 ? '' : 's'} remaining (up to ${Number(plan.studentSoftCap || 200)} students, no card required).
            ${renderBetaCodeHTML(plan)}</div>
          <button type="button" class="btn small" data-hwt="goto-account">View Plans</button>
        </div>
      `);
    }

    if (S_STATE.me?.overSoftCap) {
      out.push(`
        <div class="hwt-banner warn">
          <div><b>Over Soft Student Cap:</b> You currently have ${Number(S_STATE.me.activeStudentCount || 0)} active students (standard teacher plan soft cap is ${Number(plan.studentSoftCap || 200)}). Nothing is locked — archive finished classes or contact us for a school/district license.</div>
          <button type="button" class="btn small" data-hwt="goto-account">Account &amp; Plan</button>
        </div>
      `);
    }

    return out.join('');
  }

  function renderActiveSubTabHTML() {
    switch (S_STATE.subTab) {
      case 'classes': return renderClassesSubTabHTML();
      case 'assignments': return renderAssignmentsSubTabHTML();
      case 'gradebook': return renderGradebookSubTabHTML();
      case 'account': return renderAccountSubTabHTML();
      default: return renderClassesSubTabHTML();
    }
  }

  // ---------- Sub-tab 1: Classes & Roster
  function renderClassesSubTabHTML() {
    const cls = getSelectedClass();
    const localClasses = getLocalClasses();
    const cf = S_STATE.classForm;
    const writable = canWrite();
    const online = canDeleteOrExport();

    const sidebarHTML = `
      <aside class="hwt-sidebar">
        <div class="card">
          <div class="card-head">
            <h3>Classes</h3>
            <span class="grow"></span>
            <button type="button" class="btn small primary" data-hwt="toggle-new-class" ${writable ? '' : 'disabled'}>+ New Class</button>
          </div>

          ${cf.open ? `
            <div class="hwt-bulk-box" style="margin-bottom:10px">
              ${localClasses.length ? `
                <label class="fld">
                  <span>Copy from Rehearsal Class (optional)</span>
                  <select data-hwt-change="new-class-local">
                    <option value="">— Start blank —</option>
                    ${localClasses.map(lc => `<option value="${escHtml(lc.id)}" ${cf.localClassId === lc.id ? 'selected' : ''}>${escHtml(lc.name)}${lc.subtitle ? ' · ' + escHtml(lc.subtitle) : ''}${lc.roster?.length ? ` (${lc.roster.length} students)` : ''}</option>`).join('')}
                  </select>
                </label>
              ` : ''}
              <label class="fld">
                <span>Class Name</span>
                <input type="text" placeholder="Concert Choir — Period 2" value="${escHtml(cf.name)}" data-hwt-input="new-class-name">
              </label>
              ${cf.localClassId && localClasses.find(c => c.id === cf.localClassId)?.roster?.length ? `
                <label class="chk">
                  <input type="checkbox" data-hwt-change="new-class-import" ${cf.importRoster ? 'checked' : ''}>
                  Also import roster names &amp; generate codes
                </label>
              ` : ''}
              <div class="row">
                <button type="button" class="btn small primary" data-hwt="create-class" ${cf.busy || !writable ? 'disabled' : ''}>${cf.busy ? 'Creating…' : 'Create Class'}</button>
                <button type="button" class="btn small" data-hwt="cancel-new-class">Cancel</button>
              </div>
            </div>
          ` : ''}

          <label class="chk" style="margin-bottom:8px">
            <input type="checkbox" data-hwt-change="toggle-archived-classes" ${S_STATE.showArchivedClasses ? 'checked' : ''}>
            Show archived classes
          </label>

          <div class="list">
            ${S_STATE.classes.length ? S_STATE.classes.map(c => `
              <div class="list-item ${c.id === S_STATE.selectedClassId ? 'on' : ''}" data-hwt="select-class" data-id="${escHtml(c.id)}">
                <span class="grow" style="min-width:0">
                  <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.name)}</div>
                  <div class="small muted">Code: <code>${escHtml(formatCodeDisplay(c.joinCode))}</code> · ${Number(c.studentCount || 0)} stu</div>
                </span>
                ${c.archivedAt ? `<span class="hwt-pill muted">Archived</span>` : (c.locked ? `<span class="hwt-pill warn">Locked</span>` : '')}
              </div>
            `).join('') : '<div class="empty">No online classes yet. Click "+ New Class" to create one.</div>'}
          </div>
        </div>
      </aside>
    `;

    if (!cls) {
      return `
        <div class="hwt-split">
          ${sidebarHTML}
          <div class="hwt-main">
            <div class="card">
              <h2 style="margin-top:0">Get Started in 3 Easy Steps</h2>
              <p class="desc">Set up your first Online Homework class in under 2 minutes — students sign in with simple 6-character codes (no student email addresses required).</p>
              <ol style="margin:0 0 16px 20px;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13.5px">
                <li><strong>Create a class</strong> (or copy the roster from one of your Rehearsal classroom periods).</li>
                <li><strong>Add students &amp; print Student Code slips</strong> so everyone has their 6-character sign-in code.</li>
                <li><strong>Assign Sight Reading, Score Practice, or Audio Check-Ins</strong> and listen to recordings in the Gradebook.</li>
              </ol>
              <div class="row">
                <button type="button" class="btn primary" data-hwt="toggle-new-class" ${writable ? '' : 'disabled'}>+ Create Your First Class</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const api = API();
    const joinCodeFmt = formatCodeDisplay(cls.joinCode);
    const portalUrl = api.getStudentPortalUrl(cls.joinCode);
    const rf = S_STATE.rosterForm;
    const localWithRoster = localClasses.filter(c => Array.isArray(c.roster) && c.roster.length > 0);
    const codeAlert = S_STATE.generatedCodes && S_STATE.generatedCodes.classId === cls.id ? S_STATE.generatedCodes : null;

    return `
      <div class="hwt-split">
        ${sidebarHTML}
        <div class="hwt-main">
          <div class="hwt-joincode-card">
            <div style="display:flex;flex-direction:column;gap:6px">
              <div class="row">
                <h2 style="margin:0">${escHtml(cls.name)}</h2>
                ${cls.archivedAt ? `<span class="hwt-pill muted">Archived</span>` : ''}
                ${cls.locked ? `<span class="hwt-pill warn">Class Locked (no new Google self-joins)</span>` : `<span class="hwt-pill ok">Open for Join</span>`}
              </div>
              <div class="row" style="margin-top:4px">
                <span class="hwt-joincode-big">${escHtml(joinCodeFmt)}</span>
                <div style="display:flex;flex-direction:column;gap:4px">
                  <span class="small muted">Class Join Code</span>
                  <a class="small" href="${escHtml(portalUrl)}" target="_blank" rel="noopener">Open Student Portal (${escHtml(joinCodeFmt)}) ↗</a>
                </div>
              </div>
            </div>

            <div class="row">
              <button type="button" class="btn small" data-hwt="copy-join-code">Copy Code</button>
              <button type="button" class="btn small" data-hwt="copy-portal-link">Copy Student Link</button>
              <button type="button" class="btn small primary" data-hwt="project-big">Project Big</button>
              <button type="button" class="btn small" data-hwt="rotate-join-code" ${writable ? '' : 'disabled'}>Rotate Join Code</button>
              <button type="button" class="btn small" data-hwt="toggle-lock-class" ${writable ? '' : 'disabled'}>${cls.locked ? 'Unlock Class' : 'Lock Class'}</button>
            </div>
          </div>

          ${codeAlert ? renderCodeAlertHTML(codeAlert) : ''}

          <div class="card">
            <div class="card-head">
              <h3>Add Students</h3>
              <span class="grow"></span>
              <button type="button" class="btn small" data-hwt="toggle-bulk-paste">${rf.showBulk ? 'Hide Bulk Paste' : 'Bulk Paste List'}</button>
              <button type="button" class="btn small" data-hwt="regen-all-codes" ${writable && realStudents().length ? '' : 'disabled'}>Regenerate &amp; Print All Student Codes</button>
            </div>

            <div class="row" style="align-items:flex-end">
              <label class="fld" style="flex:2;min-width:160px">
                <span>Student Name</span>
                <input type="text" placeholder="Elena Vance" value="${escHtml(rf.singleName)}" data-hwt-input="stu-name" ${writable ? '' : 'disabled'}>
              </label>
              <label class="fld" style="flex:1;min-width:120px">
                <span>Part (optional)</span>
                <input type="text" placeholder="Soprano" value="${escHtml(rf.singlePart)}" data-hwt-input="stu-part" ${writable ? '' : 'disabled'}>
              </label>
              <label class="fld" style="flex:1.5;min-width:160px">
                <span>Email (optional)</span>
                <input type="email" placeholder="student@school.edu" value="${escHtml(rf.singleEmail)}" data-hwt-input="stu-email" ${writable ? '' : 'disabled'}>
              </label>
              <button type="button" class="btn primary" data-hwt="add-single-student" ${writable && !rf.busy ? '' : 'disabled'}>Add Student</button>
            </div>

            ${rf.showBulk ? `
              <div class="hwt-bulk-box" style="margin-top:12px">
                <label class="fld">
                  <span>Paste one student per line: <code>Name</code> or <code>Name, Part</code> or <code>Name, Part, Email</code></span>
                  <textarea rows="5" placeholder="Maya Lin, Soprano&#10;Jordan Ortiz, Tenor&#10;Priya Patel, Alto, priya@school.edu" data-hwt-input="stu-bulk">${escHtml(rf.bulkText)}</textarea>
                </label>
                <div class="row">
                  <button type="button" class="btn small primary" data-hwt="add-bulk-students" ${writable && !rf.busy ? '' : 'disabled'}>Add All &amp; Generate Codes</button>
                  <button type="button" class="btn small" data-hwt="toggle-bulk-paste">Cancel</button>
                </div>
              </div>
            ` : ''}

            ${localWithRoster.length ? `
              <div class="row" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--e-line)">
                <span class="small muted">Import from Rehearsal class roster:</span>
                <select data-hwt-change="roster-import-select" ${writable ? '' : 'disabled'}>
                  <option value="">— Choose a class —</option>
                  ${localWithRoster.map(lc => `<option value="${escHtml(lc.id)}" ${rf.importClassId === lc.id ? 'selected' : ''}>${escHtml(lc.name)} (${lc.roster.length} students)</option>`).join('')}
                </select>
                <button type="button" class="btn small" data-hwt="import-local-roster" ${writable && rf.importClassId && !rf.busy ? '' : 'disabled'}>Import Roster</button>
              </div>
            ` : ''}
          </div>

          <div class="card">
            <div class="card-head">
              <h3>Roster (${realStudents().length})</h3>
              <span class="grow"></span>
              <button type="button" class="btn small" data-hwt="export-roster-csv" ${realStudents().length ? '' : 'disabled'}>Export Roster CSV</button>
              <label class="chk">
                <input type="checkbox" data-hwt-change="toggle-archived-students" ${S_STATE.showArchivedStudents ? 'checked' : ''}>
                Show archived students
              </label>
            </div>

            ${S_STATE.students.length ? `
              <div style="overflow-x:auto">
                <table class="hwt-stu-tbl">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Part</th>
                      <th>Sign-In</th>
                      <th>Takes</th>
                      <th>Last Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${S_STATE.students.map(st => renderStudentRowHTML(st, writable, online)).join('')}
                  </tbody>
                </table>
              </div>
            ` : `<div class="empty">No students in this class yet. Add a student above (or paste your roster) to generate their printable 6-character <strong>Student Code</strong>${S_STATE.capabilities?.googleSignInEnabled ? `, or share Class Code <b>${escHtml(joinCodeFmt)}</b> for Google Sign-In` : ''}.</div>`}
          </div>

          <div class="hwt-danger-bar">
            <div class="small"><b>Class Controls:</b> Sign out shared Chromebooks, archive finished terms, or permanently erase all class data &amp; audio.</div>
            <div class="row">
              <button type="button" class="btn small" data-hwt="revoke-class-sessions" ${online ? '' : 'disabled'}>Sign Out All Students</button>
              ${cls.archivedAt
                ? `<button type="button" class="btn small" data-hwt="restore-class" ${writable ? '' : 'disabled'}>Restore Class</button>`
                : `<button type="button" class="btn small" data-hwt="archive-class" ${online ? '' : 'disabled'}>Archive Class</button>`}
              <button type="button" class="btn small danger" data-hwt="delete-class" ${online ? '' : 'disabled'}>Delete Class Permanently</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderCodeAlertHTML(codeAlert) {
    return `
      <div class="hwt-code-alert">
        <div class="row">
          <div>
            <b>One-Time Student Sign-In Codes (${codeAlert.items.length})</b>
            <div class="small">Save or print these codes now — for student security, plaintext codes are never stored and cannot be viewed again after you dismiss this box.</div>
          </div>
          <span class="grow"></span>
          <button type="button" class="btn small primary" data-hwt="print-codes">Print Student Code Sheet</button>
          <button type="button" class="btn small" data-hwt="download-codes-csv">Download Codes CSV</button>
          <button type="button" class="btn small" data-hwt="copy-all-codes">Copy All</button>
          <button type="button" class="btn small" data-hwt="dismiss-codes">Dismiss</button>
        </div>
        <div class="hwt-code-list">
          ${codeAlert.items.map(it => `
            <div>
              <div style="font-weight:700">${escHtml(it.displayName)}${it.part ? ` <span class="small" style="font-weight:400">(${escHtml(it.part)})</span>` : ''}</div>
              <div>Student Code: <code>${escHtml(formatCodeDisplay(it.code))}</code></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderStudentRowHTML(st, writable, online) {
    // The built-in Test Student: a purple row, no sign-in code, no edit/delete/archive.
    if (st.isTest) {
      return `
        <tr class="hwt-test-row">
          <td>
            <div style="font-weight:600">Test Student <span class="hwt-test-tag">Test</span></div>
            <div class="small muted">Not counted in grades</div>
          </td>
          <td><span class="muted">—</span></td>
          <td><span class="small muted">No sign-in code</span></td>
          <td>${Number(st.submissionCount || 0)}</td>
          <td class="small muted">${st.lastActiveAt ? escHtml(formatDateShort(st.lastActiveAt)) : 'Never'}</td>
          <td>
            <div class="row" style="gap:5px">
              <button type="button" class="btn small" data-hwt="open-test-student" ${online ? '' : 'disabled'} title="Open Rehearsal as this test student in a new window">Open as student ↗</button>
            </div>
          </td>
        </tr>
      `;
    }
    const badges = [];
    if (st.hasGoogle) badges.push(`<span class="hwt-pill ok">Google</span>`);
    if (st.hasCode) badges.push(`<span class="hwt-pill info">Code</span>`);
    if (st.codeLocked) badges.push(`<span class="hwt-pill danger">Locked (10 fails)</span>`);
    else if (st.codeCooldownUntil && st.codeCooldownUntil > Date.now()) badges.push(`<span class="hwt-pill warn">Cooldown</span>`);
    if (st.archivedAt) badges.push(`<span class="hwt-pill muted">Archived</span>`);

    return `
      <tr>
        <td>
          <div style="font-weight:600">${escHtml(st.displayName)}</div>
          ${st.email ? `<div class="small muted">${escHtml(st.email)}</div>` : ''}
        </td>
        <td>${st.part ? escHtml(st.part) : '<span class="muted">—</span>'}</td>
        <td><div class="row" style="gap:4px">${badges.join('') || '<span class="muted">—</span>'}</div></td>
        <td>${Number(st.submissionCount || 0)}</td>
        <td class="small muted">${st.lastActiveAt ? escHtml(formatDateShort(st.lastActiveAt)) : 'Never'}</td>
        <td>
          <div class="row" style="gap:5px">
            <button type="button" class="btn small" data-hwt="stu-new-code" data-id="${escHtml(st.id)}" ${writable ? '' : 'disabled'} title="Generate a new 6-char code and unlock account">New Code</button>
            <button type="button" class="btn small" data-hwt="stu-signout" data-id="${escHtml(st.id)}" ${online ? '' : 'disabled'} title="Revoke active student sessions">Sign Out</button>
            <button type="button" class="btn small" data-hwt="stu-export" data-id="${escHtml(st.id)}" ${online ? '' : 'disabled'} title="Download FERPA/COPPA student data JSON">Export Data</button>
            ${st.archivedAt
              ? `<button type="button" class="btn small" data-hwt="stu-restore" data-id="${escHtml(st.id)}" ${writable ? '' : 'disabled'}>Restore</button>`
              : `<button type="button" class="btn small" data-hwt="stu-archive" data-id="${escHtml(st.id)}" ${online ? '' : 'disabled'}>Archive</button>`}
            <button type="button" class="btn small danger" data-hwt="stu-delete" data-id="${escHtml(st.id)}" ${online ? '' : 'disabled'}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ---------- Sub-tab 2: Assignments
  function renderAssignmentsSubTabHTML() {
    const writable = canWrite();
    const online = canDeleteOrExport();
    const cls = getSelectedClass();

    return `
      <div class="hwt-gb-controls">
        <div class="row">
          <label class="row small">
            <span class="muted">Class:</span>
            <select data-hwt-change="select-class-dropdown">
              ${S_STATE.classes.map(c => `<option value="${escHtml(c.id)}" ${c.id === S_STATE.selectedClassId ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="chk">
            <input type="checkbox" data-hwt-change="toggle-archived-assignments" ${S_STATE.showArchivedAssignments ? 'checked' : ''}>
            Show archived
          </label>
        </div>
        <div class="row">
          <button type="button" class="btn small primary" data-hwt="open-assign-picker" ${writable && cls ? '' : 'disabled'}>+ Sight Reading / Score</button>
          <button type="button" class="btn small" data-hwt="open-assign-audio" ${writable && cls ? '' : 'disabled'}>+ Audio Recording</button>
        </div>
      </div>

      ${!cls ? `<div class="card"><div class="empty">Create a class first in Classes &amp; Roster to assign homework.</div></div>` : `
        <div class="hwt-asgn-list">
          ${S_STATE.assignments.length ? S_STATE.assignments.map(a => renderAssignmentCardHTML(a, writable, online)).join('') : `
            <div class="card"><div class="empty">No assignments in ${escHtml(cls.name)} yet. Use "+ Assign Homework" above or click <b>Assign</b> inside Sight Reading or Score Practice on the Present screen.</div></div>
          `}
        </div>
      `}
    `;
  }

  function renderAssignmentCardHTML(a, writable, online) {
    const dueStr = a.dueAt ? `Due ${formatDateTimeShort(a.dueAt)}` : 'No due date';
    const attStr = a.maxAttempts ? `${a.maxAttempts} attempt${a.maxAttempts === 1 ? '' : 's'} max` : 'Unlimited attempts';
    const polStr = a.gradePolicy === 'last' ? 'Most recent counts' : 'Best attempt counts';
    const avgStr = a.avgPct != null ? `Avg: ${Math.round(Number(a.avgPct))}%` : 'No grades yet';

    return `
      <div class="hwt-asgn-card">
        <div class="row">
          <h3>${escHtml(a.title)}</h3>
          <span class="hwt-pill ${a.published ? 'ok' : 'muted'}">${a.published ? 'Published' : 'Draft'}</span>
          <span class="hwt-pill info">${escHtml(typeLabel(a.type))}</span>
          ${a.mode === 'true_sight_read' ? `<span class="hwt-pill warn">True Sight-Read (${Number(a.config?.studySeconds || 30)}s)</span>` : ''}
          ${a.archivedAt ? `<span class="hwt-pill muted">Archived</span>` : ''}
        </div>
        ${a.instructions ? `<div class="small muted">${escHtml(a.instructions)}</div>` : ''}
        <div class="hwt-asgn-meta">
          <span>${escHtml(dueStr)}</span>
          <span>• ${escHtml(attStr)}</span>
          <span>• ${escHtml(polStr)}</span>
          <span>• ${Number(a.submissionCount || 0)} submission${Number(a.submissionCount || 0) === 1 ? '' : 's'}</span>
          <span>• <b>${escHtml(avgStr)}</b></span>
        </div>
        <div class="hwt-asgn-actions">
          <button type="button" class="btn small primary" data-hwt="review-asgn" data-id="${escHtml(a.id)}">Review Submissions</button>
          <button type="button" class="btn small" data-hwt="preview-asgn" data-id="${escHtml(a.id)}" ${online ? '' : 'disabled'}>Preview as Student ↗</button>
          <button type="button" class="btn small" data-hwt="toggle-publish" data-id="${escHtml(a.id)}" ${writable ? '' : 'disabled'}>${a.published ? 'Unpublish' : 'Publish'}</button>
          <button type="button" class="btn small" data-hwt="edit-asgn" data-id="${escHtml(a.id)}" ${writable ? '' : 'disabled'}>Edit</button>
          ${a.archivedAt
            ? `<button type="button" class="btn small" data-hwt="restore-asgn" data-id="${escHtml(a.id)}" ${writable ? '' : 'disabled'}>Restore</button>`
            : `<button type="button" class="btn small" data-hwt="archive-asgn" data-id="${escHtml(a.id)}" ${online ? '' : 'disabled'}>Archive</button>`}
          <button type="button" class="btn small danger" data-hwt="delete-asgn" data-id="${escHtml(a.id)}" ${online ? '' : 'disabled'}>Delete</button>
        </div>
      </div>
    `;
  }

  // ---------- Sub-tab 3: Gradebook
  function getFilteredGradebookStudents() {
    const gb = S_STATE.gradebook;
    if (!gb || !Array.isArray(gb.students)) return [];
    const q = S_STATE.gbFilter.search.trim().toLowerCase();
    const part = S_STATE.gbFilter.part;
    const status = S_STATE.gbFilter.status;
    const focusedAsgnId = S_STATE.gbFilter.assignmentId;
    const asgns = focusedAsgnId
      ? (gb.assignments || []).filter(a => a.id === focusedAsgnId)
      : (gb.assignments || []);

    return gb.students.filter(st => {
      if (q && !`${st.displayName} ${st.part || ''} ${st.email || ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (part && (st.part || '') !== part) return false;
      if (status === 'flagged') {
        return asgns.some(a => st.cells?.[a.id]?.hasFlags);
      }
      if (status === 'missing') {
        return asgns.some(a => !st.cells?.[a.id] || st.cells[a.id].status === 'missing');
      }
      return true;
    });
  }

  function renderGradebookSubTabHTML() {
    const cls = getSelectedClass();
    const gb = S_STATE.gradebook;
    if (!cls || !gb) {
      return `<div class="card"><div class="empty">${cls ? 'Loading gradebook…' : 'Select or create a class to view its gradebook.'}</div></div>`;
    }

    const parts = [...new Set((gb.students || []).map(s => s.part).filter(Boolean))].sort();
    const focusedAsgn = S_STATE.gbFilter.assignmentId
      ? (gb.assignments || []).find(a => a.id === S_STATE.gbFilter.assignmentId)
      : null;

    return `
      <div class="hwt-gb-controls">
        <div class="row">
          <select data-hwt-change="select-class-dropdown" title="Class">
            ${S_STATE.classes.map(c => `<option value="${escHtml(c.id)}" ${c.id === S_STATE.selectedClassId ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
          </select>
          <input type="search" placeholder="Search student…" value="${escHtml(S_STATE.gbFilter.search)}" data-hwt-input="gb-search" style="min-width:170px">
          <select data-hwt-change="gb-part" title="Filter by part">
            <option value="">All Parts</option>
            ${parts.map(p => `<option value="${escHtml(p)}" ${S_STATE.gbFilter.part === p ? 'selected' : ''}>${escHtml(p)}</option>`).join('')}
          </select>
          <select data-hwt-change="gb-status" title="Filter by status">
            <option value="all" ${S_STATE.gbFilter.status === 'all' ? 'selected' : ''}>All Students</option>
            <option value="flagged" ${S_STATE.gbFilter.status === 'flagged' ? 'selected' : ''}>Flagged Only</option>
            <option value="missing" ${S_STATE.gbFilter.status === 'missing' ? 'selected' : ''}>Has Missing</option>
          </select>
          ${focusedAsgn ? `
            <span class="hwt-pill info">Focused: ${escHtml(focusedAsgn.title)}</span>
            <button type="button" class="btn small" data-hwt="gb-clear-asgn">Show All Assignments</button>
          ` : ''}
        </div>
        <div class="row">
          ${focusedAsgn ? `<button type="button" class="btn small" data-hwt="export-asgn-csv">Export Assignment CSV</button>` : ''}
          <button type="button" class="btn small primary" data-hwt="export-class-csv">Export Class CSV</button>
        </div>
      </div>

      <div id="hwt-gb-table-wrap" class="hwt-gb-wrap">
        ${renderGradebookTableInnerHTML()}
      </div>
    `;
  }

  function renderGradebookTableInnerHTML() {
    const gb = S_STATE.gradebook;
    if (!gb) return '';
    const allAsgns = gb.assignments || [];
    const asgns = S_STATE.gbFilter.assignmentId
      ? allAsgns.filter(a => a.id === S_STATE.gbFilter.assignmentId)
      : allAsgns;
    const students = getFilteredGradebookStudents();

    if (!allAsgns.length) {
      return `<div class="empty" style="padding:16px">No assignments in this class yet.</div>`;
    }
    if (!students.length) {
      return `<div class="empty" style="padding:16px">No matching students found.</div>`;
    }

    return `
      <table class="hwt-gb-tbl">
        <thead>
          <tr>
            <th class="hwt-gb-sticky">Student</th>
            ${asgns.map(a => `
              <th title="${escHtml(a.title)}">
                <div>${escHtml(a.title)}</div>
                <div class="small muted" style="font-weight:400">${escHtml(typeLabel(a.type))}</div>
              </th>
            `).join('')}
            <th>Average %</th>
          </tr>
        </thead>
        <tbody>
          ${students.map(st => `
            <tr>
              <td class="hwt-gb-sticky">
                <div style="font-weight:600">${escHtml(st.displayName)}</div>
                ${st.part ? `<div class="small muted">${escHtml(st.part)}</div>` : ''}
                ${st.isTest ? `<span class="hwt-test-tag">Test</span>` : ''}
              </td>
              ${asgns.map(a => renderGradebookCellHTML(st, a)).join('')}
              <td class="hwt-gb-cell"><b>${st.averagePct != null ? `${Math.round(Number(st.averagePct))}%` : '—'}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderGradebookCellHTML(st, asgn) {
    const cell = st.cells?.[asgn.id];
    if (!cell || cell.status === 'missing' || !cell.attempts) {
      return `<td class="hwt-gb-cell"><button type="button" class="hwt-cell-btn score-miss" disabled title="No submission yet">—</button></td>`;
    }

    let clsName = 'score-sub';
    let label = 'Submitted';
    if (cell.score != null) {
      const n = Math.round(Number(cell.score));
      label = `${n}%`;
      clsName = n >= 85 ? 'score-hi' : (n >= 65 ? 'score-mid' : 'score-lo');
    }

    const badges = [];
    if (cell.hasFlags) badges.push(`<span class="hwt-flag-dot" title="Integrity review note"></span>`);
    if (cell.attempts > 1) badges.push(`<span>×${cell.attempts}</span>`);
    if (cell.overridden) badges.push(`<span title="Teacher override">✎</span>`);
    if (cell.audioAvailable) badges.push(`<span title="Audio recording saved">♪</span>`);

    return `
      <td class="hwt-gb-cell">
        <button type="button" class="hwt-cell-btn ${clsName}" data-hwt="open-sub" data-stu="${escHtml(st.id)}" data-asgn="${escHtml(asgn.id)}">
          <span>${escHtml(label)}</span>
          ${badges.length ? `<span class="hwt-cell-badges">${badges.join('')}</span>` : ''}
        </button>
      </td>
    `;
  }

  // ---------- Sub-tab 4: Account & Plan
  function renderAccountSubTabHTML() {
    const api = API();
    const teacher = S_STATE.me.teacher;
    const plan = teacher.plan || {};
    const badge = planBadgeInfo(plan);
    const isDemo = api.isDemoMode();
    const offline = isOffline();
    const count = Number(S_STATE.me.activeStudentCount || 0);
    const softCap = Number(plan.studentSoftCap || 200);
    const billingReady = isDemo || !!S_STATE.capabilities?.billingEnabled || !!plan.billingEnabled;
    const isPaidActive = plan.status === 'active' || plan.status === 'po_active';

    return `
      <div class="card">
        <div class="card-head">
          <h2>Plan &amp; Usage</h2>
          <span class="hwt-pill ${badge.cls}">${escHtml(badge.label)}</span>
        </div>
        <div class="hwt-metrics" style="margin-bottom:12px">
          <div class="hwt-metric"><span>Teacher</span><strong style="font-size:14px">${escHtml(teacher.name || teacher.email)}</strong></div>
          <div class="hwt-metric"><span>Active Students</span><strong>${count} / ${softCap}</strong><small>Soft cap (never locks)</small></div>
          <div class="hwt-metric"><span>Status</span><strong style="font-size:14px">${escHtml(badge.label)}</strong></div>
          ${plan.trialEndsAt ? `<div class="hwt-metric"><span>Trial Ends</span><strong style="font-size:14px">${escHtml(formatDateShort(plan.trialEndsAt))}</strong></div>` : ''}
          ${plan.planEndsAt ? `<div class="hwt-metric"><span>Renews / Ends</span><strong style="font-size:14px">${escHtml(formatDateShort(plan.planEndsAt))}</strong></div>` : ''}
        </div>

        ${renderBetaCodeHTML(plan)}

        ${billingReady ? `
          <div class="row">
            <button type="button" class="btn ${isPaidActive ? '' : 'primary'}" data-hwt="checkout-monthly" ${offline ? 'disabled' : ''}>Upgrade Monthly ($5/mo)</button>
            <button type="button" class="btn" data-hwt="checkout-annual" ${offline ? 'disabled' : ''}>Upgrade Annual ($49/yr)</button>
            <button type="button" class="btn" data-hwt="billing-portal" ${offline ? 'disabled' : ''}>Manage Billing Portal</button>
          </div>
        ` : `
          <div class="hwt-banner info" style="margin-bottom:10px">
            <div><strong>30-day free trial active</strong> — Online card checkout (\$5/mo or \$49/yr) is opening soon. Every homework feature is unlocked for your trial today, and school/district purchase orders are available anytime.</div>
          </div>
          <div class="row">
            <button type="button" class="btn" disabled>Online Billing Opening Soon ($5/mo · $49/yr)</button>
          </div>
        `}

        <div class="hwt-privacy-note" style="margin-top:12px">
          <b>School Purchase Orders (POs):</b> Need a school or district invoice for multiple teachers or more than ${softCap} students? Request a <strong>School Purchase Order</strong> license grant with custom seat caps — no credit card required.
        </div>
      </div>

      ${isDemo ? `
        <div class="card">
          <div class="card-head">
            <h3>Local Preview Mode Controls</h3>
            <span class="hwt-pill info">Preview Only</span>
          </div>
          <p class="desc">Simulate every subscription state and offline mode immediately without a live Worker or Stripe account.</p>
          <div class="row" style="margin-bottom:10px">
            <button type="button" class="btn small ${plan.status === 'trialing' ? 'primary' : ''}" data-hwt="demo-plan" data-plan="trialing">Trialing (24d)</button>
            <button type="button" class="btn small ${plan.status === 'active' ? 'primary' : ''}" data-hwt="demo-plan" data-plan="active">Active Pro</button>
            <button type="button" class="btn small ${plan.status === 'past_due' ? 'primary' : ''}" data-hwt="demo-plan" data-plan="past_due">Past-Due Grace (4d)</button>
            <button type="button" class="btn small ${plan.readOnly ? 'primary' : ''}" data-hwt="demo-plan" data-plan="expired">Read-Only Expired</button>
          </div>
          <div class="row">
            <label class="chk">
              <input type="checkbox" data-hwt-change="demo-offline-toggle" ${offline ? 'checked' : ''}>
              Offline Cache Mode (simulate offline gradebook cache)
            </label>
            <span class="grow"></span>
            <button type="button" class="btn small danger" data-hwt="demo-reset">Reset Preview Data</button>
          </div>
        </div>
      ` : ''}

      <div class="card">
        <h3>Sessions &amp; Sign Out</h3>
        <div class="row">
          <button type="button" class="btn small" data-hwt="logout">Sign Out</button>
          <button type="button" class="btn small danger" data-hwt="logout-all" ${offline ? 'disabled' : ''}>Sign Out All Devices</button>
        </div>
      </div>

      <div class="card">
        <h3>How It Works, Privacy &amp; School Resources</h3>
        <p class="desc">Preview what students see or share these plain-language documents with parents, administrators, or district IT teams.</p>
        <div class="row">
          <button type="button" class="btn small primary" data-hwt="open-demo">See How It Works &amp; Student Demo ↗</button>
          <button type="button" class="btn small" data-hwt="open-doc" data-href="privacy.html">Privacy Policy</button>
          <button type="button" class="btn small" data-hwt="open-doc" data-href="privacy-sdpc.html">1-Page SDPC Summary</button>
          <button type="button" class="btn small" data-hwt="open-doc" data-href="it-whitelisting.html">IT Admin Info</button>
        </div>
      </div>
    `;
  }

  // ---------- Projector Modal (#hw-project-modal)
  function renderProjectModal() {
    const pm = S_STATE.projectModal;
    let el = document.getElementById('hw-project-modal');
    if (!pm.open) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'hw-project-modal';
      document.body.appendChild(el);
    }
    bindModalEvents(el);
    installEscListener();

    el.innerHTML = `
      <div class="hwt-project-backdrop" data-hwt="project-backdrop">
        <div class="hwt-project-card" role="dialog" aria-modal="true" aria-label="Class Join Code" style="position:relative">
          <button type="button" class="iconbtn" data-hwt="project-close" title="Close" aria-label="Close" style="position:absolute;top:14px;right:14px">✕</button>
          <div class="small muted" style="font-size:16px;font-weight:600">${escHtml(pm.className)}</div>
          <div style="font-size:15px;opacity:0.9">Go to the Student Portal and enter this Class Code:</div>
          <div class="hwt-project-code">${escHtml(pm.joinCode)}</div>
          <div class="hwt-project-url">${escHtml(pm.portalUrl)}</div>
          <div class="row" style="margin-top:6px">
            <button type="button" class="btn" data-hwt="project-copy-code">Copy Code</button>
            <button type="button" class="btn" data-hwt="project-copy-url">Copy Student Link</button>
            <button type="button" class="btn primary" data-hwt="project-close">Close (Esc)</button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- Submission Review Modal (#hw-sub-modal)
  function renderSubModal() {
    const sm = S_STATE.subModal;
    let el = document.getElementById('hw-sub-modal');
    if (!sm.open) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'hw-sub-modal';
      document.body.appendChild(el);
    }
    bindModalEvents(el);
    installEscListener();

    const navStudents = getNavigableStudentsForAssignment(sm.assignmentId);
    const navIdx = navStudents.findIndex(s => s.id === sm.studentId);
    const hasPrev = navIdx > 0;
    const hasNext = navIdx >= 0 && navIdx < navStudents.length - 1;
    const prevScroll = el.querySelector('.hwt-modal-body')?.scrollTop || 0;

    el.innerHTML = `
      <div class="hwt-modal-backdrop" data-hwt="sub-backdrop">
        <div class="hwt-modal" role="dialog" aria-modal="true" aria-label="Submission Review">
          <div class="hwt-modal-head">
            <div style="min-width:0">
              <h3>${escHtml(sm.studentName)}${sm.studentPart ? ` · ${escHtml(sm.studentPart)}` : ''}${(sm.studentIsTest || sm.attempts?.[0]?.studentIsTest) ? ` <span class="hwt-test-tag">Test</span>` : ''}</h3>
              <div class="small muted">${escHtml(sm.assignment?.title || 'Submission Review')}</div>
            </div>
            <div class="row">
              <button type="button" class="btn small" data-hwt="sub-prev-stu" ${hasPrev ? '' : 'disabled'}>◀ Prev Student</button>
              <button type="button" class="btn small" data-hwt="sub-next-stu" ${hasNext ? '' : 'disabled'}>Next Student ▶</button>
              <button type="button" class="iconbtn" data-hwt="sub-close" title="Close" aria-label="Close">✕</button>
            </div>
          </div>

          <div class="hwt-modal-body">
            ${sm.loading ? `<div class="empty">Loading submission details…</div>` :
              sm.error ? `<div class="hwt-banner readonly">${escHtml(sm.error)}</div>` :
              renderSubModalBodyHTML()}
          </div>

          <div class="hwt-modal-foot">
            <span class="small muted">Esc to close</span>
            <button type="button" class="btn" data-hwt="sub-close">Done</button>
          </div>
        </div>
      </div>
    `;

    // Keep audio playbackRate in sync if audio element rendered
    const audioEl = el.querySelector('audio');
    if (audioEl) {
      try { audioEl.playbackRate = sm.audioRate || 1; } catch { }
    }
    if (!sm.loading && !sm.error) {
      mountModalVisualStaff();
    }
    const nextModalBody = el.querySelector('.hwt-modal-body');
    if (nextModalBody && prevScroll > 0) {
      nextModalBody.scrollTop = prevScroll;
    }
  }

  function renderSubModalBodyHTML() {
    const sm = S_STATE.subModal;
    const sub = sm.attempts[sm.activeIdx];
    if (!sub) return `<div class="empty">No attempts found for this student.</div>`;

    const policy = sm.assignment?.gradePolicy || 'best';
    const countedIdx = pickCountedAttemptIndex(sm.attempts, policy);
    const effective = sub.effectivePct != null ? sub.effectivePct : sub.overallPct;
    const writable = canWrite();
    const online = canDeleteOrExport();

    return `
      <div class="row" style="justify-content:space-between">
        <div class="hwt-attempt-tabs">
          ${sm.attempts.map((a, i) => `
            <button type="button" class="hwt-attempt-tab ${i === sm.activeIdx ? 'on' : ''}" data-hwt="sub-attempt" data-idx="${i}">
              Attempt #${Number(a.attemptNum || (i + 1))}${a.effectivePct != null ? ` (${Math.round(Number(a.effectivePct))}%)` : ''}${i === countedIdx ? ' ★' : ''}
            </button>
          `).join('')}
        </div>
        <span class="hwt-pill info">${policy === 'last' ? 'Grade Policy: Most recent' : 'Grade Policy: Best attempt'}</span>
      </div>

      <div class="hwt-metrics">
        <div class="hwt-metric">
          <span>Effective Grade</span>
          <strong>${effective != null ? `${Math.round(Number(effective))}%` : 'Ungraded'}</strong>
          <small>${sub.teacherOverridePct != null ? 'Teacher override' : 'Auto-graded'}</small>
        </div>
        <div class="hwt-metric">
          <span>Auto Overall</span>
          <strong>${sub.overallPct != null ? `${Math.round(Number(sub.overallPct))}%` : '—'}</strong>
        </div>
        <div class="hwt-metric">
          <span>Rhythm %</span>
          <strong>${sub.rhythmPct != null ? `${Math.round(Number(sub.rhythmPct))}%` : '—'}</strong>
        </div>
        <div class="hwt-metric">
          <span>Pitch %</span>
          <strong>${sub.pitchPct != null ? `${Math.round(Number(sub.pitchPct))}%` : 'N/A'}</strong>
        </div>
        <div class="hwt-metric">
          <span>Duration</span>
          <strong>${escHtml(formatDuration(sub.durationSec))}</strong>
          ${sub.expectedSec ? `<small>Expected ${escHtml(formatDuration(sub.expectedSec))}</small>` : ''}
        </div>
        <div class="hwt-metric">
          <span>Input Mode</span>
          <strong style="font-size:13px">${escHtml(inputModeLabel(sub.resultsJson?.inputMode || (sm.assignment?.type === 'audio' ? 'audio' : '')))}</strong>
          <small>${escHtml(formatDateTimeShort(sub.submittedAt))}</small>
        </div>
      </div>

      ${renderSubAudioBoxHTML(sub, online)}
      ${renderSubFlagsHTML(sub)}
      ${renderSubNoteBreakdownHTML(sub)}

      <div class="hwt-grade-form">
        <div class="hwt-field-grid">
          <label class="fld">
            <span>Teacher Override (0–100, blank = auto score)</span>
            <input type="number" min="0" max="100" step="1" placeholder="Auto" value="${escHtml(sm.overrideInput)}" data-hwt-input="sub-override" ${writable ? '' : 'disabled'}>
          </label>
          <div class="small muted" style="display:flex;align-items:flex-end;padding-bottom:6px">
            ${sub.gradedAt ? `Last graded ${escHtml(formatDateTimeShort(sub.gradedAt))}` : 'Not overridden yet'}
          </div>
        </div>
        <label class="fld">
          <span>Teacher Comment</span>
          <textarea rows="2" placeholder="Optional feedback for student…" data-hwt-input="sub-comment" ${writable ? '' : 'disabled'}>${escHtml(sm.commentInput)}</textarea>
        </label>
        <div class="row">
          <button type="button" class="btn primary small" data-hwt="sub-save-grade" ${writable && !sm.busy ? '' : 'disabled'}>${sm.busy ? 'Saving…' : 'Save Grade & Comment'}</button>
          <button type="button" class="btn small" data-hwt="sub-clear-override" ${writable && !sm.busy && sub.teacherOverridePct != null ? '' : 'disabled'}>Clear Override</button>
          <span class="grow"></span>
          <button type="button" class="btn small danger" data-hwt="sub-delete" ${online && !sm.busy ? '' : 'disabled'}>Delete Submission</button>
        </div>
      </div>
    `;
  }

  function renderSubAudioBoxHTML(sub, online) {
    const sm = S_STATE.subModal;
    const expiryTxt = sub.audioExpiresAt
      ? `Auto-deletes in ${daysUntil(sub.audioExpiresAt)} day${daysUntil(sub.audioExpiresAt) === 1 ? '' : 's'} (${formatDateShort(sub.audioExpiresAt)})`
      : '90-day retention';

    if (!sub.audioAvailable) {
      const msg = sub.audioDeletedAt
        ? `Audio recording was deleted (${formatDateShort(sub.audioDeletedAt)}). Grades and note breakdown are preserved.`
        : (sub.resultsJson?.inputMode === 'tap'
          ? 'No audio recording (student submitted using Tap mode).'
          : 'No audio recording available (deleted or expired after 90 days).');
      return `<div class="hwt-audio-box"><div class="small muted">${escHtml(msg)}</div></div>`;
    }

    return `
      <div class="hwt-audio-box">
        <div class="row" style="justify-content:space-between">
          <b style="font-size:13px">Student Recording</b>
          <span class="small muted">${escHtml(expiryTxt)}</span>
        </div>
        ${sm.audioLoading ? `<div class="small muted">Loading audio…</div>` :
          sm.audioError ? `<div class="small" style="color:var(--hwt-danger-fg)">${escHtml(sm.audioError)}</div>` :
          sm.audioUrl ? `<audio controls src="${escHtml(sm.audioUrl)}"></audio>` :
          `<div class="small muted">${online ? 'Audio ready.' : 'Audio playback is unavailable in Offline Cache Mode.'}</div>`}
        <div class="row">
          <span class="small muted">Speed:</span>
          <button type="button" class="btn small ${sm.audioRate === 0.75 ? 'primary' : ''}" data-hwt="sub-rate" data-rate="0.75" ${sm.audioUrl ? '' : 'disabled'}>0.75x</button>
          <button type="button" class="btn small ${sm.audioRate === 1 ? 'primary' : ''}" data-hwt="sub-rate" data-rate="1" ${sm.audioUrl ? '' : 'disabled'}>1x</button>
          <span class="grow"></span>
          <button type="button" class="btn small danger" data-hwt="sub-delete-audio" ${online && !sm.busy ? '' : 'disabled'}>Delete Audio Now</button>
        </div>
      </div>
    `;
  }

  function renderSubFlagsHTML(sub) {
    const flags = Array.isArray(sub.integrityFlags) ? sub.integrityFlags : [];
    if (!flags.length) return '';
    const infoMap = API()?.INTEGRITY_FLAG_INFO || {};
    return `
      <div class="hwt-flag-box">
        <b style="font-size:13px">Teacher Review Notes (Amber Flags — Hidden from Students)</b>
        ${flags.map(f => {
          const info = infoMap[f] || { title: f, description: 'Flagged for teacher review.' };
          return `
            <div class="hwt-flag-item">
              <b>${escHtml(info.title)}</b> — ${escHtml(info.description)}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ---------- Submission review: the take shown the way the student's grade card shows it:
  // the same headline, the same marks on the real music, and the same "What was graded" table.
  function subGradeInfo(sub) {
    const rj = sub?.resultsJson || {};
    const notes = Array.isArray(rj.notes) ? rj.notes : [];
    return { rj, notes, gradePitch: rj.expectsPitch !== false && sub?.pitchPct != null, tap: rj.inputMode === 'tap' };
  }

  // how one graded note is marked on the music (same rules as grade.js)
  function subMarkOf(n) {
    const pitchBad = !!n.pitch && n.pitch !== 'ok';
    const cls = n.status === 'missed' ? 'missed' : pitchBad ? 'pitch' : n.status === 'timing' ? 'timing' : 'ok';
    const cents = n.cents != null ? Math.round(Number(n.cents)) : null;
    const lbl = n.pitch === 'wrong' ? (n.sungAs ? String(n.sungAs).replace(/-?\d+$/, '') : cents != null ? `${cents > 0 ? '+' : ''}${cents}¢` : '')
      : n.pitch === 'octave' ? (n.octave > 0 ? 'oct ↑' : n.octave < 0 ? 'oct ↓' : 'oct')
        : n.pitch === 'none' ? '?' : n.joined ? 'joined' : '';
    return { cls, tcls: n.status === 'timing' ? 'timing' : 'ok', lbl, soft: !!n.joined && !pitchBad };
  }

  function renderSubVisualFeedbackHTML(sub) {
    const { rj, notes, gradePitch, tap } = subGradeInfo(sub);
    if (!notes.length) return '';

    const sm = S_STATE.subModal;
    const asgn = S_STATE.assignments.find(a => a.id === sm.assignmentId) || sm.assignment;
    const rPct = sub.rhythmPct != null ? Math.round(Number(sub.rhythmPct)) : 0;
    const pPct = sub.pitchPct != null ? Math.round(Number(sub.pitchPct)) : null;
    const heard = rj.heard != null ? Number(rj.heard) : notes.filter(n => n.status !== 'missed').length;
    const extra = Number(rj.extra || 0);
    const bits = [`${heard} ${tap ? 'tap' : 'note'}${heard === 1 ? '' : 's'} ${tap ? 'counted' : 'heard'}`];
    if (extra > 0) bits.push(`${extra} extra`);
    if (Math.abs(rj.driftCents ?? 0) >= 25) bits.push(`went ${Math.abs(rj.driftCents)}¢ ${rj.driftCents < 0 ? 'flat' : 'sharp'} by the end`);
    const range = rj.rangeLabel ? `Graded ${rj.partName ? `${rj.partName} · ` : ''}${rj.rangeLabel}` : '';

    const isSightMel = asgn?.type === 'sight' && asgn?.config?.srState?.mode !== 'rhythm';
    const srShowOn = sm.showSolfege != null ? sm.showSolfege : true;
    const srCntOn = sm.showCounts != null ? sm.showCounts : !!asgn?.config?.srState?.showCounts;

    const word = ms => ms > 0 ? `${ms} ms late` : ms < 0 ? `${-ms} ms early` : 'on time';
    const rows = notes.map(n => {
      const st = n.status === 'wrong' ? 'pitch' : n.status;
      const cents = n.cents != null ? Math.round(Number(n.cents)) : 0;
      const where = `bar ${n.bar}, note ${n.idx}${gradePitch && n.written != null && typeof grName === 'function' ? ` (${grName(n.written)})` : ''}`;
      const status = n.joined ? '✓ joined (re-sing it)' : st === 'timing' ? (n.errMs < 0 ? 'early' : 'late') : ({ ok: '✓ on time', missed: tap ? 'no tap' : 'not heard', pitch: 'pitch' }[st] || st);
      const timing = n.errMs == null ? '—' : word(Math.round(Number(n.errMs)));
      const pitch = !gradePitch ? '—'
        : n.pitch === 'ok' ? (Math.abs(cents) >= 40 ? `✓ ${Math.abs(cents)}¢ ${cents < 0 ? 'flat' : 'sharp'}` : '✓')
          : n.pitch === 'none' ? 'no clear pitch'
            : n.pitch === 'octave' ? `wrong octave${n.octave ? ` (${n.octave > 0 ? 'too high' : 'too low'})` : ''}`
              : n.pitch === 'wrong' ? (n.sungAs ? `sang ${String(n.sungAs).replace(/-?\d+$/, '')} (${cents > 0 ? '+' : ''}${cents}¢)` : `${cents > 0 ? '+' : ''}${cents}¢ off`) : '—';
      return `<tr class="gr-${escHtml(st)}"><td>${escHtml(where)}</td><td>${escHtml(status)}</td><td>${escHtml(timing)}</td>${gradePitch ? `<td>${escHtml(pitch)}</td>` : ''}</tr>`;
    }).join('');

    return `
      <div class="hwt-visual-feedback hwt-gr-review">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="gr-head">
            <b>Rhythm ${rPct}%</b>${gradePitch && pPct != null ? ` · <b>Pitch ${pPct}%</b>` : ''}
            ${range ? `<span class="gr-sub gr-range">${escHtml(range)}</span>` : ''}
            <span class="gr-sub">${escHtml(bits.join(' · '))}</span>
          </div>
          ${asgn?.type === 'sight' ? `
            <div class="row" style="gap:10px">
              ${isSightMel ? `<label class="chk small"><input type="checkbox" data-hwt-change="sub-show-solfege" ${srShowOn ? 'checked' : ''}><span>Solfege</span></label>` : ''}
              <label class="chk small"><input type="checkbox" data-hwt-change="sub-show-counts" ${srCntOn ? 'checked' : ''}><span>Counts</span></label>
            </div>
          ` : ''}
        </div>

        <div class="gr-legend"><span class="gr-sub">On the music:</span>
          <span><i class="gr-dot ok"></i>on time</span><span><i class="gr-dot timing"></i>early / late</span><span><i class="gr-dot missed"></i>${tap ? 'no tap' : 'not heard'}</span>${gradePitch ? '<span><i class="gr-dot pitch"></i>wrong pitch</span>' : ''}<span><i class="gr-dot extra"></i>extra</span>
        </div>

        <div class="hwt-gr-music" id="hwt-sub-visual-staff"></div>

        <details class="gr-details">
          <summary>What was graded</summary>
          <table class="gr-table"><thead><tr><th>Note</th><th>Result</th><th>Timing</th>${gradePitch ? '<th>Pitch</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
        </details>
      </div>
    `;
  }

  // Sight Reading: the same marks grade.js draws (grDrawMarks). Each graded note is found by bar and
  // note number, so a take that was stopped early still lines up.
  function applyStudentMarksToSightSvg(staffEl, tl, notes, q, extraAt) {
    const svg = staffEl?.querySelector('svg');
    const geo = tl?.geo;
    if (!svg || !geo?.measures?.length) return false;
    const atk = tl.filter(e => !e.rest && !e.tiedFrom);
    const exp = typeof grExpected === 'function' ? grExpected(tl) : [];
    const at = new Map(exp.map((e, i) => [`${e.bar}:${e.idx}`, i]));
    const pairs = notes.map((n, i) => {
      const k = at.get(`${n.bar}:${n.idx}`);
      const e = k != null ? atk[k] : (notes.length === atk.length ? atk[i] : null);
      return e ? [n, e] : null;
    }).filter(Boolean);
    if (!pairs.length) return false;

    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, a, parent) => {
      const n = document.createElementNS(NS, tag);
      for (const k in a) n.setAttribute(k, a[k]);
      parent.appendChild(n);
      return n;
    };
    const M = geo.measures;
    const last = M[M.length - 1];
    const mAt = pos => M.find(m => pos >= m.t0 - 1e-6 && pos < m.t1 - 1e-6) || (pos < M[0].t0 ? M[0] : last);
    const xAt = (m, pos) => {
      const K = m.knots || [[m.t0, m.x0 + 16]];
      let i = 0;
      while (i < K.length - 2 && pos >= K[i + 1][0]) i++;
      const a = K[i], b = K[i + 1] || a;
      const f = b[0] > a[0] ? (pos - a[0]) / (b[0] - a[0]) : 0;
      return Math.max(m.x0 - 10, Math.min(m.x1 + 10, a[1] + f * (b[1] - a[1])));
    };
    let up = 0;
    for (const m of M) {
      for (const k of (m.knots || [])) {
        if (k[2] != null) up = Math.max(up, m.y0 + 18 - k[2]);
      }
    }
    const rise = Math.min(Math.max(up, 4), 30) + 10;
    const laneY = m => m.y0 + 18 - rise;

    const g = mk('g', { class: 'gr-ov' }, svg);
    for (const m of M) {
      mk('line', { x1: m.x0 + 6, x2: m.x1 - 6, y1: laneY(m), y2: laneY(m), class: 'gr-lane' }, g);
    }

    pairs.forEach(([n, e]) => {
      const m = mAt(e.t), x = xAt(m, e.t), y = laneY(m);
      const { cls, tcls, lbl, soft } = subMarkOf(n);
      if (e.el?.classList) {
        e.el.classList.add('gr-n-' + cls);
        const bh = e.el.getAttribute?.('data-bh');
        if (bh) document.getElementById(bh)?.classList.add('gr-n-' + cls);
      }
      mk('line', { x1: x, x2: x, y1: y - 6, y2: y + 6, class: 'gr-tick' }, g);
      if (cls === 'missed') {
        mk('circle', { cx: x, cy: e.y ?? (m.y0 + m.y1) / 2, r: 11, class: 'gr-ring' }, g);
        return;
      }
      const hp = e.t + (Number(n.errMs) || 0) / 1000 / q;
      const hm = hp > m.t0 - 0.75 && hp < m.t1 + 0.75 ? m : mAt(hp);
      const hx = xAt(hm, hp), hy = laneY(hm);
      if (hm === m && Math.abs(hx - x) > 1.5) {
        mk('line', { x1: x, x2: hx, y1: y, y2: y, class: 'gr-off ' + tcls }, g);
      }
      mk('circle', { cx: hx, cy: hy, r: 5, class: 'gr-dot ' + tcls }, g);
      if (lbl) mk('text', { x: hx, y: hy - 9, 'text-anchor': 'middle', class: 'gr-lbl' + (soft ? ' soft' : '') }, g).textContent = lbl;
    });
    // sounds that belong to no written note
    const total = last.t1;
    for (const p of extraAt || []) {
      if (!(p > -1 && p < total + 1)) continue;
      const m = mAt(p), x = xAt(m, p), y = laneY(m);
      mk('path', { d: `M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`, class: 'gr-extra' }, g);
    }
    return true;
  }

  // Score assignments: the real score (downloaded once per assignment), drawn by Score Practice with
  // its own grading marks. The graded part and notes are found by bar and note number.
  async function mountSubScore(box, asgn, sub) {
    const sm = S_STATE.subModal;
    const stillHere = () => box.isConnected && sm.open && sm.attempts[sm.activeIdx]?.id === sub.id;
    if (typeof mountScore !== 'function' || typeof SP_XML === 'undefined' || typeof spExpectedNotes !== 'function') return false;
    const fid = 'hwt-review-' + asgn.id;
    if (!SP_XML[fid]) {
      box.innerHTML = '<div class="small muted">Loading the score…</div>';
      const r = await API().downloadAssignmentScore(asgn.id);
      if (!r?.ok || !r.blob) {
        if (stillHere()) box.innerHTML = `<div class="small muted">${escHtml(r?.error || 'Could not load the score for this assignment.')}</div>`;
        return true;
      }
      const buf = await r.blob.arrayBuffer(), head = new Uint8Array(buf, 0, 2);
      SP_XML[fid] = head[0] === 0x50 && head[1] === 0x4b ? await spMxlToXml(buf) : new TextDecoder().decode(buf);   // "PK" = zipped .mxl
    }
    if (!stillHere()) return true;
    // one settings object per assignment, so a redraw of this window re-attaches the drawn score instantly
    const store = (sm.scoreSt ||= {});
    const st = store[fid] ||= { ...JSON.parse(JSON.stringify(asgn.config?.spState || {})), fileId: fid, name: asgn.scoreFilename || 'Score', loop: undefined };
    box.innerHTML = '<div class="score-host hwt-gr-score-host"></div>';
    const host = box.firstChild;
    // Score Practice opens only files in the file list: list this one just while it opens, hidden from the library
    const listed = !!S.files[fid];
    if (!listed) S.files[fid] = { name: st.name, mime: 'application/xml', size: SP_XML[fid].length, added: Date.now(), hiddenScore: true, derived: true };
    // the drawn score is re-used between attempts, but never the last attempt's marks
    if (SP_CACHE[fid]?.host) SP_CACHE[fid].host.__grResult = null;
    const ctl = mountScore(host, st, () => { }, fid);
    host.__grResult = null;
    for (let i = 0; i < 80 && !(ctl?.sc && ctl.osmd); i++) await new Promise(r => setTimeout(r, 125));
    if (!listed) delete S.files[fid];   // never kept in the teacher's own data
    if (S.scoreSettings) delete S.scoreSettings[fid];
    if (!ctl?.sc || !ctl.osmd || !stillHere()) return true;
    // a short score doesn't need the full box
    const musicH = host.querySelector('.sp-osmd svg')?.getBoundingClientRect().height;
    if (musicH) host.style.height = `${Math.round(Math.min(440, Math.max(180, musicH + 64)))}px`;

    const { rj, notes, gradePitch } = subGradeInfo(sub);
    const runAt = all => {
      outer: for (let k = 0; k + notes.length <= all.length; k++) {
        for (let i = 0; i < notes.length; i++) if (all[k + i].bar !== notes[i].bar || all[k + i].idx !== notes[i].idx) continue outer;
        return k;
      }
      return -1;
    };
    const lines = ctl.sc.lines.map((L, i) => i);
    if (rj.lineIdx != null && ctl.sc.lines[rj.lineIdx]) lines.unshift(rj.lineIdx);
    else {
      const want = String(rj.partName || sm.studentPart || '').toLowerCase();
      if (want) lines.sort((a, b) => (String(ctl.sc.lines[b].name || '').toLowerCase().includes(want) ? 1 : 0) - (String(ctl.sc.lines[a].name || '').toLowerCase().includes(want) ? 1 : 0));
    }
    let exp = null, lineIdx = null;
    for (const li of lines) {
      const all = spExpectedNotes(ctl, li, { a: 0, b: Infinity });
      const k = runAt(all);
      if (k >= 0) { exp = all.slice(k, k + notes.length); lineIdx = li; break; }
    }
    if (!exp) { ctl.drawGradeMarks?.(); return true; }   // the music shows without marks; the table below still lists every note
    const q = Number(rj.q) || 60 / (typeof spBpmAt === 'function' ? spBpmAt(ctl.sc, 0) : 100) / ((Number(st.tempo) || 100) / 100);
    const off = notes[0].t != null ? exp[0].t - Number(notes[0].t) : null;
    const res = {
      notes: notes.map(n => ({ ...n, match: n.status === 'missed' ? null : {} })),
      q, T0: 0, offsetSec: 0, diag: { heard: rj.heard ?? 1 },
      det: off == null ? [] : (rj.extraAt || []).map(p => ({ t: (Number(p) + off) * q })),
    };
    host.__grResult = { res, gradePitch, exp, lineIdx, fileId: fid, hidden: false, hist: [] };
    ctl.drawGradeMarks?.();
    // start the view at the graded measures
    const tick = host.querySelector('.sp-grov .gr-tick'), scroller = host.querySelector('.sp-score');
    if (tick && scroller) scroller.scrollTop = Math.max(0, Number(tick.getAttribute('y1')) - 60);
    return true;
  }

  function mountModalVisualStaff() {
    const sm = S_STATE.subModal;
    const sub = sm?.attempts?.[sm.activeIdx];
    const box = document.getElementById('hwt-sub-visual-staff');
    if (!box || !sub?.resultsJson?.notes?.length) return;
    const notes = sub.resultsJson.notes;
    const asgn = S_STATE.assignments.find(a => a.id === sm.assignmentId) || sm.assignment;
    const noMusic = msg => { box.innerHTML = `<div class="small muted">${escHtml(msg)}</div>`; };

    if (asgn?.type === 'score') {
      mountSubScore(box, asgn, sub).then(ok => { if (!ok) noMusic('The score can’t be shown here. Every note is listed below.'); })
        .catch(() => noMusic('The score can’t be shown here. Every note is listed below.'));
      return;
    }

    box.innerHTML = '<div class="sr-staff hwt-gr-staff"></div>';
    const staffEl = box.firstChild;
    if (asgn?.type === 'sight' && asgn?.config?.srState && typeof srDraw === 'function') {
      const srCopy = JSON.parse(JSON.stringify(asgn.config.srState));
      if (srCopy.ex && Array.isArray(srCopy.ex.rhythm)) srCopy.ex.rhythm = { rhythm: srCopy.ex.rhythm };   // older saved shape
      let view = srCopy;
      if (srCopy.mode === 'build' && typeof srBuildToView === 'function' && srCopy.build?.items?.length) {
        try { view = srBuildToView(srCopy); } catch { }
      }
      if ((view.mode === 'solfege' || view.mode === 'rhythm') && view.ex?.[view.mode]) {
        const isMel = view.mode !== 'rhythm';
        view.show = isMel ? (sm.showSolfege != null ? sm.showSolfege : true) : false;
        view.showCounts = sm.showCounts != null ? sm.showCounts : !!(view[view.mode]?.showCounts ?? view.showCounts);
        if (view[view.mode]) view[view.mode].showCounts = view.showCounts;
        const prevRhySys = typeof S !== 'undefined' && S?.settings ? S.settings.rhythmSystem : undefined;
        try {
          if (typeof S !== 'undefined' && S?.settings && asgn.config?.countingSystem) {
            S.settings.rhythmSystem = asgn.config.countingSystem;
          }
          staffEl.__zoom = 1;
          const tl = srDraw(staffEl, view);
          const o = view[view.mode] || {};
          const beatQ = typeof SR_METERS !== 'undefined' && SR_METERS[o.ts]?.[1] === 'compound' ? 1.5 : 1;
          const q = Number(sub.resultsJson.q) || 60 / (Number(o.tempo) || 80) / beatQ;
          applyStudentMarksToSightSvg(staffEl, tl, notes, q, sub.resultsJson.extraAt);
          return;   // the music shows even if a note can't be placed; the table below lists every note
        } catch {
          // drawn below as a plain message
        } finally {
          if (typeof S !== 'undefined' && S?.settings && prevRhySys !== undefined) {
            S.settings.rhythmSystem = prevRhySys;
          }
        }
      }
    }
    noMusic('The music for this assignment can’t be shown here. Every note is listed below.');
  }

  // the grade card's headline, marks and "What was graded" table (one place, so they never disagree)
  function renderSubNoteBreakdownHTML(sub) {
    return renderSubVisualFeedbackHTML(sub);
  }

  // ---------- Settings Card (#hw-settings-card)
  function renderSettingsCardContent() {
    const card = S_STATE.settingsEl || document.getElementById('hw-settings-card');
    if (!card || !document.body.contains(card)) return;
    S_STATE.settingsEl = card;
    bindRootEvents(card);

    const api = API();
    if (!api) {
      card.innerHTML = `<h2>Online Homework</h2><p class="desc">Online Homework could not load.</p>`;
      return;
    }

    const hasTok = !!api.getToken();
    const isDemo = api.isDemoMode();
    const teacher = S_STATE.me?.teacher || null;
    const badge = teacher?.plan ? planBadgeInfo(teacher.plan) : null;

    let statusLine = 'Not signed in';
    if (hasTok && teacher) {
      statusLine = `Signed in as ${teacher.name || teacher.email}`;
    } else if (hasTok) {
      statusLine = 'Signed in (session active)';
    }

    card.innerHTML = `
      <div class="card-head">
        <h2>Online Homework</h2>
        ${badge ? `<span class="hwt-pill ${badge.cls}">${escHtml(badge.label)}</span>` : '<span class="hwt-pill ok">30-Day Free Trial</span>'}
      </div>
      <p class="desc">${hasTok ? escHtml(statusLine) + '. ' : 'Start a free 30-day trial (no credit card) to '}manage classes, print student sign-in codes, assign Sight Reading or Score Practice, and review recordings.</p>
      <div class="row">
        <button type="button" class="btn primary" data-hwt="settings-open-hw">${hasTok ? 'Open Online Homework' : 'Start Free 30-Day Trial / Sign In'}</button>
        <button type="button" class="btn" data-hwt="open-demo">See How It Works &amp; Student Demo ↗</button>
        ${hasTok ? `<button type="button" class="btn" data-hwt="settings-logout">Sign Out</button>` : ''}
      </div>
    `;
  }

  // ---------- Print Code Sheet
  function printCodeSheet() {
    const codeAlert = S_STATE.generatedCodes;
    const api = API();
    if (!codeAlert || !codeAlert.items?.length || !api) return;
    const joinFmt = formatCodeDisplay(codeAlert.joinCode);
    const portalUrl = api.getStudentPortalUrl(codeAlert.joinCode);

    const slipsHtml = `
      <p class="meta">Cut along the dashed lines and hand one slip to each student. Students open the Student Portal link and enter both the Class Code and their Student Code.</p>
      <div class="hwt-code-sheet">
        ${codeAlert.items.map(it => `
          <div class="hwt-code-slip">
            <div class="hwt-slip-hdr">
              <span>${escHtml(codeAlert.className)}</span>
              <span>${escHtml(it.part || '')}</span>
            </div>
            <div class="hwt-slip-name">${escHtml(it.displayName)}</div>
            <div class="hwt-slip-codes">
              <span>Class: <span class="hwt-slip-code">${escHtml(joinFmt)}</span></span>
              <span>Code: <span class="hwt-slip-code">${escHtml(formatCodeDisplay(it.code))}</span></span>
            </div>
            <div class="hwt-slip-url">${escHtml(portalUrl)}</div>
          </div>
        `).join('')}
      </div>
    `;

    try {
      if (typeof printHTML === 'function') {
        printHTML(`${codeAlert.className} — Student Sign-In Codes`, slipsHtml);
        return;
      }
    } catch { }

    const area = document.getElementById('print-area');
    if (area) {
      area.innerHTML = `<h1>${escHtml(codeAlert.className)} — Student Sign-In Codes</h1>${slipsHtml}`;
      try {
        if (typeof native === 'function' && native('print')) return;
      } catch { }
      window.print();
    }
  }

  // ---------- Event Binding & Handlers
  function installEscListener() {
    if (escListenerInstalled) return;
    escListenerInstalled = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (S_STATE.projectModal.open) {
        e.preventDefault();
        e.stopPropagation();
        closeProjectModal();
        return;
      }
      if (S_STATE.subModal.open) {
        e.preventDefault();
        e.stopPropagation();
        closeSubModal();
      }
    }, true);
  }

  function stopTypingLeak(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      e.stopPropagation();
    }
  }

  function handleRootKeydown(e) {
    if (e.key === 'Enter' && e.target?.matches?.('input')) {
      const k = e.target.dataset?.hwtInput;
      if (k === 'auth-email' || k === 'auth-name') { e.preventDefault(); e.stopPropagation(); doEmailStart(); return; }
      if (k === 'auth-code') { e.preventDefault(); e.stopPropagation(); doEmailVerify(); return; }
      if (k === 'new-class-name') { e.preventDefault(); e.stopPropagation(); doCreateClass(); return; }
      if (k === 'stu-name' || k === 'stu-part' || k === 'stu-email') { e.preventDefault(); e.stopPropagation(); doAddSingleStudent(); return; }
    }
    stopTypingLeak(e);
  }

  function handleModalKeydown(e) {
    if (e.key !== 'Escape') e.stopPropagation();
  }

  function bindRootEvents(el) {
    if (!el || el.__hwtBound) return;
    el.__hwtBound = true;
    el.addEventListener('click', handleClick);
    el.addEventListener('change', handleChange);
    el.addEventListener('input', handleInput);
    el.addEventListener('keydown', handleRootKeydown);
    el.addEventListener('keyup', stopTypingLeak);
  }

  function bindModalEvents(el) {
    if (!el || el.__hwtBound) return;
    el.__hwtBound = true;
    el.addEventListener('click', handleClick);
    el.addEventListener('change', handleChange);
    el.addEventListener('input', handleInput);
    el.addEventListener('keydown', handleModalKeydown);
    el.addEventListener('keyup', handleModalKeydown);
  }

  function handleInput(e) {
    const t = e.target.closest('[data-hwt-input]');
    if (!t) return;
    const key = t.dataset.hwtInput;
    const val = t.value;

    switch (key) {
      case 'auth-email': S_STATE.auth.email = val; break;
      case 'auth-name': S_STATE.auth.name = val; break;
      case 'auth-code': S_STATE.auth.code = val; break;
      case 'auth-server-url': S_STATE.auth.serverUrl = val; break;
      case 'new-class-name': S_STATE.classForm.name = val; break;
      case 'stu-name': S_STATE.rosterForm.singleName = val; break;
      case 'stu-part': S_STATE.rosterForm.singlePart = val; break;
      case 'stu-email': S_STATE.rosterForm.singleEmail = val; break;
      case 'stu-bulk': S_STATE.rosterForm.bulkText = val; break;
      case 'account-server-url': S_STATE.accountServerUrl = val; break;
      case 'sub-override': S_STATE.subModal.overrideInput = val; break;
      case 'sub-comment': S_STATE.subModal.commentInput = val; break;
      case 'gb-search': {
        S_STATE.gbFilter.search = val;
        const wrap = document.getElementById('hwt-gb-table-wrap');
        if (wrap) wrap.innerHTML = renderGradebookTableInnerHTML();
        break;
      }
    }
  }

  async function handleChange(e) {
    const t = e.target.closest('[data-hwt-change]');
    if (!t) return;
    const key = t.dataset.hwtChange;
    const api = API();

    switch (key) {
      case 'auth-ephemeral':
        S_STATE.auth.ephemeral = !!t.checked;
        break;
      case 'toggle-archived-classes':
        S_STATE.showArchivedClasses = !!t.checked;
        await loadClassesAndActiveData();
        renderAll();
        break;
      case 'toggle-archived-students':
        S_STATE.showArchivedStudents = !!t.checked;
        if (S_STATE.selectedClassId) {
          const res = await api.listStudents(S_STATE.selectedClassId, S_STATE.showArchivedStudents);
          if (res?.ok) S_STATE.students = res.students || [];
        }
        renderAll();
        break;
      case 'toggle-archived-assignments':
        S_STATE.showArchivedAssignments = !!t.checked;
        if (S_STATE.selectedClassId) {
          const res = await api.listAssignments(S_STATE.selectedClassId, S_STATE.showArchivedAssignments);
          if (res?.ok) S_STATE.assignments = res.assignments || [];
        }
        renderAll();
        break;
      case 'new-class-local': {
        S_STATE.classForm.localClassId = t.value;
        const lc = getLocalClasses().find(c => c.id === t.value);
        if (lc) {
          S_STATE.classForm.name = lc.subtitle ? `${lc.name} — ${lc.subtitle}` : lc.name;
        }
        renderMain();
        break;
      }
      case 'new-class-import':
        S_STATE.classForm.importRoster = !!t.checked;
        break;
      case 'roster-import-select':
        S_STATE.rosterForm.importClassId = t.value;
        renderMain();
        break;
      case 'select-class-dropdown':
        S_STATE.selectedClassId = t.value;
        S_STATE.gbFilter.assignmentId = '';
        await loadClassDetails(S_STATE.selectedClassId);
        renderAll();
        break;
      case 'gb-part':
        S_STATE.gbFilter.part = t.value;
        renderMain();
        break;
      case 'gb-status':
        S_STATE.gbFilter.status = t.value;
        renderMain();
        break;
      case 'sub-show-solfege':
        S_STATE.subModal.showSolfege = !!t.checked;
        renderSubModal();
        break;
      case 'sub-show-counts':
        S_STATE.subModal.showCounts = !!t.checked;
        renderSubModal();
        break;
      case 'demo-offline-toggle':
        api.setDemoOffline?.(!!t.checked);
        await loadSessionAndWorkspace(true);
        break;
    }
  }

  async function handleClick(e) {
    const target = e.target;

    // Backdrop close on project or submission modals
    if (target.dataset?.hwt === 'project-backdrop') {
      closeProjectModal();
      return;
    }
    if (target.dataset?.hwt === 'sub-backdrop') {
      closeSubModal();
      return;
    }

    const btn = target.closest('[data-hwt]');
    if (!btn) return;
    const act = btn.dataset.hwt;
    const api = API();
    const drawer = DRAWER();

    switch (act) {
      // ----- Settings card actions
      case 'settings-open-hw':
        openHomeworkTab();
        break;
      case 'settings-logout':
        await doLogout();
        break;

      // ----- Sign-In actions
      case 'auth-send-code':
        await doEmailStart();
        break;
      case 'auth-resend':
        await doEmailStart();
        break;
      case 'auth-use-devcode':
        S_STATE.auth.code = S_STATE.auth.devCode || '';
        await doEmailVerify();
        break;
      case 'auth-verify':
        await doEmailVerify();
        break;
      case 'auth-reset-email':
        S_STATE.auth.emailSent = false;
        S_STATE.auth.code = '';
        S_STATE.auth.devCode = '';
        S_STATE.auth.error = '';
        S_STATE.auth.notice = '';
        renderMain();
        break;
      case 'auth-google':
        await doGoogleAuth();
        break;
      case 'auth-google-handoff':
        await doGoogleHandoffStart();
        break;
      case 'auth-handoff-reopen':
        if (S_STATE.auth.handoff?.url) openExternalUrl(S_STATE.auth.handoff.url);
        break;
      case 'auth-handoff-cancel':
        stopOAuthHandoff(true);
        renderMain();
        break;
      case 'open-doc':
        e?.preventDefault?.();
        openDocPage(btn.dataset.href || btn.getAttribute('href') || '');
        break;
      case 'open-demo':
        e?.preventDefault?.();
        openDocPage('hw-demo.html');
        break;
      case 'auth-save-server':
        stopOAuthHandoff(true);
        api.setApiBase(S_STATE.auth.serverUrl.trim());
        S_STATE.me = null;
        S_STATE.auth.error = '';
        S_STATE.auth.emailSent = false;
        S_STATE.auth.code = '';
        S_STATE.auth.devCode = '';
        S_STATE.auth.notice = api.isDemoMode()
          ? 'Switched to Local Preview Mode.'
          : `Server URL set to ${api.getApiBase()}.`;
        await loadSessionAndWorkspace(true);
        break;
      case 'auth-use-demo':
        stopOAuthHandoff(true);
        api.setApiBase('');
        S_STATE.me = null;
        S_STATE.auth.serverUrl = '';
        S_STATE.auth.error = '';
        S_STATE.auth.emailSent = false;
        S_STATE.auth.code = '';
        S_STATE.auth.devCode = '';
        S_STATE.auth.notice = 'Switched to Local Preview Mode.';
        await loadSessionAndWorkspace(true);
        break;
      case 'auth-use-live':
        stopOAuthHandoff(true);
        api.setApiBase('https://api.rehearsalmusic.com');
        S_STATE.me = null;
        S_STATE.auth.serverUrl = api.getApiBase();
        S_STATE.auth.error = '';
        S_STATE.auth.emailSent = false;
        S_STATE.auth.code = '';
        S_STATE.auth.devCode = '';
        S_STATE.auth.notice = 'Switched back to Live Server.';
        await loadSessionAndWorkspace(true);
        break;

      // ----- Workspace header & navigation
      case 'open-assign-picker':
        if (drawer?.openPicker) {
          drawer.openPicker({
            classId: S_STATE.selectedClassId,
            onSaved: onAssignmentSaved,
          });
        }
        break;
      case 'open-assign-audio':
        openAssignAudio(S_STATE.selectedClassId);
        break;
      case 'refresh':
        await refreshAll();
        break;
      case 'logout':
        await doLogout();
        break;
      case 'logout-all': {
        if (!confirm('Sign out of Online Homework on all your devices?')) break;
        const r = await api.logoutAll();
        if (!r?.ok) {
          showToast(r?.error || 'Could not sign out all devices.');
          break;
        }
        S_STATE.me = null;
        renderAll();
        showToast('Signed out on all devices.');
        break;
      }
      case 'dismiss-error':
        S_STATE.error = '';
        renderMain();
        break;
      case 'subtab':
        S_STATE.subTab = btn.dataset.subtab || 'classes';
        renderMain();
        break;
      case 'goto-account':
        S_STATE.subTab = 'account';
        renderMain();
        break;

      // ----- Classes & Roster
      case 'toggle-new-class':
        S_STATE.classForm.open = !S_STATE.classForm.open;
        renderMain();
        break;
      case 'cancel-new-class':
        S_STATE.classForm.open = false;
        renderMain();
        break;
      case 'create-class':
        await doCreateClass();
        break;
      case 'select-class':
        S_STATE.selectedClassId = btn.dataset.id || '';
        S_STATE.gbFilter.assignmentId = '';
        await loadClassDetails(S_STATE.selectedClassId);
        renderAll();
        break;
      case 'copy-join-code': {
        const cls = getSelectedClass();
        if (cls) copyText(formatCodeDisplay(cls.joinCode), 'Class code');
        break;
      }
      case 'copy-portal-link': {
        const cls = getSelectedClass();
        if (cls) copyText(api.getStudentPortalUrl(cls.joinCode), 'Student Portal link');
        break;
      }
      case 'project-big': {
        const cls = getSelectedClass();
        if (cls) openProjectModal(cls);
        break;
      }
      case 'project-copy-code':
        copyText(S_STATE.projectModal.joinCode, 'Class code');
        break;
      case 'project-copy-url':
        copyText(S_STATE.projectModal.portalUrl, 'Student Portal link');
        break;
      case 'project-close':
        closeProjectModal();
        break;
      case 'rotate-join-code': {
        const cls = getSelectedClass();
        if (!cls) break;
        if (!confirm(`Generate a new Class Join Code for "${cls.name}"? The old join code will stop working for new logins.`)) break;
        const res = await api.updateClass(cls.id, { rotateJoinCode: true });
        if (!res?.ok) { showToast(res?.error || 'Could not rotate join code.'); break; }
        await loadClassesAndActiveData();
        renderAll();
        showToast('New join code generated.');
        break;
      }
      case 'toggle-lock-class': {
        const cls = getSelectedClass();
        if (!cls) break;
        const res = await api.updateClass(cls.id, { locked: !cls.locked });
        if (!res?.ok) { showToast(res?.error || 'Could not update class lock.'); break; }
        await loadClassesAndActiveData();
        renderAll();
        showToast(res.class?.locked ? 'Class locked against new Google joins.' : 'Class unlocked.');
        break;
      }
      case 'toggle-bulk-paste':
        S_STATE.rosterForm.showBulk = !S_STATE.rosterForm.showBulk;
        renderMain();
        break;
      case 'add-single-student':
        await doAddSingleStudent();
        break;
      case 'add-bulk-students':
        await doAddBulkStudents();
        break;
      case 'import-local-roster':
        await doImportLocalRoster();
        break;
      case 'regen-all-codes': {
        const cls = getSelectedClass();
        if (!cls) break;
        if (!confirm(`Regenerate personal sign-in codes for all active students in "${cls.name}"? Existing student sessions will be signed out.`)) break;
        const res = await api.regenerateClassCodes(cls.id, { revokeSessions: true });
        if (!res?.ok) { showToast(res?.error || 'Could not regenerate codes.'); break; }
        // Leave the Test Student out of the printed code sheet.
        const testIds = new Set(S_STATE.students.filter(s => s.isTest).map(s => s.id));
        S_STATE.generatedCodes = {
          classId: cls.id,
          className: cls.name,
          joinCode: cls.joinCode,
          items: (res.generatedCodes || []).filter(it => !testIds.has(it.id) && !testIds.has(it.studentId)),
        };
        await loadClassDetails(cls.id);
        renderAll();
        break;
      }
      case 'print-codes':
        printCodeSheet();
        break;
      case 'download-codes-csv': {
        const ca = S_STATE.generatedCodes;
        if (!ca) break;
        const r = api.exportCodesCsv(ca);
        showToast(r?.ok ? `Downloaded ${r.filename}.` : (r?.error || 'Could not download student codes CSV.'));
        break;
      }
      case 'export-roster-csv': {
        const cls = getSelectedClass();
        if (!cls) break;
        const r = api.exportRosterCsv(cls, realStudents());
        showToast(r?.ok ? `Exported ${r.count} student${r.count === 1 ? '' : 's'} to ${r.filename}.` : (r?.error || 'Could not export roster CSV.'));
        break;
      }
      case 'copy-all-codes': {
        const ca = S_STATE.generatedCodes;
        if (!ca) break;
        const joinFmt = formatCodeDisplay(ca.joinCode);
        const lines = ca.items.map(it => `${it.displayName}${it.part ? ` (${it.part})` : ''}: Class ${joinFmt} | Code ${formatCodeDisplay(it.code)}`);
        copyText(lines.join('\n'), 'All student codes');
        break;
      }
      case 'dismiss-codes':
        S_STATE.generatedCodes = null;
        renderMain();
        break;
      case 'open-test-student': {
        const cls = getSelectedClass();
        if (!cls || !api) break;
        // Open the window now, while the click is still allowed to open a popup.
        // Its address is set once the test session is ready.
        const win = window.open('about:blank', '_blank');
        try {
          const r = await api.openTestStudent(cls.id);
          const url = new URL('hw.html', location.href).href + '#test=' + encodeURIComponent(r.token);
          if (win) win.location.href = url;
          else window.open(url, '_blank');
        } catch (err) {
          if (win) win.close();
          showToast(err?.message || 'Could not open the test student.');
        }
        break;
      }
      case 'apply-beta-code': {
        const box = btn.closest('.hwt-beta-code');
        const input = box?.querySelector('.hwt-beta-input');
        const errEl = box?.querySelector('.hwt-beta-err');
        const code = String(input?.value || '').trim();
        if (errEl) errEl.textContent = '';
        if (!code) { if (errEl) errEl.textContent = 'Type your beta code first.'; break; }
        btn.disabled = true;
        try {
          const res = await api.redeemBeta(code);
          if (res && res.ok === false) throw new Error(res.error || 'That beta code did not work.');
          showToast('Beta access is on.');
          await loadSessionAndWorkspace(true);
        } catch (err) {
          if (errEl) errEl.textContent = err?.message || 'That beta code did not work.';
          btn.disabled = false;
        }
        break;
      }
      case 'stu-new-code': {
        const cls = getSelectedClass();
        const sid = btn.dataset.id;
        if (!cls || !sid) break;
        const res = await api.regenerateStudentCode(cls.id, sid, true);
        if (!res?.ok) { showToast(res?.error || 'Could not generate new code.'); break; }
        S_STATE.generatedCodes = {
          classId: cls.id,
          className: cls.name,
          joinCode: cls.joinCode,
          items: [{
            studentId: res.studentId || sid,
            displayName: res.displayName || 'Student',
            part: res.part || '',
            code: res.code,
          }],
        };
        await loadClassDetails(cls.id);
        renderAll();
        showToast('New student code generated and any lockout cleared.');
        break;
      }
      case 'stu-signout': {
        const cls = getSelectedClass();
        const sid = btn.dataset.id;
        if (!cls || !sid) break;
        const res = await api.revokeStudentSessions(cls.id, sid);
        if (!res?.ok) { showToast(res?.error || 'Could not sign out student.'); break; }
        showToast('Student signed out on all devices.');
        break;
      }
      case 'stu-export': {
        const cls = getSelectedClass();
        const sid = btn.dataset.id;
        if (!cls || !sid) break;
        const res = await api.exportStudentData(cls.id, sid);
        if (!res || res.ok === false) { showToast(res?.error || 'Could not export student data.'); break; }
        const stuName = (res.student?.displayName || 'student').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || sid;
        api.triggerDownload(JSON.stringify(res, null, 2), res.filename || `student-data-${stuName}.json`, 'application/json');
        showToast('Student FERPA JSON exported.');
        break;
      }
      case 'stu-archive':
      case 'stu-restore': {
        const cls = getSelectedClass();
        const sid = btn.dataset.id;
        if (!cls || !sid) break;
        const res = await api.updateStudent(cls.id, sid, { archived: act === 'stu-archive' });
        if (!res?.ok) { showToast(res?.error || 'Could not update student.'); break; }
        await loadClassDetails(cls.id);
        renderAll();
        showToast(act === 'stu-archive' ? 'Student archived.' : 'Student restored.');
        break;
      }
      case 'stu-delete': {
        const cls = getSelectedClass();
        const sid = btn.dataset.id;
        if (!cls || !sid) break;
        const stu = S_STATE.students.find(s => s.id === sid);
        if (!confirm(`Permanently delete ${stu?.displayName || 'this student'} and all of their submissions & audio recordings?`)) break;
        const res = await api.deleteStudent(cls.id, sid);
        if (!res?.ok) { showToast(res?.error || 'Could not delete student.'); break; }
        await loadClassesAndActiveData();
        renderAll();
        showToast('Student permanently deleted.');
        break;
      }
      case 'revoke-class-sessions': {
        const cls = getSelectedClass();
        if (!cls) break;
        if (!confirm(`Sign out all students currently logged into "${cls.name}"?`)) break;
        const res = await api.revokeClassSessions(cls.id);
        if (!res?.ok) { showToast(res?.error || 'Could not sign out students.'); break; }
        showToast('All student sessions signed out.');
        break;
      }
      case 'archive-class':
      case 'restore-class': {
        const cls = getSelectedClass();
        if (!cls) break;
        const archiving = act === 'archive-class';
        if (archiving && !confirm(`Archive "${cls.name}"? Students will be signed out and won't see this class until restored.`)) break;
        const res = await api.updateClass(cls.id, { archived: archiving });
        if (!res?.ok) { showToast(res?.error || 'Could not update class.'); break; }
        await loadClassesAndActiveData();
        renderAll();
        showToast(archiving ? 'Class archived.' : 'Class restored.');
        break;
      }
      case 'delete-class': {
        const cls = getSelectedClass();
        if (!cls) break;
        if (!confirm(`Permanently delete "${cls.name}", all students, assignments, grades, and audio recordings? This cannot be undone.`)) break;
        const res = await api.deleteClass(cls.id);
        if (!res?.ok) { showToast(res?.error || 'Could not delete class.'); break; }
        S_STATE.selectedClassId = '';
        await loadClassesAndActiveData();
        renderAll();
        showToast('Class permanently deleted.');
        break;
      }

      // ----- Assignments actions
      case 'review-asgn':
        S_STATE.gbFilter.assignmentId = btn.dataset.id || '';
        S_STATE.subTab = 'gradebook';
        renderMain();
        break;
      case 'preview-asgn':
        await openAssignmentPreview(btn.dataset.id);
        break;
      case 'toggle-publish': {
        const id = btn.dataset.id;
        const a = S_STATE.assignments.find(x => x.id === id);
        if (!a) break;
        const res = await api.updateAssignment(a.id, { published: !a.published });
        if (!res?.ok) { showToast(res?.error || 'Could not update assignment.'); break; }
        await loadClassDetails(S_STATE.selectedClassId);
        renderAll();
        showToast(res.assignment?.published ? 'Assignment published.' : 'Moved to drafts.');
        break;
      }
      case 'edit-asgn': {
        const id = btn.dataset.id;
        const a = S_STATE.assignments.find(x => x.id === id);
        if (a && drawer?.openEdit) {
          drawer.openEdit(a, { onSaved: onAssignmentSaved });
        }
        break;
      }
      case 'archive-asgn':
      case 'restore-asgn': {
        const id = btn.dataset.id;
        const res = await api.updateAssignment(id, { archived: act === 'archive-asgn' });
        if (!res?.ok) { showToast(res?.error || 'Could not update assignment.'); break; }
        await loadClassDetails(S_STATE.selectedClassId);
        renderAll();
        showToast(act === 'archive-asgn' ? 'Assignment archived.' : 'Assignment restored.');
        break;
      }
      case 'delete-asgn': {
        const id = btn.dataset.id;
        const a = S_STATE.assignments.find(x => x.id === id);
        if (!confirm(`Permanently delete "${a?.title || 'this assignment'}" and all student submissions & audio for it?`)) break;
        const res = await api.deleteAssignment(id);
        if (!res?.ok) { showToast(res?.error || 'Could not delete assignment.'); break; }
        await loadClassesAndActiveData();
        renderAll();
        showToast('Assignment deleted.');
        break;
      }

      // ----- Gradebook actions
      case 'gb-clear-asgn':
        S_STATE.gbFilter.assignmentId = '';
        renderMain();
        break;
      case 'export-class-csv': {
        const r = await api.downloadGradebookCsv(S_STATE.selectedClassId);
        showToast(r?.ok ? 'Gradebook CSV exported.' : (r?.error || 'Could not export Gradebook CSV.'));
        break;
      }
      case 'export-asgn-csv': {
        const r = await api.downloadGradebookCsv(S_STATE.selectedClassId, S_STATE.gbFilter.assignmentId);
        showToast(r?.ok ? 'Assignment CSV exported.' : (r?.error || 'Could not export Assignment CSV.'));
        break;
      }
      case 'open-sub':
        await openSubmissionModal(btn.dataset.stu, btn.dataset.asgn);
        break;

      // ----- Submission Modal actions
      case 'sub-close':
        closeSubModal();
        break;
      case 'sub-attempt':
        await selectAttemptInModal(Number(btn.dataset.idx || 0));
        break;
      case 'sub-prev-stu':
      case 'sub-next-stu': {
        const sm = S_STATE.subModal;
        const list = getNavigableStudentsForAssignment(sm.assignmentId);
        const idx = list.findIndex(s => s.id === sm.studentId);
        const nextIdx = act === 'sub-prev-stu' ? idx - 1 : idx + 1;
        if (nextIdx >= 0 && nextIdx < list.length) {
          await openSubmissionModal(list[nextIdx].id, sm.assignmentId);
        }
        break;
      }
      case 'sub-rate': {
        const rate = Number(btn.dataset.rate || 1);
        S_STATE.subModal.audioRate = rate;
        const audio = document.querySelector('#hw-sub-modal audio');
        if (audio) try { audio.playbackRate = rate; } catch { }
        document.querySelectorAll('#hw-sub-modal [data-hwt="sub-rate"]').forEach(b => {
          b.classList.toggle('primary', Number(b.dataset.rate || 1) === rate);
        });
        break;
      }
      case 'sub-save-grade':
        await doSaveSubmissionGrade(false);
        break;
      case 'sub-clear-override':
        await doSaveSubmissionGrade(true);
        break;
      case 'sub-delete-audio':
        await doDeleteSubmissionAudio();
        break;
      case 'sub-delete':
        await doDeleteSubmission();
        break;

      // ----- Account & Plan actions
      case 'checkout-monthly':
        await doBillingCheckout('monthly');
        break;
      case 'checkout-annual':
        await doBillingCheckout('annual');
        break;
      case 'billing-portal':
        await doBillingPortal();
        break;
      case 'demo-plan':
        api.setDemoPlan?.(btn.dataset.plan || 'trialing');
        await loadSessionAndWorkspace(true);
        showToast(`Preview plan switched to ${btn.dataset.plan}.`);
        break;
      case 'toggle-demo-offline':
        api.setDemoOffline?.(false);
        await loadSessionAndWorkspace(true);
        break;
      case 'demo-reset':
        if (!confirm('Reset Local Preview data back to initial sample classes, students, and submissions?')) break;
        api.resetDemoData?.();
        S_STATE.selectedClassId = '';
        S_STATE.generatedCodes = null;
        await loadSessionAndWorkspace(true);
        showToast('Preview data reset.');
        break;
      case 'account-save-server':
        api.setApiBase(S_STATE.accountServerUrl.trim());
        S_STATE.me = null;
        S_STATE.selectedClassId = '';
        S_STATE.generatedCodes = null;
        S_STATE.auth.error = '';
        await loadSessionAndWorkspace(true);
        showToast(api.isDemoMode() ? 'Switched to Local Preview Mode.' : 'Worker Server URL saved.');
        break;
      case 'account-use-demo':
        api.setApiBase('');
        S_STATE.me = null;
        S_STATE.accountServerUrl = '';
        S_STATE.selectedClassId = '';
        S_STATE.generatedCodes = null;
        S_STATE.auth.error = '';
        await loadSessionAndWorkspace(true);
        showToast('Switched to Local Preview Mode.');
        break;
    }
  }

  // ---------- Async Action Implementations
  async function doEmailStart() {
    const api = API();
    const email = S_STATE.auth.email.trim();
    if (!email || !email.includes('@')) {
      S_STATE.auth.error = 'Enter a valid email address.';
      renderMain();
      return;
    }
    S_STATE.auth.busy = true;
    S_STATE.auth.error = '';
    S_STATE.auth.notice = '';
    renderMain();

    const res = await api.emailStart({ email });
    S_STATE.auth.busy = false;
    if (!res || !res.ok) {
      S_STATE.auth.error = res?.error || 'Could not send sign-in code.';
      renderMain();
      return;
    }
    S_STATE.auth.emailSent = true;
    S_STATE.auth.devCode = res.devCode || '';
    S_STATE.auth.notice = res.devCode
      ? 'Sign-in code ready below.'
      : `We sent a 6-digit code to ${email}. Check your inbox.`;
    renderMain();
  }

  async function doEmailVerify() {
    const api = API();
    const email = S_STATE.auth.email.trim();
    const code = S_STATE.auth.code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      S_STATE.auth.error = 'Enter the 6-digit sign-in code.';
      renderMain();
      return;
    }
    S_STATE.auth.busy = true;
    S_STATE.auth.error = '';
    renderMain();

    const res = await api.emailVerify({
      email,
      code,
      ephemeral: S_STATE.auth.ephemeral,
      name: S_STATE.auth.name.trim(),
    });
    S_STATE.auth.busy = false;
    if (!res || !res.ok) {
      S_STATE.auth.error = res?.error || 'Could not verify code.';
      renderMain();
      return;
    }
    S_STATE.auth.emailSent = false;
    S_STATE.auth.code = '';
    S_STATE.auth.devCode = '';
    S_STATE.auth.notice = '';
    stopOAuthHandoff(true);
    await loadSessionAndWorkspace(false);
    showToast('Signed in to Online Homework.');
  }

  async function doGoogleHandoffStart() {
    const api = API();
    stopOAuthHandoff(true);
    S_STATE.auth.error = '';
    S_STATE.auth.busy = true;
    renderMain();

    const startRes = await api.oauthHandoffStart({ ephemeral: S_STATE.auth.ephemeral });
    S_STATE.auth.busy = false;
    if (!startRes?.ok || !startRes.state || !startRes.pollSecret) {
      S_STATE.auth.error = startRes?.error || 'Could not start browser Google Sign-In.';
      renderMain();
      return;
    }

    const ttlSec = Number(startRes.expiresInSec || 60);
    const url = api.getOAuthHandoffUrl({
      state: startRes.state,
      googleClientId: window.HW_GOOGLE_CLIENT_ID || '',
    });

    const h = S_STATE.auth.handoff;
    h.active = true;
    h.state = startRes.state;
    h.pollSecret = startRes.pollSecret;
    h.url = url;
    h.expiresAt = Date.now() + ttlSec * 1000;
    h.secondsLeft = ttlSec;

    openExternalUrl(url);
    renderMain();

    h.countdownTimer = setInterval(() => {
      if (!S_STATE.auth.handoff.active) return stopOAuthHandoff(false);
      const left = Math.max(0, Math.ceil((S_STATE.auth.handoff.expiresAt - Date.now()) / 1000));
      S_STATE.auth.handoff.secondsLeft = left;
      if (left <= 0) {
        stopOAuthHandoff(true);
        S_STATE.auth.error = 'Browser sign-in link expired after 60 seconds. Click Sign in with Google to try again.';
      }
      renderMain();
    }, 1000);

    h.timer = setInterval(async () => {
      const cur = S_STATE.auth.handoff;
      if (!cur.active) return;
      const res = await api.oauthHandoffPoll({
        state: cur.state,
        pollSecret: cur.pollSecret,
        ephemeral: S_STATE.auth.ephemeral,
      });
      if (!S_STATE.auth.handoff.active) return;
      if (res?.ok && res.status === 'complete' && res.token) {
        stopOAuthHandoff(true);
        await loadSessionAndWorkspace(false);
        showToast('Signed in with Google.');
      } else if (res && res.status === 410) {
        stopOAuthHandoff(true);
        S_STATE.auth.error = 'Browser sign-in link expired. Click Sign in with Google to try again.';
        renderMain();
      }
    }, 1500);
  }

  async function doGoogleAuth() {
    const api = API();
    stopOAuthHandoff(true);
    S_STATE.auth.error = '';
    let idToken = '';

    if (api.isDemoMode()) {
      idToken = 'dev-google:demo-teacher|ms.rivera@oakridge.edu|Ms. Rivera';
    } else {
      const clientId = window.HW_GOOGLE_CLIENT_ID || '';
      if (!clientId || !window.google?.accounts?.id) {
        S_STATE.auth.error = 'Google Sign-In is not available right now. Use the 6-digit email code above.';
        renderMain();
        return;
      }
      idToken = await new Promise(resolve => {
        let done = false;
        const finish = tok => { if (!done) { done = true; resolve(tok || ''); } };
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: resp => finish(resp?.credential || ''),
          });
          window.google.accounts.id.prompt(n => {
            if (n && (n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.())) {
              finish('');
            }
          });
        } catch { finish(''); }
      });
      if (!idToken) {
        S_STATE.auth.error = 'Google Sign-In was canceled.';
        renderMain();
        return;
      }
    }

    S_STATE.auth.busy = true;
    renderMain();
    const res = await api.googleAuth({ idToken, ephemeral: S_STATE.auth.ephemeral });
    S_STATE.auth.busy = false;
    if (!res || !res.ok) {
      S_STATE.auth.error = res?.error || 'Google Sign-In failed.';
      renderMain();
      return;
    }
    await loadSessionAndWorkspace(false);
    showToast('Signed in with Google.');
  }

  async function doLogout() {
    stopOAuthHandoff(true);
    const api = API();
    if (!api) return;
    await api.logout();
    S_STATE.me = null;
    S_STATE.classes = [];
    S_STATE.students = [];
    S_STATE.assignments = [];
    S_STATE.gradebook = null;
    S_STATE.generatedCodes = null;
    closeProjectModal();
    closeSubModal();
    renderAll();
    showToast('Signed out of Online Homework.');
  }

  async function doCreateClass() {
    const api = API();
    const cf = S_STATE.classForm;
    const name = cf.name.trim();
    if (!name) {
      showToast('Enter a class name.');
      return;
    }
    cf.busy = true;
    renderMain();

    const res = await api.createClass({ name, locked: false });
    if (!res || !res.ok) {
      cf.busy = false;
      showToast(res?.error || 'Could not create class.');
      renderMain();
      return;
    }

    const newCls = res.class;
    S_STATE.selectedClassId = newCls.id;

    // Optionally import roster from selected local Rehearsal class
    const lc = cf.localClassId ? getLocalClasses().find(c => c.id === cf.localClassId) : null;
    if (lc && cf.importRoster && Array.isArray(lc.roster) && lc.roster.length) {
      const students = lc.roster.map(r => String(r || '').trim()).filter(Boolean).map(n => ({ displayName: n }));
      if (students.length) {
        const addRes = await api.addStudents(newCls.id, students, true);
        if (addRes?.ok && addRes.generatedCodes?.length) {
          S_STATE.generatedCodes = {
            classId: newCls.id,
            className: newCls.name,
            joinCode: newCls.joinCode,
            items: addRes.generatedCodes,
          };
        }
      }
    }

    cf.busy = false;
    cf.open = false;
    cf.name = '';
    cf.localClassId = '';
    await loadClassesAndActiveData();
    renderAll();
    showToast(`Created class "${newCls.name}".`);
  }

  async function doAddSingleStudent() {
    const cls = getSelectedClass();
    const rf = S_STATE.rosterForm;
    if (!cls) return;
    const displayName = rf.singleName.trim();
    if (!displayName) {
      showToast('Enter a student name.');
      return;
    }

    rf.busy = true;
    renderMain();

    const entry = { displayName };
    if (rf.singlePart.trim()) entry.part = rf.singlePart.trim();
    if (rf.singleEmail.trim()) entry.email = rf.singleEmail.trim();

    const res = await API().addStudents(cls.id, [entry], true);
    rf.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not add student.');
      renderMain();
      return;
    }

    rf.singleName = '';
    rf.singlePart = '';
    rf.singleEmail = '';
    if (res.generatedCodes?.length) {
      S_STATE.generatedCodes = {
        classId: cls.id,
        className: cls.name,
        joinCode: cls.joinCode,
        items: res.generatedCodes,
      };
    }
    await loadClassesAndActiveData();
    renderAll();
    showToast(`Added ${displayName}.`);
  }

  function parseBulkRosterText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map(s => s.trim());
      const displayName = parts[0] || '';
      if (!displayName) continue;
      const item = { displayName };
      if (parts[1]) {
        if (parts[1].includes('@') && !parts[2]) item.email = parts[1];
        else item.part = parts[1];
      }
      if (parts[2]) item.email = parts[2];
      out.push(item);
    }
    return out;
  }

  async function doAddBulkStudents() {
    const cls = getSelectedClass();
    const rf = S_STATE.rosterForm;
    if (!cls) return;
    const parsed = parseBulkRosterText(rf.bulkText);
    if (!parsed.length) {
      showToast('Paste at least one student name.');
      return;
    }

    rf.busy = true;
    renderMain();
    const res = await API().addStudents(cls.id, parsed, true);
    rf.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not add students.');
      renderMain();
      return;
    }

    rf.bulkText = '';
    rf.showBulk = false;
    if (res.generatedCodes?.length) {
      S_STATE.generatedCodes = {
        classId: cls.id,
        className: cls.name,
        joinCode: cls.joinCode,
        items: res.generatedCodes,
      };
    }
    await loadClassesAndActiveData();
    renderAll();
    showToast(`Added ${res.count || parsed.length} student${parsed.length === 1 ? '' : 's'}.`);
  }

  async function doImportLocalRoster() {
    const cls = getSelectedClass();
    const rf = S_STATE.rosterForm;
    if (!cls || !rf.importClassId) return;
    const lc = getLocalClasses().find(c => c.id === rf.importClassId);
    if (!lc || !Array.isArray(lc.roster) || !lc.roster.length) return;

    const existingNames = new Set(realStudents().map(s => String(s.displayName || '').trim().toLowerCase()));
    const toAdd = lc.roster
      .map(n => String(n || '').trim())
      .filter(n => n && !existingNames.has(n.toLowerCase()))
      .map(n => ({ displayName: n }));

    if (!toAdd.length) {
      showToast('All students from that Rehearsal class are already on this roster.');
      return;
    }

    rf.busy = true;
    renderMain();
    const res = await API().addStudents(cls.id, toAdd, true);
    rf.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not import roster.');
      renderMain();
      return;
    }

    if (res.generatedCodes?.length) {
      S_STATE.generatedCodes = {
        classId: cls.id,
        className: cls.name,
        joinCode: cls.joinCode,
        items: res.generatedCodes,
      };
    }
    await loadClassesAndActiveData();
    renderAll();
    showToast(`Imported ${toAdd.length} student${toAdd.length === 1 ? '' : 's'} from ${lc.name}.`);
  }

  async function doSaveSubmissionGrade(clearOverride) {
    const sm = S_STATE.subModal;
    const sub = sm.attempts[sm.activeIdx];
    if (!sub) return;

    let teacherOverridePct = null;
    if (!clearOverride) {
      const raw = sm.overrideInput.trim();
      if (raw !== '') {
        const num = Number(raw);
        if (!Number.isInteger(num) || num < 0 || num > 100) {
          showToast('Override score must be a whole number from 0 to 100.');
          return;
        }
        teacherOverridePct = num;
      }
    }

    sm.busy = true;
    renderSubModal();

    const res = await API().gradeSubmission(sub.id, {
      teacherOverridePct,
      teacherComment: sm.commentInput.trim(),
    });
    sm.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not save grade.');
      renderSubModal();
      return;
    }

    const updated = res.submission || {};
    sub.teacherOverridePct = updated.teacherOverridePct !== undefined ? updated.teacherOverridePct : teacherOverridePct;
    sub.teacherComment = updated.teacherComment !== undefined ? updated.teacherComment : sm.commentInput.trim();
    sub.effectivePct = updated.effectivePct !== undefined ? updated.effectivePct : (sub.teacherOverridePct != null ? sub.teacherOverridePct : sub.overallPct);
    sub.gradedAt = updated.gradedAt || Date.now();
    sm.overrideInput = sub.teacherOverridePct != null ? String(sub.teacherOverridePct) : '';

    await loadClassDetails(S_STATE.selectedClassId);
    renderAll();
    showToast(clearOverride ? 'Override cleared.' : 'Grade & comment saved.');
  }

  async function doDeleteSubmissionAudio() {
    const sm = S_STATE.subModal;
    const sub = sm.attempts[sm.activeIdx];
    if (!sub) return;
    if (!confirm('Delete this audio recording now? The student grade and note breakdown will be kept.')) return;

    sm.busy = true;
    renderSubModal();
    const res = await API().deleteSubmissionAudio(sub.id);
    sm.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not delete audio.');
      renderSubModal();
      return;
    }

    sub.audioAvailable = false;
    sub.audioDeletedAt = res.audioDeletedAt || Date.now();
    revokeModalAudio();
    renderSubModal();
    await loadClassDetails(S_STATE.selectedClassId);
    renderAll();
    showToast('Audio recording deleted.');
  }

  async function doDeleteSubmission() {
    const sm = S_STATE.subModal;
    const sub = sm.attempts[sm.activeIdx];
    if (!sub) return;
    if (!confirm(`Delete Attempt #${sub.attemptNum || (sm.activeIdx + 1)} for ${sm.studentName}?`)) return;

    sm.busy = true;
    renderSubModal();
    const res = await API().deleteSubmission(sub.id);
    sm.busy = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not delete submission.');
      renderSubModal();
      return;
    }

    revokeModalAudio();
    sm.attempts.splice(sm.activeIdx, 1);
    if (!sm.attempts.length) {
      closeSubModal();
    } else {
      await selectAttemptInModal(Math.max(0, sm.activeIdx - 1));
    }
    await loadClassesAndActiveData();
    renderAll();
    showToast('Submission deleted.');
  }

  async function doBillingCheckout(interval) {
    const res = await API().billingCheckout(interval);
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not start checkout.');
      return;
    }
    if (res.url) {
      openExternalUrl(res.url);
    } else {
      showToast(res.message || 'Checkout is only available when connected to a live Worker.');
    }
  }

  async function doBillingPortal() {
    const res = await API().billingPortal();
    if (!res || !res.ok) {
      showToast(res?.error || 'Could not open billing portal.');
      return;
    }
    if (res.url) {
      openExternalUrl(res.url);
    } else {
      showToast(res.message || 'Billing portal is only available when connected to a live Worker.');
    }
  }

  // ---------- Public API (window.HW_TEACHER)
  function renderTab() {
    return '<div id="hw-teacher-root" class="hwt-wrap"></div>';
  }

  function mount(rootEl) {
    const el = rootEl || document.getElementById('hw-teacher-root');
    if (!el) return;
    S_STATE.rootEl = el;
    bindRootEvents(el);
    loadSessionAndWorkspace(true);
  }

  function renderSettingsCard() {
    return '<div class="card" id="hw-settings-card"></div>';
  }

  function mountSettingsCard(cardEl) {
    const el = cardEl || document.getElementById('hw-settings-card');
    if (!el) return;
    S_STATE.settingsEl = el;
    bindRootEvents(el);
    renderSettingsCardContent();
    const api = API();
    if (api && api.getToken() && !S_STATE.me && !S_STATE.loading) {
      api.getMe().then(res => {
        if (res?.ok) {
          S_STATE.me = res;
          renderSettingsCardContent();
        }
      });
    }
  }

  function openHomeworkTab(subTab) {
    if (subTab && ['classes', 'assignments', 'gradebook', 'account'].includes(subTab)) {
      S_STATE.subTab = subTab;
    }

    if (typeof window.__openHomeworkTab === 'function') {
      window.__openHomeworkTab();
      return;
    }

    let switched = false;
    try {
      if (typeof exitFullscreen === 'function') exitFullscreen();
    } catch { }
    try {
      if (typeof TAB !== 'undefined') {
        TAB = 'homework';
        if (typeof VIEW !== 'undefined' && VIEW !== 'edit' && typeof go === 'function') {
          go('edit');
          switched = true;
        } else if (typeof renderEditor === 'function') {
          renderEditor();
          switched = true;
        }
      }
    } catch { }

    if (!switched) {
      const editBtn = document.querySelector('[data-action="edit"]');
      if (editBtn && !document.querySelector('[data-tab="homework"]')) {
        editBtn.click();
      }
      const hwTabBtn = document.querySelector('[data-tab="homework"]');
      if (hwTabBtn) hwTabBtn.click();
    }
  }

  function openAssignFromSight(st, viewObj) {
    const drawer = DRAWER();
    if (!drawer?.openFromSight) {
      showToast('Assignment drawer is still loading.');
      return;
    }
    drawer.openFromSight(st, viewObj, {
      classId: S_STATE.selectedClassId,
      onSaved: onAssignmentSaved,
    });
  }

  function openAssignFromScore(ctl) {
    const drawer = DRAWER();
    if (!drawer?.openFromScore) {
      showToast('Assignment drawer is still loading.');
      return;
    }
    drawer.openFromScore(ctl, {
      classId: S_STATE.selectedClassId,
      onSaved: onAssignmentSaved,
    });
  }

  function openAssignAudio(classId) {
    const drawer = DRAWER();
    if (!drawer?.openAudio) {
      showToast('Assignment drawer is still loading.');
      return;
    }
    drawer.openAudio({
      classId: classId || S_STATE.selectedClassId,
      onSaved: onAssignmentSaved,
    });
  }

  async function onAssignmentSaved(assignment) {
    if (assignment?.classId) {
      S_STATE.selectedClassId = assignment.classId;
    }
    await loadClassesAndActiveData();
    renderAll();
  }

  async function openAssignmentPreview(assignmentId) {
    const api = API();
    if (!api || !assignmentId) return;
    let placeholderWin = null;
    if (!isNativeApp()) {
      try {
        placeholderWin = window.open('about:blank', '_blank');
        if (placeholderWin && !placeholderWin.closed && placeholderWin.document) {
          placeholderWin.document.title = 'Opening Student Preview Sandbox…';
          placeholderWin.document.body.innerHTML = '<p style="font:15px system-ui,sans-serif;padding:24px;color:#334155">Opening Student Preview Sandbox…</p>';
        }
      } catch { placeholderWin = null; }
    }

    const res = await api.createAssignmentPreview(assignmentId);
    if (!res?.ok || !res.previewUrl) {
      if (placeholderWin && !placeholderWin.closed) {
        try { placeholderWin.close(); } catch { }
      }
      showToast(res?.error || 'Could not open assignment preview.');
      return;
    }

    if (isNativeApp()) {
      openExternalUrl(res.previewUrl);
      return;
    }
    if (placeholderWin && !placeholderWin.closed) {
      try {
        placeholderWin.opener = null;
        placeholderWin.location.replace(res.previewUrl);
        return;
      } catch { }
    }
    openExternalUrl(res.previewUrl);
    showToast('Preview ready — allow pop-ups if the tab did not open.');
  }

  window.HW_TEACHER = {
    renderTab,
    mount,
    renderSettingsCard,
    mountSettingsCard,
    openHomeworkTab,
    openAssignFromSight,
    openAssignFromScore,
    openAssignAudio,
    openAssignmentPreview,
    onAssignmentSaved,
  };
})();
