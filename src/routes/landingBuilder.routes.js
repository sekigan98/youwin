import express from 'express';
import archiver from 'archiver';
import { db } from '../lib/db.js';
import { normalizeAuthorizedDomains, normalizeOrigin, nowIso } from '../lib/utils.js';
import { requireAuth, requireActiveAgency } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { getPlanCapabilities, hasActiveEntitlement } from '../lib/pricing.js';
import {
  appendLandingPackage,
  buildLandingPackage,
  normalizeLandingBuilderConfig
} from '../services/landingBuilder.service.js';

export const landingBuilderRouter = express.Router();
const builderLimit = createRateLimit({
  windowMs: 15 * 60_000,
  max: 40,
  keyGenerator: (req) => req.auth?.agencyId || req.ip,
  message: 'Alcanzaste el límite temporal de generación de landings. Esperá unos minutos.'
});

// Autenticamos y validamos CSRF antes de aceptar un body con imágenes.
landingBuilderRouter.use(requireAuth, requireActiveAgency);
landingBuilderRouter.use(builderLimit);
landingBuilderRouter.use(express.json({ limit: '20mb' }));

function agencyId(req) {
  return req.auth.agencyId;
}

function capabilities(req) {
  if (req.auth?.role === 'admin') return getPlanCapabilities('enterprise');
  return getPlanCapabilities(hasActiveEntitlement(req.agency) ? (req.agency?.plan || 'free') : 'free');
}

function requireBuilder(req, res) {
  if (capabilities(req).canBuildLandings) return true;
  res.status(402).json({
    error: req.agency?.status === 'expired'
      ? 'Tu plan venció. Reactivalo para crear o descargar landings.'
      : 'El constructor de landings está disponible desde Starter.',
    requiredPlan: 'starter'
  });
  return false;
}

function findLandingProject(req, res) {
  const project = db.data.projects.find((item) =>
    item.id === req.params.projectId && item.agencyId === agencyId(req)
  );
  if (!project) {
    res.status(404).json({ error: 'Proyecto no encontrado.' });
    return null;
  }
  if (project.trackingMode === 'cloud_api') {
    res.status(400).json({ error: 'Seleccioná un proyecto Landing o Híbrido. Un proyecto Cloud API no puede abrir WhatsApp desde una web.' });
    return null;
  }
  return project;
}

function appendAuthorizedOrigin(project, value) {
  const origin = normalizeOrigin(value);
  if (!origin) return false;
  const updated = normalizeAuthorizedDomains(`${project.domain || ''}\n${origin}`);
  if (!updated || updated === project.domain) return false;
  project.domain = updated;
  return true;
}

landingBuilderRouter.put('/projects/:projectId', async (req, res) => {
  if (!requireBuilder(req, res)) return;
  const project = findLandingProject(req, res);
  if (!project) return;

  const config = normalizeLandingBuilderConfig(req.body?.config || req.body || {}, project);
  project.landingBuilder = config;
  appendAuthorizedOrigin(project, config.publishedOrigin);
  project.updatedAt = nowIso();
  await db.save();

  res.json({
    ok: true,
    config,
    project: {
      id: project.id,
      publicId: project.publicId,
      name: project.name,
      domain: project.domain,
      landingBuilder: project.landingBuilder
    }
  });
});

landingBuilderRouter.post('/projects/:projectId/export', async (req, res) => {
  if (!requireBuilder(req, res)) return;
  const project = findLandingProject(req, res);
  if (!project) return;

  const session = db.data.whatsappSessions.find((item) =>
    item.id === project.whatsappSessionId && item.agencyId === agencyId(req)
  );
  if (!session?.number && !project.whatsappNumber) {
    return res.status(400).json({ error: 'El proyecto todavía no tiene un WhatsApp vinculado por QR.' });
  }

  const appOrigin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  let landingPackage;
  try {
    landingPackage = buildLandingPackage({
      input: req.body?.config || project.landingBuilder || {},
      project,
      appOrigin,
      rawAssets: req.body?.assets || {}
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${landingPackage.filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (error) => console.warn('[landing-builder] archive warning:', error.message));
  archive.on('error', (error) => {
    console.error('[landing-builder] archive failed:', error.message);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el ZIP.' });
    else res.destroy(error);
  });
  archive.pipe(res);
  appendLandingPackage(archive, landingPackage);
  await archive.finalize();
});
