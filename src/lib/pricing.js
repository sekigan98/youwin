export const PLAN_DEFINITIONS = [
  {
    id: 'free',
    name: 'Free',
    title: 'Vista previa del panel',
    usdMonthly: 0,
    leadsMonthly: null,
    clientsLimit: 0,
    projectsLimit: 0,
    whatsappLimit: 0,
    featured: false,
    capabilities: {
      phoneVisibility: 'locked',
      canViewFullPhones: false,
      canExportLeads: false,
      canEditLeadPhones: false,
      canUseMetaCapi: false,
      canUsePurchases: false,
      canCreateClients: false,
      canCreateProjects: false,
      canBuildLandings: false,
      canConnectWhatsapp: false,
      canUseSdk: false,
      isPaid: false,
      upgradeRequired: true,
      exportLabel: 'Disponible desde Starter'
    },
    features: [
      'Acceso al panel demo/preview',
      'Sin clientes activos',
      'Sin proyectos ni SDK',
      'Sin WhatsApp vinculado',
      'Requiere Starter o superior para medir leads reales'
    ]
  },
  {
    id: 'starter',
    name: 'Starter',
    title: 'Para un primer cliente',
    usdMonthly: 19,
    leadsMonthly: null,
    clientsLimit: 1,
    projectsLimit: 5,
    whatsappLimit: 1,
    featured: false,
    capabilities: {
      phoneVisibility: 'manual',
      canViewFullPhones: true,
      canExportLeads: true,
      canEditLeadPhones: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      canCreateClients: true,
      canCreateProjects: true,
      canBuildLandings: true,
      canConnectWhatsapp: true,
      canUseSdk: true,
      isPaid: true,
      upgradeRequired: false,
      exportLabel: 'Exportación incluida'
    },
    features: [
      '1 cliente',
      'Hasta 5 proyectos / landings',
      'Constructor visual y descarga ZIP',
      '1 conexión WhatsApp (QR o Cloud API)',
      'Teléfono editable manualmente por lead',
      'Exportación CSV/XLSX incluida',
      'Leads reales y Meta CAPI'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    title: 'Para agencias chicas',
    usdMonthly: 49,
    leadsMonthly: null,
    clientsLimit: 5,
    projectsLimit: 25,
    whatsappLimit: 5,
    featured: true,
    capabilities: {
      phoneVisibility: 'manual',
      canViewFullPhones: true,
      canExportLeads: true,
      canEditLeadPhones: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      canCreateClients: true,
      canCreateProjects: true,
      canBuildLandings: true,
      canConnectWhatsapp: true,
      canUseSdk: true,
      isPaid: true,
      upgradeRequired: false,
      exportLabel: 'Exportación incluida'
    },
    features: [
      'Hasta 5 clientes',
      'Hasta 25 proyectos / landings',
      'Constructor visual y descarga ZIP',
      'Hasta 5 conexiones QR / Cloud API',
      'Teléfono editable manualmente por lead',
      'Meta Conversions API',
      'Exportación CSV/XLSX incluida'
    ]
  },
  {
    id: 'agency',
    name: 'Agency',
    title: 'Escala multi-cliente',
    usdMonthly: 99,
    leadsMonthly: null,
    clientsLimit: 20,
    projectsLimit: 100,
    whatsappLimit: 20,
    capabilities: {
      phoneVisibility: 'full',
      canViewFullPhones: true,
      canExportLeads: true,
      canEditLeadPhones: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      canCreateClients: true,
      canCreateProjects: true,
      canBuildLandings: true,
      canConnectWhatsapp: true,
      canUseSdk: true,
      isPaid: true,
      upgradeRequired: false,
      exportLabel: 'Exportación CSV/XLSX incluida'
    },
    features: [
      'Hasta 20 clientes',
      'Hasta 100 proyectos / landings',
      'Constructor visual y descarga ZIP',
      'Hasta 20 conexiones QR / Cloud API',
      'Teléfono editable manualmente por lead',
      'Exportación CSV/XLSX por fechas',
      'Soporte prioritario'
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    title: 'Operación a medida',
    usdMonthly: null,
    leadsMonthly: null,
    clientsLimit: null,
    projectsLimit: null,
    whatsappLimit: null,
    capabilities: {
      phoneVisibility: 'full',
      canViewFullPhones: true,
      canExportLeads: true,
      canEditLeadPhones: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      canCreateClients: true,
      canCreateProjects: true,
      canBuildLandings: true,
      canConnectWhatsapp: true,
      canUseSdk: true,
      isPaid: true,
      upgradeRequired: false,
      exportLabel: 'Exportación avanzada incluida'
    },
    features: [
      'Clientes ilimitados',
      'Proyectos ilimitados',
      'Constructor visual y descarga ZIP',
      'WhatsApps según operación',
      'Exportación avanzada',
      'Onboarding personalizado',
      'Soporte dedicado'
    ]
  }
]

const PLAN_ALIASES = {
  supreme: 'enterprise',
  premium: 'agency'
};

export function getUsdArsRate() {
  const raw = Number(process.env.TRUELEAD_USD_ARS_RATE || process.env.USD_ARS_RATE || 1200);
  return Number.isFinite(raw) && raw > 0 ? raw : 1200;
}

export function isArgentinaRequest(req) {
  const queryCountry = String(req.query.country || '').toUpperCase();
  const headerCountry = String(
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-country-code'] ||
    ''
  ).toUpperCase();

  const tz = String(req.query.tz || req.headers['x-timezone'] || '').toLowerCase();
  const lang = String(req.headers['accept-language'] || '').toLowerCase();

  return queryCountry === 'AR' ||
    headerCountry === 'AR' ||
    tz.includes('argentina') ||
    lang.includes('es-ar');
}

export function roundArs(value) {
  return Math.round(Number(value || 0) / 100) * 100;
}

export function formatUsd(value) {
  if (value == null) return 'Consultar';
  return `USD ${Number(value).toLocaleString('en-US')}`;
}

export function formatArs(value) {
  if (value == null) return 'Consultar';
  return `$${Number(value).toLocaleString('es-AR')}`;
}

export function getPricingForRequest(req) {
  const usdArsRate = getUsdArsRate();
  const country = isArgentinaRequest(req) ? 'AR' : 'INTL';
  const currency = country === 'AR' ? 'ARS' : 'USD';

  const plans = PLAN_DEFINITIONS.map((plan) => {
    const arsMonthly = plan.usdMonthly == null ? null : roundArs(plan.usdMonthly * usdArsRate);
    const displayPrice = currency === 'ARS' ? formatArs(arsMonthly) : formatUsd(plan.usdMonthly);

    return {
      ...plan,
      arsMonthly,
      currency,
      displayPrice,
      displaySuffix: plan.usdMonthly == null ? '' : '/mes'
    };
  });

  return {
    country,
    currency,
    usdArsRate,
    rateSource: 'Render env TRUELEAD_USD_ARS_RATE',
    plans
  };
}

export function getPlanById(id) {
  const normalized = String(id || 'free').toLowerCase();
  const target = PLAN_ALIASES[normalized] || normalized;
  return PLAN_DEFINITIONS.find((plan) => plan.id === target) || getPlanById('free');
}

export function isAgencyExpired(agency, now = new Date()) {
  if (!agency || agency.plan === 'free' || !agency.expiresAt) return false;
  const expiresAt = new Date(agency.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime();
}

export function hasActiveEntitlement(agency) {
  if (!agency || agency.status !== 'active') return false;
  return !isAgencyExpired(agency);
}

export function getPlanCapabilities(id) {
  const plan = getPlanById(id);
  return {
    phoneVisibility: 'manual',
    canViewFullPhones: false,
    canExportLeads: false,
    canEditLeadPhones: false,
    canUseMetaCapi: false,
    canUsePurchases: false,
    canCreateClients: false,
    canCreateProjects: false,
    canConnectWhatsapp: false,
    canUseSdk: false,
    isPaid: false,
    upgradeRequired: true,
    exportLabel: 'Disponible desde Starter',
    ...(plan.capabilities || {})
  };
}

export function isWithinPlanLimit(currentCount, limit) {
  if (limit == null) return true;
  return Number(currentCount || 0) < Number(limit);
}
