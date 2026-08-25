import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, normalizeLeadPhone, nowIso } from '../lib/utils.js';
import { sendMetaConversionEvent } from './metaCapi.service.js';

function nextAttemptDate(attempt, retryAfterSeconds = 0) {
  const configuredBase = Number(process.env.META_QUEUE_RETRY_BASE_SECONDS || 30);
  const baseSeconds = Number.isFinite(configuredBase) ? Math.max(5, configuredBase) : 30;
  const seconds = retryAfterSeconds > 0
    ? Math.min(60 * 60, retryAfterSeconds)
    : Math.min(60 * 60, baseSeconds * (2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function dedupeKey({ eventName, preleadId, purchaseId }) {
  return [eventName, preleadId || '', purchaseId || ''].join(':');
}

export class ConversionQueue {
  constructor() {
    this.timer = null;
    this.running = false;
  }

  async init() {
    db.data.conversionJobs = db.data.conversionJobs || [];
    for (const job of db.data.conversionJobs) {
      if (job.status === 'processing') job.status = 'pending';
    }
    await db.save();
    const configuredPoll = Number(process.env.META_QUEUE_POLL_MS || 5000);
    const pollMs = Number.isFinite(configuredPoll) ? Math.max(1000, Math.min(60_000, configuredPoll)) : 5000;
    this.timer = setInterval(() => this.run().catch((error) => {
      console.error('[meta-queue] runner error', error.message);
    }), pollMs);
    this.timer.unref?.();
    this.kick();
  }

  async enqueue({
    agencyId,
    projectId,
    preleadId,
    purchaseId = '',
    eventName = 'Lead',
    value = 0,
    currency = '',
    testEventCode = ''
  }) {
    const key = dedupeKey({ eventName, preleadId, purchaseId });
    const existing = db.data.conversionJobs.find((job) => job.dedupeKey === key && !['failed', 'cancelled'].includes(job.status));
    if (existing) return existing;

    const job = {
      id: `meta_${nanoid(12)}`,
      dedupeKey: key,
      agencyId,
      projectId,
      preleadId,
      purchaseId,
      eventName,
      value: Number(value || 0),
      currency,
      testEventCode: cleanString(testEventCode, 120),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: nowIso(),
      lastError: '',
      result: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.data.conversionJobs.push(job);

    const prelead = db.data.preleads.find((item) => item.id === preleadId);
    if (prelead && eventName === 'Lead') prelead.metaStatus = 'queued';
    const purchase = db.data.purchases.find((item) => item.id === purchaseId);
    if (purchase) {
      purchase.metaStatus = 'queued';
      purchase.metaSkipReason = '';
    }

    await db.save();
    this.kick();
    return job;
  }

  kick() {
    setTimeout(() => this.run().catch((error) => {
      console.error('[meta-queue] kick error', error.message);
    }), 0).unref?.();
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const jobs = db.data.conversionJobs
        .filter((job) => ['pending', 'retrying'].includes(job.status))
        .filter((job) => new Date(job.nextAttemptAt || 0).getTime() <= now)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(0, 5);

      for (const job of jobs) await this.process(job);
    } finally {
      this.running = false;
    }
  }

  async process(job) {
    const project = db.data.projects.find((item) => item.id === job.projectId && item.agencyId === job.agencyId);
    const prelead = db.data.preleads.find((item) => item.id === job.preleadId && item.agencyId === job.agencyId);
    const purchase = job.purchaseId
      ? db.data.purchases.find((item) => item.id === job.purchaseId && item.agencyId === job.agencyId)
      : null;

    if (!project || !prelead) {
      job.status = 'failed';
      job.lastError = 'El proyecto o lead ya no existe.';
      job.updatedAt = nowIso();
      await db.save();
      return;
    }

    job.status = 'processing';
    job.attempts = Number(job.attempts || 0) + 1;
    job.updatedAt = nowIso();
    await db.save();

    const phone = normalizeLeadPhone(prelead.manualPhone || prelead.whatsappFromPhone || prelead.phone || '');
    let result;
    try {
      result = await sendMetaConversionEvent({
        project,
        prelead,
        purchase,
        phone,
        eventName: job.eventName,
        value: job.value,
        currency: job.currency,
        testEventCode: job.testEventCode || ''
      });
    } catch (error) {
      result = { ok: false, retryable: true, error: error.message || 'Error inesperado al enviar el evento.' };
    }

    job.result = result;
    job.updatedAt = nowIso();

    if (result.ok) {
      job.status = 'sent';
      job.sentAt = nowIso();
      job.lastError = '';
      if (job.eventName === 'Lead') {
        prelead.metaStatus = 'sent';
        prelead.metaResponse = result;
        prelead.status = 'sent_to_meta';
      }
      if (purchase) {
        purchase.metaStatus = 'sent';
        purchase.metaResponse = result;
      }
    } else if (result.skipped) {
      job.status = 'skipped';
      job.lastError = result.reason || 'Evento omitido.';
      if (job.eventName === 'Lead') prelead.metaStatus = 'skipped';
      if (purchase) purchase.metaStatus = 'skipped';
    } else {
      const configuredMaxAttempts = Number(process.env.META_QUEUE_MAX_ATTEMPTS || 6);
      const maxAttempts = Number.isFinite(configuredMaxAttempts)
        ? Math.max(1, Math.min(20, configuredMaxAttempts))
        : 6;
      const canRetry = result.retryable !== false && job.attempts < maxAttempts;
      job.status = canRetry ? 'retrying' : 'failed';
      job.nextAttemptAt = canRetry ? nextAttemptDate(job.attempts, Number(result.retryAfterSeconds || 0)) : null;
      job.lastError = result.error || result.result?.error?.message || `Meta respondió ${result.status || 'con error'}.`;
      if (job.eventName === 'Lead') prelead.metaStatus = canRetry ? 'retrying' : 'error';
      if (purchase) purchase.metaStatus = canRetry ? 'retrying' : 'error';
    }

    prelead.updatedAt = nowIso();
    if (purchase) purchase.updatedAt = nowIso();
    await db.save();
  }

  async retry({ jobId, agencyId }) {
    const job = db.data.conversionJobs.find((item) => item.id === jobId && item.agencyId === agencyId);
    if (!job) return { ok: false, status: 404, error: 'Evento de conversión no encontrado.' };
    if (!['failed', 'skipped'].includes(job.status)) {
      return { ok: false, status: 409, error: 'Solo se pueden reintentar eventos fallidos u omitidos.' };
    }

    const project = db.data.projects.find((item) => item.id === job.projectId && item.agencyId === agencyId);
    const prelead = db.data.preleads.find((item) => item.id === job.preleadId && item.agencyId === agencyId);
    if (!project || !prelead) {
      return { ok: false, status: 409, error: 'El proyecto o lead original ya no existe.' };
    }

    job.status = 'pending';
    job.attempts = 0;
    job.nextAttemptAt = nowIso();
    job.lastError = '';
    job.result = null;
    job.updatedAt = nowIso();
    if (job.eventName === 'Lead') prelead.metaStatus = 'queued';
    const purchase = job.purchaseId
      ? db.data.purchases.find((item) => item.id === job.purchaseId && item.agencyId === agencyId)
      : null;
    if (purchase) {
      purchase.metaStatus = 'queued';
      purchase.metaSkipReason = '';
    }
    await db.save();
    this.kick();
    return { ok: true, job };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const conversionQueue = new ConversionQueue();
