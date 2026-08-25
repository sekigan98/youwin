import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { Pool } from 'pg';
import { nowIso, addDays, sha256Exact } from './utils.js';

const COLLECTIONS = [
  'users',
  'agencies',
  'clients',
  'projects',
  'preleads',
  'payments',
  'whatsappSessions',
  'whatsappMessages',
  'whatsappContacts',
  'purchases',
  'events',
  'conversionJobs',
  'emailLogs',
  'emailVerificationTokens'
];

const DEFAULT_DATA = {
  ...Object.fromEntries(COLLECTIONS.map((name) => [name, []])),
  settings: {
    createdAt: nowIso(),
    schemaVersion: 2
  }
};

function normalizeData(input = {}) {
  const normalized = {
    ...structuredClone(DEFAULT_DATA),
    ...(input && typeof input === 'object' ? input : {}),
    settings: {
      ...DEFAULT_DATA.settings,
      ...(input?.settings || {}),
      schemaVersion: 2
    }
  };
  for (const name of COLLECTIONS) {
    if (!Array.isArray(normalized[name])) normalized[name] = [];
  }
  return normalized;
}

function getDataFilePath() {
  const configured = process.env.DATA_FILE || './data/truelead-db.json';
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

function postgresEnabled() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export class TrueLeadDB {
  constructor() {
    this.filePath = getDataFilePath();
    this.data = null;
    this.writeQueue = Promise.resolve();
    this.pool = null;
    this.storage = postgresEnabled() ? 'postgres' : 'json';
  }

  async init() {
    if (this.storage === 'postgres') {
      await this.initPostgres();
    } else {
      await this.initJson();
    }

    let migratedTokens = false;
    for (const token of this.data.emailVerificationTokens || []) {
      if (token.token) {
        if (!token.tokenHash) token.tokenHash = sha256Exact(token.token);
        delete token.token;
        migratedTokens = true;
      }
    }
    if (migratedTokens) await this.save();

    await this.ensureAdmin();
    return this;
  }

  async initJson() {
    const dataDirectory = path.dirname(this.filePath);
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(dataDirectory, 0o700).catch(() => {});
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = normalizeData(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        try {
          const backup = await fs.readFile(`${this.filePath}.bak`, 'utf8');
          this.data = normalizeData(JSON.parse(backup));
        } catch {
          throw new Error(`No se pudo abrir la base de datos JSON: ${error.message}`);
        }
      } else {
        this.data = normalizeData();
      }
      await this.save();
    }
  }

  async initPostgres() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: String(process.env.DATABASE_SSL ?? 'true') === 'false'
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 4),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS truelead_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await this.pool.query('SELECT payload FROM truelead_state WHERE id = 1');
    if (result.rows[0]?.payload) {
      this.data = normalizeData(result.rows[0].payload);
      return;
    }

    this.data = normalizeData();
    await this.save();
  }

  async ensureAdmin() {
    const email = (process.env.ADMIN_EMAIL || 'trueleadsite@gmail.com').toLowerCase();
    const existing = this.data.users.find((user) => user.email === email);
    if (existing) {
      if (existing.role !== 'admin') {
        throw new Error(`ADMIN_EMAIL (${email}) ya pertenece a un usuario que no es administrador.`);
      }
      const configuredPassword = String(process.env.ADMIN_PASSWORD || '');
      if (configuredPassword && !(await bcrypt.compare(configuredPassword, existing.passwordHash))) {
        existing.passwordHash = await bcrypt.hash(configuredPassword, 12);
        existing.updatedAt = nowIso();
        await this.save();
      }
      return existing;
    }

    const adminAgencyId = nanoid(12);
    const adminUserId = nanoid(12);
    const password = process.env.ADMIN_PASSWORD || 'TrueLeadAdmin123!';
    const passwordHash = await bcrypt.hash(password, 12);

    this.data.agencies.push({
      id: adminAgencyId,
      name: 'TrueLead Admin',
      status: 'active',
      plan: 'agency',
      planStatus: 'active',
      createdAt: nowIso(),
      activatedAt: nowIso(),
      expiresAt: addDays(new Date(), 3650),
      notes: 'Cuenta administradora inicial.'
    });

    this.data.users.push({
      id: adminUserId,
      agencyId: adminAgencyId,
      name: process.env.ADMIN_NAME || 'TrueLead Admin',
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      createdAt: nowIso(),
      lastLoginAt: null
    });

    await this.save();
    return this.data.users.find((user) => user.id === adminUserId);
  }

  async persistJson(payload) {
    const tempPath = `${this.filePath}.tmp`;
    try {
      const current = await fs.readFile(this.filePath, 'utf8');
      JSON.parse(current);
      await fs.copyFile(this.filePath, `${this.filePath}.bak`);
    } catch (error) {
      // Si el archivo principal está corrupto, conservamos el backup bueno.
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await fs.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, this.filePath);
  }

  async persistPostgres(payload) {
    await this.pool.query(
      `INSERT INTO truelead_state (id, payload, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [payload]
    );
  }

  async save() {
    const payload = JSON.stringify(this.data, null, this.storage === 'json' ? 2 : 0);
    const previousWrite = this.writeQueue.catch(() => {});
    this.writeQueue = previousWrite.then(() => (
      this.storage === 'postgres'
        ? this.persistPostgres(payload)
        : this.persistJson(payload)
    ));
    return this.writeQueue;
  }

  collection(name) {
    if (!Array.isArray(this.data[name])) this.data[name] = [];
    return this.data[name];
  }

  async insert(name, record) {
    const item = {
      id: record.id || nanoid(12),
      createdAt: record.createdAt || nowIso(),
      updatedAt: nowIso(),
      ...record
    };
    this.collection(name).push(item);
    await this.save();
    return item;
  }

  async update(name, id, patch) {
    const list = this.collection(name);
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return null;
    list[index] = {
      ...list[index],
      ...patch,
      updatedAt: nowIso()
    };
    await this.save();
    return list[index];
  }

  async remove(name, id) {
    const list = this.collection(name);
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    await this.save();
    return true;
  }

  async close() {
    await this.writeQueue.catch(() => {});
    await this.pool?.end();
  }
}

export const db = new TrueLeadDB();
