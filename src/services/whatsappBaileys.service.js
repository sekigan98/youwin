import path from 'node:path';
import fs from 'node:fs/promises';
import QRCode from 'qrcode';
import pino from 'pino';
import { nanoid } from 'nanoid';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { db } from '../lib/db.js';
import { cleanString, jidToLid, jidToPhone, normalizeLeadPhone, normalizeWhatsAppNumber, isLikelyWhatsAppLidNumber, nowIso } from '../lib/utils.js';
import { registerIncomingWhatsAppMessage } from './leadEvents.service.js';
import { getPlanCapabilities, hasActiveEntitlement } from '../lib/pricing.js';

function hasWhatsappEntitlement(agency) {
  return hasActiveEntitlement(agency) && getPlanCapabilities(agency?.plan || 'free').canConnectWhatsapp;
}

function getDataRoot() {
  if (process.env.WHATSAPP_SESSION_DIR) return process.env.WHATSAPP_SESSION_DIR;
  const dataFile = process.env.DATA_FILE || './data/truelead-db.json';
  const dir = path.dirname(path.isAbsolute(dataFile) ? dataFile : path.resolve(process.cwd(), dataFile));
  return path.join(dir, 'whatsapp-sessions');
}

function getContentInfo(message = {}) {
  const m = message.message || {};
  const ephemeral = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.documentWithCaptionMessage?.message;
  const content = ephemeral || m;

  if (content.conversation) {
    return { text: content.conversation, type: 'text', hasMedia: false };
  }

  if (content.extendedTextMessage) {
    return { text: content.extendedTextMessage.text || '', type: 'text', hasMedia: false };
  }

  if (content.imageMessage) {
    return {
      text: content.imageMessage.caption || '',
      type: 'image',
      hasMedia: true,
      mimeType: content.imageMessage.mimetype || 'image/jpeg',
      fileName: ''
    };
  }

  if (content.documentMessage) {
    return {
      text: content.documentMessage.caption || '',
      type: 'document',
      hasMedia: true,
      mimeType: content.documentMessage.mimetype || '',
      fileName: content.documentMessage.fileName || ''
    };
  }

  if (content.videoMessage) {
    const isGif = Boolean(content.videoMessage.gifPlayback);
    return {
      text: content.videoMessage.caption || '',
      type: isGif ? 'gif' : 'video',
      hasMedia: true,
      mimeType: content.videoMessage.mimetype || 'video/mp4',
      fileName: isGif ? 'whatsapp.gif' : ''
    };
  }

  if (content.audioMessage) {
    return {
      text: '',
      type: 'audio',
      hasMedia: true,
      mimeType: content.audioMessage.mimetype || 'audio',
      fileName: ''
    };
  }

  if (content.stickerMessage) {
    return {
      text: '',
      type: 'sticker',
      hasMedia: true,
      mimeType: content.stickerMessage.mimetype || 'image/webp',
      fileName: ''
    };
  }

  return { text: '', type: 'unknown', hasMedia: false };
}

function collectJids(value, out = [], seen = new Set()) {
  if (!value || seen.size > 250) return out;

  if (typeof value === 'string') {
    if (/@(?:s\.whatsapp\.net|lid|c\.us)$/i.test(value) || /@(?:s\.whatsapp\.net|lid|c\.us)[:?&\s]/i.test(value)) {
      out.push(value.trim());
    }
    return out;
  }

  if (typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectJids(item, out, seen);
    return out;
  }

  for (const item of Object.values(value)) collectJids(item, out, seen);
  return out;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function isValidLeadPhone(phone) {
  const normalized = normalizeLeadPhone(phone);
  return Boolean(normalized) && !isLikelyWhatsAppLidNumber(normalized);
}

function ensureWhatsappContactCollection() {
  if (!Array.isArray(db.data.whatsappContacts)) db.data.whatsappContacts = [];
}

function getContactMapKey({ agencyId, sessionId, lid = '' }) {
  return `${agencyId || ''}:${sessionId || ''}:${lid || ''}`;
}

function upsertWhatsappContact({ agencyId, sessionId, lid = '', phone = '', name = '' }) {
  const normalizedLid = cleanString(lid, 120);
  const normalizedPhone = normalizeLeadPhone(phone);
  if (!normalizedLid || !normalizedPhone) return null;

  ensureWhatsappContactCollection();
  const key = getContactMapKey({ agencyId, sessionId, lid: normalizedLid });
  let contact = db.data.whatsappContacts.find((item) => item.key === key);
  if (!contact) {
    contact = {
      id: `wc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      key,
      agencyId,
      sessionId,
      lid: normalizedLid,
      phone: normalizedPhone,
      name: cleanString(name, 160),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.data.whatsappContacts.push(contact);
  } else {
    contact.phone = normalizedPhone || contact.phone;
    contact.name = cleanString(name, 160) || contact.name || '';
    contact.updatedAt = nowIso();
  }
  return contact;
}

function resolvePhoneFromLid({ agencyId, sessionId, lid = '' }) {
  if (!lid || !Array.isArray(db.data.whatsappContacts)) return '';
  const exact = db.data.whatsappContacts.find((item) =>
    item.lid === lid &&
    item.agencyId === agencyId &&
    (!sessionId || !item.sessionId || item.sessionId === sessionId) &&
    isValidLeadPhone(item.phone)
  );
  if (exact) return normalizeLeadPhone(exact.phone);

  const fallback = db.data.whatsappContacts.find((item) =>
    item.lid === lid && item.agencyId === agencyId && isValidLeadPhone(item.phone)
  );
  return normalizeLeadPhone(fallback?.phone || '');
}

function extractSenderIdentity(message = {}, session = {}, sock = null) {
  const ownPhone = normalizeLeadPhone(session.number || jidToPhone(sock?.user?.id || ''));
  const jids = unique([
    message.key?.remoteJid,
    message.key?.participant,
    message.participant,
    ...collectJids(message.key || {})
  ]);

  const lid = jids.map(jidToLid).find(Boolean) || '';
  const phone = jids
    .map(jidToPhone)
    .find((candidate) => candidate && candidate !== ownPhone && isValidLeadPhone(candidate)) ||
    resolvePhoneFromLid({ agencyId: session.agencyId, sessionId: session.id, lid });

  return {
    phone: normalizeLeadPhone(phone),
    lid,
    jid: cleanString(message.key?.remoteJid || '', 180),
    name: cleanString(message.pushName || message.verifiedBizName || '', 160)
  };
}

function extractContactIdentity(contact = {}) {
  const jids = unique([contact.id, contact.lid, contact.jid, contact.pn, contact.phoneJid, contact.phoneNumberJid, ...collectJids(contact)]);
  const lid = jids.map(jidToLid).find(Boolean) || jidToLid(contact.lid || contact.id || '');
  const phone = jids.map(jidToPhone).find((candidate) => candidate && isValidLeadPhone(candidate)) || '';
  const name = contact.notify || contact.name || contact.shortName || contact.verifiedName || contact.pushName || '';
  return { lid, phone, name: cleanString(name, 160) };
}

function safeFolderName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function runtimeKey(agencyId, sessionId) {
  return `${agencyId}:${sessionId}`;
}

async function secureSessionDirectory(directory) {
  await fs.chmod(directory, 0o700).catch(() => {});
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return secureSessionDirectory(target);
    return fs.chmod(target, 0o600).catch(() => {});
  }));
}

export class WhatsAppBaileysManager {
  constructor() {
    this.instances = new Map();
    this.qrWaiters = new Map();
    this.qrCodes = new Map();
    this.intentionalDisconnects = new Set();
    this.sessionRoot = getDataRoot();
  }

  async init() {
    await fs.mkdir(this.sessionRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(this.sessionRoot, 0o700).catch(() => {});
    ensureWhatsappContactCollection();

    // Migration suave: sesiones viejas sin label/clientId siguen funcionando.
    // También repara números propios guardados desde Baileys con suffix de dispositivo
    // (ej.: 5491124649559:2@s.whatsapp.net -> 5491124649559).
    for (const session of db.data.whatsappSessions || []) {
      session.label = session.label || 'WhatsApp principal';
      session.clientId = session.clientId || '';
      session.updatedAt = session.updatedAt || nowIso();
      if (session.qr || session.qrDataUrl) {
        session.qr = null;
        session.qrDataUrl = null;
      }

      const fixedNumber = normalizeWhatsAppNumber(session.number || '');
      if (fixedNumber && fixedNumber !== session.number) {
        session.number = fixedNumber;
        session.updatedAt = nowIso();
      }
    }

    for (const project of db.data.projects || []) {
      const fixedProjectNumber = normalizeWhatsAppNumber(project.whatsappNumber || '');
      if (fixedProjectNumber && fixedProjectNumber !== project.whatsappNumber) {
        project.whatsappNumber = fixedProjectNumber;
        project.updatedAt = nowIso();
      }
    }

    for (const lead of db.data.preleads || []) {
      for (const field of ['phone', 'whatsappFromPhone', 'whatsappFrom']) {
        if (isLikelyWhatsAppLidNumber(lead[field])) {
          lead.whatsappFromLid = lead.whatsappFromLid || `${normalizeWhatsAppNumber(lead[field])}@lid`;
          lead[field] = '';
          lead.updatedAt = nowIso();
        }
      }
    }

    for (const message of db.data.whatsappMessages || []) {
      if (isLikelyWhatsAppLidNumber(message.fromPhone)) {
        message.fromLid = message.fromLid || `${normalizeWhatsAppNumber(message.fromPhone)}@lid`;
        message.fromPhone = '';
        message.updatedAt = nowIso();
      }
    }

    for (const purchase of db.data.purchases || []) {
      if (isLikelyWhatsAppLidNumber(purchase.whatsappFromPhone)) {
        purchase.whatsappFromLid = purchase.whatsappFromLid || `${normalizeWhatsAppNumber(purchase.whatsappFromPhone)}@lid`;
        purchase.whatsappFromPhone = '';
        purchase.updatedAt = nowIso();
      }
    }

    await db.save();

    if (process.env.WHATSAPP_AUTO_RESTORE === 'true') {
      const sessions = db.data.whatsappSessions.filter((session) =>
        ['connected', 'connecting', 'qr'].includes(session.status) &&
        hasWhatsappEntitlement(db.data.agencies.find((agency) => agency.id === session.agencyId))
      );

      for (const session of sessions) {
        this.start({
          agencyId: session.agencyId,
          sessionId: session.id,
          clientId: session.clientId,
          label: session.label
        }).catch((err) => {
          console.error('[wa] restore error', session.id, err);
        });
      }
    }
  }

  listSessions(agencyId) {
    return db.data.whatsappSessions
      .filter((session) => session.agencyId === agencyId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .map((session) => ({
        ...session,
        qr: null,
        qrDataUrl: this.qrCodes.get(runtimeKey(session.agencyId, session.id)) || null
      }));
  }

  getSession(agencyId, sessionId = '') {
    const sessions = this.listSessions(agencyId);
    if (sessionId) {
      return sessions.find((session) => session.id === sessionId) || null;
    }
    return sessions[0] || null;
  }

  ensureSessionRecord({ agencyId, sessionId = '', clientId = '', label = '' }) {
    let session = sessionId
      ? db.data.whatsappSessions.find((s) => s.id === sessionId && s.agencyId === agencyId)
      : null;

    if (sessionId && !session) {
      throw new Error('La sesión de WhatsApp indicada no pertenece a esta agencia.');
    }

    if (!session) {
      const client = db.data.clients.find((item) => item.id === clientId && item.agencyId === agencyId);
      if (!client) throw new Error('El cliente indicado no pertenece a esta agencia.');
      let generatedId = `wa_${nanoid(10)}`;
      while (db.data.whatsappSessions.some((item) => item.id === generatedId)) generatedId = `wa_${nanoid(10)}`;
      session = {
        id: generatedId,
        agencyId,
        clientId: cleanString(clientId, 80),
        label: cleanString(label || 'WhatsApp principal', 120),
        status: 'disconnected',
        qr: null,
        qrDataUrl: null,
        number: '',
        device: '',
        lastActivityAt: null,
        lastError: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.data.whatsappSessions.push(session);
    }

    if (clientId !== undefined && clientId !== null && String(clientId).trim()) {
      const client = db.data.clients.find((item) => item.id === clientId && item.agencyId === agencyId);
      if (!client) throw new Error('El cliente indicado no pertenece a esta agencia.');
      session.clientId = cleanString(clientId, 80);
    }
    if (label !== undefined && label !== null && String(label).trim()) {
      session.label = cleanString(label, 120);
    }
    session.label = session.label || 'WhatsApp principal';
    session.clientId = session.clientId || '';

    return session;
  }

  async updateSession(agencyId, sessionId, patch) {
    const session = db.data.whatsappSessions.find((item) => item.id === sessionId && item.agencyId === agencyId);
    if (!session) return null;
    const normalizedPatch = { ...patch };
    const key = runtimeKey(agencyId, sessionId);

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'qrDataUrl')) {
      if (normalizedPatch.qrDataUrl) this.qrCodes.set(key, normalizedPatch.qrDataUrl);
      else this.qrCodes.delete(key);
      normalizedPatch.qrDataUrl = null;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'qr')) normalizedPatch.qr = null;

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'number')) {
      normalizedPatch.number = normalizeWhatsAppNumber(normalizedPatch.number);
    }

    Object.assign(session, normalizedPatch, {
      updatedAt: nowIso()
    });
    await db.save();
    return this.getSession(agencyId, sessionId);
  }

  async start({ agencyId, sessionId = '', clientId = '', label = '' }) {
    const agency = db.data.agencies.find((item) => item.id === agencyId);
    if (!hasWhatsappEntitlement(agency)) {
      throw new Error('La agencia no tiene un plan activo para conectar WhatsApp.');
    }
    const sessionRecord = this.ensureSessionRecord({ agencyId, sessionId, clientId, label });
    const sid = sessionRecord.id;
    const key = runtimeKey(agencyId, sid);

    const existing = this.instances.get(key);
    if (existing?.sock) {
      return this.getSession(agencyId, sid);
    }

    const agencyDir = path.join(this.sessionRoot, safeFolderName(agencyId));
    const sessionDir = path.join(agencyDir, safeFolderName(sid));
    const legacyDir = path.join(this.sessionRoot, safeFolderName(sid));
    await fs.mkdir(agencyDir, { recursive: true, mode: 0o700 });
    try {
      await fs.access(legacyDir);
      await fs.access(sessionDir).catch(() => fs.rename(legacyDir, sessionDir));
    } catch {}
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await secureSessionDirectory(sessionDir);
    await this.updateSession(agencyId, sid, {
      status: 'connecting',
      lastError: '',
      qr: null,
      qrDataUrl: null
    });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' }),
      browser: ['TrueLead', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      printQRInTerminal: false
    });

    this.instances.set(key, { sock, saveCreds, agencyId });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await secureSessionDirectory(sessionDir);
    });

    const rememberContacts = async (contacts = []) => {
      const list = Array.isArray(contacts) ? contacts : [contacts];
      let changed = false;
      for (const contact of list) {
        const identity = extractContactIdentity(contact);
        if (identity.lid && identity.phone) {
          upsertWhatsappContact({ agencyId, sessionId: sid, lid: identity.lid, phone: identity.phone, name: identity.name });
          changed = true;
        }
      }
      if (changed) await db.save();
    };

    sock.ev.on('contacts.update', rememberContacts);
    sock.ev.on('contacts.upsert', rememberContacts);
    sock.ev.on('messaging-history.set', async ({ contacts = [] } = {}) => {
      await rememberContacts(contacts);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 320,
          color: {
            dark: '#030711',
            light: '#ffffff'
          }
        });

        const session = await this.updateSession(agencyId, sid, {
          status: 'qr',
          qr: null,
          qrDataUrl,
          lastActivityAt: nowIso()
        });

        const waiter = this.qrWaiters.get(key);
        if (waiter) {
          waiter(session);
          this.qrWaiters.delete(key);
        }
      }

      if (connection === 'open') {
        const number = jidToPhone(sock.user?.id || '');
        await this.updateSession(agencyId, sid, {
          status: 'connected',
          qr: null,
          qrDataUrl: null,
          number,
          device: cleanString(sock.user?.name || 'WhatsApp vinculado', 120),
          lastActivityAt: nowIso(),
          lastError: ''
        });

        const waiter = this.qrWaiters.get(key);
        if (waiter) {
          waiter(this.getSession(agencyId, sid));
          this.qrWaiters.delete(key);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        // Cuando el cierre lo pidió el usuario desde el panel, Baileys suele devolver
        // "Intentional Logout". No debe mostrarse como error ni recrear la sesión.
        if (this.intentionalDisconnects.has(key)) {
          this.intentionalDisconnects.delete(key);
          this.instances.delete(key);
          this.qrWaiters.delete(key);
          return;
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await this.updateSession(agencyId, sid, {
          status: shouldReconnect ? 'disconnected' : 'logged_out',
          qr: null,
          qrDataUrl: null,
          lastError: cleanString(lastDisconnect?.error?.message || 'Conexión cerrada.', 400),
          lastActivityAt: nowIso()
        });

        this.instances.delete(key);

        if (shouldReconnect && process.env.WHATSAPP_DISABLE_RECONNECT !== 'true') {
          setTimeout(() => {
            this.start({ agencyId, sessionId: sid }).catch((err) => console.error('[wa] reconnect error', err));
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages = [], type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        await this.handleMessage(sessionRecord, message);
      }
    });

    const configuredWait = Number(process.env.WHATSAPP_QR_WAIT_MS || 25000);
    const qrWaitMs = Number.isFinite(configuredWait)
      ? Math.max(1000, Math.min(60_000, configuredWait))
      : 25_000;
    const session = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.qrWaiters.delete(key);
        resolve(this.getSession(agencyId, sid));
      }, qrWaitMs);

      this.qrWaiters.set(key, (currentSession) => {
        clearTimeout(timeout);
        resolve(currentSession);
      });
    });

    return session;
  }

  async handleMessage(session, message) {
    try {
      const agency = db.data.agencies.find((item) => item.id === session.agencyId);
      if (!hasWhatsappEntitlement(agency)) return { ok: true, skipped: true, reason: 'Plan inactivo o vencido.' };
      if (!message?.message) return null;
      if (message.key?.fromMe) return null;
      if (message.key?.remoteJid?.endsWith('@g.us')) return null;

      const sender = extractSenderIdentity(message, session, this.instances.get(runtimeKey(session.agencyId, session.id))?.sock || null);
      const content = getContentInfo(message);

      if (!content.text && !content.hasMedia) return null;

      const result = await registerIncomingWhatsAppMessage({
        agencyId: session.agencyId,
        clientId: session.clientId || '',
        whatsappSessionId: session.id,
        messageId: message.key?.id || '',
        from: sender.phone,
        fromLid: sender.lid,
        fromJid: sender.jid,
        senderName: sender.name,
        text: content.text || '',
        messageType: content.type || 'unknown',
        mimeType: content.mimeType || '',
        fileName: content.fileName || '',
        hasMedia: Boolean(content.hasMedia),
        source: 'baileys'
      });

      await this.updateSession(session.agencyId, session.id, {
        lastActivityAt: nowIso()
      });

      return result;
    } catch (err) {
      console.error('[wa] message handler error', err);
      await this.updateSession(session.agencyId, session.id, {
        lastError: cleanString(err.message || String(err), 400)
      });
      return null;
    }
  }

  async disconnect(agencyId, sessionId = '') {
    const session = this.getSession(agencyId, sessionId);
    if (!session) return null;

    // En TrueLead, "Desconectar" significa eliminar el vínculo de WhatsApp:
    // cerrar Baileys, borrar credenciales del disco y quitar la tarjeta del panel.
    const removedSession = {
      ...session,
      status: 'removed',
      qr: null,
      qrDataUrl: null,
      lastError: '',
      lastActivityAt: nowIso(),
      updatedAt: nowIso()
    };

    const key = runtimeKey(agencyId, session.id);
    this.intentionalDisconnects.add(key);

    const instance = this.instances.get(key);
    if (instance?.sock) {
      try {
        await instance.sock.logout();
      } catch {}
      try {
        instance.sock.end?.();
      } catch {}
    }

    this.instances.delete(key);
    this.qrWaiters.delete(key);
    this.qrCodes.delete(key);

    await fs.rm(path.join(this.sessionRoot, safeFolderName(agencyId), safeFolderName(session.id)), { recursive: true, force: true });
    await fs.rm(path.join(this.sessionRoot, safeFolderName(session.id)), { recursive: true, force: true });

    db.data.whatsappSessions = (db.data.whatsappSessions || []).filter((item) => !(item.id === session.id && item.agencyId === agencyId));

    // Si algún proyecto usaba este WhatsApp, queda sin WhatsApp asignado hasta que el usuario elija otro.
    for (const project of db.data.projects || []) {
      if (project.agencyId === agencyId && project.whatsappSessionId === session.id) {
        project.whatsappSessionId = '';
        project.updatedAt = nowIso();
      }
    }

    await db.save();
    const forgetIntent = setTimeout(() => this.intentionalDisconnects.delete(key), 30_000);
    forgetIntent.unref?.();
    return removedSession;
  }

  async resetSession(agencyId, sessionId = '') {
    return this.disconnect(agencyId, sessionId);
  }

  async shutdown() {
    for (const [key, instance] of this.instances.entries()) {
      this.intentionalDisconnects.add(key);
      try {
        instance.sock?.end?.(new Error('TrueLead server shutdown'));
      } catch {}
    }
    this.instances.clear();
    this.qrWaiters.clear();
    this.qrCodes.clear();
  }
}

export const whatsappManager = new WhatsAppBaileysManager();
