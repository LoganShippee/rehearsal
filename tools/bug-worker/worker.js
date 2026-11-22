// Rehearsal Bug Report Inbox — Cloudflare Worker -> Private GitHub Issue (with screenshot)
// Teachers submit directly inside Rehearsal with zero sign-in and never leave the app.
//
// Required Worker Secrets / Variables (Cloudflare Dashboard -> Worker -> Settings -> Variables):
//   GITHUB_TOKEN  (Secret) : Fine-grained GitHub PAT with Contents (Read & write) + Issues (Read & write)
//                            scoped ONLY to your private bug-reports repository.
//   GITHUB_REPO   (Text)   : e.g. "loganshippee/Rehearsal-Bugs"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const repo = (env.GITHUB_REPO || '').trim();
    const token = (env.GITHUB_TOKEN || '').trim();
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok: false, error: 'Worker missing GITHUB_REPO or GITHUB_TOKEN' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let category = 'Bug', message = '', replyEmail = '', version = '', os = '', view = '', log = '';
    let shotBytes = null;

    const ct = request.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      category = String(form.get('category') || 'Bug').slice(0, 40);
      message = String(form.get('message') || '').trim().slice(0, 8000);
      replyEmail = String(form.get('_replyto') || form.get('replyEmail') || '').trim().slice(0, 120);
      version = String(form.get('version') || '').trim().slice(0, 40);
      os = String(form.get('os') || '').trim().slice(0, 120);
      view = String(form.get('view') || '').trim().slice(0, 40);
      log = String(form.get('log') || '').trim().slice(-4000);
      const file = form.get('attachment');
      if (file && typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= 4 * 1024 * 1024) {
        shotBytes = new Uint8Array(await file.arrayBuffer());
      }
    } else {
      const body = await request.json().catch(() => ({}));
      category = String(body.category || 'Bug').slice(0, 40);
      message = String(body.description || body.message || '').trim().slice(0, 8000);
      replyEmail = String(body.replyEmail || '').trim().slice(0, 120);
      version = String(body.version || '').trim().slice(0, 40);
      os = String(body.os || '').trim().slice(0, 120);
      view = String(body.view || '').trim().slice(0, 40);
      log = String(body.logTail || body.log || '').trim().slice(-4000);
    }

    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: 'Message is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Rehearsal-Bug-Worker',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };

    // 1. Optional screenshot upload into the private repo so it renders inside the GitHub Issue
    let shotMarkdown = '';
    if (shotBytes && shotBytes.length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rand = Math.random().toString(36).slice(2, 7);
      const path = `screenshots/${stamp}-${rand}.jpg`;
      const up = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Bug report screenshot (${stamp})`,
          content: toBase64(shotBytes),
        }),
      });
      if (up.ok) {
        shotMarkdown = `\n\n### Screenshot\n![screenshot](https://github.com/${repo}/blob/main/${path}?raw=true)`;
      }
    }

    // 2. Open the private GitHub Issue
    const firstLine = message.split('\n')[0].trim().slice(0, 72) || 'Feedback';
    const title = `[${category}] ${firstLine}`;
    const body = [
      '### Report',
      message,
      shotMarkdown,
      '',
      '### Diagnostics',
      `- **Category**: ${category}`,
      `- **Version**: ${version || 'unknown'}`,
      `- **OS**: ${os || 'unknown'}`,
      `- **View**: ${view || 'unknown'}`,
      replyEmail ? `- **Reply email**: ${replyEmail}` : '',
      log ? `\n<details><summary>Recent log</summary>\n\n\`\`\`\n${log}\n\`\`\`\n</details>` : '',
    ].filter(Boolean).join('\n');

    const issueRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ title, body }),
    });

    if (!issueRes.ok) {
      const errText = await issueRes.text().catch(() => '');
      return new Response(JSON.stringify({ ok: false, error: `GitHub API ${issueRes.status}: ${errText.slice(0, 160)}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const created = await issueRes.json();
    return new Response(JSON.stringify({ ok: true, issue: created.number }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
