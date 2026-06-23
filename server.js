const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const PORT = process.env.PORT || 3456;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DATA_DIR = path.join(__dirname, "data");
const AGENTS_DIR = path.join(DATA_DIR, "agents");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");
const DEFAULT_AGENT_ID = "scheduling-agent";

const sessions = new Map();

const DEFAULT_PLATFORM = {
  platformName: "数字员工报价平台",
  tagline: "多智能体组合报价计算器",
  salesEmail: "sales@example.com",
  bundleDiscounts: [
    { minAgents: 2, discountRate: 0.95, label: "2 个智能体组合 95 折" },
    { minAgents: 3, discountRate: 0.9, label: "3 个及以上 90 折" },
  ],
  bundleDiscountApplyTo: "subscription",
  sharedCostScaling: [
    {
      costItemId: "infra",
      name: "服务器与基础设施（月）",
      incrementalRatePerAgent: 0.5,
      description: "多智能体共用基础设施，每增 1 个智能体成本 +50%",
    },
    {
      costItemId: "cs",
      name: "客户成功/运营人力（月）",
      incrementalRatePerAgent: 0.5,
      description: "客户成功团队可复用，每增 1 个智能体成本 +50%",
    },
    {
      costItemId: "sales",
      name: "销售与市场费用",
      incrementalRatePerAgent: 0.3,
      description: "销售与市场投入可复用，每增 1 个智能体成本 +30%",
    },
  ],
};

const DEFAULT_AGENT_META = {
  id: DEFAULT_AGENT_ID,
  name: "排班智能体",
  shortName: "排班",
  icon: "排",
  enabled: true,
  sortOrder: 1,
  description: "门店排班、班次规则、人力优化",
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureDataFiles() {
  ensureDir(DATA_DIR);
  ensureDir(AGENTS_DIR);
  const quotesPath = path.join(DATA_DIR, "quotes.json");
  if (!fs.existsSync(quotesPath)) fs.writeFileSync(quotesPath, "[]\n", "utf8");
  migrateLegacyData();
}

function migrateLegacyData() {
  const indexPath = path.join(AGENTS_DIR, "index.json");
  if (fs.existsSync(indexPath)) return;

  const legacyPricing = path.join(DATA_DIR, "pricing.json");
  if (!fs.existsSync(legacyPricing)) return;

  const agentDir = path.join(AGENTS_DIR, DEFAULT_AGENT_ID);
  ensureDir(agentDir);
  for (const file of ["pricing.json", "addons.json", "costs.json"]) {
    const src = path.join(DATA_DIR, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(agentDir, file));
  }
  fs.writeFileSync(indexPath, JSON.stringify([DEFAULT_AGENT_META], null, 2), "utf8");
  if (!fs.existsSync(path.join(DATA_DIR, "platform.json"))) {
    fs.writeFileSync(path.join(DATA_DIR, "platform.json"), JSON.stringify(DEFAULT_PLATFORM, null, 2), "utf8");
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, relativePath), "utf8"));
}

function writeJson(relativePath, data) {
  fs.writeFileSync(path.join(DATA_DIR, relativePath), JSON.stringify(data, null, 2), "utf8");
}

function agentPath(agentId, file) {
  return path.join(AGENTS_DIR, agentId, file);
}

function readAgentFile(agentId, file) {
  const p = agentPath(agentId, file);
  if (!fs.existsSync(p)) throw new Error(`Agent config missing: ${agentId}/${file}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeAgentFile(agentId, file, data) {
  ensureDir(path.join(AGENTS_DIR, agentId));
  fs.writeFileSync(agentPath(agentId, file), JSON.stringify(data, null, 2), "utf8");
}

function readAgentsIndex() {
  migrateLegacyData();
  const p = path.join(AGENTS_DIR, "index.json");
  if (!fs.existsSync(p)) return [DEFAULT_AGENT_META];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeAgentsIndex(data) {
  ensureDir(AGENTS_DIR);
  fs.writeFileSync(path.join(AGENTS_DIR, "index.json"), JSON.stringify(data, null, 2), "utf8");
}

function readPlatform() {
  migrateLegacyData();
  const p = path.join(DATA_DIR, "platform.json");
  if (!fs.existsSync(p)) return { ...DEFAULT_PLATFORM };
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!data.sharedCostScaling?.length) {
    data.sharedCostScaling = JSON.parse(JSON.stringify(DEFAULT_PLATFORM.sharedCostScaling));
  }
  return data;
}

function getSharedCostScaling(platform = readPlatform()) {
  const defaults = DEFAULT_PLATFORM.sharedCostScaling;
  const custom = platform?.sharedCostScaling;
  if (!custom?.length) return JSON.parse(JSON.stringify(defaults));
  return defaults.map((d) => {
    const override = custom.find((c) => c.costItemId === d.costItemId);
    return override ? { ...d, ...override } : { ...d };
  });
}

function writePlatform(data) {
  writeJson("platform.json", data);
}

function getEnabledAgents() {
  return readAgentsIndex()
    .filter((a) => a.enabled !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

function getAgentMeta(agentId) {
  return readAgentsIndex().find((a) => a.id === agentId) || null;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function requireAuth(req, res) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) {
    send(res, 401, { error: "未授权，请先登录" });
    return null;
  }
  return token;
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function slugifyId(name) {
  const base = String(name || "agent")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `agent-${Date.now()}`;
}

function resolveAgentIds(input) {
  if (Array.isArray(input?.agentIds) && input.agentIds.length) {
    return [...new Set(input.agentIds)];
  }
  if (input?.agentId) return [input.agentId];
  return [DEFAULT_AGENT_ID];
}

function getSubscriptionTier(pricing, storeCount) {
  for (const tier of pricing.subscriptionTiers) {
    if (storeCount >= tier.minStores && (tier.maxStores == null || storeCount <= tier.maxStores)) {
      return tier;
    }
  }
  return null;
}

function calculateAgentQuote(agentId, input) {
  const pricing = readAgentFile(agentId, "pricing.json");
  const addons = readAgentFile(agentId, "addons.json");
  const meta = getAgentMeta(agentId);

  const storeCount = Math.max(1, Number(input.storeCount) || 1);
  const contractYears = Math.max(1, Number(input.contractYears) || 2);
  const integrationCount = Math.max(0, Number(input.integrationCount) || 0);
  const addonIds = input.addonIds || [];
  const contractMonths = contractYears * 12;

  const implLines = pricing.implementationItems.map((item) => {
    let qty = item.defaultQty;
    if (item.qtyField === "integrationCount") qty = Math.max(0, integrationCount);
    const amount = item.unitPrice * qty;
    return { ...item, qty, amount };
  });
  const implementationTotal = implLines.reduce((s, l) => s + l.amount, 0);

  const tier = getSubscriptionTier(pricing, storeCount);
  const customQuote = !tier || tier.pricePerStore == null;

  const monthlyPerStore = tier?.pricePerStore ?? 0;
  const monthlySubscription = customQuote ? null : storeCount * monthlyPerStore;
  const yearlySubscription = customQuote ? null : monthlySubscription * 12;
  const contractSubscription = customQuote ? null : monthlySubscription * contractMonths;
  const annualPayAmount = customQuote ? null : Math.round(yearlySubscription * pricing.annualPayDiscount);
  const annualPaySavings = customQuote ? null : yearlySubscription - annualPayAmount;

  const selectedAddons = [];
  let addonsMonthly = 0;
  for (const id of addonIds) {
    const addon = addons.find((a) => a.id === id);
    if (!addon) continue;
    selectedAddons.push(addon);
    addonsMonthly += addon.monthlyPrice;
  }
  const addonsContractTotal = addonsMonthly * contractMonths;
  const addonsFirstYear = addonsMonthly * 12;

  const contractTotal = customQuote
    ? null
    : implementationTotal + contractSubscription + addonsContractTotal;
  const firstYearBudget = customQuote
    ? null
    : implementationTotal + yearlySubscription + addonsFirstYear;

  return {
    agentId,
    agentName: meta?.name || pricing.productName,
    productName: pricing.productName,
    storeCount,
    contractYears,
    contractMonths,
    integrationCount,
    tier: tier
      ? { id: tier.id, name: tier.name, label: tier.label, description: tier.description, customQuote }
      : null,
    customQuote,
    addonIds,
    sections: [
      {
        id: "implementation",
        title: "一、企业建模实施费（一次性）",
        type: "oneTime",
        amount: implementationTotal,
        lines: implLines.map((l) => ({
          name: l.name,
          unitPrice: l.unitPrice,
          qty: l.qty,
          description: l.description,
          amount: l.amount,
        })),
        description: pricing.paymentNotes.implementation,
      },
      {
        id: "subscription",
        title: "二、数字员工订阅费（按门店数分档 × 月收取）",
        type: "recurring",
        customQuote,
        monthlyPerStore,
        monthlyAmount: monthlySubscription,
        yearlyAmount: yearlySubscription,
        contractAmount: contractSubscription,
        annualPayDiscount: pricing.annualPayDiscount,
        annualPayAmount,
        annualPaySavings,
        tiers: pricing.subscriptionTiers,
        description: pricing.paymentNotes.subscription,
      },
      {
        id: "addons",
        title: "三、增值服务费（按月收取，可选配置）",
        type: "monthly",
        monthlyAmount: addonsMonthly,
        contractAmount: addonsContractTotal,
        firstYearAmount: addonsFirstYear,
        items: selectedAddons.map((a) => ({
          ...a,
          contractAmount: a.monthlyPrice * contractMonths,
        })),
        description: pricing.paymentNotes.addons,
      },
    ],
    overview: [
      {
        label: "① 企业建模实施费（一次性）",
        amount: implementationTotal,
        note: pricing.paymentNotes.implementation,
      },
      {
        label: "② 数字员工订阅费（合同期）",
        amount: contractSubscription,
        note: pricing.paymentNotes.subscription,
        customQuote,
      },
      {
        label: "③ 增值服务费（合同期）",
        amount: addonsContractTotal,
        note: pricing.paymentNotes.addons,
      },
    ],
    summary: {
      implementationTotal,
      subscriptionContractTotal: contractSubscription,
      addonsContractTotal,
      contractTotal,
      firstYearBudget,
      monthlySubscription,
      addonsMonthly,
    },
  };
}

function getBundleDiscountRule(agentCount, platform) {
  const rules = [...(platform.bundleDiscounts || [])].sort((a, b) => b.minAgents - a.minAgents);
  return rules.find((r) => agentCount >= r.minAgents) || null;
}

function applyBundleDiscount(agents, platform) {
  const rule = getBundleDiscountRule(agents.length, platform);
  if (!rule || rule.discountRate >= 1) {
    return { rate: 1, label: null, savings: 0, appliedTo: platform.bundleDiscountApplyTo || "subscription" };
  }

  const applyTo = platform.bundleDiscountApplyTo || "subscription";
  let base = 0;
  if (applyTo === "subscription") {
    base = agents.reduce((s, a) => s + (a.summary.subscriptionContractTotal || 0), 0);
  } else if (applyTo === "total") {
    base = agents.reduce((s, a) => s + (a.summary.contractTotal || 0), 0);
  }

  const discounted = Math.round(base * rule.discountRate);
  const savings = base - discounted;
  return {
    rate: rule.discountRate,
    label: rule.label,
    savings,
    appliedTo: applyTo,
    baseAmount: base,
    discountedAmount: discounted,
  };
}

function buildCombinedSummary(agents, bundleDiscount) {
  const implementationTotal = agents.reduce((s, a) => s + (a.summary.implementationTotal || 0), 0);
  const subscriptionContractTotal = agents.reduce((s, a) => s + (a.summary.subscriptionContractTotal || 0), 0);
  const addonsContractTotal = agents.reduce((s, a) => s + (a.summary.addonsContractTotal || 0), 0);
  const firstYearBudget = agents.reduce((s, a) => s + (a.summary.firstYearBudget || 0), 0);
  const bundleSavings = bundleDiscount.savings || 0;
  const contractTotal =
    implementationTotal + subscriptionContractTotal + addonsContractTotal - bundleSavings;

  return {
    implementationTotal,
    subscriptionContractTotal,
    addonsContractTotal,
    bundleSavings,
    contractTotal,
    firstYearBudget,
    monthlySubscription: agents.reduce((s, a) => s + (a.summary.monthlySubscription || 0), 0),
    addonsMonthly: agents.reduce((s, a) => s + (a.summary.addonsMonthly || 0), 0),
  };
}

function buildCombinedOverview(agents, bundleDiscount, combinedSummary, platform) {
  const rows = [];
  for (const agent of agents) {
    rows.push({
      label: `【${agent.agentName}】实施费（一次性）`,
      amount: agent.summary.implementationTotal,
      note: agent.sections.find((s) => s.id === "implementation")?.description || "",
    });
    rows.push({
      label: `【${agent.agentName}】订阅费（合同期）`,
      amount: agent.summary.subscriptionContractTotal,
      note: agent.tier?.label ? `档位 ${agent.tier.label}` : "",
    });
    rows.push({
      label: `【${agent.agentName}】增值服务费（合同期）`,
      amount: agent.summary.addonsContractTotal,
      note: "",
    });
  }
  if (bundleDiscount.savings > 0) {
    rows.push({
      label: `组合折扣（${bundleDiscount.label || ""}）`,
      amount: -bundleDiscount.savings,
      note: `作用于${bundleDiscount.appliedTo === "subscription" ? "订阅费" : "总价"}`,
      isDiscount: true,
    });
  }
  return rows;
}

function calculateMultiQuote(input) {
  const platform = readPlatform();
  const agentIds = resolveAgentIds(input);
  const enabledIds = new Set(getEnabledAgents().map((a) => a.id));
  const validIds = agentIds.filter((id) => enabledIds.has(id));

  if (!validIds.length) {
    return { customQuote: true, error: "请至少选择一个有效的智能体" };
  }

  const storeCount = Math.max(1, Number(input.storeCount) || 1);
  const contractYears = Math.max(1, Number(input.contractYears) || 2);
  const integrationCount = Math.max(0, Number(input.integrationCount) || 0);
  const addonSelections = input.addonSelections || {};
  const contractMonths = contractYears * 12;

  const agents = [];
  let customQuote = false;
  let customQuoteAgent = null;

  for (const agentId of validIds) {
    const addonIds =
      addonSelections[agentId] ||
      (validIds.length === 1 && input.addonIds ? input.addonIds : getDefaultAddonIds(agentId));
    const result = calculateAgentQuote(agentId, {
      storeCount,
      contractYears,
      integrationCount,
      addonIds,
    });
    if (result.customQuote) {
      customQuote = true;
      customQuoteAgent = result.agentName;
    }
    agents.push(result);
  }

  const sharedInput = { storeCount, contractYears, contractMonths, integrationCount };
  const base = {
    platformName: platform.platformName,
    agentIds: validIds,
    sharedInput,
    agents,
    customQuote,
    customQuoteAgent,
  };

  if (customQuote) {
    return {
      ...base,
      bundleDiscount: null,
      combinedSummary: null,
      overview: [],
      summary: null,
    };
  }

  const bundleDiscount = applyBundleDiscount(agents, platform);
  const combinedSummary = buildCombinedSummary(agents, bundleDiscount);
  const overview = buildCombinedOverview(agents, bundleDiscount, combinedSummary, platform);

  return {
    ...base,
    bundleDiscount,
    combinedSummary,
    overview,
    summary: combinedSummary,
    addonSelections: Object.fromEntries(
      validIds.map((id) => [id, agents.find((a) => a.agentId === id)?.addonIds || []])
    ),
  };
}

function getDefaultAddonIds(agentId) {
  const defaults = {
    "scheduling-agent": ["dedicated-service", "maintenance"],
    "ordering-agent": ["dedicated-service", "maintenance"],
    "store-ops-agent": ["dedicated-service", "maintenance"],
    "kitchen-agent": ["dedicated-service", "maintenance"],
    "marketing-agent": ["dedicated-service", "maintenance"],
    "menu-agent": ["dedicated-service", "maintenance"],
  };
  return defaults[agentId] || ["dedicated-service", "maintenance"];
}

function calculateQuote(input) {
  return calculateMultiQuote(input);
}

function normalizeQuoteBreakdown(breakdown) {
  if (!breakdown) return null;
  if (breakdown.agents?.length) return breakdown;
  if (breakdown.sections?.length) {
    return {
      ...breakdown,
      platformName: breakdown.platformName || readPlatform().platformName,
      agentIds: [DEFAULT_AGENT_ID],
      agents: [{ agentId: DEFAULT_AGENT_ID, ...breakdown }],
      combinedSummary: breakdown.summary,
      bundleDiscount: { rate: 1, savings: 0, label: null },
    };
  }
  return breakdown;
}

function getQuoteAgentIds(quote) {
  if (quote.agentIds?.length) return quote.agentIds;
  const normalized = normalizeQuoteBreakdown(quote.breakdown);
  return normalized?.agentIds || [DEFAULT_AGENT_ID];
}

function getQuoteContractTotal(quote) {
  if (quote.finalTotal != null) return quote.finalTotal;
  const b = normalizeQuoteBreakdown(quote.breakdown);
  return b?.combinedSummary?.contractTotal ?? b?.summary?.contractTotal ?? quote.contractTotal ?? 0;
}

function resolveCostQuantity(item, revenue) {
  if (item.quantityFields?.length) {
    return item.quantityFields.reduce((product, field) => product * (Number(revenue[field]) || 0), 1);
  }
  if (item.quantityField === "contractMonths") {
    return revenue.contractMonths || 24;
  }
  return item.quantity ?? 1;
}

function resolveCostQtyLabel(item, revenue) {
  if (item.quantityFields?.length) {
    return item.quantityFields
      .map((field) => {
        const labels = { storeCount: "店", contractMonths: "月" };
        return `${revenue[field] ?? 0}${labels[field] || ""}`;
      })
      .join(" × ");
  }
  if (item.quantityField === "contractMonths") {
    return `${revenue.contractMonths || 24} ${item.unit || "月"}`;
  }
  return `${item.quantity ?? 1} ${item.unit || ""}`;
}

function extractAddonIds(input) {
  if (input?.addonSelections && typeof input.addonSelections === "object") {
    return Object.values(input.addonSelections).flat();
  }
  if (Array.isArray(input?.addonIds) && input.addonIds.length) return input.addonIds;
  const addonsSection = input?.sections?.find((s) => s.id === "addons");
  if (addonsSection?.items?.length) return addonsSection.items.map((i) => i.id);
  return [];
}

function isCostItemApplicable(item, addonIds) {
  if (!item.requiresAddon) return true;
  return addonIds.includes(item.requiresAddon);
}

function normalizeRevenueForCost(input, agentId = DEFAULT_AGENT_ID) {
  const base = input?.summary ? input : input || {};
  const summary = base.summary || {};
  const contractYears = Number(base.contractYears ?? input?.contractYears) || 2;
  const contractMonths = Number(base.contractMonths ?? input?.contractMonths) || contractYears * 12;
  return {
    ...base,
    summary,
    storeCount: Number(base.storeCount ?? input?.storeCount) || 1,
    contractYears,
    contractMonths,
    addonIds: extractAddonIds(base).length ? extractAddonIds(base) : extractAddonIds(input),
    agentId,
  };
}

function calculateCostProfit(revenueInput, agentId = DEFAULT_AGENT_ID) {
  const revenue = normalizeRevenueForCost(revenueInput, agentId);
  const costsConfig = readAgentFile(agentId, "costs.json");
  const contractMonths = revenue.contractMonths;
  const addonIds = revenue.addonIds || [];
  const implRev = revenue.summary.implementationTotal || 0;
  const subRev = revenue.summary.subscriptionContractTotal || 0;
  const addonRev = revenue.summary.addonsContractTotal || 0;
  const totalRev = revenue.summary.contractTotal || implRev + subRev + addonRev;

  const costLines = costsConfig.costItems
    .filter((item) => isCostItemApplicable(item, addonIds))
    .map((item) => {
      const qty = resolveCostQuantity(item, revenue);
      return {
        ...item,
        qty,
        qtyLabel: resolveCostQtyLabel(item, revenue),
        amount: item.unitPrice * qty,
      };
    });
  const totalCost = costLines.reduce((s, l) => s + l.amount, 0);
  const grossProfit = totalRev - totalCost;
  const margin = totalRev > 0 ? grossProfit / totalRev : 0;

  const implCost =
    (costLines.find((c) => c.id === "fde")?.amount || 0) +
    (costLines.find((c) => c.id === "travel")?.amount || 0) +
    (costLines.find((c) => c.id === "sales")?.amount || 0);
  const implMargin = implRev > 0 ? (implRev - implCost) / implRev : 0;

  const opsCost = costLines
    .filter((c) => ["ai-token", "infra", "cs", "rd"].includes(c.id))
    .reduce((s, c) => s + c.amount, 0);
  const subStageRev = subRev + addonRev;
  const subMargin = subRev > 0 ? (subStageRev - opsCost) / subRev : 0;

  const monthlyOpsProfit = contractMonths > 0 ? (subStageRev - opsCost) / contractMonths : 0;
  const fixedCost = implCost;
  const breakEvenMonths = monthlyOpsProfit > 0 ? fixedCost / monthlyOpsProfit : null;

  return {
    agentId,
    agentName: getAgentMeta(agentId)?.name || agentId,
    revenue: { implementation: implRev, subscription: subRev, addons: addonRev, total: totalRev },
    costLines,
    totalCost,
    grossProfit,
    margin,
    implMargin,
    subMargin,
    breakEvenMonths,
  };
}

function calculateMultiCostProfit(breakdown) {
  const normalized = normalizeQuoteBreakdown(breakdown);
  const platform = readPlatform();
  if (!normalized?.agents?.length) {
    return { perAgent: [calculateCostProfit(normalized, DEFAULT_AGENT_ID)], combined: null };
  }

  const perAgent = normalized.agents.map((a) => calculateCostProfit(a, a.agentId));
  const agentCount = perAgent.length;
  const combinedRev = perAgent.reduce(
    (acc, p) => ({
      implementation: acc.implementation + p.revenue.implementation,
      subscription: acc.subscription + p.revenue.subscription,
      addons: acc.addons + p.revenue.addons,
      total: acc.total + p.revenue.total,
    }),
    { implementation: 0, subscription: 0, addons: 0, total: 0 }
  );
  const bundleSavings = normalized.combinedSummary?.bundleSavings || 0;
  const adjustedTotal = normalized.combinedSummary?.contractTotal ?? combinedRev.total;

  let totalCost;
  let sharedCostScaling = null;
  let costBreakdown = null;

  if (agentCount <= 1) {
    totalCost = perAgent[0]?.totalCost || 0;
  } else {
    const scalingRules = getSharedCostScaling(platform);
    const sharedIds = new Set(scalingRules.map((r) => r.costItemId));
    const sharedLines = [];

    for (const rule of scalingRules) {
      const perAgentAmounts = perAgent
        .map((p) => p.costLines.find((c) => c.id === rule.costItemId))
        .filter(Boolean)
        .map((l) => l.amount);
      if (!perAgentAmounts.length) continue;

      const baseAmount = Math.max(...perAgentAmounts);
      const naiveSum = perAgent.reduce((sum, p) => {
        const line = p.costLines.find((c) => c.id === rule.costItemId);
        return sum + (line?.amount || 0);
      }, 0);
      const rate = Number(rule.incrementalRatePerAgent) || 0;
      const factor = 1 + (agentCount - 1) * rate;
      const scaledAmount = Math.round(baseAmount * factor * 100) / 100;

      sharedLines.push({
        costItemId: rule.costItemId,
        name: rule.name,
        description: rule.description,
        baseAmount,
        naiveSum,
        scaledAmount,
        incrementalRatePerAgent: rate,
        agentCount,
        factor,
        savingsVsNaive: Math.round((naiveSum - scaledAmount) * 100) / 100,
      });
    }

    const nonSharedMap = new Map();
    for (const p of perAgent) {
      for (const line of p.costLines) {
        if (sharedIds.has(line.id)) continue;
        if (!nonSharedMap.has(line.id)) {
          nonSharedMap.set(line.id, {
            id: line.id,
            name: line.name,
            amount: 0,
            unitPrice: line.unitPrice,
            qtyLabel: line.qtyLabel,
          });
        }
        const agg = nonSharedMap.get(line.id);
        agg.amount += line.amount;
      }
    }

    const nonSharedTotal = [...nonSharedMap.values()].reduce((s, l) => s + l.amount, 0);
    const sharedTotal = sharedLines.reduce((s, l) => s + l.scaledAmount, 0);
    const naiveSharedTotal = sharedLines.reduce((s, l) => s + l.naiveSum, 0);
    totalCost = nonSharedTotal + sharedTotal;
    sharedCostScaling = {
      lines: sharedLines,
      naiveSharedTotal,
      scaledSharedTotal: sharedTotal,
      savingsVsNaive: Math.round((naiveSharedTotal - sharedTotal) * 100) / 100,
    };
    costBreakdown = {
      nonShared: [...nonSharedMap.values()],
      shared: sharedLines,
    };
  }

  return {
    perAgent,
    combined: {
      revenue: { ...combinedRev, total: adjustedTotal, bundleSavings },
      totalCost,
      grossProfit: adjustedTotal - totalCost,
      margin: adjustedTotal > 0 ? (adjustedTotal - totalCost) / adjustedTotal : 0,
      agentCount,
      sharedCostScaling,
      costBreakdown,
    },
  };
}

function quotePipelineValue(q) {
  return q.finalTotal ?? getQuoteContractTotal(q) ?? q.firstYearBudget ?? 0;
}

function createBlankPricing(productName) {
  const template = readAgentFile(DEFAULT_AGENT_ID, "pricing.json");
  return {
    ...JSON.parse(JSON.stringify(template)),
    productName: productName || "新智能体",
  };
}

function createBlankAddons() {
  return JSON.parse(JSON.stringify(readAgentFile(DEFAULT_AGENT_ID, "addons.json")));
}

function createBlankCosts() {
  return JSON.parse(JSON.stringify(readAgentFile(DEFAULT_AGENT_ID, "costs.json")));
}

function resolveAdminAgentId(url, body) {
  return url.searchParams.get("agentId") || body?.agentId || DEFAULT_AGENT_ID;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function serveStatic(baseDir, urlPath, res) {
  let filePath = path.join(baseDir, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(baseDir)) return send(res, 403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const alt = path.join(baseDir, urlPath.replace(/\/?$/, "") + ".html");
    if (fs.existsSync(alt)) filePath = alt;
    else return send(res, 404, "Not Found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname, url) {
  const method = req.method;

  if (pathname === "/api/platform" && method === "GET") {
    const platform = readPlatform();
    return send(res, 200, {
      ...platform,
      agents: getEnabledAgents(),
    });
  }

  const agentAddonsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/addons$/);
  if (agentAddonsMatch && method === "GET") {
    try {
      return send(res, 200, readAgentFile(agentAddonsMatch[1], "addons.json"));
    } catch {
      return send(res, 404, { error: "智能体不存在" });
    }
  }

  if (pathname === "/api/pricing" && method === "GET") {
    return send(res, 200, readAgentFile(DEFAULT_AGENT_ID, "pricing.json"));
  }

  if (pathname === "/api/addons" && method === "GET") {
    return send(res, 200, readAgentFile(DEFAULT_AGENT_ID, "addons.json"));
  }

  if (pathname === "/api/calculate" && method === "POST") {
    try {
      const body = await parseBody(req);
      return send(res, 200, calculateMultiQuote(body));
    } catch {
      return send(res, 400, { error: "请求格式错误" });
    }
  }

  if (pathname === "/api/quotes" && method === "POST") {
    try {
      const body = await parseBody(req);
      const { name, email, company, phone, notes } = body;
      if (!name || !email) {
        return send(res, 400, { error: "请填写联系人和邮箱" });
      }
      const calc = calculateMultiQuote(body);
      if (calc.customQuote) {
        const msg = calc.customQuoteAgent
          ? `「${calc.customQuoteAgent}」当前门店数需面议，请联系商务`
          : "当前门店数未匹配到可自动报价的档位，请联系商务获取专属报价";
        return send(res, 400, { error: msg });
      }
      if (!calc.agentIds?.length) {
        return send(res, 400, { error: "请至少选择一个智能体" });
      }

      const tierLabels = calc.agents.map((a) => a.tier?.label).filter(Boolean).join(" / ");
      const quote = {
        id: generateId("q"),
        name,
        email,
        company: company || "",
        phone: phone || "",
        agentIds: calc.agentIds,
        storeCount: calc.sharedInput.storeCount,
        contractYears: calc.sharedInput.contractYears,
        integrationCount: calc.sharedInput.integrationCount,
        tierLabel: tierLabels,
        addonSelections: calc.addonSelections || {},
        notes: notes || "",
        breakdown: calc,
        implementationTotal: calc.combinedSummary.implementationTotal,
        contractTotal: calc.combinedSummary.contractTotal,
        firstYearBudget: calc.combinedSummary.firstYearBudget,
        monthlySubscription: calc.combinedSummary.monthlySubscription,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const quotes = readJson("quotes.json");
      quotes.unshift(quote);
      writeJson("quotes.json", quotes);
      return send(res, 201, { success: true, quote });
    } catch {
      return send(res, 400, { error: "提交失败，请检查表单" });
    }
  }

  if (pathname === "/api/admin/login" && method === "POST") {
    try {
      const body = await parseBody(req);
      if (body.password !== ADMIN_PASSWORD) return send(res, 401, { error: "密码错误" });
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { createdAt: Date.now() });
      return send(res, 200, { token });
    } catch {
      return send(res, 400, { error: "登录失败" });
    }
  }

  if (pathname === "/api/admin/logout" && method === "POST") {
    const token = getToken(req);
    if (token) sessions.delete(token);
    return send(res, 200, { success: true });
  }

  if (pathname === "/api/admin/platform" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readPlatform());
  }

  if (pathname === "/api/admin/platform" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      writePlatform(body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/agents" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readAgentsIndex());
  }

  if (pathname === "/api/admin/agents" && method === "POST") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const index = readAgentsIndex();
      let id = body.id || slugifyId(body.name);
      if (index.some((a) => a.id === id)) id = `${id}-${Date.now()}`;
      const meta = {
        id,
        name: body.name || "新智能体",
        shortName: body.shortName || body.name?.slice(0, 2) || "新",
        icon: body.icon || "智",
        enabled: body.enabled !== false,
        sortOrder: body.sortOrder ?? index.length + 1,
        description: body.description || "",
      };
      index.push(meta);
      writeAgentsIndex(index);
      const copyFrom = body.copyFrom || DEFAULT_AGENT_ID;
      try {
        writeAgentFile(id, "pricing.json", createBlankPricing(meta.name));
        if (body.copyFrom) {
          writeAgentFile(id, "pricing.json", readAgentFile(copyFrom, "pricing.json"));
          writeAgentFile(id, "addons.json", readAgentFile(copyFrom, "addons.json"));
          writeAgentFile(id, "costs.json", readAgentFile(copyFrom, "costs.json"));
          const pricing = readAgentFile(id, "pricing.json");
          pricing.productName = meta.name;
          writeAgentFile(id, "pricing.json", pricing);
        } else {
          writeAgentFile(id, "addons.json", createBlankAddons());
          writeAgentFile(id, "costs.json", createBlankCosts());
        }
      } catch {
        writeAgentFile(id, "pricing.json", createBlankPricing(meta.name));
        writeAgentFile(id, "addons.json", createBlankAddons());
        writeAgentFile(id, "costs.json", createBlankCosts());
      }
      return send(res, 201, meta);
    } catch {
      return send(res, 400, { error: "创建失败" });
    }
  }

  const agentMetaMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)$/);
  if (agentMetaMatch && method === "PATCH") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const index = readAgentsIndex();
      const idx = index.findIndex((a) => a.id === agentMetaMatch[1]);
      if (idx === -1) return send(res, 404, { error: "智能体不存在" });
      for (const key of ["name", "shortName", "icon", "enabled", "sortOrder", "description"]) {
        if (body[key] !== undefined) index[idx][key] = body[key];
      }
      writeAgentsIndex(index);
      if (body.name) {
        try {
          const pricing = readAgentFile(agentMetaMatch[1], "pricing.json");
          pricing.productName = body.name;
          writeAgentFile(agentMetaMatch[1], "pricing.json", pricing);
        } catch {
          /* ignore */
        }
      }
      return send(res, 200, index[idx]);
    } catch {
      return send(res, 400, { error: "更新失败" });
    }
  }

  const agentConfigMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)\/(pricing|addons|costs)$/);
  if (agentConfigMatch && method === "GET") {
    if (!requireAuth(req, res)) return;
    try {
      return send(res, 200, readAgentFile(agentConfigMatch[1], `${agentConfigMatch[2]}.json`));
    } catch {
      return send(res, 404, { error: "智能体不存在" });
    }
  }

  if (agentConfigMatch && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      if (agentConfigMatch[2] === "addons" && !Array.isArray(body)) {
        return send(res, 400, { error: "数据格式错误" });
      }
      writeAgentFile(agentConfigMatch[1], `${agentConfigMatch[2]}.json`, body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/stats" && method === "GET") {
    if (!requireAuth(req, res)) return;
    const quotes = readJson("quotes.json");
    const now = new Date();
    const thisMonth = quotes.filter((q) => {
      const d = new Date(q.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const byStatus = {};
    for (const q of quotes) byStatus[q.status] = (byStatus[q.status] || 0) + 1;
    const pipeline = quotes
      .filter((q) => !["won", "lost"].includes(q.status))
      .reduce((sum, q) => sum + quotePipelineValue(q), 0);
    return send(res, 200, {
      total: quotes.length,
      thisMonth: thisMonth.length,
      byStatus,
      pipelineValue: pipeline,
      recent: quotes.slice(0, 5),
      agentCount: readAgentsIndex().filter((a) => a.enabled !== false).length,
    });
  }

  if (pathname === "/api/admin/quotes" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readJson("quotes.json"));
  }

  const quoteMatch = pathname.match(/^\/api\/admin\/quotes\/([^/]+)$/);
  if (quoteMatch && method === "GET") {
    if (!requireAuth(req, res)) return;
    const quotes = readJson("quotes.json");
    const q = quotes.find((x) => x.id === quoteMatch[1]);
    if (!q) return send(res, 404, { error: "报价单不存在" });
    return send(res, 200, q);
  }

  if (quoteMatch && method === "PATCH") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const quotes = readJson("quotes.json");
      const idx = quotes.findIndex((q) => q.id === quoteMatch[1]);
      if (idx === -1) return send(res, 404, { error: "报价单不存在" });
      for (const key of ["status", "adminNotes", "finalTotal"]) {
        if (body[key] !== undefined) quotes[idx][key] = body[key];
      }
      quotes[idx].updatedAt = new Date().toISOString();
      writeJson("quotes.json", quotes);
      return send(res, 200, quotes[idx]);
    } catch {
      return send(res, 400, { error: "更新失败" });
    }
  }

  if (quoteMatch && method === "DELETE") {
    if (!requireAuth(req, res)) return;
    try {
      const quotes = readJson("quotes.json");
      const idx = quotes.findIndex((q) => q.id === quoteMatch[1]);
      if (idx === -1) return send(res, 404, { error: "报价单不存在" });
      const removed = quotes.splice(idx, 1)[0];
      writeJson("quotes.json", quotes);
      return send(res, 200, { success: true, quote: removed });
    } catch {
      return send(res, 400, { error: "删除失败" });
    }
  }

  if (pathname === "/api/admin/quotes/cost-profit" && method === "POST") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const breakdown = body.breakdown || calculateMultiQuote(body);
      return send(res, 200, calculateMultiCostProfit(breakdown));
    } catch {
      return send(res, 400, { error: "计算失败" });
    }
  }

  if (pathname === "/api/admin/pricing" && method === "GET") {
    if (!requireAuth(req, res)) return;
    const agentId = resolveAdminAgentId(url, {});
    return send(res, 200, readAgentFile(agentId, "pricing.json"));
  }

  if (pathname === "/api/admin/pricing" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const agentId = resolveAdminAgentId(url, body);
      writeAgentFile(agentId, "pricing.json", body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/addons" && method === "GET") {
    if (!requireAuth(req, res)) return;
    const agentId = resolveAdminAgentId(url, {});
    return send(res, 200, readAgentFile(agentId, "addons.json"));
  }

  if (pathname === "/api/admin/addons" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: "数据格式错误" });
      const agentId = resolveAdminAgentId(url, body);
      writeAgentFile(agentId, "addons.json", body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/costs" && method === "GET") {
    if (!requireAuth(req, res)) return;
    const agentId = resolveAdminAgentId(url, {});
    return send(res, 200, readAgentFile(agentId, "costs.json"));
  }

  if (pathname === "/api/admin/costs" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const agentId = resolveAdminAgentId(url, body);
      writeAgentFile(agentId, "costs.json", body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  send(res, 404, { error: "Not Found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname, url);
  if (pathname.startsWith("/admin")) {
    const sub = pathname.replace(/^\/admin\/?/, "") || "index.html";
    return serveStatic(ADMIN_DIR, sub, res);
  }
  return serveStatic(PUBLIC_DIR, pathname, res);
});

ensureDataFiles();

server.listen(PORT, "0.0.0.0", () => {
  const platform = readPlatform();
  console.log(`\n  ${platform.platformName}已启动`);
  console.log(`  报价页: http://0.0.0.0:${PORT}`);
  console.log(`  管理后台: http://0.0.0.0:${PORT}/admin/login.html`);
  if (ADMIN_PASSWORD === "admin123") {
    console.log(`  ⚠ 请设置环境变量 ADMIN_PASSWORD 修改默认密码`);
  }
  console.log("");
});
