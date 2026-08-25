# TrueLead 2.1.1

TrueLead mide el tramo que suele quedar invisible entre un clic que abre WhatsApp y una conversación que realmente comenzó. Está pensado para agencias que necesitan separar intención, chat confirmado y venta validada, y devolver esas señales a Meta Conversions API (CAPI).

## La diferencia que mide

Si Meta muestra `100` resultados pero solo `47` personas escribieron con el código de seguimiento:

| Métrica | Valor | Significado |
|---|---:|---|
| Resultado nativo de Meta | 100 | El dato que ya atribuyó la plataforma |
| Intenciones TrueLead | 100 | Aperturas de WhatsApp generadas por el SDK |
| Chats reales TrueLead | 47 | Primeros mensajes recibidos con un código TL válido |
| Brecha | 53 | Personas que abrieron WhatsApp pero no completaron el mensaje |

TrueLead **no modifica ni reduce retroactivamente el 100 de Meta**. Crea y envía una conversión confirmada separada. Para usar esa señal en optimización, el dataset/evento debe estar configurado correctamente en Meta y seleccionado como objetivo de la campaña cuando corresponda.

Cada prelead tiene un código único. La primera recepción válida confirma el lead y encola un solo evento; reentregas del mismo mensaje y mensajes posteriores se deduplican para no inflar conversiones.

Esto aplica a landings que abren WhatsApp y a anuncios Click-to-WhatsApp conectados por Cloud API. Una campaña de **Formulario instantáneo (Lead Ads)** es otro flujo: esta versión no descarga respuestas del formulario ni las enlaza con el chat. En ese caso TrueLead puede contar los mensajes recibidos, pero para reconciliar también los formularios hace falta un módulo separado de Lead Ads/Webhooks y los permisos correspondientes de Meta.

## Modos de atribución

| Origen | Estado | Atribución |
|---|---|---|
| Landing instrumentada → WhatsApp | Implementado | SDK, código `TL-XXXXXX`, `_fbp`, `_fbc`, IP y user-agent |
| Anuncio que abre WhatsApp directamente | Conector implementado; requiere alta en Meta | Webhook firmado de WhatsApp Cloud API, WABA, Phone Number ID y `ctwa_clid` |

Baileys permite vincular un número por QR y detectar el mensaje, pero no inventa el `ctwa_clid`. El modo directo usa el webhook oficial, valida `X-Hub-Signature-256` y solo atribuye el anuncio cuando puede resolver de forma inequívoca su Phone Number ID o `source_id`.

Referencias oficiales: [Conversions API for Business Messaging](https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging), [webhook de mensajes de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages) y [versiones de Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/).

## Funcionalidad incluida

- Landing pública rediseñada y responsive.
- Registro con verificación de email y sesión mediante cookie `HttpOnly`.
- Panel de agencia y backoffice administrador separados.
- Clientes, proyectos, límites por plan y vencimiento efectivo.
- Formulario de proyectos compacto, responsive y con acciones siempre visibles.
- Varios WhatsApps por cliente y proyectos asociados a una sesión.
- Constructor visual de landings por proyecto con vista previa y descarga ZIP.
- Favicon, logo, portada, galería, colores, copies y analítica configurables.
- SDK público con whitelist real de dominios.
- Código criptográficamente aleatorio por intento.
- Dedupe por visitante/clic y por ID de mensaje entrante.
- Métricas de intenciones, chats reales, mensajes, comprobantes, ventas y CAPI.
- Cola persistente de conversiones con reintentos y `event_id` estable.
- Eventos `Lead` y `Purchase` para landings; `LeadSubmitted` preparado para el modo Business Messaging oficial.
- Validación manual de compras; `Purchase` solo se envía si existe un importe mayor a cero.
- Exportación CSV/XLSX protegida contra inyección de fórmulas.
- Tokens de Meta cifrados con AES-256-GCM.
- Sesiones de WhatsApp aisladas por agencia y permisos restrictivos en disco.
- Persistencia PostgreSQL opcional y JSON atómico como fallback local.
- Rate limits, CSP, CSRF, CORS por origen y webhook fail-closed.

## Flujo de una landing

1. La landing carga `/sdk/truelead.js` con el `projectPublicId`.
2. El usuario toca un botón `data-truelead-whatsapp`.
3. TrueLead valida el dominio, crea una intención y arma el mensaje con un código TL.
4. WhatsApp abre con el texto precargado.
5. Si el usuario envía el mensaje conservando el código, el conector lo detecta.
6. El lead pasa a confirmado y se encola un solo evento de Meta.
7. Si luego llega un comprobante, la agencia puede validar la compra y su importe.

Si la persona elimina el código antes de enviar el primer mensaje, el QR/Baileys no tiene una clave determinística para unir ese remitente con una intención concreta. TrueLead no hace una asociación heurística que pueda atribuir el lead al proyecto equivocado.

## Constructor de landings

La pestaña **Crear landing** permite seleccionar un proyecto Landing/Híbrido,
editar el contenido y descargar un sitio estático listo para GitHub Pages,
Netlify o Vercel. El paquete contiene HTML, CSS, JavaScript, imágenes optimizadas,
headers de seguridad e instrucciones de publicación.

El ZIP no contiene un número fijo ni `numeros.json`. Incluye únicamente el
`projectPublicId` y la URL del SDK; al hacer clic, TrueLead consulta el proyecto
y abre el WhatsApp que esté vinculado en ese momento. Cambiar el número desde
el panel no obliga a regenerar la landing.

Los textos se guardan en el proyecto. Las imágenes permanecen en IndexedDB del
navegador para no inflar la base de datos ni el snapshot de PostgreSQL. Antes de
descargar se optimizan y se validan nuevamente en el servidor. Si la edición
continúa desde otro dispositivo, hay que volver a seleccionar las imágenes.

Después de publicar, la URL final debe agregarse a **Dominios autorizados**. El
constructor puede hacerlo automáticamente si se completa “URL publicada o
prevista” antes de guardar.

## SDK

```html
<a
  href="#"
  data-truelead-whatsapp
  data-truelead-source="hero"
  data-truelead-message="Hola, quiero información. Mi código es: {{code}}">
  Enviar WhatsApp
</a>

<script
  src="https://app.truelead.com.ar/sdk/truelead.js"
  data-project="tl_TU_PROJECT_ID"
  data-api="https://app.truelead.com.ar">
</script>
```

En el proyecto hay que autorizar los orígenes exactos de las landings. Se admite uno por línea y wildcard de subdominio, por ejemplo:

```txt
https://cliente.com
https://www.cliente.com
*.campanas.cliente.com
```

## Anuncios que abren WhatsApp directamente

1. Crear/configurar la app de Meta y WhatsApp Cloud API.
2. En Render, cargar `META_APP_SECRET` y un `META_WHATSAPP_VERIFY_TOKEN` aleatorio.
3. Registrar como callback `https://app.truelead.com.ar/api/webhooks/meta/whatsapp` y suscribir el campo `messages`.
4. En el proyecto TrueLead elegir `cloud_api` o `hybrid`.
5. Cargar Dataset ID, CAPI token, WABA ID y Phone Number ID.
6. Si varios proyectos comparten número, cargar los `source_id` de sus anuncios para desambiguar.

El endpoint de verificación responde al challenge de Meta y los POST se aceptan solo si la firma HMAC del body original coincide. Los mensajes reintentados se deduplican por `message.id`.

En el modo directo, TrueLead conoce el chat cuando llega el webhook, pero no recibe un feed completo de personas que tocaron el anuncio y abandonaron antes de escribir. Por eso el panel no mezcla esos chats con el denominador de “Intenciones de landing”: la comparación contra clics/resultados directos se hace con la métrica nativa de Meta.

## Ejecutar local

Requiere Node.js 20 o superior.

```bash
npm ci
cp .env.example .env
npm start
```

Abrir `http://localhost:3000`. Los valores de desarrollo de `.env.example` no se aceptan cuando `NODE_ENV=production`.

## Variables críticas de producción

```env
NODE_ENV=production
APP_URL=https://app.truelead.com.ar
CORS_ORIGIN=https://app.truelead.com.ar,https://truelead.com.ar,https://www.truelead.com.ar

ADMIN_EMAIL=tu-email
ADMIN_PASSWORD=secreto-aleatorio-largo
JWT_SECRET=secreto-aleatorio-de-32-caracteres-o-mas
DATA_ENCRYPTION_KEY=clave-estable-de-32-caracteres-o-mas

DATABASE_URL=postgresql://...
DATABASE_SSL=true
WHATSAPP_SESSION_DIR=/var/data/whatsapp-sessions
WHATSAPP_AUTO_RESTORE=true
WHATSAPP_ALLOW_DEMO_CONNECT=false

META_API_VERSION=v26.0
META_QUEUE_MAX_ATTEMPTS=6
```

`WHATSAPP_WEBHOOK_SECRET` es opcional y solo protege el webhook genérico
`POST /api/webhooks/whatsapp/message`. Si no se configura, esa ruta queda
deshabilitada con `503`; el panel, Baileys y el webhook oficial de Meta siguen
funcionando. Si se usa un conector externo, configurarla con al menos 24
caracteres y enviar el mismo valor en `x-truelead-secret`.

Podés generar secretos con, por ejemplo, `openssl rand -base64 48`. Guardá `DATA_ENCRYPTION_KEY` en un gestor de secretos y en un backup seguro: cambiarla sin migrar los datos vuelve ilegibles los tokens existentes.

Para Gmail se recomienda una contraseña de aplicación:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=trueleadsite@gmail.com
SMTP_PASS=contraseña-de-aplicación
MAIL_FROM=trueleadsite@gmail.com
```

## Render

`render.yaml` crea un servicio web con disco persistente y genera automáticamente
`JWT_SECRET` y `DATA_ENCRYPTION_KEY` al crear o sincronizar el Blueprint. Hay que
completar `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_URL` y `CORS_ORIGIN`; PostgreSQL,
SMTP y Meta Cloud API pueden quedar vacíos si todavía no se usan. En un servicio
de Render creado manualmente, `DATA_ENCRYPTION_KEY` se agrega una sola vez desde
Environment con un valor aleatorio de al menos 32 caracteres.

`ADMIN_PASSWORD` es autoritativa: al arrancar, TrueLead actualiza el hash de la cuenta que coincide con `ADMIN_EMAIL`. Esto también reemplaza de forma segura una contraseña administradora heredada del MVP.

Recomendaciones operativas:

- Ejecutar una sola instancia mientras se use Baileys y el estado PostgreSQL en formato snapshot.
- Mantener `/var/data/whatsapp-sessions` en disco persistente.
- Configurar PostgreSQL para el estado principal; reservar JSON para desarrollo o recuperación simple.
- Hacer backups de base y sesiones antes de actualizar.
- No activar `WHATSAPP_ALLOW_DEMO_CONNECT` en producción.
- Probar CAPI con `Test Event Code` antes de enviar tráfico real.

## Seguridad y datos

TrueLead guarda datos mínimos para atribución: código, proyecto, timestamps, IP/user-agent para CAPI, identificadores `_fbp`/`_fbc`, teléfono o hash cuando WhatsApp lo provee, vista previa limitada y metadatos del comprobante. No descarga adjuntos ni conserva el historial completo del chat.

Antes de comercializar hay que publicar una política de privacidad y términos con la razón social, CUIT/domicilio y canal legal del responsable real. También hay que definir y automatizar el plazo de retención; `DATA_RETENTION_DAYS` queda documentado, pero la eliminación programada requiere una política aprobada antes de activarse.

Baileys es un conector de terceros basado en WhatsApp Web, no la API oficial de WhatsApp Business. Para una operación con SLA, atribución directa de anuncios o mayor estabilidad, la ruta recomendada es WhatsApp Cloud API.

## Verificación

```bash
npm test
npm run check
npm audit --omit=dev
```

La suite cubre formato y dedupe de códigos, normalización de Baileys/LID, whitelist de dominios, cifrado, vencimiento de planes, payload website, payload Business Messaging y el caso de reentrega de un mismo mensaje sin doble conversión.

## Documentación adicional

- [API](docs/API.md)
- [Variables de ejemplo](.env.example)
- [Blueprint de Render](render.yaml)
