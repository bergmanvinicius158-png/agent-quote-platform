const TOKEN_KEY = "adminToken";
const STATUS_LABELS = {
  pending: "待处理",
  contacted: "已联系",
  quoted: "已报价",
  won: "已成交",
  lost: "已流失",
};

let quotes = [];
let pricing = null;
let addons = [];
let costs = null;
let currentQuoteId = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...options.headers } });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/admin/login.html";
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

const fmt = (n) => "¥" + (n || 0).toLocaleString("zh-CN");
const fmtPct = (n) => ((n || 0) * 100).toFixed(1) + "%";
const fmtDate = (iso) => new Date(iso).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
const quoteAmount = (q) => q.finalTotal ?? q.contractTotal ?? 0;

function badge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function switchPage(page) {
  document.querySelectorAll(".page-section").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-item[data-page]").forEach((el) => el.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.querySelector(`[data-page="${page}"]`).classList.add("active");
  const titles = {
    dashboard: "数据概览",
    quotes: "报价单管理",
    pricing: "定价规则",
    addons: "增值项管理",
    costs: "成本配置",
    profit: "成本利润分析",
  };
  document.getElementById("page-title").textContent = titles[page];
}

async function loadDashboard() {
  const stats = await api("/api/admin/stats");
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card"><div class="label">总报价单</div><div class="value">${stats.total}</div></div>
    <div class="stat-card"><div class="label">本月新增</div><div class="value accent">${stats.thisMonth}</div></div>
    <div class="stat-card"><div class="label">待处理</div><div class="value">${stats.byStatus.pending || 0}</div></div>
    <div class="stat-card"><div class="label">管道预估</div><div class="value accent">${fmt(stats.pipelineValue)}</div></div>
  `;
  const tbody = document.getElementById("recent-quotes");
  if (!stats.recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无</td></tr>';
    return;
  }
  tbody.innerHTML = stats.recent
    .map(
      (q) => `<tr>
      <td>${q.name}<br><small style="color:var(--text-muted)">${q.company || q.email}</small></td>
      <td>${q.storeCount} 店 / ${q.contractYears} 年</td>
      <td>${fmt(quoteAmount(q))}</td>
      <td>${badge(q.status)}</td>
      <td>${fmtDate(q.createdAt)}</td>
    </tr>`
    )
    .join("");
}

function renderQuotesTable(filter = "") {
  const filtered = filter ? quotes.filter((q) => q.status === filter) : quotes;
  const tbody = document.getElementById("quotes-table");
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map(
      (q) => `<tr>
      <td>${q.name}</td>
      <td>${q.company || "—"}</td>
      <td>${q.storeCount} 店 / ${q.tierLabel || "—"} / ${q.contractYears} 年</td>
      <td>${fmt(quoteAmount(q))}</td>
      <td>${badge(q.status)}</td>
      <td>${fmtDate(q.createdAt)}</td>
      <td><button class="btn btn-ghost btn-sm" data-view="${q.id}">查看</button></td>
    </tr>`
    )
    .join("");
  tbody.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => openQuoteModal(btn.dataset.view));
  });
}

function renderBreakdown(breakdown) {
  if (!breakdown?.sections) return "";
  return breakdown.sections
    .map((s) => {
      let amount = s.amount;
      if (s.id === "subscription") amount = s.contractAmount;
      if (s.id === "addons") amount = s.contractAmount;
      const lines =
        s.lines?.map((l) => `<li>${l.name} × ${l.qty} = ${fmt(l.amount)}</li>`).join("") ||
        s.items?.map((a) => `<li>${a.name} ${fmt(a.contractAmount || a.monthlyPrice)}/月</li>`).join("") ||
        "";
      return `<div class="breakdown-block"><strong>${s.title}</strong> ${fmt(amount)}<ul>${lines}</ul></div>`;
    })
    .join("");
}

function openQuoteModal(id) {
  const q = quotes.find((x) => x.id === id);
  if (!q) return;
  currentQuoteId = id;
  document.getElementById("quote-detail").innerHTML = `
    <div class="detail-row"><span class="label">客户</span><span>${q.name} / ${q.email}</span></div>
    <div class="detail-row"><span class="label">企业</span><span>${q.company || "—"}</span></div>
    <div class="detail-row"><span class="label">门店</span><span>${q.storeCount} 家（${q.tierLabel}）</span></div>
    <div class="detail-row"><span class="label">合同年限</span><span>${q.contractYears} 年</span></div>
    <div class="detail-row"><span class="label">对接套数</span><span>${q.integrationCount} 套</span></div>
    <div class="detail-row"><span class="label">建模实施费</span><span>${fmt(q.implementationTotal)}</span></div>
    <div class="detail-row"><span class="label">合同总金额</span><span>${fmt(q.contractTotal)}</span></div>
    <div class="detail-row"><span class="label">首年预算</span><span>${fmt(q.firstYearBudget)}</span></div>
    <div class="detail-row"><span class="label">备注</span><span>${q.notes || "—"}</span></div>
  `;
  document.getElementById("quote-breakdown").innerHTML = renderBreakdown(q.breakdown);
  document.getElementById("modal-status").value = q.status;
  document.getElementById("modal-final-total").value = q.finalTotal || "";
  document.getElementById("modal-notes").value = q.adminNotes || "";
  document.getElementById("quote-modal").classList.add("open");
}

function renderPricingEditor() {
  document.getElementById("pricing-editor").innerHTML = `
    <div class="editor-block">
      <h4>全局参数</h4>
      <div class="editor-grid">
        <div><label>年付折扣</label><input data-global="annualPayDiscount" type="number" step="0.01" value="${pricing.annualPayDiscount}" /></div>
        <div><label>产品名称</label><input data-global="productName" value="${pricing.productName}" /></div>
      </div>
    </div>
    <div class="editor-block">
      <h4>实施费明细</h4>
      ${pricing.implementationItems
        .map(
          (item, i) => `
        <div class="editor-grid" style="margin-bottom:0.5rem;" data-impl="${i}">
          <div><label>${item.name} 单价</label><input data-field="unitPrice" type="number" value="${item.unitPrice}" /></div>
          <div><label>默认数量</label><input data-field="defaultQty" type="number" value="${item.defaultQty}" /></div>
          <div style="grid-column:1/-1"><label>说明</label><input data-field="description" value="${item.description}" /></div>
        </div>`
        )
        .join("")}
    </div>
    <div class="editor-block">
      <h4>订阅分档</h4>
      ${pricing.subscriptionTiers
        .filter((t) => !t.customQuote)
        .map(
          (t, i) => `
        <div class="editor-grid" style="margin-bottom:0.5rem;" data-tier="${i}">
          <div><label>${t.name} 最低价</label><input data-field="pricePerStore" type="number" value="${t.pricePerStore}" /></div>
          <div><label>门店上限</label><input data-field="maxStores" type="number" value="${t.maxStores}" /></div>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderAddonsEditor() {
  document.getElementById("addons-editor").innerHTML = addons
    .map(
      (a, i) => `
    <div class="editor-block" data-addon="${i}">
      <h4>${a.name}</h4>
      <div class="editor-grid">
        <div><label>名称</label><input data-field="name" value="${a.name}" /></div>
        <div><label>月费</label><input data-field="monthlyPrice" type="number" value="${a.monthlyPrice}" /></div>
        <div style="grid-column:1/-1"><label>说明</label><textarea data-field="description" rows="2">${a.description}</textarea></div>
      </div>
    </div>`
    )
    .join("");
}

function renderCostsEditor() {
  document.getElementById("costs-editor").innerHTML = costs.costItems
    .map(
      (c, i) => `
    <div class="editor-block" data-cost="${i}">
      <h4>${c.name}</h4>
      <div class="editor-grid">
        <div><label>单价</label><input data-field="unitPrice" type="number" value="${c.unitPrice}" /></div>
        <div><label>数量${
          c.quantityFields
            ? "（门店数×合同月数，自动计算）"
            : c.quantityField
              ? "（合同月数自动）"
              : ""
        }</label><input data-field="quantity" type="number" value="${c.quantity ?? ""}" ${
          c.quantityField || c.quantityFields ? "disabled" : ""
        } /></div>
        <div style="grid-column:1/-1"><label>说明</label><input data-field="description" value="${c.description}" /></div>
      </div>
    </div>`
    )
    .join("");
}

function collectPricing() {
  const result = JSON.parse(JSON.stringify(pricing));
  document.querySelectorAll("[data-global]").forEach((el) => {
    const key = el.dataset.global;
    result[key] = key === "annualPayDiscount" ? Number(el.value) : el.value;
  });
  document.querySelectorAll("[data-impl]").forEach((el) => {
    const i = Number(el.dataset.impl);
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      result.implementationItems[i][f] =
        f === "unitPrice" || f === "defaultQty" ? Number(input.value) : input.value;
    });
  });
  const tiers = result.subscriptionTiers.filter((t) => !t.customQuote);
  document.querySelectorAll("[data-tier]").forEach((el) => {
    const i = Number(el.dataset.tier);
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      tiers[i][f] = Number(input.value);
    });
  });
  return result;
}

function collectAddons() {
  return [...document.querySelectorAll("[data-addon]")].map((el, i) => {
    const base = { ...addons[i] };
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      base[f] = f === "monthlyPrice" ? Number(input.value) : input.value;
    });
    return base;
  });
}

function collectCosts() {
  const result = JSON.parse(JSON.stringify(costs));
  document.querySelectorAll("[data-cost]").forEach((el) => {
    const i = Number(el.dataset.cost);
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      if (f === "quantity" && (result.costItems[i].quantityField || result.costItems[i].quantityFields)) return;
      result.costItems[i][f] = f === "unitPrice" || f === "quantity" ? Number(input.value) : input.value;
    });
  });
  return result;
}

function populateProfitSelect() {
  const sel = document.getElementById("profit-quote-select");
  sel.innerHTML =
    '<option value="">选择报价单…</option>' +
    quotes
      .map((q) => `<option value="${q.id}">${q.company || q.name} — ${q.storeCount}店 — ${fmt(q.contractTotal)}</option>`)
      .join("");
}

async function renderProfit(quoteId) {
  const q = quotes.find((x) => x.id === quoteId);
  if (!q?.breakdown) {
    document.getElementById("profit-result").innerHTML = '<p class="empty-state">无有效报价数据</p>';
    return;
  }
  const profit = await api("/api/admin/quotes/cost-profit", {
    method: "POST",
    body: JSON.stringify({
      breakdown: q.breakdown,
      storeCount: q.storeCount,
      contractYears: q.contractYears,
      contractMonths: q.breakdown?.contractMonths,
      addonIds: q.addonIds ?? q.breakdown?.addonIds ?? [],
    }),
  });

  document.getElementById("profit-result").innerHTML = `
    <h4 style="margin:0 0 0.75rem;font-size:0.875rem;">▌ 收入引用</h4>
    <div class="profit-grid">
      <div class="profit-metric"><label>建模实施费</label><strong>${fmt(profit.revenue.implementation)}</strong></div>
      <div class="profit-metric"><label>订阅费（合同期）</label><strong>${fmt(profit.revenue.subscription)}</strong></div>
      <div class="profit-metric"><label>增值服务费</label><strong>${fmt(profit.revenue.addons)}</strong></div>
      <div class="profit-metric"><label>合同期总收入</label><strong>${fmt(profit.revenue.total)}</strong></div>
    </div>
    <h4 style="margin:1rem 0 0.75rem;font-size:0.875rem;">▌ 成本明细</h4>
    <div class="table-wrap">
      <table>
        <thead><tr><th>成本项</th><th>单价</th><th>数量</th><th>小计</th></tr></thead>
        <tbody>
          ${profit.costLines.map((c) => `<tr><td>${c.name}</td><td>${fmt(c.unitPrice)}</td><td>${c.qtyLabel || `${c.qty} ${c.unit || ""}`}</td><td>${fmt(c.amount)}</td></tr>`).join("")}
          <tr style="font-weight:700;background:#f8fafc"><td colspan="3">合同期总成本</td><td>${fmt(profit.totalCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <h4 style="margin:1rem 0 0.75rem;font-size:0.875rem;">▌ 利润分析总览</h4>
    <div class="profit-grid">
      <div class="profit-metric positive"><label>毛利润</label><strong>${fmt(profit.grossProfit)}</strong></div>
      <div class="profit-metric"><label>整体利润率</label><strong>${fmtPct(profit.margin)}</strong></div>
      <div class="profit-metric"><label>实施阶段利润率</label><strong>${fmtPct(profit.implMargin)}</strong></div>
      <div class="profit-metric"><label>订阅阶段利润率</label><strong>${fmtPct(profit.subMargin)}</strong></div>
      <div class="profit-metric"><label>盈亏平衡月数</label><strong>${profit.breakEvenMonths ? profit.breakEvenMonths.toFixed(1) + " 月" : "—"}</strong></div>
    </div>`;
}

async function init() {
  if (!getToken()) {
    location.href = "/admin/login.html";
    return;
  }

  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.dataset.page));
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", headers: authHeaders() });
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/admin/login.html";
  });

  document.getElementById("status-filter").addEventListener("change", (e) => renderQuotesTable(e.target.value));
  document.getElementById("modal-close").addEventListener("click", () => document.getElementById("quote-modal").classList.remove("open"));

  document.getElementById("modal-save").addEventListener("click", async () => {
    const payload = {
      status: document.getElementById("modal-status").value,
      adminNotes: document.getElementById("modal-notes").value,
    };
    const final = document.getElementById("modal-final-total").value;
    if (final) payload.finalTotal = Number(final);
    await api(`/api/admin/quotes/${currentQuoteId}`, { method: "PATCH", body: JSON.stringify(payload) });
    document.getElementById("quote-modal").classList.remove("open");
    quotes = await api("/api/admin/quotes");
    renderQuotesTable(document.getElementById("status-filter").value);
    populateProfitSelect();
    loadDashboard();
  });

  document.getElementById("save-pricing").addEventListener("click", async () => {
    pricing = collectPricing();
    await api("/api/admin/pricing", { method: "PUT", body: JSON.stringify(pricing) });
    alert("已保存");
  });

  document.getElementById("save-addons").addEventListener("click", async () => {
    addons = collectAddons();
    await api("/api/admin/addons", { method: "PUT", body: JSON.stringify(addons) });
    alert("已保存");
  });

  document.getElementById("save-costs").addEventListener("click", async () => {
    costs = collectCosts();
    await api("/api/admin/costs", { method: "PUT", body: JSON.stringify(costs) });
    alert("已保存");
  });

  document.getElementById("profit-quote-select").addEventListener("change", (e) => {
    if (e.target.value) renderProfit(e.target.value);
  });

  document.getElementById("calc-profit").addEventListener("click", () => {
    const id = document.getElementById("profit-quote-select").value;
    if (id) renderProfit(id);
  });

  try {
    [quotes, pricing, addons, costs] = await Promise.all([
      api("/api/admin/quotes"),
      api("/api/admin/pricing"),
      api("/api/admin/addons"),
      api("/api/admin/costs"),
    ]);

    await loadDashboard();
    renderQuotesTable();
    renderPricingEditor();
    renderAddonsEditor();
    renderCostsEditor();
    populateProfitSelect();
  } catch (err) {
    if (getToken()) {
      console.error(err);
      document.querySelector(".page-body").innerHTML =
        `<div class="panel"><div class="panel-body empty-state">加载失败：${err.message || "请刷新页面或重新登录"}</div></div>`;
    }
  }
}

init();
