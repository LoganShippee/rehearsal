'use strict';

(function () {
  const DEFAULT_VERSION = '1.3.1';
  const GITHUB_BASE = 'https://github.com/LoganShippee/rehearsal/releases/latest/download';
  const RELEASE_CACHE_KEY = 'rehearsal-site-release-v1';

  const isLocalHost = (
    location.protocol === 'file:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );

  function downloadUrl(file) {
    return isLocalHost ? `${GITHUB_BASE}/${file}` : `/dl/${file}`;
  }

  function detectOS() {
    const ua = navigator.userAgent || '';
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const touchMac = /Mac/i.test(plat) && navigator.maxTouchPoints > 1;
    if (touchMac || /iPad|iPhone|iPod|Android|CrOS/i.test(ua)) return 'web';
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'win';
    if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) return 'mac';
    return 'web';
  }

  function applyOsAwareness() {
    const os = detectOS();
    const map = {
      mac: {
        label: 'Download Free for Mac',
        href: downloadUrl('Rehearsal.zip'),
        note: 'Universal macOS app (Apple Silicon & Intel)'
      },
      win: {
        label: 'Download Free for Windows',
        href: downloadUrl('Rehearsal-Setup.exe'),
        note: 'Windows 10 / 11 · No admin password required'
      },
      web: {
        label: 'Open Web App (No Install)',
        href: isLocalHost ? '../web/index.html' : 'https://app.rehearsalmusic.com/',
        note: 'Runs in Chrome, Safari, or Edge · Works offline'
      }
    };
    const chosen = map[os] || map.mac;

    document.querySelectorAll('[data-os-cta]').forEach(el => {
      el.textContent = chosen.label;
      if (el.tagName === 'A') el.setAttribute('href', chosen.href);
    });
    document.querySelectorAll('[data-os-note]').forEach(el => {
      el.textContent = chosen.note;
    });
    document.querySelectorAll('[data-dl-file]').forEach(el => {
      const f = el.getAttribute('data-dl-file');
      if (f) el.setAttribute('href', downloadUrl(f));
    });
    if (isLocalHost) {
      document.querySelectorAll('[data-app-href]').forEach(el => {
        const target = el.getAttribute('data-app-href');
        if (target === 'app') el.setAttribute('href', '../web/index.html');
        if (target === 'hw') el.setAttribute('href', '../web/hw.html');
        if (target === 'hw-demo') el.setAttribute('href', '../web/hw-demo.html');
        if (target === 'hw-sandbox') el.setAttribute('href', '../web/hw.html?demo=1');
      });
    }

    // Highlight matching OS tab on download.html unless user explicitly chose a hash
    const hashTab = (location.hash || '').replace(/^#/, '');
    const initialTab = ['mac', 'win', 'web'].includes(hashTab) ? hashTab : os;
    const dlTabs = document.querySelector('[data-os-tabs]');
    if (dlTabs) activateOsTab(initialTab);
  }

  function activateOsTab(os) {
    const buttons = document.querySelectorAll('[data-os-tab]');
    const panels = document.querySelectorAll('[data-os-panel]');
    if (!buttons.length) return;
    buttons.forEach(btn => {
      const match = btn.getAttribute('data-os-tab') === os;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    panels.forEach(panel => {
      const match = panel.getAttribute('data-os-panel') === os;
      panel.hidden = !match;
    });
  }

  function setupOsTabs() {
    document.querySelectorAll('[data-os-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const os = btn.getAttribute('data-os-tab');
        if (os) activateOsTab(os);
      });
    });
  }

  function setupPreviewTabs() {
    const tablist = document.querySelector('[data-preview-tablist]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('[data-preview-panel]'));

    function selectTab(id) {
      tabs.forEach(t => {
        const on = t.getAttribute('aria-controls') === id;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach(p => {
        p.hidden = p.id !== id;
      });
    }

    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls')));
      tab.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        selectTab(tabs[next].getAttribute('aria-controls'));
      });
    });
  }

  function setupMobileNav() {
    const btn = document.getElementById('menu-toggle');
    const nav = document.getElementById('site-nav');
    if (!btn || !nav) return;
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  async function hydrateReleaseMeta() {
    let data = null;
    try {
      const cached = sessionStorage.getItem(RELEASE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ts && Date.now() - parsed.ts < 15 * 60 * 1000) data = parsed.data;
      }
    } catch { }

    if (!data && !isLocalHost) {
      try {
        const res = await fetch('/api/release', { headers: { Accept: 'application/json' } });
        if (res.ok) {
          data = await res.json();
          try { sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { }
        }
      } catch { }
    }

    const ver = (data && data.version) || DEFAULT_VERSION;
    const date = (data && data.date) || '';
    document.querySelectorAll('[data-release-version]').forEach(el => {
      el.textContent = `v${ver}`;
    });
    document.querySelectorAll('[data-release-date]').forEach(el => {
      if (date) el.textContent = date;
    });
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function hydrateChangelog() {
    const host = document.getElementById('changelog-list');
    if (!host || isLocalHost) return;
    try {
      const res = await fetch('/api/releases', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) return;
      host.innerHTML = list.map(rel => {
        const tag = escHtml(rel.tag || rel.name || '');
        const date = escHtml((rel.publishedAt || '').slice(0, 10));
        const body = escHtml(rel.notes || '').replace(/\n/g, '<br>');
        const url = escHtml(rel.url || 'https://github.com/LoganShippee/rehearsal/releases');
        return `
          <article class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
              <h3 style="margin:0">${tag}</h3>
              <span class="tag">${date || 'Release'}</span>
            </div>
            <p class="small muted">${body || 'Maintenance and classroom improvements.'}</p>
            <p class="small" style="margin-top:10px"><a href="${url}" target="_blank" rel="noopener">View release assets on GitHub →</a></p>
          </article>
        `;
      }).join('');
    } catch { }
  }

  function setupInquiryForm() {
    const form = document.getElementById('inquiry-form');
    if (!form) return;
    const status = document.getElementById('inquiry-status');
    const submitBtn = document.getElementById('inquiry-submit');

    function setStatus(ok, msg) {
      if (!status) return;
      status.className = `form-status ${ok ? 'ok' : 'err'}`;
      status.textContent = msg;
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        kind: String(fd.get('kind') || 'demo'),
        name: String(fd.get('name') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        school: String(fd.get('school') || '').trim(),
        role: String(fd.get('role') || '').trim(),
        platform: String(fd.get('platform') || '').trim(),
        message: String(fd.get('message') || '').trim(),
        website: String(fd.get('website') || '').trim(),
      };
      if (!payload.name || !payload.email) {
        setStatus(false, 'Please enter your name and school email address.');
        return;
      }

      if (isLocalHost) {
        const subject = encodeURIComponent(`[Rehearsal ${payload.kind.toUpperCase()}] ${payload.school || payload.name}`);
        const body = encodeURIComponent(
          `Name: ${payload.name}\nEmail: ${payload.email}\nSchool/District: ${payload.school}\nEnsembles/Role: ${payload.role}\nPlatform: ${payload.platform}\n\nNotes:\n${payload.message}`
        );
        setStatus(true, 'Local preview mode: opening your email client to send this request to privacy@rehearsalmusic.com.');
        window.location.href = `mailto:privacy@rehearsalmusic.com?subject=${subject}&body=${body}`;
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      setStatus(true, 'Sending your request…');
      try {
        const res = await fetch('/api/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          form.reset();
          setStatus(true, 'Request sent! Expect a reply from rehearsalmusic.com within 1 school day.');
        } else {
          setStatus(false, data.error || 'Could not send right now. Please email privacy@rehearsalmusic.com directly.');
        }
      } catch {
        setStatus(false, 'Network error sending request. You can email privacy@rehearsalmusic.com directly.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupMobileNav();
    setupOsTabs();
    setupPreviewTabs();
    applyOsAwareness();
    hydrateReleaseMeta();
    hydrateChangelog();
    setupInquiryForm();
  });
})();
