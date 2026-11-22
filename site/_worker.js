// Cloudflare Pages Advanced Mode Worker for rehearsalmusic.com
// Keeps downloads, release notes, homework portal URLs, and inquiry forms on
// a single domain (rehearsalmusic.com) so school web filters never block GitHub.

const GITHUB_OWNER = 'LoganShippee';
const GITHUB_REPO = 'rehearsal';
const GITHUB_LATEST_DL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download`;
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=15`;

const ALLOWED_DOWNLOADS = {
  'Rehearsal.zip': 'application/zip',
  'Rehearsal-Setup.exe': 'application/vnd.microsoft.portable-executable',
  'Rehearsal-Windows.zip': 'application/zip',
  'latest.json': 'application/json; charset=utf-8',
  'latest.json.sig': 'text/plain; charset=utf-8',
};

const REDIRECTS = {
  '/app': 'https://app.rehearsalmusic.com/',
  '/app/': 'https://app.rehearsalmusic.com/',
  '/hw': 'https://app.rehearsalmusic.com/hw',
  '/hw/': 'https://app.rehearsalmusic.com/hw',
  '/hw/demo': 'https://app.rehearsalmusic.com/hw-demo',
  '/demo/app': 'https://app.rehearsalmusic.com/',
  '/demo/homework': 'https://app.rehearsalmusic.com/hw-demo',
  '/sdpc': '/privacy-sdpc',
  '/it': '/it-whitelisting',
};

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function addSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'SAMEORIGIN');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

async function handleDownload(file, env) {
  const contentType = ALLOWED_DOWNLOADS[file];
  if (!contentType) {
    return jsonResponse({ error: 'Unknown download file' }, 404);
  }

  const isMetadata = file === 'latest.json' || file === 'latest.json.sig';
  const cacheControl = isMetadata ? 'public, max-age=300' : 'public, max-age=1800';

  if (env.RELEASES_BUCKET) {
    try {
      const obj = await env.RELEASES_BUCKET.get(`latest/${file}`);
      if (obj) {
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Cache-Control', cacheControl);
        headers.set('X-Content-Type-Options', 'nosniff');
        if (!isMetadata) headers.set('Content-Disposition', `attachment; filename="${file}"`);
        return new Response(obj.body, { status: 200, headers });
      }
    } catch { }
  }

  const upstream = await fetch(`${GITHUB_LATEST_DL}/${encodeURIComponent(file)}`, {
    headers: { 'User-Agent': 'rehearsalmusic.com-edge' },
    cf: { cacheEverything: true, cacheTtl: isMetadata ? 300 : 1800 },
  });
  if (!upstream.ok) {
    return new Response('Release artifact temporarily unavailable.', { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!isMetadata) {
    headers.set('Content-Disposition', `attachment; filename="${file}"`);
  }
  const len = upstream.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  return new Response(upstream.body, { status: 200, headers });
}

async function handleReleaseJson() {
  try {
    const res = await fetch(`${GITHUB_LATEST_DL}/latest.json`, {
      headers: { 'User-Agent': 'rehearsalmusic.com-edge' },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
    if (res.ok) {
      const data = await res.json();
      return jsonResponse({
        version: data.version || '1.3.1',
        date: data.date || '',
        notes: data.notes || '',
        downloads: {
          mac: '/dl/Rehearsal.zip',
          winSetup: '/dl/Rehearsal-Setup.exe',
          winZip: '/dl/Rehearsal-Windows.zip',
        },
      }, 200, { 'Cache-Control': 'public, max-age=300' });
    }
  } catch { }

  return jsonResponse({
    version: '1.3.1',
    date: '2026-11-22',
    notes: 'Rehearsal v1.3.1',
    downloads: {
      mac: '/dl/Rehearsal.zip',
      winSetup: '/dl/Rehearsal-Setup.exe',
      winZip: '/dl/Rehearsal-Windows.zip',
    },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function handleReleasesList() {
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        'User-Agent': 'rehearsalmusic.com-edge',
        Accept: 'application/vnd.github+json',
      },
      cf: { cacheEverything: true, cacheTtl: 600 },
    });
    if (res.ok) {
      const raw = await res.json();
      const mapped = (Array.isArray(raw) ? raw : [])
        .filter(r => !r.draft)
        .map(r => ({
          tag: r.tag_name,
          name: r.name,
          publishedAt: r.published_at,
          notes: r.body || '',
          url: r.html_url,
        }));
      return jsonResponse(mapped, 200, { 'Cache-Control': 'public, max-age=600' });
    }
  } catch { }

  return jsonResponse([
    {
      tag: 'v1.3.1',
      name: 'Rehearsal 1.3.1',
      publishedAt: '2026-11-22',
      notes: 'Hosted web app & Student Portal on app.rehearsalmusic.com and Homework API on api.rehearsalmusic.com; added interactive How It Works & Student Demo page.',
      url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    },
  ], 200, { 'Cache-Control': 'public, max-age=120' });
}

async function handleInquiry(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid request body.' }, 400);
  }

  // Silent honeypot success to deter bots
  if (body && String(body.website || '').trim()) {
    return jsonResponse({ ok: true });
  }

  const name = String(body?.name || '').trim().slice(0, 120);
  const email = String(body?.email || '').trim().slice(0, 160);
  const kind = String(body?.kind || 'demo').trim().slice(0, 40);
  const school = String(body?.school || '').trim().slice(0, 160);
  const role = String(body?.role || '').trim().slice(0, 160);
  const platform = String(body?.platform || '').trim().slice(0, 80);
  const message = String(body?.message || '').trim().slice(0, 2500);

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: 'Please provide your name and a valid email address.' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return jsonResponse({
      ok: false,
      error: 'Web form email is not configured yet. Please email privacy@rehearsalmusic.com directly.',
    }, 503);
  }

  const from = env.FROM_EMAIL || 'Rehearsal <noreply@rehearsalmusic.com>';
  const to = env.INQUIRY_TO_EMAIL || 'privacy@rehearsalmusic.com';
  const subject = `[Rehearsal ${kind.toUpperCase()}] ${school || name}`;
  const text = [
    `Request type: ${kind}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `School / District: ${school || '(not specified)'}`,
    `Ensembles / Role: ${role || '(not specified)'}`,
    `Primary Platform: ${platform || '(not specified)'}`,
    '',
    'Message:',
    message || '(no extra notes)',
  ].join('\n');

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject,
      text,
    }),
  });

  if (!resendRes.ok) {
    return jsonResponse({
      ok: false,
      error: 'Could not deliver message right now. Please email privacy@rehearsalmusic.com.',
    }, 502);
  }

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (url.hostname === 'www.rehearsalmusic.com') {
      return Response.redirect(`https://rehearsalmusic.com${path}${url.search}`, 301);
    }

    if (request.method === 'POST' && path === '/api/inquiry') {
      return handleInquiry(request, env);
    }
    if (request.method === 'GET' && path === '/api/release') {
      return handleReleaseJson();
    }
    if (request.method === 'GET' && path === '/api/releases') {
      return handleReleasesList();
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/dl/')) {
      const file = decodeURIComponent(path.slice(4));
      return handleDownload(file, env);
    }

    const redir = REDIRECTS[path];
    if (redir) {
      const target = new URL(redir, url.origin);
      if (url.search && !target.search) {
        target.search = url.search;
      } else if (url.search && target.search) {
        const merged = new URLSearchParams(target.search);
        for (const [k, v] of url.searchParams.entries()) merged.set(k, v);
        target.search = `?${merged.toString()}`;
      }
      return Response.redirect(target.toString(), 302);
    }

    const res = await env.ASSETS.fetch(request);
    return addSecurityHeaders(res);
  },
};
