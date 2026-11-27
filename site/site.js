'use strict';

(function () {
  const GITHUB_BASE = 'https://github.com/LoganShippee/rehearsal/releases/latest/download';

  const isLocalHost = (
    location.protocol === 'file:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );

  function downloadUrl(file) {
    return isLocalHost ? `${GITHUB_BASE}/${file}` : `/dl/${file}`;
  }

  function applyDownloadUrls() {
    document.querySelectorAll('[data-dl-file]').forEach(el => {
      const f = el.getAttribute('data-dl-file');
      if (f) el.setAttribute('href', downloadUrl(f));
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
        kind: String(fd.get('kind') || 'po'),
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
        setStatus(true, 'Local preview: opening your email client to send to privacy@rehearsalmusic.com.');
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
        setStatus(false, 'Network error sending request. Please email privacy@rehearsalmusic.com directly.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupMobileNav();
    applyDownloadUrls();
    setupInquiryForm();
  });
})();
