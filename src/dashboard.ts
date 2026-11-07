export function serveDashboardHtml(): Response {
  return new Response(DASHBOARD_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>discordgram - Panel de Control</title>
<style>
  :root {
    --bg-page: #f8fafc;
    --card-bg: #ffffff;
    --card-border: #e2e8f0;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --btn-primary: #0d1527;
    --btn-primary-hover: #1e293b;
    --discord: #5865F2;
    --telegram: #229ED9;
    --green: #22c55e;
    --red: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg-page);
    color: var(--text-main);
    line-height: 1.5;
  }
  main {
    max-width: 920px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 28px;
    flex-wrap: wrap;
    gap: 16px;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand img {
    height: 36px;
    width: auto;
  }
  .badge {
    font-size: 0.75rem;
    background: #e0e7ff;
    color: #4338ca;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 700;
  }
  p.sub { color: var(--text-muted); font-size: 0.95rem; margin-top: 4px; }
  
  .header-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 18px;
    margin-bottom: 30px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.03);
  }
  .card h2 {
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 1.15rem;
  }
  .dot-status { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .green { background: var(--green); box-shadow: 0 0 10px rgba(34, 197, 94, 0.4); }
  .red { background: var(--red); box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
  .value { font-size: 1.3rem; font-weight: 800; margin-top: 6px; }
  .time { color: var(--text-muted); font-size: .85rem; margin-top: 8px; }

  .section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 24px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.03);
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .section h2 { font-size: 1.25rem; font-weight: 800; }
  .section p.desc { color: var(--text-muted); font-size: 0.92rem; margin-bottom: 22px; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
    font-size: 0.92rem;
  }
  th {
    text-align: left;
    padding: 12px 14px;
    color: var(--text-muted);
    border-bottom: 1.5px solid var(--card-border);
    font-weight: 700;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  td {
    padding: 14px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  code {
    background: #f1f5f9;
    padding: 4px 8px;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    color: #1e293b;
    border: 1px solid #e2e8f0;
  }

  .form-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: flex-end;
    background: #f8fafc;
    padding: 20px;
    border-radius: 12px;
    border: 1px solid var(--card-border);
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 200px;
  }
  label { font-size: 0.8rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  input {
    background: #ffffff;
    border: 1.5px solid var(--card-border);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--text-main);
    font-size: 0.92rem;
    outline: none;
    transition: border-color 0.15s ease;
  }
  input:focus { border-color: var(--btn-primary); }

  button {
    background: var(--btn-primary);
    color: #fff;
    border: 0;
    padding: 10px 18px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.15s ease, transform 0.05s ease;
  }
  button:hover { background: var(--btn-primary-hover); }
  button:active { transform: scale(0.98); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  button.danger {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    padding: 6px 14px;
    font-size: 0.82rem;
  }
  button.danger:hover { background: #fee2e2; }
  button.secondary {
    background: #ffffff;
    color: #334155;
    border: 1px solid var(--card-border);
  }
  button.secondary:hover { background: #f8fafc; }

  #status-line { color: var(--text-muted); font-size: .85rem; margin-top: 20px; }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #0f172a;
    color: #fff;
    padding: 14px 22px;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    display: none;
    z-index: 1000;
    font-size: 0.92rem;
    font-weight: 500;
  }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">
        <img src="https://hosted.inled.es/cdn/inled-logo-full.png" alt="INLED" />
        <span class="badge">discordgram v2.0</span>
      </div>
      <p class="sub">Puente bidireccional Discord ⇄ Telegram (Cloudflare Workers)</p>
    </div>
    <div class="header-actions">
      <button id="reconnect" class="secondary">🔄 Reconectar Gateway</button>
      <button id="logout" class="secondary" style="color:#dc2626;">Cerrar sesión</button>
    </div>
  </header>

  <div class="grid">
    <div class="card" id="gateway-card">
      <h2>Gateway de Discord</h2>
      <div class="pill"><span class="dot-status red" id="gw-dot"></span><span id="gw-text">desconectado</span></div>
      <div class="time" id="gateway-last">—</div>
    </div>
    <div class="card">
      <h2>Webhook de Telegram</h2>
      <div class="value" id="tg-message">—</div>
      <div class="time">último mensaje sincronizado</div>
    </div>
    <div class="card">
      <h2>Webhook de Discord</h2>
      <div class="value" id="dc-message">—</div>
      <div class="time">último mensaje sincronizado</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Canales Sincronizados</h2>
      <button id="btn-syncall" class="secondary" style="font-size:0.85rem; padding:6px 14px;">⚡ Auto-sincronizar Todo</button>
    </div>
    <p class="desc">
      Mensajes, fotos, vídeos y citas de respuesta se reenvían en tiempo real entre estos canales de Discord y temas de Telegram.
    </p>

    <table>
      <thead>
        <tr>
          <th>Canal de Discord</th>
          <th>Tema de Telegram</th>
          <th>Chat ID</th>
          <th style="text-align: right;">Acciones</th>
        </tr>
      </thead>
      <tbody id="channels-tbody">
        <tr><td colspan="4" style="color:var(--text-muted); text-align:center;">Cargando canales...</td></tr>
      </tbody>
    </table>

    <div class="form-row">
      <div class="form-group">
        <label>ID Canal de Discord</label>
        <input type="text" id="new-channel-id" placeholder="Ej: 1521456678195957802" />
      </div>
      <div class="form-group">
        <label>ID Tema Telegram (threadId)</label>
        <input type="number" id="new-thread-id" placeholder="0 para General, o vacío para auto-crear" />
      </div>
      <div class="form-group" style="max-width: 140px;">
        <label>&nbsp;</label>
        <button id="btn-add-channel" style="width:100%;">+ Vincular</button>
      </div>
    </div>
    <small style="display:block; color:var(--text-muted); margin-top:10px; font-size:0.84rem;">
      💡 <b>Para vincular a un tema existente:</b> Pon el ID del canal de Discord y el ID del tema (ej. <code>0</code> para el General de Telegram).
    </small>
  </div>

  <div id="status-line">Comprobando estado en tiempo real...</div>
</main>

<div id="toast" class="toast"></div>

<script>
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    const s = await res.json();
    const g = s.gateway || { connected: false };

    const gwDot = document.getElementById('gw-dot');
    const gwText = document.getElementById('gw-text');
    gwDot.className = 'dot-status ' + (g.connected ? 'green' : 'red');
    gwText.textContent = g.connected ? 'conectado' : 'desconectado';

    document.getElementById('gateway-last').textContent =
      g.lastDispatch ? 'Último evento: ' + fmt(g.lastDispatch) : 'Sin eventos recientes';
    document.getElementById('tg-message').textContent = fmt(s.lastTelegramMessage);
    document.getElementById('dc-message').textContent = fmt(s.lastDiscordMessage);

    document.getElementById('status-line').textContent =
      'Actualizado ' + new Date().toLocaleTimeString() +
      (s.lastError ? ' · Último error: ' + s.lastError : '');
  } catch (err) {
    document.getElementById('status-line').textContent = 'Error leyendo estado: ' + err;
  }
}

async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    const channels = await res.json();
    const tbody = document.getElementById('channels-tbody');
    tbody.innerHTML = '';

    const entries = Object.entries(channels);
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted); text-align:center;">No hay canales configurados todavía. Añade uno abajo.</td></tr>';
      return;
    }

    for (const [chanId, target] of entries) {
      const tr = document.createElement('tr');
      const name = target.name ? '#' + target.name : chanId;
      const threadLabel = target.threadId === 0 ? 'General (0)' : 'Tema ' + target.threadId;

      tr.innerHTML = \`
        <td><strong>\${name}</strong><br><small style="color:var(--text-muted); font-family:monospace;">\${chanId}</small></td>
        <td><code>\${threadLabel}</code></td>
        <td><code>\${target.chatId}</code></td>
        <td style="text-align: right;">
          <button class="danger btn-delete" data-channel-id="\${chanId}">Desvincular</button>
        </td>
      \`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('Error cargando canales:', err);
  }
}

// Delegación de eventos para los botones Desvincular
document.getElementById('channels-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;

  const channelId = btn.getAttribute('data-channel-id');
  if (!channelId) return;

  btn.disabled = true;
  btn.textContent = 'Eliminando...';

  try {
    const res = await fetch('/api/channels/' + channelId, { method: 'DELETE' });
    if (res.ok) {
      showToast('Canal desvinculado con éxito.');
      await loadChannels();
    } else {
      const errText = await res.text();
      showToast('Error al desvincular: ' + errText);
      btn.disabled = false;
      btn.textContent = 'Desvincular';
    }
  } catch (err) {
    showToast('Error de red: ' + err);
    btn.disabled = false;
    btn.textContent = 'Desvincular';
  }
});

// Botón Vincular Canal
document.getElementById('btn-add-channel').addEventListener('click', async () => {
  const channelInput = document.getElementById('new-channel-id');
  const threadInput = document.getElementById('new-thread-id');
  const channelId = channelInput.value.trim();
  const threadIdVal = threadInput.value.trim();

  if (!channelId) {
    showToast('Ingresa el ID del canal de Discord.');
    channelInput.focus();
    return;
  }

  const btn = document.getElementById('btn-add-channel');
  btn.disabled = true;
  btn.textContent = 'Vinculando...';

  const payload = {
    channelId,
    threadId: threadIdVal !== '' ? parseInt(threadIdVal, 10) : undefined,
  };

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('¡Canal vinculado con éxito!');
      channelInput.value = '';
      threadInput.value = '';
      await loadChannels();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast('Error: ' + (data.error || 'No se pudo vincular el canal'));
    }
  } catch (err) {
    showToast('Error de conexión: ' + err);
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Vincular';
  }
});

// Botón Auto-sincronizar Todo
document.getElementById('btn-syncall').addEventListener('click', async () => {
  const btn = document.getElementById('btn-syncall');
  btn.disabled = true;
  btn.textContent = '⏳ Sincronizando...';
  showToast('Iniciando auto-sincronización...');

  try {
    const res = await fetch('/api/channels/auto-sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('¡Listo! Nuevos canales sincronizados: ' + (data.createdCount ?? 0));
      await loadChannels();
    } else {
      showToast('Error: ' + (data.error || 'Fallo'));
    }
  } catch (err) {
    showToast('Error: ' + err);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Auto-sincronizar Todo';
  }
});

// Botón Reconectar Gateway
document.getElementById('reconnect').addEventListener('click', async () => {
  const btn = document.getElementById('reconnect');
  btn.disabled = true;
  btn.textContent = '⏳ Conectando...';
  showToast('Reconectando Gateway de Discord...');
  try {
    await fetch('/api/connect', { method: 'POST' });
    setTimeout(async () => {
      await refreshStatus();
      btn.disabled = false;
      btn.textContent = '🔄 Reconectar Gateway';
    }, 2500);
  } catch (err) {
    showToast('Error: ' + err);
    btn.disabled = false;
    btn.textContent = '🔄 Reconectar Gateway';
  }
});

// Botón Cerrar sesión
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  window.location.reload();
});

refreshStatus();
loadChannels();
setInterval(refreshStatus, 5000);
</script>
</body>
</html>
`;
