# 🤖 discordgram

> **discordgram** es un puente bidireccional de alto rendimiento entre servidores de **Discord** y supergrupos con temas (topics) de **Telegram**, ejecutado enteramente sobre **Cloudflare Workers** mediante **Durable Objects**.

Permite mantener sincronizadas las conversaciones de canales de Discord con temas de Telegram en tiempo real, incluyendo **respuestas citadas**, **imágenes**, **vídeos**, **gestión automatizada de canales** (estilo Flake) y un **panel de control web protegido por contraseña y captcha ALTCHA**.

---

## ✨ Características Principales

1. **Gestión Cómoda y Automatizada de Canales (Estilo Flake)**:
   - **Auto-creación al crear canales en Discord**: Cada vez que creas un canal nuevo de texto en Discord, discordgram crea automáticamente el tema correspondiente en Telegram y los vincula sin reiniciar ni redesplegar nada.
   - **Comandos interactivos en Telegram**:
     - `/sync <ID_CANAL_DISCORD>`: Vincula el tema actual a un canal de Discord.
     - `/syncall`: Descubre todos los canales de tu Discord y les crea su tema en Telegram automáticamente.
     - `/unsync`: Desvincula el tema actual.
     - `/synclist`: Muestra la lista de canales y temas actualmente emparejados.
   - **Panel Web Interactivo (`/`)**: Visualiza el estado del gateway en vivo y añade o elimina canales cómodamente desde tu navegador.
2. **Acceso Restringido al Panel de Control (Password + ALTCHA Captcha)**:
   - Pantalla de acceso seguro con contraseña (`DASHBOARD_PASSWORD`) y verificación PoW **ALTCHA** (*Proof-of-Work* ligera e invisible contra bots).
   - Sesión protegida mediante cookies seguras HTTP-Only firmadas con HMAC.
3. **Contexto de Respuestas (Replies)**:
   - Al responder a un mensaje en Discord o Telegram, el mensaje sincronizado incluye una cita destacada con el autor y el texto al que se respondió, para que nunca se pierda el hilo de la conversación.
4. **Sincronización Multimedia**:
   - **Discord ➔ Telegram**: Reenvía fotos, vídeos y adjuntos directamente a Telegram vía API.
   - **Telegram ➔ Discord**: Descarga fotos y vídeos desde Telegram y los adjunta de forma nativa a los webhooks de Discord (manteniendo seguro tu token sin exponerlo en los mensajes).
5. **Arquitectura Serverless 24/7**:
   - Conexión persistente al Gateway de Discord v10 mediante un **Durable Object**.
   - Reconexión automática con retroceso exponencial (*exponential backoff*) y alarmas periódicas de *keep-alive*.

---

## 📁 Estructura del Código

```
discordgram/
├── src/
│   ├── index.ts        # Router principal de peticiones, webhooks y autenticación
│   ├── auth.ts         # Acceso restringido, verificación ALTCHA y cookies de sesión
│   ├── config.ts       # Constantes y configuración general
│   ├── types.ts        # Definiciones TypeScript de Discord y Telegram
│   ├── storage.ts      # Acceso persistente al mapa dinámico de canales
│   ├── gateway.ts      # Durable Object para conexión WebSocket con Discord
│   ├── status.ts       # Durable Object para almacenamiento de estado y canales
│   ├── discord.ts      # Cliente API REST y gestión de webhooks de Discord
│   ├── telegram.ts     # Cliente Bot API de Telegram y gestor de comandos
│   ├── media.ts        # Procesamiento y descarga/reenvío de fotos y vídeos
│   ├── replies.ts      # Formateo de citas de respuesta (HTML y Markdown)
│   └── dashboard.ts    # Panel de control web visual (HTML/CSS/JS)
├── wrangler.toml       # Configuración del Cloudflare Worker y Durable Objects
├── package.json        # Dependencias y scripts
└── tsconfig.json       # Configuración de TypeScript
```

---

## 🚀 Requisitos Previos

1. **Bot de Discord**:
   - Creado en el [Discord Developer Portal](https://discord.com/developers/applications).
   - En la sección **Bot** ➔ **Privileged Gateway Intents**, asegúrate de activar:
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent** (¡imprescindible para leer los mensajes!)
   - Permisos del bot al invitarlo al servidor:
     - `Manage Webhooks` (para crear los webhooks de envío por canal)
     - `Read Messages / View Channels`
     - `Send Messages`
2. **Bot de Telegram**:
   - Creado con [@BotFather](https://t.me/BotFather).
   - Debe añadirse al supergrupo de Telegram como **Administrador** con permisos para:
     - `Manage Topics` (Gestionar temas/foros)
     - `Post Messages`
3. **Supergrupo de Telegram**:
   - El grupo debe tener los **Temas / Foros** activados (Ajustes del grupo ➔ Temas / Topics).

---

## ⚙️ Configuración

### 1. Variables en `wrangler.toml`

Edita [wrangler.toml](file:///home/jaime/Documentos/discordgram/wrangler.toml) según tu configuración:

```toml
[vars]
# ID del supergrupo de Telegram (suele empezar por -100...)
DEFAULT_TELEGRAM_CHAT_ID = "-1001234567890"

# ID de tu servidor de Discord (necesario para /syncall y auto-descubrimiento)
DISCORD_GUILD_ID = ""

# Crear tema automáticamente en Telegram cuando se crea un canal de texto en Discord
AUTO_CREATE_TOPICS = "true"

# Contraseña de acceso al panel web
DASHBOARD_PASSWORD = "admin"
```

### 2. Configurar Secretos en Cloudflare

Ejecuta los siguientes comandos para configurar las claves privadas de forma segura en Cloudflare:

```bash
# Token de tu bot de Discord
npx wrangler secret put DISCORD_BOT_TOKEN

# Token de tu bot de Telegram
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Secreto opcional para verificar peticiones de Telegram
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Contraseña del panel web (recomendado)
npx wrangler secret put DASHBOARD_PASSWORD
```

---

## 🚢 Despliegue

```bash
# Instalar dependencias
npm install

# Desplegar en Cloudflare
npm run deploy
```

Una vez desplegado, Cloudflare te dará la URL de tu worker (ejemplo: `https://discordgram.<tu-subdominio>.workers.dev`).

### Configurar el Webhook de Telegram

Configura el webhook de Telegram para que apunte a tu Worker:

```bash
curl -F "url=https://<TU-WORKER>.workers.dev/telegram/webhook" \
     -F "secret_token=<TU_TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/setWebhook
```

### Iniciar la Conexión del Gateway de Discord

Abre en tu navegador la URL de tu Worker: `https://<TU-WORKER>.workers.dev`, introduce tu contraseña, completa el captcha ALTCHA y pulsa **"Reconectar Gateway"**.

¡El punto indicador del Gateway se pondrá en verde! 🟢

---

## 🪄 Cómo Añadir y Sincronizar Nuevos Canales

Tienes 3 formas cómodas para añadir nuevos canales:

### Opción 1: Automática al crear canales en Discord (Estilo Flake)
Crea un canal nuevo de texto en tu servidor de Discord. Gracias al evento `CHANNEL_CREATE` del Gateway, **discordgram creará el tema en Telegram al instante** y comenzará a sincronizarlo sin que tengas que hacer nada.

### Opción 2: Desde Telegram con comandos
Entra al tema del foro en Telegram y escribe:
```
/sync <ID_DEL_CANAL_DE_DISCORD>
```
El bot responderá confirmando que el tema ha quedado emparejado con el canal.

Para sincronizar todos los canales del servidor en lote:
```
/syncall
```

Para ver la lista de canales activos:
```
/synclist
```

### Opción 3: Desde el Panel de Control Web
Accede a `https://<TU-WORKER>.workers.dev/` en tu navegador.
En la sección **Canales Sincronizados**:
1. Pega el ID del canal de Discord.
2. Si dejas el campo *Tema Telegram* vacío, el bot consultará el nombre del canal en Discord y creará el tema por ti automáticamente.
3. Pulsa **+ Vincular**.

---

## 📜 Licencia

MIT
