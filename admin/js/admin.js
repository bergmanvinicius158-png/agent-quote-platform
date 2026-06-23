const TOKEN_KEY = "adminToken";
const DEFAULT_AGENT_ID = "scheduling-agent";
const STATUS_LABELS = {
  pending: "待处理",
  contacted: "已联系",
  quoted: "已报价",
  won: "已成交",
  lost: "已流失",
};

let quotes = [];
let platform = null;
let agents = [];
let currentAgentId = DEFAULT_AGENT_ID;
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

const fmt = (n) => "¥" + (Number(n) || 0).toLocaleString("zh-CN");
const fmtPct = (n) => ((n || 0) * 100).toFixed(1) + "%";
const fmtDate = (iso) => new Date(iso).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });

function quoteAmount(q) {
  return q.finalTotal ?? q.contractTotal ?? q.breakdown?.combinedSummary?.contractTotal ?? 0;
}

function getQuoteAgentIds(q) {
  if (q.agentIds?.length) return q.agentIds;
  if (q.breakdown?.agentIds?.length) return q.breakdown.agentIds;
  return ["scheduling-agent"];
}

function agentBadges(q) {
  const ids = getQuoteAgentIds(q);
  return ids
    .map((id) => {
      const meta = agents.find((a) => a.id === id);
      return `<span class="badge badge-agent">${meta?.shortName || meta?.name || id}</span>`;
    })
    .join(" ");
}

function normalizeBreakdown(breakdown) {
  if (!breakdown) return null;
  if (breakdown.agents?.length) return breakdown;
  if (breakdown.sections?.length) {
    return {
      ...breakdown,
      agents: [{ agentId: DEFAULT_AGENT_ID, ...breakdown }],
      combinedSummary: breakdown.summary,
      bundleDiscount: { savings: 0, label: null },
    };
  }
  return breakdown;
}

function badge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function updateAgentContextUI() {
  const meta = agents.find((a) => a.id === currentAgentId);
  ["config-agent-name", "config-agent-name-addons", "config-agent-name-costs"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = meta?.name || "—";
  });
  populateAgentSelects();
}

function getCurrentAgentName() {
  return agents.find((a) => a.id === currentAgentId)?.name || "当前智能体";
}

function bindAgentSelectEvents() {
  document.getElementById("agent-config-select")?.addEventListener("change", (e) => {
    switchAgentConfig(e.target.value);
  });
  ["pricing-agent-select", "addons-agent-select", "costs-agent-select"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      switchAgentConfig(e.target.value);
    });
  });
}

function populateAgentSelects() {
  const options = agents
    .filter((a) => a.enabled !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((a) => `<option value="${a.id}">${a.icon || "智"} ${a.name}</option>`)
    .join("");
  ["agent-config-select", "pricing-agent-select", "addons-agent-select", "costs-agent-select"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = options;
    el.value = currentAgentId;
  });
}

async function switchAgentConfig(agentId) {
  if (!agentId || agentId === currentAgentId) return;
  await loadAgentConfig(agentId);
}

function switchPage(page) {
  document.querySelectorAll(".page-section").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-item[data-page]").forEach((el) => el.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add("active");
  const titles = {
    dashboard: "数据概览",
    quotes: "报价单管理",
    agents: "智能体管理",
    platform: "平台设置",
    pricing: "定价规则",
    addons: "增值项管理",
    costs: "成本配置",
    profit: "成本利润分析",
  };
  document.getElementById("page-title").textContent = titles[page] || page;
}

async function loadAgentConfig(agentId) {
  currentAgentId = agentId;
  updateAgentContextUI();
  [pricing, addons, costs] = await Promise.all([
    api(`/api/admin/agents/${agentId}/pricing`),
    api(`/api/admin/agents/${agentId}/addons`),
    api(`/api/admin/agents/${agentId}/costs`),
  ]);
  renderPricingEditor();
  renderAddonsEditor();
  renderCostsEditor();
}

async function loadDashboard() {
  const stats = await api("/api/admin/stats");
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card"><div class="label">总报价单</div><div class="value">${stats.total}</div></div>
    <div class="stat-card"><div class="label">本月新增</div><div class="value accent">${stats.thisMonth}</div></div>
    <div class="stat-card"><div class="label">待处理</div><div class="value">${stats.byStatus.pending || 0}</div></div>
    <div class="stat-card"><div class="label">启用智能体</div><div class="value accent">${stats.agentCount || agents.filter((a) => a.enabled !== false).length}</div></div>
    <div class="stat-card"><div class="label">管道预估</div><div class="value accent">${fmt(stats.pipelineValue)}</div></div>
  `;
  const tbody = document.getElementById("recent-quotes");
  if (!stats.recent.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无</td></tr>';
    return;
  }
  tbody.innerHTML = stats.recent
    .map(
      (q) => `<tr>
      <td>${q.name}<br><small style="color:var(--text-muted)">${q.company || q.email}</small></td>
      <td>${agentBadges(q)}</td>
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
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map(
      (q) => `<tr>
      <td>${q.name}</td>
      <td>${q.company || "—"}</td>
      <td>${agentBadges(q)}</td>
      <td>${q.storeCount} 店 / ${q.contractYears} 年</td>
      <td>${fmt(quoteAmount(q))}</td>
      <td>${badge(q.status)}</td>
      <td>${fmtDate(q.createdAt)}</td>
      <td class="action-btns">
        <button type="button" class="btn btn-ghost btn-sm" data-view="${q.id}">查看</button>
        <button type="button" class="btn btn-primary btn-sm" data-doc="${q.id}">生成报价单</button>
        <button type="button" class="btn btn-danger btn-sm" data-delete="${q.id}">删除</button>
      </td>
    </tr>`
    )
    .join("");
  tbody.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => openQuoteModal(btn.dataset.view));
  });
  tbody.querySelectorAll("[data-doc]").forEach((btn) => {
    btn.addEventListener("click", () => openQuoteDocument(btn.dataset.doc));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteQuote(btn.dataset.delete));
  });
}

function openQuoteDocument(id) {
  const url = `/admin/quote-document.html?id=${encodeURIComponent(id)}`;
  const win = window.open(url, "_blank");
  if (!win) location.href = url;
}

async function deleteQuote(id) {
  const q = quotes.find((x) => x.id === id);
  if (!q) return;
  const label = q.company || q.name || q.email;
  if (!confirm(`确定删除报价单「${label}」？此操作不可恢复。`)) return;
  try {
    await api(`/api/admin/quotes/${id}`, { method: "DELETE" });
    if (currentQuoteId === id) {
      document.getElementById("quote-modal").classList.remove("open");
      currentQuoteId = null;
    }
    quotes = await api("/api/admin/quotes");
    renderQuotesTable(document.getElementById("status-filter").value);
    populateProfitSelect();
    await loadDashboard();
  } catch (err) {
    alert(err.message || "删除失败");
  }
}

function renderBreakdown(breakdown) {
  const b = normalizeBreakdown(breakdown);
  if (!b?.agents?.length) return "";
  return b.agents
    .map((agent) => {
      const sections = agent.sections || [];
      const blocks = sections
        .map((s) => {
          let amount = s.amount;
          if (s.id === "subscription" || s.id === "addons") amount = s.contractAmount;
          const lines =
            s.lines?.map((l) => `<li>${l.name} × ${l.qty} = ${fmt(l.amount)}</li>`).join("") ||
            s.items?.map((a) => `<li>${a.name} ${fmt(a.contractAmount || a.monthlyPrice)}</li>`).join("") ||
            "";
          return `<div class="breakdown-block"><strong>${s.title}</strong> ${fmt(amount)}<ul>${lines}</ul></div>`;
        })
        .join("");
      return `<div class="breakdown-agent"><h4>${agent.agentName || agent.productName}</h4>${blocks}
        <p><strong>小计：</strong>${fmt(agent.summary?.contractTotal)}</p></div>`;
    })
    .join("") +
    (b.bundleDiscount?.savings
      ? `<div class="breakdown-block discount"><strong>组合折扣</strong> -${fmt(b.bundleDiscount.savings)} (${b.bundleDiscount.label || ""})</div>`
      : "") +
    `<div class="breakdown-block total"><strong>合同总金额</strong> ${fmt(b.combinedSummary?.contractTotal ?? b.summary?.contractTotal)}</div>`;
}

function openQuoteModal(id) {
  const q = quotes.find((x) => x.id === id);
  if (!q) return;
  currentQuoteId = id;
  const b = normalizeBreakdown(q.breakdown);
  document.getElementById("quote-detail").innerHTML = `
    <div class="detail-row"><span class="label">客户</span><span>${q.name} / ${q.email}</span></div>
    <div class="detail-row"><span class="label">企业</span><span>${q.company || "—"}</span></div>
    <div class="detail-row"><span class="label">智能体</span><span>${agentBadges(q)}</span></div>
    <div class="detail-row"><span class="label">门店</span><span>${q.storeCount} 家（${q.tierLabel || "—"}）</span></div>
    <div class="detail-row"><span class="label">合同年限</span><span>${q.contractYears} 年</span></div>
    <div class="detail-row"><span class="label">对接套数</span><span>${q.integrationCount} 套</span></div>
    <div class="detail-row"><span class="label">实施费合计</span><span>${fmt(b?.combinedSummary?.implementationTotal ?? q.implementationTotal)}</span></div>
    <div class="detail-row"><span class="label">合同总金额</span><span>${fmt(quoteAmount(q))}</span></div>
    <div class="detail-row"><span class="label">首年预算</span><span>${fmt(b?.combinedSummary?.firstYearBudget ?? q.firstYearBudget)}</span></div>
    <div class="detail-row"><span class="label">备注</span><span>${q.notes || "—"}</span></div>
  `;
  document.getElementById("quote-breakdown").innerHTML = renderBreakdown(q.breakdown);
  document.getElementById("modal-status").value = q.status;
  document.getElementById("modal-final-total").value = q.finalTotal || "";
  document.getElementById("modal-notes").value = q.adminNotes || "";
  document.getElementById("quote-modal").classList.add("open");
}

function renderAgentsList() {
  const container = document.getElementById("agents-list");
  if (!agents.length) {
    container.innerHTML = '<p class="empty-state">暂无智能体</p>';
    return;
  }
  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>名称</th><th>简介</th><th>状态</th><th>排序</th><th>操作</th></tr></thead>
    <tbody>${agents
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(
        (a) => `<tr>
        <td><span class="agent-list-icon">${a.icon || "智"}</span> ${a.name}<br><small>${a.id}</small></td>
        <td>${a.description || "—"}</td>
        <td>${a.enabled !== false ? '<span class="badge badge-quoted">启用</span>' : '<span class="badge badge-lost">停用</span>'}</td>
        <td>${a.sortOrder ?? "—"}</td>
        <td class="action-btns">
          <button type="button" class="btn btn-ghost btn-sm" data-config-agent="${a.id}">配置</button>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-agent="${a.id}">${a.enabled !== false ? "停用" : "启用"}</button>
        </td>
      </tr>`
      )
      .join("")}</tbody></table></div>`;

  container.querySelectorAll("[data-config-agent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadAgentConfig(btn.dataset.configAgent);
      switchPage("pricing");
    });
  });
  container.querySelectorAll("[data-toggle-agent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const a = agents.find((x) => x.id === btn.dataset.toggleAgent);
      await api(`/api/admin/agents/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: a.enabled === false }),
      });
      agents = await api("/api/admin/agents");
      renderAgentsList();
    });
  });
}

function formatDiscountLabel(rate) {
  const pct = Math.round((Number(rate) || 0) * 1000) / 10;
  return `${pct} 折`;
}

function formatIncrementalRate(rate) {
  const pct = Math.round((Number(rate) || 0) * 1000) / 10;
  return `+${pct}%`;
}

function formatScalingFactorPreview(rate, agentCount = 3) {
  const factor = 1 + Math.max(0, agentCount - 1) * (Number(rate) || 0);
  return `${agentCount} 个智能体 = ${Math.round(factor * 1000) / 10}%`;
}

function renderPlatformEditor() {
  const rules = platform.bundleDiscounts || [];
  const scaling = platform.sharedCostScaling || [];
  document.getElementById("platform-editor").innerHTML = `
    <div class="editor-block">
      <h4>基本信息</h4>
      <div class="editor-grid">
        <div><label>平台名称</label><input data-platform="platformName" value="${platform.platformName || ""}" /></div>
        <div><label>副标题</label><input data-platform="tagline" value="${platform.tagline || ""}" /></div>
        <div><label>商务邮箱</label><input data-platform="salesEmail" value="${platform.salesEmail || ""}" /></div>
        <div><label>组合折扣作用范围</label>
          <select data-platform="bundleDiscountApplyTo">
            <option value="subscription" ${platform.bundleDiscountApplyTo === "subscription" ? "selected" : ""}>仅订阅费（合同期）</option>
            <option value="total" ${platform.bundleDiscountApplyTo === "total" ? "selected" : ""}>合同总价（实施+订阅+增值）</option>
          </select>
        </div>
      </div>
    </div>
    <div class="editor-block">
      <div class="panel-header" style="padding:0;margin-bottom:0.5rem;border:none;background:transparent;">
        <h4 style="margin:0;">组合购买折扣规则</h4>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-bundle">+ 添加规则</button>
      </div>
      <p class="editor-hint">客户同时选购多个智能体时，按<strong>选中数量</strong>匹配「最少智能体数 ≤ 选中数」中最高的一档折扣。规则按最少智能体数从大到小匹配。</p>
      <div class="table-wrap">
        <table class="tier-edit-table">
          <thead>
            <tr>
              <th>最少智能体数</th>
              <th>折扣率</th>
              <th>折算</th>
              <th>显示标签（报价页展示）</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="bundle-rules-body">
            ${rules
              .map(
                (r, i) => `
              <tr data-bundle="${i}">
                <td><input data-field="minAgents" type="number" min="2" value="${r.minAgents}" /></td>
                <td><input data-field="discountRate" type="number" step="0.01" min="0.01" max="1" value="${r.discountRate}" /></td>
                <td class="discount-preview">${formatDiscountLabel(r.discountRate)}</td>
                <td><input data-field="label" value="${r.label || ""}" style="width:100%;" placeholder="如：3 个智能体组合 92 折" /></td>
                <td><button type="button" class="btn btn-ghost btn-sm btn-remove-bundle" ${rules.length <= 1 ? "disabled" : ""}>删除</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="editor-block">
      <h4>多智能体共享成本递增规则</h4>
      <p class="editor-hint">客户同时选购多个智能体时，下列成本项按<strong>复用递增</strong>合并计费（非简单叠加）：<br>
        合并成本 = 各产品中该项的<strong>最高基准值</strong> × (1 + (N−1) × 增量比例)，N 为选中智能体数量。<br>
        其余成本项（实施、AI Token、研发摊销等）仍按各智能体分别累加。</p>
      <div class="table-wrap">
        <table class="tier-edit-table">
          <thead>
            <tr>
              <th>成本项名称</th>
              <th>成本 ID</th>
              <th>每增 1 个智能体增量</th>
              <th>3 个智能体折算</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody id="shared-cost-scaling-body">
            ${scaling
              .map(
                (r, i) => `
              <tr data-shared-cost="${i}">
                <td><input data-field="name" value="${r.name || ""}" style="width:100%;" /></td>
                <td><input data-field="costItemId" value="${r.costItemId || ""}" style="width:5rem;" title="对应各产品 costs.json 中的 id" /></td>
                <td><input data-field="incrementalRatePerAgent" type="number" step="0.01" min="0" max="2" value="${r.incrementalRatePerAgent ?? 0}" /> <span class="incremental-preview">${formatIncrementalRate(r.incrementalRatePerAgent)}</span></td>
                <td class="scaling-factor-preview">${formatScalingFactorPreview(r.incrementalRatePerAgent)}</td>
                <td><input data-field="description" value="${r.description || ""}" style="width:100%;" /></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  bindPlatformEditorEvents();
}

function bindPlatformEditorEvents() {
  document.getElementById("btn-add-bundle")?.addEventListener("click", () => {
    platform = collectPlatform();
    const maxMin = Math.max(0, ...(platform.bundleDiscounts || []).map((r) => r.minAgents || 0));
    platform.bundleDiscounts.push({
      minAgents: maxMin + 1,
      discountRate: 0.9,
      label: `${maxMin + 1} 个智能体组合 90 折`,
    });
    renderPlatformEditor();
  });
  document.querySelectorAll(".btn-remove-bundle").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ((platform.bundleDiscounts || []).length <= 1) return;
      platform = collectPlatform();
      const row = btn.closest("[data-bundle]");
      platform.bundleDiscounts.splice(Number(row.dataset.bundle), 1);
      renderPlatformEditor();
    });
  });
  document.querySelectorAll("#bundle-rules-body [data-field='discountRate']").forEach((input) => {
    input.addEventListener("input", () => {
      const preview = input.closest("tr")?.querySelector(".discount-preview");
      if (preview) preview.textContent = formatDiscountLabel(input.value);
    });
  });
  document.querySelectorAll("#shared-cost-scaling-body [data-field='incrementalRatePerAgent']").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest("tr");
      const incPreview = row?.querySelector(".incremental-preview");
      const factorPreview = row?.querySelector(".scaling-factor-preview");
      if (incPreview) incPreview.textContent = formatIncrementalRate(input.value);
      if (factorPreview) factorPreview.textContent = formatScalingFactorPreview(input.value);
    });
  });
}

function collectPlatform() {
  const result = JSON.parse(JSON.stringify(platform));
  document.querySelectorAll("[data-platform]").forEach((el) => {
    result[el.dataset.platform] = el.value;
  });
  result.bundleDiscounts = [...document.querySelectorAll("[data-bundle]")].map((el) => {
    const row = {};
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      row[f] = f === "label" ? input.value : Number(input.value);
    });
    return row;
  });
  result.sharedCostScaling = [...document.querySelectorAll("[data-shared-cost]")].map((el) => {
    const row = {};
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      row[f] =
        f === "incrementalRatePerAgent" ? Number(input.value) : input.value;
    });
    return row;
  });
  return result;
}

function formatTierRangeHint(t) {
  if (t.maxStores == null) return `${Number(t.minStores).toLocaleString()} 家以上`;
  if (t.minStores === 1) return `≤${Number(t.maxStores).toLocaleString()} 家`;
  return `${Number(t.minStores).toLocaleString()}–${Number(t.maxStores).toLocaleString()} 家`;
}

function renderPricingEditor() {
  if (!pricing) return;
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
      <h4>数字员工订阅费分档（按门店数 × 月收取）</h4>
      <p class="editor-hint">以下配置<strong>仅作用于当前选中的智能体</strong>，与其他产品互不影响。保存后公开报价页实时生效。</p>
      <div class="table-wrap">
        <table class="tier-edit-table">
          <thead>
            <tr>
              <th>档位</th>
              <th>门店下限</th>
              <th>门店上限</th>
              <th>月单价（元/店/月）</th>
              <th>计费特点</th>
            </tr>
          </thead>
          <tbody>
            ${pricing.subscriptionTiers
              .map(
                (t, i) => `
              <tr data-tier="${i}">
                <td>
                  <input data-field="label" value="${t.label}" style="width:3rem;" title="显示标签" />
                  <input data-field="name" value="${t.name}" style="width:5rem;margin-left:0.25rem;" title="档位名称" />
                  <small class="tier-range-hint">${formatTierRangeHint(t)}</small>
                </td>
                <td><input data-field="minStores" type="number" min="1" value="${t.minStores}" /></td>
                <td><input data-field="maxStores" type="number" value="${t.maxStores ?? ""}" placeholder="无上限" /></td>
                <td><input data-field="pricePerStore" type="number" value="${t.pricePerStore ?? ""}" /></td>
                <td><input data-field="description" value="${t.description}" style="width:100%;" /></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderAddonsEditor() {
  if (!addons) return;
  document.getElementById("addons-editor").innerHTML = `
    <p class="editor-hint">以下增值项<strong>仅属于当前智能体</strong>，修改后请点击底部「保存本产品增值项」。</p>
    ${addons
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
    .join("")}
  `;
}

function renderCostsEditor() {
  if (!costs) return;
  document.getElementById("costs-editor").innerHTML = `
    <p class="editor-hint">以下成本项<strong>仅用于当前智能体的利润分析</strong>，不影响对客报价。</p>
    ${costs.costItems
    .map(
      (c, i) => `
    <div class="editor-block" data-cost="${i}">
      <h4>${c.name}</h4>
      <div class="editor-grid">
        <div><label>单价</label><input data-field="unitPrice" type="number" value="${c.unitPrice}" /></div>
        <div><label>数量${
          c.quantityFields
            ? "（门店数×合同月数，自动）"
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
    .join("")}
  `;
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
  document.querySelectorAll("[data-tier]").forEach((el) => {
    const i = Number(el.dataset.tier);
    el.querySelectorAll("[data-field]").forEach((input) => {
      const f = input.dataset.field;
      if (f === "name" || f === "label" || f === "description") {
        result.subscriptionTiers[i][f] = input.value;
      } else if (f === "maxStores" || f === "pricePerStore") {
        result.subscriptionTiers[i][f] = input.value === "" ? null : Number(input.value);
      } else {
        result.subscriptionTiers[i][f] = Number(input.value);
      }
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
      .map((q) => `<option value="${q.id}">${q.company || q.name} — ${getQuoteAgentIds(q).length}个智能体 — ${fmt(quoteAmount(q))}</option>`)
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
    body: JSON.stringify({ breakdown: q.breakdown }),
  });

  const perAgentHtml = (profit.perAgent || [])
    .map(
      (p) => `
    <h4 style="margin:1rem 0 0.5rem;">${p.agentName || p.agentId}</h4>
    <div class="profit-grid">
      <div class="profit-metric"><label>合同期收入</label><strong>${fmt(p.revenue.total)}</strong></div>
      <div class="profit-metric"><label>成本</label><strong>${fmt(p.totalCost)}</strong></div>
      <div class="profit-metric positive"><label>毛利润</label><strong>${fmt(p.grossProfit)}</strong></div>
      <div class="profit-metric"><label>利润率</label><strong>${fmtPct(p.margin)}</strong></div>
    </div>`
    )
    .join("");

  const combined = profit.combined;
  const scaling = combined?.sharedCostScaling;
  const scalingHtml =
    scaling?.lines?.length
      ? `
    <h4 style="margin:1.25rem 0 0.5rem;font-size:0.875rem;">▌ 共享成本递增（${combined.agentCount} 个智能体）</h4>
    <p class="editor-hint" style="margin-bottom:0.5rem;">基准取各产品中该项最高值，按平台递增规则合并；较简单叠加${scaling.savingsVsNaive >= 0 ? "节省" : "增加"} ${fmt(Math.abs(scaling.savingsVsNaive))}。</p>
    <div class="table-wrap">
      <table class="tier-edit-table">
        <thead>
          <tr>
            <th>成本项</th>
            <th>简单叠加</th>
            <th>递增合并</th>
            <th>增量比例</th>
          </tr>
        </thead>
        <tbody>
          ${scaling.lines
            .map(
              (l) => `<tr>
            <td>${l.name}</td>
            <td>${fmt(l.naiveSum)}</td>
            <td><strong>${fmt(l.scaledAmount)}</strong><br><small class="tier-range-hint">基准 ${fmt(l.baseAmount)} × ${Math.round(l.factor * 1000) / 10}%</small></td>
            <td>${formatIncrementalRate(l.incrementalRatePerAgent)} / 个</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`
      : "";

  document.getElementById("profit-result").innerHTML = `
    ${perAgentHtml}
    ${scalingHtml}
    <h4 style="margin:1.25rem 0 0.75rem;font-size:0.875rem;">▌ 合并汇总</h4>
    <div class="profit-grid">
      <div class="profit-metric"><label>实施费收入</label><strong>${fmt(combined?.revenue?.implementation ?? profit.revenue?.implementation)}</strong></div>
      <div class="profit-metric"><label>订阅费收入</label><strong>${fmt(combined?.revenue?.subscription ?? profit.revenue?.subscription)}</strong></div>
      <div class="profit-metric"><label>增值服务收入</label><strong>${fmt(combined?.revenue?.addons ?? profit.revenue?.addons)}</strong></div>
      <div class="profit-metric"><label>合同期总收入</label><strong>${fmt(combined?.revenue?.total ?? profit.revenue?.total)}</strong></div>
      <div class="profit-metric"><label>合并成本</label><strong>${fmt(combined?.totalCost ?? profit.totalCost)}</strong></div>
      <div class="profit-metric positive"><label>合并毛利润</label><strong>${fmt(combined?.grossProfit ?? profit.grossProfit)}</strong></div>
      <div class="profit-metric"><label>合并利润率</label><strong>${fmtPct(combined?.margin ?? profit.margin)}</strong></div>
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
  document.getElementById("modal-delete").addEventListener("click", () => {
    if (currentQuoteId) deleteQuote(currentQuoteId);
  });
  document.getElementById("modal-generate-doc").addEventListener("click", () => {
    if (currentQuoteId) openQuoteDocument(currentQuoteId);
  });

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

  document.getElementById("save-platform").addEventListener("click", async () => {
    platform = collectPlatform();
    await api("/api/admin/platform", { method: "PUT", body: JSON.stringify(platform) });
    document.getElementById("sidebar-brand-name").textContent = platform.platformName;
    alert("组合折扣、共享成本递增规则与平台设置已保存");
  });

  document.getElementById("btn-new-agent").addEventListener("click", async () => {
    const name = prompt("新智能体名称：");
    if (!name?.trim()) return;
    const copy = confirm("是否从「智能排班智能体」复制配置？\n确定=复制，取消=空白模板");
    await api("/api/admin/agents", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), copyFrom: copy ? DEFAULT_AGENT_ID : null }),
    });
    agents = await api("/api/admin/agents");
    renderAgentsList();
  });

  document.getElementById("save-pricing").addEventListener("click", async () => {
    pricing = collectPricing();
    await api(`/api/admin/agents/${currentAgentId}/pricing`, { method: "PUT", body: JSON.stringify(pricing) });
    alert(`「${getCurrentAgentName()}」定价规则已保存`);
  });

  document.getElementById("save-addons").addEventListener("click", async () => {
    addons = collectAddons();
    await api(`/api/admin/agents/${currentAgentId}/addons`, { method: "PUT", body: JSON.stringify(addons) });
    alert(`「${getCurrentAgentName()}」增值项已保存`);
  });

  document.getElementById("save-costs").addEventListener("click", async () => {
    costs = collectCosts();
    await api(`/api/admin/agents/${currentAgentId}/costs`, { method: "PUT", body: JSON.stringify(costs) });
    alert(`「${getCurrentAgentName()}」成本配置已保存`);
  });

  document.getElementById("profit-quote-select").addEventListener("change", (e) => {
    if (e.target.value) renderProfit(e.target.value);
  });
  document.getElementById("calc-profit").addEventListener("click", () => {
    const id = document.getElementById("profit-quote-select").value;
    if (id) renderProfit(id);
  });

  bindAgentSelectEvents();

  try {
    [quotes, platform, agents] = await Promise.all([
      api("/api/admin/quotes"),
      api("/api/admin/platform"),
      api("/api/admin/agents"),
    ]);
    document.getElementById("sidebar-brand-name").textContent = platform.platformName || "数字员工报价平台";
    await loadAgentConfig(currentAgentId);
    renderPlatformEditor();
    renderAgentsList();
    await loadDashboard();
    renderQuotesTable();
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
