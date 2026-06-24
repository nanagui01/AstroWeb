// Check authentication state
let isAuthenticated = false;

// Elements
const loginSection = document.getElementById('loginSection');
const appSection = document.getElementById('appSection');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const modalCancel = document.getElementById('modalCancel');
const modalSave = document.getElementById('modalSave');
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

// API helper
async function api(url, options = {}) {
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    if (res.status === 401 || res.status === 403) {
      isAuthenticated = false;
      showLogin();
      throw new Error('Unauthorized');
    }
    return res;
  } catch (err) {
    throw err;
  }
}

// Show login
function showLogin() {
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
}

// Load dashboard
async function loadDashboard() {
  const scriptsRes = await api('/api/scripts');
  const scripts = await scriptsRes.json();
  const keysRes = await api('/api/keys');
  const keys = await keysRes.json();
  document.getElementById('statScripts').textContent = scripts.length;
  document.getElementById('statKeys').textContent = keys.length;
  document.getElementById('statActiveKeys').textContent = keys.filter(k => k.status === 'active').length;
  document.getElementById('statOnlineScripts').textContent = scripts.filter(s => s.status === 'online').length;
}

// Load scripts table
async function loadScripts() {
  const res = await api('/api/scripts');
  const scripts = await res.json();
  const tbody = document.getElementById('scriptsTable');
  tbody.innerHTML = scripts.map(s => `
    <tr class="border-b border-zinc-800">
      <td class="p-4">${s.name}</td>
      <td class="p-4"><span class="status-badge status-${s.status}">${s.status}</span></td>
      <td class="p-4 text-xs font-mono text-zinc-400">loadstring(game:HttpGet("https://.../api/load/${s.id}?key=KEY"))()</td>
      <td class="p-4">
        <button class="edit-script mr-2 text-blue-400" data-id="${s.id}">Edit</button>
        <button class="delete-script text-red-400" data-id="${s.id}">Delete</button>
      </td>
    </tr>`).join('');
}

// Load keys table
async function loadKeys() {
  const res = await api('/api/keys');
  const keys = await res.json();
  const tbody = document.getElementById('keysTable');
  tbody.innerHTML = keys.map(k => `
    <tr class="border-b border-zinc-800">
      <td class="p-4 font-mono text-sm">${k.key}</td>
      <td class="p-4">${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</td>
      <td class="p-4 text-sm text-zinc-400">${k.hwid || 'Free'}</td>
      <td class="p-4"><span class="status-badge status-${k.status}">${k.status}</span></td>
      <td class="p-4">
        <button class="revoke-key mr-2 text-orange-400" data-id="${k.id}">Revoke</button>
        <button class="reset-hwid mr-2 text-yellow-400" data-id="${k.id}">Reset HWID</button>
        <button class="delete-key text-red-400" data-id="${k.id}">Delete</button>
      </td>
    </tr>`).join('');
}

// Tab switching
tabLinks.forEach(link => {
  link.addEventListener('click', () => {
    tabLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    const tab = link.dataset.tab;
    tabContents.forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    if (tab === 'dashboard') loadDashboard();
    else if (tab === 'scripts') loadScripts();
    else if (tab === 'keys') loadKeys();
  });
});

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'same-origin'
  });
  if (res.ok) {
    isAuthenticated = true;
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    document.querySelector('.tab-link[data-tab="dashboard"]').click();
  } else {
    document.getElementById('loginError').classList.remove('hidden');
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  isAuthenticated = false;
  showLogin();
});

// Modal handling
modalCancel.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

// New/Edit Script modal
document.getElementById('newScriptBtn').addEventListener('click', () => openScriptModal());
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('edit-script')) {
    openScriptModal(e.target.dataset.id);
  }
  if (e.target.classList.contains('delete-script')) {
    if (confirm('Delete this script?')) deleteScript(e.target.dataset.id);
  }
});

async function openScriptModal(id = null) {
  modal.classList.remove('hidden');
  if (id) {
    const res = await api(`/api/scripts/${id}`);
    const script = await res.json();
    modalTitle.textContent = 'Edit Script';
    modalContent.innerHTML = `
      <input id="scriptName" class="w-full p-2 mb-3 bg-zinc-800 border border-zinc-700 rounded" value="${script.name}">
      <textarea id="scriptContent" class="w-full p-2 mb-3 bg-zinc-800 border border-zinc-700 rounded h-40 font-mono">${script.content}</textarea>
      <select id="scriptStatus" class="w-full p-2 bg-zinc-800 border border-zinc-700 rounded">
        <option value="online" ${script.status==='online'?'selected':''}>Online</option>
        <option value="offline" ${script.status==='offline'?'selected':''}>Offline</option>
        <option value="maintenance" ${script.status==='maintenance'?'selected':''}>Maintenance</option>
        <option value="development" ${script.status==='development'?'selected':''}>Development</option>
      </select>
      <input type="hidden" id="scriptId" value="${script.id}">`;
  } else {
    modalTitle.textContent = 'New Script';
    modalContent.innerHTML = `
      <input id="scriptName" class="w-full p-2 mb-3 bg-zinc-800 border border-zinc-700 rounded" placeholder="Script name">
      <textarea id="scriptContent" class="w-full p-2 mb-3 bg-zinc-800 border border-zinc-700 rounded h-40 font-mono" placeholder="Lua code..."></textarea>
      <select id="scriptStatus" class="w-full p-2 bg-zinc-800 border border-zinc-700 rounded">
        <option value="online">Online</option>
        <option value="offline">Offline</option>
        <option value="maintenance">Maintenance</option>
        <option value="development">Development</option>
      </select>`;
  }
  modalSave.onclick = saveScript;
}

async function saveScript() {
  const id = document.getElementById('scriptId')?.value;
  const name = document.getElementById('scriptName').value;
  const content = document.getElementById('scriptContent').value;
  const status = document.getElementById('scriptStatus').value;
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/scripts/${id}` : '/api/scripts';
  await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, status })
  });
  modal.classList.add('hidden');
  loadScripts();
}

async function deleteScript(id) {
  await api(`/api/scripts/${id}`, { method: 'DELETE' });
  loadScripts();
}

// Keys actions
document.getElementById('newKeyBtn').addEventListener('click', async () => {
  const scriptId = prompt('Script ID (optional):');
  const days = prompt('Expiration (days, leave empty for never):');
  const expiresAt = days ? new Date(Date.now() + days*86400000).toISOString() : null;
  await api('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId, expiresAt })
  });
  loadKeys();
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('revoke-key')) {
    api(`/api/keys/${e.target.dataset.id}/revoke`, { method: 'PUT' }).then(loadKeys);
  }
  if (e.target.classList.contains('reset-hwid')) {
    api(`/api/keys/${e.target.dataset.id}/reset-hwid`, { method: 'PUT' }).then(loadKeys);
  }
  if (e.target.classList.contains('delete-key')) {
    if (confirm('Delete this key?')) api(`/api/keys/${e.target.dataset.id}`, { method: 'DELETE' }).then(loadKeys);
  }
});

// Check auth on load
(async () => {
  try {
    const res = await api('/api/auth/me');
    if (res.ok) {
      isAuthenticated = true;
      loginSection.classList.add('hidden');
      appSection.classList.remove('hidden');
      document.querySelector('.tab-link[data-tab="dashboard"]').click();
    }
  } catch {
    showLogin();
  }
})();