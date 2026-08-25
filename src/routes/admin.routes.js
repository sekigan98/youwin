import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso, addDays } from '../lib/utils.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getPricingForRequest, getPlanById } from '../lib/pricing.js';
import { notifyAgencyStatusChange, notifyPaymentValidation, notifyPlanUpdated } from '../services/email.service.js';

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);

function normalizeDate(value, fallback = null) {
  const date = new Date(value || fallback || '');
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function requestedPlan(value) {
  const requested = cleanString(value, 40).toLowerCase();
  const plan = getPlanById(requested);
  const valid = plan.id !== 'free' || requested === 'free';
  return valid ? plan : null;
}

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

adminRouter.get('/pricing', (req, res) => {
  res.json(getPricingForRequest(req));
});


adminRouter.get('/overview', (req, res) => {
  const agencies = db.data.agencies;
  const users = db.data.users;
  const leads = db.data.preleads;
  const payments = db.data.payments;
  const purchases = db.data.purchases;
  res.json({
    metrics: {
      agencies: agencies.length,
      activeAgencies: agencies.filter((a) => a.status === 'active').length,
      pendingAgencies: agencies.filter((a) => ['pending', 'pending_email'].includes(a.status)).length,
      users: users.length,
      leads: leads.length,
      confirmedLeads: leads.filter((l) => l.status === 'confirmed' || l.status === 'sent_to_meta').length,
      paymentsPending: payments.filter((p) => p.status === 'pending').length,
      paymentProofs: purchases.length,
      purchasesPending: purchases.filter((p) => p.status === 'proof_received').length,
      purchasesConfirmed: purchases.filter((p) => p.status === 'purchase_confirmed').length
    },
    recentEvents: [...db.data.events].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30)
  });
});

adminRouter.get('/agencies', (req, res) => {
  const agencies = db.data.agencies.map((agency) => {
    const users = db.data.users.filter((u) => u.agencyId === agency.id).map(publicUser);
    const payments = db.data.payments.filter((p) => p.agencyId === agency.id);
    const projects = db.data.projects.filter((p) => p.agencyId === agency.id);
    const leads = db.data.preleads.filter((l) => l.agencyId === agency.id);
    const messages = db.data.whatsappMessages.filter((m) => m.agencyId === agency.id);
    const purchases = db.data.purchases.filter((purchase) => purchase.agencyId === agency.id);
    return {
      ...agency,
      users,
      payments,
      projectsCount: projects.length,
      leadsCount: leads.length,
      messagesCount: messages.length,
      purchasesCount: purchases.length
    };
  });
  res.json({ agencies });
});

adminRouter.patch('/agencies/:id/status', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const status = cleanString(req.body.status, 40);
  if (!['active', 'pending', 'pending_email', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  const patch = {
    status,
    planStatus: status === 'active' ? 'active' : agency.planStatus,
    activatedAt: status === 'active' ? (agency.activatedAt || nowIso()) : agency.activatedAt
  };

  const updated = await db.update('agencies', agency.id, patch);

  for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
    user.status = status === 'active' ? 'active' : status;
  }
  await db.save();

  notifyAgencyStatusChange({ agency: updated, status }).catch((error) => {
    console.warn('[email] agency status notification failed:', error.message);
  });

  res.json({ agency: updated });
});

adminRouter.post('/agencies/:id/payments', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const amount = Number(req.body.amount || 0);
  const plan = requestedPlan(req.body.plan || agency.plan || 'pro');
  const periodStart = normalizeDate(req.body.periodStart, nowIso());
  const periodEnd = normalizeDate(req.body.periodEnd, addDays(new Date(), 30));
  const paymentStatus = cleanString(req.body.status || 'pending', 30);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
    return res.status(400).json({ error: 'Monto de pago inválido.' });
  }
  if (!plan) return res.status(400).json({ error: 'Plan inválido.' });
  if (!['pending', 'approved', 'rejected'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Estado de pago inválido.' });
  }
  if (!periodStart || !periodEnd || new Date(periodEnd) <= new Date(periodStart)) {
    return res.status(400).json({ error: 'El período del pago es inválido.' });
  }

  const payment = await db.insert('payments', {
    id: nanoid(12),
    agencyId: agency.id,
    amount,
    currency: /^[A-Z]{3}$/.test(cleanString(req.body.currency || 'ARS', 10).toUpperCase())
      ? cleanString(req.body.currency || 'ARS', 10).toUpperCase()
      : 'ARS',
    plan: plan.id,
    status: paymentStatus,
    method: cleanString(req.body.method || 'manual', 60),
    notes: cleanString(req.body.notes, 1000),
    periodStart,
    periodEnd,
    createdAt: nowIso()
  });

  res.status(201).json({ payment });
});

adminRouter.patch('/payments/:id/validate', async (req, res) => {
  const payment = db.data.payments.find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado.' });

  const status = cleanString(req.body.status || 'approved', 30);
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  const updatedPayment = await db.update('payments', payment.id, {
    status,
    approvedAt: status === 'approved' ? nowIso() : null,
    adminNotes: cleanString(req.body.adminNotes, 1000)
  });

  if (status === 'approved') {
    const agency = db.data.agencies.find((a) => a.id === payment.agencyId);
    if (agency) {
      agency.status = 'active';
      agency.planStatus = 'active';
      agency.plan = payment.plan || agency.plan;
      agency.activatedAt = agency.activatedAt || nowIso();
      agency.expiresAt = payment.periodEnd || agency.expiresAt || addDays(new Date(), 30);

      for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
        user.status = 'active';
      }
    }
    await db.save();
  }

  const agencyForEmail = db.data.agencies.find((a) => a.id === payment.agencyId);
  if (agencyForEmail) {
    notifyPaymentValidation({ agency: agencyForEmail, payment: updatedPayment, status }).catch((error) => {
      console.warn('[email] payment notification failed:', error.message);
    });
  }

  res.json({ payment: updatedPayment });
});


adminRouter.patch('/agencies/:id/plan', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const plan = requestedPlan(req.body.plan || agency.plan || 'starter');
  if (!plan) return res.status(400).json({ error: 'Plan inválido.' });
  const expiresAt = normalizeDate(req.body.expiresAt, agency.expiresAt || addDays(new Date(), 30));
  if (plan.id !== 'free' && !expiresAt) return res.status(400).json({ error: 'Vencimiento inválido.' });
  const planStatus = cleanString(req.body.planStatus || agency.planStatus || 'active', 60);

  const updated = await db.update('agencies', agency.id, {
    plan: plan.id,
    planStatus,
    expiresAt,
    status: req.body.activate === false ? agency.status : 'active',
    activatedAt: agency.activatedAt || nowIso()
  });

  for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
    if (updated.status === 'active') user.status = 'active';
  }

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: agency.id,
    type: 'plan_updated',
    message: `Plan actualizado a ${plan.name} para ${agency.name}.`,
    createdAt: nowIso()
  });

  await db.save();

  notifyPlanUpdated({ agency: updated, plan, expiresAt }).catch((error) => {
    console.warn('[email] plan notification failed:', error.message);
  });

  res.json({ agency: updated, plan });
});


adminRouter.delete('/agencies/:id/history', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const counts = {
    preleads: db.data.preleads.filter((item) => item.agencyId === agency.id).length,
    whatsappMessages: db.data.whatsappMessages.filter((item) => item.agencyId === agency.id).length,
    purchases: db.data.purchases.filter((item) => item.agencyId === agency.id).length,
    events: db.data.events.filter((item) => item.agencyId === agency.id).length,
    whatsappContacts: (db.data.whatsappContacts || []).filter((item) => item.agencyId === agency.id).length,
    conversionJobs: (db.data.conversionJobs || []).filter((item) => item.agencyId === agency.id).length
  };

  db.data.preleads = db.data.preleads.filter((item) => item.agencyId !== agency.id);
  db.data.whatsappMessages = db.data.whatsappMessages.filter((item) => item.agencyId !== agency.id);
  db.data.purchases = db.data.purchases.filter((item) => item.agencyId !== agency.id);
  db.data.events = db.data.events.filter((item) => item.agencyId !== agency.id);
  if (Array.isArray(db.data.whatsappContacts)) {
    db.data.whatsappContacts = db.data.whatsappContacts.filter((item) => item.agencyId !== agency.id);
  }
  if (Array.isArray(db.data.conversionJobs)) {
    db.data.conversionJobs = db.data.conversionJobs.filter((item) => item.agencyId !== agency.id);
  }

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: agency.id,
    type: 'history_deleted',
    message: `Historial eliminado para ${agency.name}. Leads: ${counts.preleads}, mensajes: ${counts.whatsappMessages}, comprobantes: ${counts.purchases}, contactos: ${counts.whatsappContacts || 0}.`,
    createdAt: nowIso()
  });

  await db.save();
  res.json({ ok: true, agencyId: agency.id, removed: counts });
});

adminRouter.get('/users', (req, res) => {
  res.json({ users: db.data.users.map(publicUser) });
});
