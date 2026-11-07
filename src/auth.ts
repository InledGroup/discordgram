import { Env } from "./types";

const SESSION_COOKIE_NAME = "dg_session";
const SESSION_MAX_AGE_SEC = 7 * 24 * 3600; // 7 días

function getSecretKey(env: Env): string {
  return env.ALTCHA_HMAC_KEY || env.TELEGRAM_WEBHOOK_SECRET || env.DASHBOARD_PASSWORD || "discordgram-default-secret";
}

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Genera un reto ALTCHA (Proof-of-Work con SHA-256 y firma HMAC)
 */
export async function createAltchaChallenge(env: Env): Promise<{
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber: number;
}> {
  const saltBytes = new Uint8Array(12);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Número secreto para el PoW (rango razonable para que el cliente lo resuelva en ~50ms)
  const maxnumber = 20000;
  const number = Math.floor(Math.random() * maxnumber) + 1;

  const challenge = await sha256Hex(`${salt}${number}`);
  const signature = await hmacHex(getSecretKey(env), challenge);

  return {
    algorithm: "SHA-256",
    challenge,
    salt,
    signature,
    maxnumber,
  };
}

/**
 * Valida la solución del reto ALTCHA enviada por el navegador
 */
export async function verifyAltcha(
  payloadBase64: string | undefined,
  env: Env
): Promise<boolean> {
  if (!payloadBase64) return false;

  try {
    const raw = atob(payloadBase64);
    const data = JSON.parse(raw) as {
      algorithm?: string;
      challenge?: string;
      number?: number;
      salt?: string;
      signature?: string;
    };

    if (data.algorithm !== "SHA-256" || !data.challenge || data.number === undefined || !data.salt || !data.signature) {
      return false;
    }

    // 1. Verificar firma HMAC del reto
    const expectedSig = await hmacHex(getSecretKey(env), data.challenge);
    if (data.signature !== expectedSig) {
      return false;
    }

    // 2. Verificar que SHA256(salt + number) coincide con el challenge
    const calculatedHash = await sha256Hex(`${data.salt}${data.number}`);
    return calculatedHash === data.challenge;
  } catch {
    return false;
  }
}

/**
 * Comprueba si la contraseña introducida coincide
 */
export function verifyPassword(password: string | undefined, env: Env): boolean {
  const expected = env.DASHBOARD_PASSWORD || "admin";
  if (!password) return false;
  return password === expected;
}

/**
 * Genera la cookie de sesión firmada
 */
export async function createSessionCookie(env: Env): Promise<string> {
  const now = Date.now().toString();
  const sig = await hmacHex(getSecretKey(env), `session:${now}`);
  const token = `${now}.${sig}`;
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

/**
 * Verifica si la petición contiene una cookie de sesión válida
 */
export async function verifySession(request: Request, env: Env): Promise<boolean> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return false;

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [timestamp, sig] = match[1].split(".");
  if (!timestamp || !sig) return false;

  const ageMs = Date.now() - parseInt(timestamp, 10);
  if (isNaN(ageMs) || ageMs < 0 || ageMs > SESSION_MAX_AGE_SEC * 1000) {
    return false;
  }

  const expectedSig = await hmacHex(getSecretKey(env), `session:${timestamp}`);
  return sig === expectedSig;
}

/**
 * Genera la página de acceso restringido exactamente con el estilo de la imagen
 */
export function renderLoginPage(error?: string): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acceso Restringido - discordgram</title>
<style>
  :root {
    --bg-page: #f8fafc;
    --card-bg: #ffffff;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --text-label: #475569;
    --border-color: #e2e8f0;
    --btn-bg: #0d1527;
    --btn-hover: #1e293b;
    --input-border: #0f172a;
    --accent-red: #ef4444;
    --accent-blue: #229ED9;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg-page);
    color: var(--text-main);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }

  /* Logo superior estilo INLED */
  .logo-container {
    margin-bottom: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo-text {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--accent-blue);
    display: inline-flex;
    align-items: center;
    position: relative;
  }
  .logo-i-dot {
    color: var(--accent-red);
    display: inline-block;
  }

  /* Tarjeta de Acceso Restringido */
  .login-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 20px;
    width: 100%;
    max-width: 420px;
    padding: 40px 34px 34px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.04), 0 8px 10px -6px rgba(0, 0, 0, 0.02);
  }

  h1 {
    font-size: 1.45rem;
    font-weight: 800;
    color: var(--text-main);
    text-align: center;
    margin-bottom: 8px;
  }
  p.subtitle {
    font-size: 0.95rem;
    color: var(--text-muted);
    text-align: center;
    margin-bottom: 28px;
  }

  .form-group {
    margin-bottom: 20px;
  }
  label {
    display: block;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: var(--text-label);
    margin-bottom: 8px;
    text-transform: uppercase;
  }
  input[type="password"] {
    width: 100%;
    padding: 12px 16px;
    font-size: 1.1rem;
    border: 1.5px solid var(--input-border);
    border-radius: 12px;
    outline: none;
    background: #fff;
    color: var(--text-main);
    transition: border-color 0.15s ease;
  }
  input[type="password"]::placeholder {
    color: #94a3b8;
    letter-spacing: 3px;
  }
  input[type="password"]:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  /* Widget de ALTCHA integrado */
  .altcha-box {
    margin-bottom: 24px;
    display: flex;
    justify-content: center;
  }
  .altcha-widget-custom {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: #f8fafc;
    width: 100%;
    max-width: 280px;
    user-select: none;
  }
  .altcha-checkbox {
    width: 22px;
    height: 22px;
    border: 2px solid #94a3b8;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    transition: all 0.2s ease;
  }
  .altcha-checkbox.checked {
    background: #22c55e;
    border-color: #22c55e;
  }
  .altcha-checkbox.checked::after {
    content: "✓";
    color: #fff;
    font-size: 14px;
    font-weight: bold;
  }
  .altcha-label {
    flex: 1;
    font-size: 0.88rem;
    color: #334155;
    cursor: pointer;
  }
  .altcha-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 0.65rem;
    color: #64748b;
  }
  .altcha-icon {
    width: 20px;
    height: 20px;
    border: 2px solid #475569;
    border-top-color: transparent;
    border-radius: 50%;
    position: relative;
  }
  .altcha-icon.spin {
    animation: spin 0.8s linear infinite;
    border-color: #3b82f6;
    border-top-color: transparent;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }

  /* Botón Entrar */
  button[type="submit"] {
    width: 100%;
    background: var(--btn-bg);
    color: #ffffff;
    border: 0;
    border-radius: 12px;
    padding: 14px 20px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background-color 0.15s ease, transform 0.05s ease;
  }
  button[type="submit"]:hover {
    background: var(--btn-hover);
  }
  button[type="submit"]:active {
    transform: scale(0.99);
  }
  button[type="submit"]:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-msg {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 20px;
    text-align: center;
  }

  /* Pie de página inferior */
  footer {
    margin-top: 32px;
    font-size: 0.82rem;
    color: #94a3b8;
    text-align: center;
  }
</style>
</head>
<body>

  <!-- Logo centrado -->
  <div class="logo-container">
    <div class="logo-text">
      <span><span class="logo-i-dot">İ</span>NLED</span>
    </div>
  </div>

  <!-- Tarjeta del formulario -->
  <div class="login-card">
    <h1>Acceso Restringido</h1>
    <p class="subtitle">Introduce tu contraseña para acceder al panel.</p>

    ${error ? `<div class="error-msg">${error}</div>` : ""}

    <form id="login-form">
      <div class="form-group">
        <label for="password">CONTRASEÑA</label>
        <input type="password" id="password" name="password" placeholder="••••••••" required autofocus autocomplete="current-password" />
      </div>

      <!-- ALTCHA Captcha -->
      <div class="altcha-box">
        <div class="altcha-widget-custom" id="altcha-box" onclick="triggerAltcha()">
          <div class="altcha-checkbox" id="altcha-checkbox"></div>
          <div class="altcha-label" id="altcha-label">I'm not a robot</div>
          <div class="altcha-brand">
            <div class="altcha-icon" id="altcha-icon"></div>
            <span>Protected by ALTCHA</span>
          </div>
        </div>
      </div>

      <input type="hidden" id="altcha-payload" name="altcha" />

      <button type="submit" id="btn-submit">
        <span>Entrar</span>
        <span style="font-size:1.1rem; line-height:1;">›</span>
      </button>
    </form>
  </div>

  <footer>
    Licenciado bajo MIT-INLED
  </footer>

<script>
let altchaSolved = false;
let solving = false;

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function triggerAltcha() {
  if (altchaSolved || solving) return;
  solving = true;

  const icon = document.getElementById("altcha-icon");
  const label = document.getElementById("altcha-label");
  const checkbox = document.getElementById("altcha-checkbox");

  icon.classList.add("spin");
  label.textContent = "Verifying...";

  try {
    const res = await fetch("/api/altcha/challenge");
    const ch = await res.json();

    const max = ch.maxnumber || 30000;
    let foundNumber = null;

    // Resolver Proof-of-Work
    for (let i = 0; i <= max; i++) {
      const hash = await sha256(ch.salt + i);
      if (hash === ch.challenge) {
        foundNumber = i;
        break;
      }
    }

    if (foundNumber !== null) {
      const solution = {
        algorithm: ch.algorithm,
        challenge: ch.challenge,
        number: foundNumber,
        salt: ch.salt,
        signature: ch.signature
      };

      document.getElementById("altcha-payload").value = btoa(JSON.stringify(solution));
      altchaSolved = true;

      icon.classList.remove("spin");
      icon.style.display = "none";
      checkbox.classList.add("checked");
      label.textContent = "Verified!";
    } else {
      throw new Error("No solution found");
    }
  } catch (err) {
    icon.classList.remove("spin");
    label.textContent = "Retry verification";
    solving = false;
  }
}

document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();

  if (!altchaSolved) {
    await triggerAltcha();
    if (!altchaSolved) {
      alert("Por favor completa la verificación de seguridad.");
      return;
    }
  }

  const password = document.getElementById("password").value;
  const altcha = document.getElementById("altcha-payload").value;
  const btn = document.getElementById("btn-submit");

  btn.disabled = true;
  btn.querySelector("span").textContent = "Entrando...";

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, altcha })
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Contraseña incorrecta o verificación no válida");
      btn.disabled = false;
      btn.querySelector("span").textContent = "Entrar";
    }
  } catch (err) {
    alert("Error de conexión: " + err);
    btn.disabled = false;
    btn.querySelector("span").textContent = "Entrar";
  }
};
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
