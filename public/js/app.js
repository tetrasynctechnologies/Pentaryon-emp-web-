/**
 * Pentaryon Technology - Client Application Controller
 * High-craft UI/UX integrated with live Express & SQLite backend
 */

const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// Inline high-contrast SVG icons
const I = {
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:
    '<path d="M3 3l18 18M10.6 6.1A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.9C3.6 8.8 2 12 2 12s4 7 10 7c1.5 0 2.8-.4 4-1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'
};

const ic = (n) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px">${I[n] || ''}</svg>`;

const logo = (w = 32, full = false) =>
  full
    ? `<img src="/assets/logo_full_dark.png" alt="Pentaryon Technology" style="height:${w}px; width:auto; max-width:100%; object-fit:contain; display:inline-block;" />`
    : `<img src="/assets/logo_emblem_dark.png" alt="Pentaryon Technology" style="width:${w}px; height:${w}px; object-fit:contain; display:inline-block; vertical-align:middle; filter:drop-shadow(0 0 14px rgba(0,210,255,0.28));" />`;

const DEPTS = ['Web Management', 'Digital Marketing', 'Cyber Security', 'Designer', 'Systems Eng'];
const ST = ['Pending', 'In Progress', 'Under Review', 'Completed'];
const PR = ['Urgent', 'High', 'Medium', 'Low'];

// Application State
const S = {
  role: 'emp',
  me: null,
  tab: 'q',
  pend: [],
  emps: [],
  T: [],
  L: []
};

// Loader Control Helpers
let activeRequests = 0;
function showTopLoader() {
  activeRequests++;
  const t = $('#top-loader');
  if (t) t.classList.add('active');
}
function hideTopLoader() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) {
    const t = $('#top-loader');
    if (t) t.classList.remove('active');
  }
}

function dismissInitialLoader() {
  const l = $('#initial-loader');
  if (l && !l.classList.contains('dismissed')) {
    l.classList.add('dismissed');
    setTimeout(() => {
      try { l.remove(); } catch (_) {}
    }, 500);
  }
}

// API Helpers
async function api(path, options = {}) {
  showTopLoader();
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  } finally {
    hideTopLoader();
  }
}

// Status & Priority mappers
const toUiStatus = (s) =>
  ({
    pending: 'Pending',
    in_progress: 'In Progress',
    review: 'Under Review',
    completed: 'Completed'
  }[s] || s);

const toApiStatus = (s) =>
  ({
    'Pending': 'pending',
    'In Progress': 'in_progress',
    'Under Review': 'review',
    'Completed': 'completed'
  }[s] || (s ? s.toLowerCase() : 'pending'));

const toUiPriority = (p) =>
  ({
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  }[p] || p);

const toApiPriority = (p) => (p ? p.toLowerCase() : 'medium');

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getAttIcon(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('image')) return '🖼️';
  if (m.includes('pdf')) return '📄';
  if (m.includes('zip') || m.includes('tar') || m.includes('rar') || m.includes('gzip')) return '📦';
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return '📊';
  if (m.includes('text') || m.includes('json') || m.includes('javascript')) return '📝';
  return '📎';
}

function mapTask(t) {
  const rawDue = t.due_date;
  const dueTimestamp = rawDue ? new Date(rawDue + 'T23:59:59').getTime() : null;
  return {
    id: t.id,
    t: t.title,
    d: t.description,
    p: toUiPriority(t.priority),
    s: toUiStatus(t.status),
    pct: t.progress_percent ?? 0,
    c: t.category || 'General',
    to: t.assignee_username,
    toName: t.assignee_name,
    toId: t.assignee_id,
    due: dueTimestamp,
    rawDue,
    n: (t.updates || []).map((u) => ({
      by: u.updater_name || u.user_id,
      at: new Date(u.created_at).getTime(),
      x: u.note
    }))
  };
}

const dt = (t) =>
  new Date(t).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });

const rel = (t) => {
  if (!t) return '—';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 6e4);
  return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
};

const pill = (t) => `<span class="badge ${t.p.toLowerCase()}">${t.p}</span>`;

function due(t) {
  if (t.s == 'Completed') return '<span class="badge em">Done</span>';
  if (!t.due) return '<span class="badge low">No deadline</span>';
  const d = Math.ceil((t.due - Date.now()) / 864e5);
  const c = d <= 0 ? 'cr' : d <= 2 ? 'am' : 'cy';
  return `<span class="badge ${c}">${d <= 0 ? 'Overdue' : d + 'd left'}</span>`;
}

const card = (t, emp) => `
  <article class="card">
    <div class="row">${pill(t)}${due(t)}</div>
    <h3 style="margin:10px 0 4px;font-size:15px">${esc(t.t)}</h3>
    <p class="mu card-desc">${esc(t.d)}</p>
    <div class="row mono mu" style="font-size:12px">
      <span>${esc(t.c)} · ${emp ? t.s : '@' + esc(t.to)}</span>
      <span>${t.pct}%</span>
    </div>
    <div class="bar" role="progressbar" aria-valuenow="${t.pct}" aria-valuemin="0" aria-valuemax="100">
      <i style="width:${t.pct}%"></i>
    </div>
    <div class="act row" style="margin-top:12px">
      <button class="p" data-a="up" data-id="${t.id}">${ic('plus')} Update Progress</button>
      ${!emp ? `<button class="no" data-a="del" data-id="${t.id}" aria-label="Delete task">${ic('trash')}</button>` : ''}
    </div>
  </article>
`;

const kpi = (l, v, c = '', x = '') => `
  <div class="card kpi">
    <div>
      <span class="mu" style="font-size:12px">${l}</span>
      <b class="${c}">${v}</b>
    </div>
    ${x}
  </div>
`;

const head = () => `
  <header class="hdr">
    ${logo(28)}
    <b>Pentaryon</b>
    <span style="flex:1"></span>
    <span class="mono">${esc(S.me.u)}</span>
    <span class="badge ${S.me.admin ? 'cy' : ''} hide-s">${S.me.admin ? 'Executive Admin' : 'Employee'}</span>
    <button data-a="out" aria-label="Sign out">${ic('out')}<span class="hide-s"> Sign Out</span></button>
  </header>
`;

function gate(m) {
  dismissInitialLoader();
  S.me = null;
  app.innerHTML = `
    <main class="gate">
      <form class="card" id="lf" novalidate>
        <div style="text-align:center">
          ${logo(68)}
          <h1 style="margin:10px 0 0;font-size:20px;letter-spacing:0.3px">Workplace Access Gate</h1>
          <div class="mu mono" style="font-size:11px;margin-top:2px">Pentaryon Technology · Zero-trust entry</div>
        </div>
        <div class="seg" role="group" aria-label="Access type">
          ${[
            ['emp', 'Employee Access'],
            ['adm', 'Executive Admin']
          ]
            .map(
              (r) =>
                `<button type="button" data-a="role" data-r="${r[0]}" aria-pressed="${S.role == r[0]}">${r[1]}</button>`
            )
            .join('')}
        </div>
        <label for="u">Username</label>
        <input id="u" name="u" class="mono" autocomplete="username" autocapitalize="none" required autofocus>
        <label for="pw">Password</label>
        <div style="position:relative">
          <input id="pw" name="p" type="password" autocomplete="current-password" required placeholder="••••••••">
          <button type="button" class="eye" data-a="pw" aria-label="Show password">${ic('eye')}</button>
        </div>
        ${m ? `<div class="alert ${m.c}" role="alert">${m.t}</div>` : ''}
        <button class="p" style="width:100%;margin-top:16px;min-height:44px">Authenticate</button>
        <p style="text-align:center;margin:14px 0 0">
          <a href="#" data-a="req" class="cy">Request Employee Account</a>
        </p>
      </form>
    </main>
  `;
}

function admin() {
  const pend = S.pend;
  const emps = S.emps;
  const open = S.T.filter((t) => t.s != 'Completed');
  const rate = S.T.length ? Math.round((100 * (S.T.length - open.length)) / S.T.length) : 0;
  const tabs = [
    ['q', 'Clearance Queue'],
    ['t', 'Work Delegation & Tasks'],
    ['d', 'Employee Directory'],
    ['a', 'Audit & Compliance Trail']
  ];

  const body = {
    q: () => `
      <div class="row" style="margin-bottom:12px; justify-content:space-between">
        <span class="mu">${pend.length} pending clearance${pend.length === 1 ? '' : 's'}</span>
        <button class="ghost" data-a="ref" title="Refresh clearance queue">${ic('clock')} Refresh</button>
      </div>
      ${pend.length
        ? `<div class="grid">${pend
            .map(
              (u) => `
          <article class="card">
            <div class="row">
              <b>${esc(u.name)}</b>
              <span class="badge am">Pending</span>
            </div>
            <div class="mono cy">@${esc(u.username)}</div>
            ${u.email ? `<div class="mono mu" style="font-size:12px;margin:2px 0">${esc(u.email)}</div>` : ''}
            <p style="margin:8px 0 2px">${esc(u.department || 'General')}</p>
            <div class="mono mu" style="font-size:12px">${dt(u.created_at)}</div>
            <p class="mu">${esc(u.notes || 'No note provided.')}</p>
            <div class="act row">
              <button class="ok" data-a="ap" data-id="${u.id}" data-u="${esc(u.username)}">${ic('check')} Approve Account</button>
              <button class="no" data-a="rj" data-id="${u.id}" data-u="${esc(u.username)}">${ic('x')} Reject Request</button>
            </div>
          </article>
        `
            )
            .join('')}</div>`
        : '<p class="mu">Clearance queue is empty. All employee accounts are verified.</p>'}
    `,
    t: () => `
      <div class="row" style="margin-bottom:12px">
        <span class="mu">${S.T.length} assignments</span>
        <button class="p" data-a="nt">${ic('plus')} New Task</button>
      </div>
      <div class="grid">${S.T.length ? S.T.map((t) => card(t, 0)).join('') : '<p class="mu">No tasks created yet. Click "New Task" to assign work.</p>'}</div>
    `,
    d: () => `
      <div class="row" style="margin-bottom:12px">
        <span class="mu">${emps.length} team members</span>
        <button class="p" data-a="ne">${ic('plus')} Add Employee</button>
      </div>
      <div class="grid">${emps.length ? emps
        .map(
          (u) => `
        <article class="card" style="display:flex;flex-direction:column;gap:12px">
          <div class="row" style="flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:8px">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
              <div class="av">${esc(u.name[0] || 'U')}</div>
              <div style="min-width:0;flex:1">
                <b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px">${esc(u.name)}</b>
                <div class="mono mu" style="font-size:12px">@${esc(u.username)}</div>
                ${u.email ? `<div class="mono cy" style="font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(u.email)}">${esc(u.email)}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
              <button class="no" data-a="ee" data-id="${u.id}" data-name="${esc(u.name)}" data-u="${esc(u.username)}" data-d="${esc(u.department || 'General')}" data-e="${esc(u.email || '')}" title="Edit employee ${esc(u.name)}" aria-label="Edit employee ${esc(u.name)}" style="padding:6px 9px;border-color:var(--line);color:var(--cy)">
                ${ic('edit')}
              </button>
              <button class="no" data-a="de" data-id="${u.id}" data-name="${esc(u.name)}" data-u="${esc(u.username)}" title="Delete employee" aria-label="Delete employee ${esc(u.name)}" style="padding:6px 9px">
                ${ic('trash')}
              </button>
            </div>
          </div>
          <div class="row" style="flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid var(--line)">
            <span class="badge cy" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:1" title="${esc(u.department || 'General')}">${esc(u.department || 'General')}</span>
            <div style="text-align:right;flex-shrink:0">
              <span class="mono" style="font-size:12px"><b>${u.active_tasks ?? 0}</b> <span class="mu" style="font-size:11px">active</span></span>
              <span class="mono mu" style="font-size:11px;margin-left:6px">${rel(u.last_login_at)}</span>
            </div>
          </div>
        </article>
      `
        )
        .join('') : '<p class="mu">No employees found. Click "Add Employee" to create one.</p>'}</div>
    `,
    a: () => `
      <div class="card">
        ${
          S.L.length
            ? S.L.map(
                (l) => `
            <div class="row mono" style="font-size:12px;padding:8px 0;border-bottom:1px solid var(--line)">
              <span><span class="cy">${esc(l.actor_name || l.actor_id || 'System')}</span> ${esc(l.details || l.action)}</span>
              <span class="mu">${dt(l.created_at)}</span>
            </div>
          `
              ).join('')
            : '<div class="mu">No audit logs recorded yet.</div>'
        }
      </div>
    `
  };

  const R = 22 * 2 * Math.PI;
  app.innerHTML =
    head() +
    `
    <main class="wrap">
      <section class="kpis" aria-label="Key metrics">
        ${kpi('Pending Clearances', pend.length, 'am', pend.length ? '<span class="badge am">Review</span>' : '')}
        ${kpi('Active Workforce', emps.length)}
        ${kpi('Open Assignments', open.length, 'cy')}
        ${kpi(
          'Completion Rate',
          rate + '%',
          'em',
          `<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#1c2434" stroke-width="5"/>
            <circle cx="26" cy="26" r="22" fill="none" stroke="#10B981" stroke-width="5" stroke-linecap="round" stroke-dasharray="${R}" stroke-dashoffset="${R * (1 - rate / 100)}" transform="rotate(-90 26 26)"/>
          </svg>`
        )}
      </section>
      <div class="tabs" role="tablist">
        ${tabs
          .map(
            (t) =>
              `<button class="tab" role="tab" data-a="tab" data-t="${t[0]}" aria-selected="${S.tab == t[0]}">${t[1]}${t[0] == 'q' && pend.length ? ` <span class="badge am">${pend.length}</span>` : ''}</button>`
          )
          .join('')}
      </div>
      ${body[S.tab]()}
      <footer style="text-align:center;padding:32px 0 16px;font-size:12px;color:var(--mu);font-family:var(--mono)">
        &copy; 2026 Pentaryon Technology
      </footer>
    </main>
  `;
}

function emp() {
  const mine = S.T.slice().sort(
    (a, b) => (a.s == 'Completed') - (b.s == 'Completed') || PR.indexOf(a.p) - PR.indexOf(b.p)
  );
  const n = (s) => mine.filter((t) => t.s == s).length;

  app.innerHTML =
    head() +
    `
    <main class="wrap">
      <h2 style="margin:0 0 14px">Welcome, ${esc(S.me.name)}</h2>
      <section class="kpis">
        ${kpi('Total Assigned', mine.length)}
        ${kpi('In Progress', n('In Progress'), 'cy')}
        ${kpi('Under Review', n('Under Review'), 'am')}
        ${kpi('Completed', n('Completed'), 'em')}
      </section>
      <h3 style="margin:22px 0 12px">Priority Work Queue</h3>
      ${mine.length ? `<div class="grid">${mine.map((t) => card(t, 1)).join('')}</div>` : '<p class="mu">No assignments yet.</p>'}
      <footer style="text-align:center;padding:32px 0 16px;font-size:12px;color:var(--mu);font-family:var(--mono)">
        &copy; 2026 Pentaryon Technology
      </footer>
    </main>
  `;
}

async function loadDataAndRender() {
  if (!S.me) return gate();

  try {
    if (S.me.admin) {
      const [reqs, emps, tasks, logs] = await Promise.all([
        api('/api/admin/requests').catch(() => ({ requests: [] })),
        api('/api/admin/employees').catch(() => ({ employees: [] })),
        api('/api/tasks').catch(() => ({ tasks: [] })),
        api('/api/admin/audit-logs').catch(() => ({ logs: [] }))
      ]);

      S.pend = reqs.requests || [];
      S.emps = emps.employees || [];
      S.T = (tasks.tasks || []).map(mapTask);
      S.L = logs.logs || [];
      admin();
    } else {
      const tasks = await api('/api/tasks').catch(() => ({ tasks: [] }));
      S.T = (tasks.tasks || []).map(mapTask);
      emp();
    }
    dismissInitialLoader();
  } catch (err) {
    console.error('Data load error:', err);
    if (S.me.admin) admin();
    else emp();
    dismissInitialLoader();
  }
}

const render = () => (S.me ? loadDataAndRender() : gate());

// Modals handling
let M;
const close = () => {
  M?.remove();
  M = null;
};

const open = (h) => {
  close();
  M = document.createElement('div');
  M.className = 'modal';
  M.innerHTML = `<div class="card" role="dialog" aria-modal="true">${h}</div>`;
  document.body.appendChild(M);
  M.addEventListener('mousedown', (e) => {
    if (e.target === M) close();
  });
  M.querySelector('input,select,textarea')?.focus();
};

addEventListener('keydown', (e) => e.key == 'Escape' && close());
const opts = (a) => a.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
const mh = (t, f) =>
  `<div class="row"><h2 style="margin:0;font-size:17px">${t}</h2><button data-a="close" aria-label="Close">${ic('x')}</button></div><form id="${f}">`;

const T = (id) => S.T.find((t) => t.id == id);

// Action Dispatcher
const act = {
  role: (d) => {
    S.role = d.r;
    gate();
  },
  out: async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    S.me = null;
    gate();
  },
  tab: (d) => {
    S.tab = d.t;
    admin();
  },
  close,
  pw: () => {
    const i = $('#pw');
    const h = i.type == 'password';
    i.type = h ? 'text' : 'password';
    $('[data-a=pw]').innerHTML = ic(h ? 'eyeoff' : 'eye');
  },
  req: () =>
    open(
      mh('Request Clearance', 'rq') +
        `
      <label>Full Name</label>
      <input name="n" required autocomplete="name" placeholder="e.g. Maya Lin">
      <label>Desired Username</label>
      <input name="u" class="mono" required pattern="[a-z0-9._]{3,30}" autocapitalize="none" placeholder="e.g. maya.l">
      <label>Email Address (for task briefings)</label>
      <input name="e" type="email" autocomplete="email" placeholder="e.g. employee@gmail.com">
      <label>Create Password</label>
      <input name="p" type="password" required minlength="8" placeholder="Minimum 8 characters">
      <label>Department / Role</label>
      <input name="d" list="dept-list-req" placeholder="Type or select department / role" required autocomplete="off">
      <datalist id="dept-list-req">
        ${DEPTS.map((x) => `<option value="${esc(x)}">`).join('')}
      </datalist>
      <label>Note to Admin (optional)</label>
      <textarea name="x" rows="3" placeholder="Specialization, internal project ref, or sponsor"></textarea>
      <div class="alert am" id="er" hidden></div>
      <div class="act" style="margin-top:16px"><button class="p" style="width:100%">Submit Request</button></div>
    </form>`
    ),
  ap: async (d) => {
    try {
      await api(`/api/admin/requests/${d.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ username: d.u })
      });
    } catch (err) {
      alert(err.message);
    } finally {
      await loadDataAndRender();
    }
  },
  rj: (d) =>
    open(
      mh('Reject @' + esc(d.u), 'rf') +
        `
      <input type="hidden" name="req_id" value="${esc(d.id)}">
      <input type="hidden" name="id" value="${esc(d.id)}">
      <input type="hidden" name="username" value="${esc(d.u)}">
      <label>Reason (shown to applicant)</label>
      <textarea name="r" rows="3" required placeholder="Identity unconfirmed with HR"></textarea>
      <div class="alert cr" id="rf-er" hidden style="margin-top:12px"></div>
      <div class="act" style="margin-top:16px"><button class="no" style="width:100%">Confirm Rejection</button></div>
    </form>`
    ),
  ref: async () => {
    await loadDataAndRender();
  },
  nt: () =>
    open(
      mh('New Assignment', 'tk') +
        `
      <label>Task Title</label>
      <input name="t" required placeholder="e.g. Firmware Signal Integrity Audit">
      <label>Scope (Markdown supported)</label>
      <textarea name="d" rows="4" class="mono" placeholder="Detailed assignment instructions and acceptance criteria"></textarea>
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <label>Priority</label>
          <select name="p">${opts(PR)}</select>
        </div>
        <div style="flex:1">
          <label>Category</label>
          <input name="c" value="General">
        </div>
      </div>
      <label>Assignee</label>
      <select name="to">
        ${
          S.emps.length
            ? S.emps.map((u) => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)}) - ${esc(u.department)}</option>`).join('')
            : '<option value="">No employees available</option>'
        }
      </select>
      <label>Due Date</label>
      <input name="due" type="date" required value="${new Date(Date.now() + 864e5 * 7).toISOString().split('T')[0]}">
      <div class="row" style="margin-top:12px;padding:9px 12px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.2);border-radius:6px;gap:8px;align-items:center;">
        <span style="color:var(--cy);font-size:15px;">✉</span>
        <span class="mu" style="font-size:11px;line-height:1.4">An official task briefing email will automatically be dispatched to the employee's Gmail from <b class="cy">tetrasynctech@gmail.com</b>.</span>
      </div>
      <div class="alert cr" id="tk-er" hidden style="margin-top:12px"></div>
      <div class="act" style="margin-top:16px"><button class="p" style="width:100%">Delegate Task</button></div>
    </form>`
    ),
  up: async (d) => {
    let t = T(d.id);
    let updates = [];
    let attachments = [];
    try {
      const details = await api(`/api/tasks/${d.id}`);
      if (details.task) {
        t = mapTask({ ...details.task, updates: details.updates });
      }
      updates = (details.updates || []).map((u) => ({
        by: u.updater_name || u.updater_role || 'User',
        at: new Date(u.created_at).getTime(),
        x: u.note
      }));
      attachments = details.attachments || [];
    } catch (_) {
      updates = t?.n || [];
    }

    if (!t) return;

    open(
      mh(esc(t.t), 'ud') +
        `
      <input type="hidden" name="task_id" value="${t.id}">
      <input type="hidden" name="id" value="${t.id}">
      ${
        t.d
          ? `
      <div class="task-scope-box">
        <div class="task-scope-lbl">Assignment Scope & Instructions</div>
        <div class="task-scope-body">${esc(t.d)}</div>
      </div>
      `
          : ''
      }
      <label>Status</label>
      <select name="s">
        ${ST.map((s) => `<option value="${s}"${s == t.s ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      ${
        S.me?.admin
          ? `
      <label for="ud-due">Assignment Due Date <span class="badge cy" style="margin-left:6px">Admin</span></label>
      <input id="ud-due" name="due" type="date" value="${t.rawDue ? esc(t.rawDue) : ''}">
      `
          : ''
      }
      <label for="rg">Progress</label>
      <div style="position:relative;padding-top:22px">
        <output class="bub" id="bb" style="left:${t.pct}%">${t.pct}%</output>
        <input id="rg" name="pct" type="range" min="0" max="100" value="${t.pct}">
      </div>
      <label>Milestone Note</label>
      <textarea name="x" rows="3" minlength="3" maxlength="1000" placeholder="e.g. Completed oscilloscope frequency tests and passed benchmarks." required></textarea>
      <div class="alert cr" id="ud-er" hidden style="margin-top:12px"></div>
      <div class="act" style="margin-top:16px"><button type="submit" id="btn-save-milestone" class="p" style="width:100%">Save Milestone</button></div>
    </form>

    <!-- Attachments & Deliverables Section -->
    <div class="att-section">
      <div class="att-header">
        <h4 class="att-title">Deliverables & Attachments (${attachments.length})</h4>
        <label for="att-file-input" class="badge cy" style="cursor:pointer;margin:0">+ Add File</label>
        <input type="file" id="att-file-input" style="display:none;">
      </div>
      <div class="att-list" id="task-att-list">
        ${
          attachments.length
            ? attachments
                .map(
                  (a) => `
              <div class="att-item" id="att-item-${a.id}">
                <div class="att-info">
                  <span class="att-icon">${getAttIcon(a.file_type)}</span>
                  <div class="att-meta">
                    <a href="/api/tasks/${t.id}/attachments/${a.id}" target="_blank" download="${esc(a.filename)}">${esc(a.filename)}</a>
                    <span>(${formatBytes(a.file_size)}) &middot; by ${esc(a.uploader_name || a.uploader_username)}</span>
                  </div>
                </div>
                ${(S.me?.admin || S.me?.id === a.user_id) ? `<button type="button" class="att-btn-del" data-a="del_att" data-taskid="${t.id}" data-attid="${a.id}" title="Delete file">✕</button>` : ''}
              </div>
            `
                )
                .join('')
            : '<div class="mu" style="font-size:12px">No files or deliverables attached yet.</div>'
        }
      </div>
      <div id="att-upload-status" class="mu" style="font-size:11px" hidden></div>
    </div>

    <h4 style="margin:18px 0 0">Timeline</h4>
    <div class="tl">
      ${
        updates.length
          ? updates
              .map(
                (n) => `
            <div>
              <span class="mono cy">${esc(n.by)}</span> <span class="mono mu">${dt(n.at)}</span><br>
              ${esc(n.x)}
            </div>
          `
              )
              .join('')
          : '<div class="mu">No milestones logged yet.</div>'
      }
    </div>`
    );

    // Bind file upload handler
    const fileInput = document.getElementById('att-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          alert('File size exceeds the 5MB limit. Please choose a file under 5MB.');
          fileInput.value = '';
          return;
        }
        const statusEl = document.getElementById('att-upload-status');
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = `Uploading "${file.name}"...`;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await api(`/api/tasks/${t.id}/attachments`, {
              method: 'POST',
              body: JSON.stringify({
                filename: file.name,
                file_type: file.type || 'application/octet-stream',
                file_data: reader.result
              })
            });
            await act.up({ id: t.id });
          } catch (uploadErr) {
            alert(uploadErr.message || 'Failed to upload attachment');
            if (statusEl) statusEl.hidden = true;
          }
        };
        reader.readAsDataURL(file);
      });
    }
  },
  del_att: async (d) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return;
    try {
      await api(`/api/tasks/${d.taskid}/attachments/${d.attid}`, { method: 'DELETE' });
      await act.up({ id: d.taskid });
    } catch (err) {
      alert(err.message);
    }
  },
  del: async (d) => {
    if (!confirm('Are you sure you want to permanently delete this task?')) return;
    try {
      // Optimistically remove from local state for instant UI responsiveness
      S.T = S.T.filter((t) => String(t.id) !== String(d.id));
      render();
      await api(`/api/tasks/${d.id}`, { method: 'DELETE' });
      await loadDataAndRender();
    } catch (err) {
      await loadDataAndRender();
      alert(err.message);
    }
  },
  de: async (d) => {
    const label = d.name ? `${d.name} (@${d.u})` : 'this employee';
    if (!confirm(`Are you sure you want to permanently delete ${label} from the employee directory? All active sessions and task assignments will be removed.`)) return;
    try {
      await api(`/api/admin/employees/${d.id}`, { method: 'DELETE' });
      await loadDataAndRender();
    } catch (err) {
      alert(err.message);
    }
  },
  ne: () =>
    open(
      mh('Add Employee', 'em_form') +
        `
      <label>Full Name</label>
      <input name="n" required placeholder="e.g. Rachel Adams">
      <label>Username</label>
      <input name="u" class="mono" required pattern="[a-z0-9._]{3,30}" autocapitalize="none" placeholder="e.g. rachel.a">
      <label>Email Address (for task briefings)</label>
      <input name="e" type="email" placeholder="e.g. employee@gmail.com">
      <label>Password</label>
      <input name="p" type="password" required minlength="8" placeholder="Minimum 8 characters">
      <label>Department / Role</label>
      <input name="d" list="dept-list-ne" placeholder="Type or select department / role" required autocomplete="off">
      <datalist id="dept-list-ne">
        ${DEPTS.map((x) => `<option value="${esc(x)}">`).join('')}
      </datalist>
      <div class="alert cr" id="ne-er" hidden style="margin-top:12px"></div>
      <div class="act" style="margin-top:16px"><button type="submit" class="p" style="width:100%">Create Employee</button></div>
    </form>`
    ),
  ee: (d) =>
    open(
      mh('Edit Employee @' + esc(d.u), 'ee_form') +
        `
      <input type="hidden" name="emp_id" value="${esc(d.id)}">
      <label>Full Name</label>
      <input name="n" value="${esc(d.name)}" required placeholder="e.g. Rachel Adams">
      <label>Email Address (for task briefings)</label>
      <input name="e" type="email" value="${esc(d.e || '')}" placeholder="e.g. employee@gmail.com">
      <label>Department / Role</label>
      <input name="d" list="dept-list-ee" value="${esc(d.d)}" required placeholder="Type or select department / role" autocomplete="off">
      <datalist id="dept-list-ee">
        ${DEPTS.map((x) => `<option value="${esc(x)}">`).join('')}
      </datalist>
      <div class="alert cr" id="ee-er" hidden style="margin-top:12px"></div>
      <div class="act" style="margin-top:16px"><button type="submit" class="p" style="width:100%">Save Changes</button></div>
    </form>`
    )
};

// Global Event Listeners
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (b) {
    e.preventDefault();
    act[b.dataset.a]?.(b.dataset);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id == 'rg') {
    const v = +e.target.value;
    const f = e.target.form;
    $('#bb').textContent = v + '%';
    $('#bb').style.left = `calc(${v}% + ${8 - v * 0.16}px)`;
    if (v == 100) f.s.value = 'Completed';
    else if (f.s.value == 'Completed') f.s.value = 'In Progress';
  }
  const formId = e.target.form?.getAttribute?.('id') || (typeof e.target.form?.id === 'string' ? e.target.form.id : '');
  if (e.target.name == 's' && formId === 'ud' && e.target.value == 'Completed') {
    const r = $('#rg');
    if (r) {
      r.value = 100;
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const formId = f.getAttribute('id') || (typeof f.id === 'string' ? f.id : '');
  const v = (n) => f.elements[n]?.value?.trim() ?? '';

  if (formId === 'lf') {
    const u = v('u').toLowerCase();
    const p = v('p');
    const expected_role = S.role === 'adm' ? 'admin' : 'employee';
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p, expected_role })
      });

      // Strict role enforcement
      if (S.role === 'emp' && res.user.role === 'admin') {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        gate({
          c: 'am',
          t: 'Administrative accounts cannot authenticate under Employee Access. Please switch to the Executive Admin tab.'
        });
        return;
      }

      if (S.role === 'adm' && res.user.role !== 'admin') {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        gate({
          c: 'cr',
          t: 'This account does not have Executive Administrator clearance. Please switch to the Employee Access tab.'
        });
        return;
      }

      S.me = {
        id: res.user.id,
        u: res.user.username,
        name: res.user.name,
        admin: res.user.role === 'admin',
        dept: res.user.department
      };
      S.tab = 'q';
      await loadDataAndRender();
    } catch (err) {
      const isWarning = err.message.toLowerCase().includes('pending') || err.message.toLowerCase().includes('switch to');
      gate({ c: isWarning ? 'am' : 'cr', t: err.message });
    }
  }

  if (formId === 'rq') {
    const n = v('n');
    const u = v('u').toLowerCase();
    const e = v('e');
    const p = v('p');
    const d = v('d');
    const x = v('x');
    const er = $('#er');

    try {
      const res = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: n,
          username: u,
          email: e,
          password: p,
          department: d,
          notes: x
        })
      });
      close();
      gate({
        c: 'em',
        t: res.message || 'Account request submitted. An Executive Admin will review your clearance.'
      });
    } catch (err) {
      er.hidden = false;
      er.textContent = err.message;
    }
  }

  if (formId === 'rf') {
    const id = v('req_id') || v('id');
    const u = v('username');
    const r = v('r');
    const er = $('#rf-er');
    try {
      await api(`/api/admin/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: r, username: u })
      });
      close();
    } catch (err) {
      if (er) {
        er.hidden = false;
        er.textContent = err.message;
      } else {
        alert(err.message);
      }
    } finally {
      await loadDataAndRender();
    }
  }

  if (formId === 'tk') {
    const t = v('t');
    const d = v('d');
    const p = toApiPriority(v('p'));
    const to = parseInt(v('to'), 10);
    const c = v('c');
    const due = v('due');
    const er = $('#tk-er');

    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: t,
          description: d,
          priority: p,
          assigned_to: to,
          category: c,
          due_date: due
        })
      });
      close();
      await loadDataAndRender();
    } catch (err) {
      if (er) {
        er.hidden = false;
        er.textContent = err.message;
      } else {
        alert(err.message);
      }
    }
  }

  if (formId === 'ud') {
    const id = v('task_id') || v('id');
    const s = toApiStatus(v('s'));
    const pct = parseInt(v('pct'), 10);
    const x = v('x');
    const due = v('due');
    const er = $('#ud-er');
    const btn = $('#btn-save-milestone') || f.querySelector('button.p');

    if (!x || x.length < 3) {
      if (er) {
        er.hidden = false;
        er.textContent = 'Please enter a milestone note (at least 3 characters).';
      } else {
        alert('Please enter a milestone note (at least 3 characters).');
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving Milestone...';
    }

    const payload = {
      status: s,
      progress_percent: pct,
      note: x
    };
    if (due) {
      payload.due_date = due;
    }

    try {
      await api(`/api/tasks/${id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      close();
      await loadDataAndRender();
    } catch (err) {
      if (er) {
        er.hidden = false;
        er.textContent = err.message;
      } else {
        alert(err.message);
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Milestone';
      }
    }
  }

  if (formId === 'em_form') {
    const n = v('n');
    const u = v('u').toLowerCase();
    const e = v('e');
    const p = v('p');
    const d = v('d');
    const er = $('#ne-er');
    try {
      await api('/api/admin/employees', {
        method: 'POST',
        body: JSON.stringify({ name: n, username: u, email: e, password: p, department: d })
      });
      close();
      await loadDataAndRender();
    } catch (err) {
      if (er) {
        er.hidden = false;
        er.textContent = err.message;
      } else {
        alert(err.message);
      }
    }
  }

  if (formId === 'ee_form') {
    const id = v('emp_id');
    const n = v('n');
    const e = v('e');
    const d = v('d');
    const er = $('#ee-er');
    try {
      await api(`/api/admin/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: n, email: e, department: d })
      });
      close();
      await loadDataAndRender();
    } catch (err) {
      if (er) {
        er.hidden = false;
        er.textContent = err.message;
      } else {
        alert(err.message);
      }
    }
  }
});

// Check Existing Active Session on Load
async function checkSession() {
  try {
    const res = await api('/api/auth/me');
    if (res.user) {
      S.me = {
        id: res.user.id,
        u: res.user.username,
        name: res.user.name,
        admin: res.user.role === 'admin',
        dept: res.user.department
      };
      await loadDataAndRender();
      return;
    }
  } catch (_) {}
  gate();
}

checkSession();
