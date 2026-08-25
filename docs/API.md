# TrueLead API 2.1

Base de producción: `https://app.truelead.com.ar`.

## Autenticación

El panel usa una cookie de sesión `HttpOnly`. En requests mutables, el cliente web envía además `X-CSRF-Token` con el valor de la cookie `tl_csrf`. `Authorization: Bearer` se mantiene solo para migrar sesiones antiguas.

### Registro

`POST /api/auth/register`

```json
{
  "agencyName": "Agencia Éxito",
  "name": "Tomi",
  "email": "hola@agencia.com",
  "password": "una-clave-segura"
}
```

### Login, sesión y salida

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email` con `{ "token": "..." }`
- `POST /api/auth/resend-verification`

Los links nuevos transportan el token en el fragmento `#token=...` para que no llegue en la URL del servidor; el frontend lo limpia y lo envía por POST. Los tokens no deben registrarse en logs ni compartirse.

## Endpoints públicos

### Salud

`GET /health`

### Pricing

`GET /api/public/pricing?country=AR&tz=America%2FBuenos_Aires`

### Crear intención desde una landing

`POST /api/preleads`

El navegador debe enviar un `Origin` o `Referer` incluido en la whitelist del proyecto.

```json
{
  "projectPublicId": "tl_xxxxx",
  "landingUrl": "https://cliente.com/landing",
  "visitorId": "v_xxxxx",
  "buttonSource": "hero",
  "messageTemplate": "Hola. Mi código es {{code}}",
  "fbp": "fb.1...",
  "fbc": "fb.1...",
  "utm": {
    "utm_campaign": "agosto"
  }
}
```

La respuesta incluye `code` y `whatsappHref`. Múltiples requests del mismo visitante, proyecto y botón dentro de 30 segundos reutilizan la intención.

### Webhook interno de WhatsApp

`POST /api/webhooks/whatsapp/message`

Header obligatorio:

```txt
x-truelead-secret: WHATSAPP_WEBHOOK_SECRET
```

Esta integración es opcional. Si `WHATSAPP_WEBHOOK_SECRET` no está configurado,
el endpoint responde `503 Webhook no configurado` y no procesa mensajes. Esto no
afecta al conector QR/Baileys ni al webhook oficial de WhatsApp Cloud API.

```json
{
  "agencyId": "agencia_id",
  "clientId": "cliente_id",
  "whatsappSessionId": "wa_sesion_id",
  "messageId": "wamid.identificador-unico",
  "from": "5491100000000",
  "text": "Hola, mi código es TL-4F9K2Q",
  "messageType": "text",
  "hasMedia": false
}
```

Si el mismo `messageId` vuelve a llegar, TrueLead devuelve el registro existente y no crea otra conversión. El código TL alcanza para confirmar el primer mensaje. Para asociar mensajes posteriores que ya no traen código, el conector debe enviar una sesión o cliente válido de esa agencia; TrueLead no cruza teléfonos sin ese alcance.

### Webhook oficial de WhatsApp Cloud API

- `GET /api/webhooks/meta/whatsapp` — challenge con `META_WHATSAPP_VERIFY_TOKEN`.
- `POST /api/webhooks/meta/whatsapp` — eventos `messages` firmados por Meta.

El POST exige `X-Hub-Signature-256` y se valida con HMAC-SHA256 sobre el body original usando `META_APP_SECRET`. TrueLead extrae `phone_number_id`, `message.id`, `referral.source_id` y `referral.ctwa_clid`; un Phone Number ID compartido entre proyectos necesita IDs de anuncio para desambiguar.

## Agencia autenticada

- `GET /api/agency/dashboard?range=month`
- `GET|POST /api/agency/clients`
- `PUT|DELETE /api/agency/clients/:id`
- `GET|POST /api/agency/projects`
- `PUT|DELETE /api/agency/projects/:id`
- `GET /api/agency/preleads?range=month`
- `GET /api/agency/conversion-jobs?range=month`
- `POST /api/agency/conversion-jobs/:id/retry`
- `PATCH /api/agency/preleads/:id/phone`
- `GET /api/agency/purchases?range=month`
- `PATCH /api/agency/purchases/:id/status`
- `GET /api/agency/exports/leads?range=month&mode=confirmed&format=xlsx`
- `PUT /api/agency/landing-builder/projects/:projectId`
- `POST /api/agency/landing-builder/projects/:projectId/export`

Los endpoints con rango aceptan `tzOffsetMinutes` con el mismo valor de
`Date#getTimezoneOffset()` del navegador. Para un rango personalizado también se
envían `from=YYYY-MM-DD` y `to=YYYY-MM-DD`; así “Hoy” y los límites de fecha se
calculan en la zona horaria de la agencia, no en UTC.

### Constructor de landings

Guardar configuración editable:

```http
PUT /api/agency/landing-builder/projects/:projectId
Content-Type: application/json
```

```json
{
  "config": {
    "brandName": "Mi marca",
    "headline": "Una propuesta clara",
    "ctaLabel": "Hablar por WhatsApp",
    "whatsappMessage": "Hola, quiero información. Mi código es: {{code}}",
    "publishedOrigin": "https://mi-marca.vercel.app"
  }
}
```

Cuando `publishedOrigin` es válido se agrega sin duplicados a la whitelist del
proyecto. La exportación recibe la misma configuración y assets como data URLs
validadas, y responde `application/zip`. Requiere un proyecto Landing/Híbrido,
plan Starter o superior, sesión y CSRF. El ZIP incluye el `projectPublicId`,
pero nunca el número de WhatsApp ni tokens privados.

### Confirmación manual excepcional

`POST /api/preleads/:code/confirm`

```json
{
  "phone": "5491100000000",
  "sendToMeta": true,
  "source": "manual_panel"
}
```

### Validar compra

```http
PATCH /api/agency/purchases/:id/status
```

```json
{
  "status": "purchase_confirmed",
  "notes": "Comprobante validado manualmente.",
  "value": 125000,
  "currency": "ARS"
}
```

Estados: `proof_received`, `purchase_confirmed`, `rejected`, `duplicate`. Solo una compra confirmada con `value > 0` encola `Purchase` para Meta.

## WhatsApp QR

- `GET /api/whatsapp/sessions`
- `POST /api/whatsapp/request-qr`
- `POST /api/whatsapp/reconnect`
- `POST /api/whatsapp/disconnect`

Todos los IDs de sesión se validan contra la agencia autenticada. Los nuevos IDs los genera el servidor.

## Administración

Requiere rol `admin`.

- `GET /api/admin/overview`
- `GET /api/admin/agencies`
- `GET /api/admin/users`
- `GET /api/admin/pricing`
- `PATCH /api/admin/agencies/:id/status`
- `PATCH /api/admin/agencies/:id/plan`
- `POST /api/admin/agencies/:id/payments`
- `PATCH /api/admin/payments/:id/validate`
- `DELETE /api/admin/agencies/:id/history`

## Códigos de respuesta relevantes

| Código | Significado |
|---:|---|
| 401 | Falta sesión, sesión inválida o webhook incorrecto |
| 402 | Plan Free o plan vencido para esa capacidad |
| 403 | CSRF inválido, origen no autorizado o permisos insuficientes |
| 429 | Rate limit excedido |
| 503 | Webhook o dependencia crítica sin configurar |
