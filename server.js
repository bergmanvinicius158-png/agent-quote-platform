const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3456;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");

const sessions = new Map();

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const defaults = { "quotes.json": "[]\n" };
  for (const [file, content] of Object.entries(defaults)) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, "utf8");
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf8");
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

function getSubscriptionTier(pricing, storeCount) {
  for (const tier of pricing.subscriptionTiers) {
    if (tier.customQuote) continue;
    if (storeCount >= tier.minStores && (tier.maxStores == null || storeCount <= tier.maxStores)) {
      return tier;
    }
  }
  return pricing.subscriptionTiers.find((t) => t.customQuote) || null;
}

function calculateQuote(input) {
  const pricing = readJson("pricing.json");
  const addons = readJson("addons.json");

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
  const customQuote = tier?.customQuote === true;

  let monthlyPerStore = tier?.pricePerStore ?? 0;
  let monthlySubscription = customQuote ? null : storeCount * monthlyPerStore;
  let yearlySubscription = customQuote ? null : monthlySubscription * 12;
  let contractSubscription = customQuote ? null : monthlySubscription * contractMonths;
  let annualPayAmount = customQuote ? null : Math.round(yearlySubscription * pricing.annualPayDiscount);
  let annualPaySavings = customQuote ? null : yearlySubscription - annualPayAmount;

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
  if (Array.isArray(input?.addonIds) && input.addonIds.length) return input.addonIds;
  const addonsSection = input?.sections?.find((s) => s.id === "addons");
  if (addonsSection?.items?.length) return addonsSection.items.map((i) => i.id);
  return [];
}

function isCostItemApplicable(item, addonIds) {
  if (!item.requiresAddon) return true;
  return addonIds.includes(item.requiresAddon);
}

function normalizeRevenueForCost(input) {
  const base = input?.summary ? input : input || {};
  const summary = base.summary || {};
  const contractYears = Number(base.contractYears ?? input?.contractYears) || 2;
  const contractMonths =
    Number(base.contractMonths ?? input?.contractMonths) || contractYears * 12;
  return {
    ...base,
    summary,
    storeCount: Number(base.storeCount ?? input?.storeCount) || 1,
    contractYears,
    contractMonths,
    addonIds: extractAddonIds(base).length ? extractAddonIds(base) : extractAddonIds(input),
  };
}

function calculateCostProfit(revenueInput) {
  const revenue = normalizeRevenueForCost(revenueInput);
  const costsConfig = readJson("costs.json");
  const contractMonths = revenue.contractMonths;
  const addonIds = revenue.addonIds || [];
  const implRev = revenue.summary.implementationTotal;
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
    revenue: {
      implementation: implRev,
      subscription: subRev,
      addons: addonRev,
      total: totalRev,
    },
    costLines,
    totalCost,
    grossProfit,
    margin,
    implMargin,
    subMargin,
    breakEvenMonths,
  };
}

function quotePipelineValue(q) {
  return q.finalTotal ?? q.contractTotal ?? q.firstYearTotal ?? 0;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === "/api/pricing" && method === "GET") {
    return send(res, 200, readJson("pricing.json"));
  }

  if (pathname === "/api/addons" && method === "GET") {
    return send(res, 200, readJson("addons.json"));
  }

  if (pathname === "/api/calculate" && method === "POST") {
    try {
      const body = await parseBody(req);
      return send(res, 200, calculateQuote(body));
    } catch {
      return send(res, 400, { error: "请求格式错误" });
    }
  }

  if (pathname === "/api/quotes" && method === "POST") {
    try {
      const body = await parseBody(req);
      const { name, email, company, phone, storeCount, contractYears, integrationCount, addonIds, notes } = body;
      if (!name || !email) {
        return send(res, 400, { error: "请填写联系人和邮箱" });
      }
      const calc = calculateQuote({ storeCount, contractYears, integrationCount, addonIds });
      if (calc.customQuote) {
        return send(res, 400, { error: "门店数超过 1000 家，请联系商务获取专属报价" });
      }

      const quote = {
        id: generateId("q"),
        name,
        email,
        company: company || "",
        phone: phone || "",
        storeCount: calc.storeCount,
        contractYears: calc.contractYears,
        integrationCount: calc.integrationCount,
        tierLabel: calc.tier?.label || "",
        addonIds: addonIds || [],
        notes: notes || "",
        breakdown: calc,
        implementationTotal: calc.summary.implementationTotal,
        contractTotal: calc.summary.contractTotal,
        firstYearBudget: calc.summary.firstYearBudget,
        monthlySubscription: calc.summary.monthlySubscription,
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
    });
  }

  if (pathname === "/api/admin/quotes" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readJson("quotes.json"));
  }

  const quoteMatch = pathname.match(/^\/api\/admin\/quotes\/([^/]+)$/);
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

  if (pathname === "/api/admin/quotes/cost-profit" && method === "POST") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      const calc = body.breakdown || calculateQuote(body);
      const merged = {
        ...calc,
        storeCount: calc.storeCount ?? body.storeCount,
        contractYears: calc.contractYears ?? body.contractYears,
        contractMonths:
          calc.contractMonths ??
          body.contractMonths ??
          (calc.contractYears ?? body.contractYears ?? 2) * 12,
        addonIds: body.addonIds ?? calc.addonIds ?? extractAddonIds(calc),
      };
      return send(res, 200, calculateCostProfit(merged));
    } catch {
      return send(res, 400, { error: "计算失败" });
    }
  }

  if (pathname === "/api/admin/pricing" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readJson("pricing.json"));
  }

  if (pathname === "/api/admin/pricing" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      writeJson("pricing.json", body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/addons" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readJson("addons.json"));
  }

  if (pathname === "/api/admin/addons" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: "数据格式错误" });
      writeJson("addons.json", body);
      return send(res, 200, body);
    } catch {
      return send(res, 400, { error: "保存失败" });
    }
  }

  if (pathname === "/api/admin/costs" && method === "GET") {
    if (!requireAuth(req, res)) return;
    return send(res, 200, readJson("costs.json"));
  }

  if (pathname === "/api/admin/costs" && method === "PUT") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await parseBody(req);
      writeJson("costs.json", body);
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  if (pathname.startsWith("/admin")) {
    const sub = pathname.replace(/^\/admin\/?/, "") || "index.html";
    return serveStatic(ADMIN_DIR, sub, res);
  }
  return serveStatic(PUBLIC_DIR, pathname, res);
});

ensureDataFiles();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  智能排班智能体报价平台已启动`);
  console.log(`  报价页: http://0.0.0.0:${PORT}`);
  console.log(`  管理后台: http://0.0.0.0:${PORT}/admin/login.html`);
  if (ADMIN_PASSWORD === "admin123") {
    console.log(`  ⚠ 请设置环境变量 ADMIN_PASSWORD 修改默认密码`);
  }
  console.log("");
});
