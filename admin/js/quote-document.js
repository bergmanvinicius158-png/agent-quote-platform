const TOKEN_KEY = "adminToken";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

async function api(path) {
  const res = await fetch(path, { headers: authHeaders() });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/admin/login.html";
    throw new Error("登录已过期");
  }
  if (!res.ok) throw new Error(data.error || "加载失败");
  return data;
}

const fmt = (n) => "¥" + (Number(n) || 0).toLocaleString("zh-CN");
const fmtDate = (iso, opts = { dateStyle: "long" }) =>
  new Date(iso).toLocaleDateString("zh-CN", opts);
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString("zh-CN", { dateStyle: "long", timeStyle: "short" });

function formatTierRange(t) {
  if (t.maxStores == null) return `${Number(t.minStores).toLocaleString()} 家以上`;
  if (t.minStores === 1) return `≤${Number(t.maxStores).toLocaleString()} 家`;
  return `${Number(t.minStores).toLocaleString()}–${Number(t.maxStores).toLocaleString()} 家`;
}

function discountLabel(rate) {
  const pct = Math.round((rate || 0) * 1000) / 10;
  return pct % 1 === 0 ? `${pct} 折` : `${pct} 折`;
}

function shortQuoteNo(id) {
  if (!id) return "—";
  const parts = id.split("_");
  return parts.length >= 2 ? `Q-${parts[1].slice(-8).toUpperCase()}` : id;
}

function renderImplementationSection(section) {
  if (!section) return "";
  const rows = (section.lines || [])
    .map(
      (l) => `<tr>
        <td>${l.name}</td>
        <td class="col-desc">${l.description || "—"}</td>
        <td class="col-num">${fmt(l.unitPrice)}</td>
        <td class="col-num">${l.qty}</td>
        <td class="col-num">${fmt(l.amount)}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="doc-section">
      <h2>${section.title}</h2>
      <p class="section-note">${section.description || ""}</p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>说明</th>
            <th class="col-num">单价</th>
            <th class="col-num">数量</th>
            <th class="col-num">小计</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4">实施费合计（一次性）</td>
            <td class="col-num">${fmt(section.amount)}</td>
          </tr>
        </tfoot>
      </table>
    </section>`;
}

function renderSubscriptionSection(section, tierId, storeCount, contractMonths) {
  if (!section || section.customQuote) {
    return `<section class="doc-section"><h2>二、数字员工订阅费</h2><p class="section-note">当前门店规模需商务面议，请联系销售获取专属报价。</p></section>`;
  }

  const tierRows = (section.tiers || [])
    .map((t) => {
      const active = t.id === tierId ? " tier-active" : "";
      const price = t.pricePerStore == null ? "面议" : `${t.pricePerStore} 元/店/月`;
      return `<tr class="${active.trim()}">
        <td>${t.name}（${t.label}）</td>
        <td>${formatTierRange(t)}</td>
        <td class="col-num">${price}</td>
        <td class="col-desc">${t.description || "—"}</td>
      </tr>`;
    })
    .join("");

  const discountPct = Math.round((1 - (section.annualPayDiscount || 1)) * 1000) / 10;

  return `
    <section class="doc-section">
      <h2>${section.title}</h2>
      <p class="section-note">${section.description || ""}</p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>档位</th>
            <th>门店数范围</th>
            <th class="col-num">月单价</th>
            <th>计费特点</th>
          </tr>
        </thead>
        <tbody>${tierRows}</tbody>
      </table>

      <p class="section-note" style="margin-top:1rem;">▶ 当前企业订阅费计算</p>
      <div class="calc-box">
        <div><label>所在档位</label><strong>${section.tiers?.find((t) => t.id === tierId)?.name || "—"}</strong></div>
        <div><label>门店数量</label><strong>${storeCount} 家</strong></div>
        <div><label>月单价</label><strong>${section.monthlyPerStore} 元/店/月</strong></div>
        <div><label>月订阅费</label><strong>${fmt(section.monthlyAmount)}</strong></div>
        <div><label>年订阅费（按月付累计）</label><strong>${fmt(section.yearlyAmount)}</strong></div>
        <div><label>合同期（${contractMonths} 个月）</label><strong>${fmt(section.contractAmount)}</strong></div>
      </div>
      <p class="section-note">计算公式：${storeCount} 店 × ${section.monthlyPerStore} 元/店/月 × ${contractMonths} 月 = ${fmt(section.contractAmount)}</p>

      <div class="discount-panel">
        <h3>年付优惠方案</h3>
        <div class="discount-grid">
          <div><label>年付折扣</label><strong>${discountLabel(section.annualPayDiscount)}</strong></div>
          <div><label>年订阅费（按月付累计，原价）</label><strong>${fmt(section.yearlyAmount)}</strong></div>
          <div><label>年付实付金额</label><strong>${fmt(section.annualPayAmount)}</strong></div>
          <div><label>年付节省</label><strong class="savings">${fmt(section.annualPaySavings)}</strong></div>
        </div>
        <p class="discount-formula">
          年付优惠说明：选择年付时，在年订阅费 ${fmt(section.yearlyAmount)} 基础上享受 ${discountLabel(section.annualPayDiscount)}（约 ${discountPct}% 优惠），
          实付 ${fmt(section.annualPayAmount)}，较按月累计支付节省 ${fmt(section.annualPaySavings)}。
          合同期若选择年付，可按年重复享受该折扣。
        </p>
      </div>
    </section>`;
}

function renderAddonsSection(section, contractMonths) {
  if (!section) return "";
  const items = section.items || [];
  if (!items.length) {
    return `
      <section class="doc-section">
        <h2>${section.title}</h2>
        <p class="section-note">未选购增值服务项目。</p>
      </section>`;
  }

  const rows = items
    .map(
      (a) => `<tr>
        <td>${a.name}</td>
        <td class="col-desc">${a.description || "—"}</td>
        <td class="col-num">${fmt(a.monthlyPrice)}</td>
        <td class="col-num">${contractMonths} 月</td>
        <td class="col-num">${fmt(a.contractAmount ?? a.monthlyPrice * contractMonths)}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="doc-section">
      <h2>${section.title}</h2>
      <p class="section-note">${section.description || ""}</p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>服务项</th>
            <th>功能说明</th>
            <th class="col-num">月费</th>
            <th class="col-num">合同月数</th>
            <th class="col-num">合同期合计</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4">增值服务费合计（合同期）</td>
            <td class="col-num">${fmt(section.contractAmount)}</td>
          </tr>
        </tfoot>
      </table>
      <p class="section-note">增值服务月合计：${fmt(section.monthlyAmount)} / 月；首年合计：${fmt(section.firstYearAmount)}</p>
    </section>`;
}

function normalizeBreakdown(breakdown) {
  if (!breakdown) return null;
  if (breakdown.agents?.length) return breakdown;
  if (breakdown.sections?.length) {
    return {
      ...breakdown,
      agents: [{ agentId: "scheduling-agent", agentName: breakdown.productName, ...breakdown }],
      combinedSummary: breakdown.summary,
      bundleDiscount: { savings: 0, label: null },
    };
  }
  return breakdown;
}

function renderAgentBlock(agent, storeCount, contractMonths) {
  const impl = agent.sections?.find((s) => s.id === "implementation");
  const sub = agent.sections?.find((s) => s.id === "subscription");
  const addons = agent.sections?.find((s) => s.id === "addons");
  return `
    <div class="agent-doc-block">
      <h2 class="agent-doc-title">${agent.agentName || agent.productName}</h2>
      ${renderImplementationSection(impl)}
      ${renderSubscriptionSection(sub, agent.tier?.id, storeCount, contractMonths)}
      ${renderAddonsSection(addons, contractMonths)}
      <p class="section-note agent-subtotal">本智能体合同期小计：<strong>${fmt(agent.summary?.contractTotal)}</strong></p>
    </div>`;
}

function renderSummary(quote, breakdown) {
  const b = normalizeBreakdown(breakdown);
  const summary = b.combinedSummary || b.summary || {};
  const overview = b.overview || [];
  const contractTotal = quote.finalTotal ?? summary.contractTotal;
  const hasFinalOverride = quote.finalTotal != null && quote.finalTotal !== summary.contractTotal;

  const rows = overview.length
    ? overview
        .map(
          (o) => `<tr class="${o.isDiscount ? "row-discount" : ""}">
        <td>${o.label}</td>
        <td class="col-num">${o.amount < 0 ? "-" + fmt(Math.abs(o.amount)) : fmt(o.amount)}</td>
        <td class="col-desc">${o.note || ""}</td>
      </tr>`
        )
        .join("")
    : (b.agents || [])
        .map(
          (a) => `<tr>
        <td>【${a.agentName || a.productName}】合同期合计</td>
        <td class="col-num">${fmt(a.summary?.contractTotal)}</td>
        <td class="col-desc"></td>
      </tr>`
        )
        .join("");

  const bundleRow =
    b.bundleDiscount?.savings > 0
      ? `<tr class="row-discount">
        <td>组合折扣（${b.bundleDiscount.label || ""}）</td>
        <td class="col-num">-${fmt(b.bundleDiscount.savings)}</td>
        <td class="col-desc">作用于${b.bundleDiscount.appliedTo === "subscription" ? "订阅费" : "合同总价"}</td>
      </tr>`
      : "";

  const finalRow = hasFinalOverride
    ? `<tr class="row-final">
        <td>最终报价金额（商务确认）</td>
        <td class="col-num">${fmt(quote.finalTotal)}</td>
        <td class="col-desc">系统估算 ${fmt(summary.contractTotal)}</td>
      </tr>`
    : "";

  return `
    <section class="doc-section">
      <h2>费用总览</h2>
      <table class="doc-table summary-table">
        <thead><tr><th>费用项目</th><th class="col-num">金额</th><th>说明</th></tr></thead>
        <tbody>
          ${rows}
          ${bundleRow}
          <tr class="row-total">
            <td>合同总金额</td>
            <td class="col-num">${fmt(contractTotal)}</td>
            <td class="col-desc">含所选智能体全部费用${summary.bundleSavings ? "，已扣组合折扣" : ""}，含税报价</td>
          </tr>
          ${finalRow}
          <tr>
            <td>首年预算参考</td>
            <td class="col-num">${fmt(summary.firstYearBudget)}</td>
            <td class="col-desc">一次性实施费 ＋ 首年订阅（月付）＋ 首年增值服务</td>
          </tr>
        </tbody>
      </table>
    </section>`;
}

function renderQuoteDocument(quote, platform) {
  const b = normalizeBreakdown(quote.breakdown);
  if (!b?.agents?.length) {
    return `<div class="doc-error">该报价单缺少费用明细，无法生成对客报价单。</div>`;
  }

  const shared = b.sharedInput || {};
  const storeCount = quote.storeCount ?? shared.storeCount;
  const contractMonths = shared.contractMonths ?? quote.contractYears * 12;
  const agentNames = b.agents.map((a) => a.agentName || a.productName).join("、");
  const validUntil = new Date(quote.updatedAt || quote.createdAt);
  validUntil.setDate(validUntil.getDate() + 30);
  const salesEmail = platform?.salesEmail || "sales@example.com";

  const agentBlocks = b.agents
    .map((a) => renderAgentBlock(a, storeCount, contractMonths))
    .join("");

  const bundlePanel =
    b.bundleDiscount?.savings > 0
      ? `<div class="discount-panel" style="margin:1.5rem 0;">
        <h3>多智能体组合折扣</h3>
        <p>${b.bundleDiscount.label || ""}：订阅费合同期合计节省 <strong class="savings">${fmt(b.bundleDiscount.savings)}</strong></p>
      </div>`
      : "";

  return `
    <header class="doc-header">
      <div class="brand-lockup brand-lockup--light brand-lockup--doc">
        <img src="/images/foundex-logo.png" alt="Foundex" class="brand-wordmark brand-wordmark--on-light" />
        <span class="brand-divider" aria-hidden="true"></span>
        <div class="brand-doc-title">
          <h1>${b.platformName || platform?.platformName || "数字员工报价平台"} · 正式报价单</h1>
          <p class="subtitle">多智能体组合报价 — ${agentNames}</p>
        </div>
      </div>
      <div class="doc-meta">
        <strong>报价单编号 ${shortQuoteNo(quote.id)}</strong>
        报价日期：${fmtDate(quote.createdAt)}<br />
        有效期至：${fmtDate(validUntil.toISOString())}
      </div>
    </header>

    <div class="info-grid">
      <div class="info-block">
        <h3>致客户</h3>
        <div class="info-row"><span class="label">企业名称</span><span>${quote.company || "—"}</span></div>
        <div class="info-row"><span class="label">联系人</span><span>${quote.name}</span></div>
        <div class="info-row"><span class="label">联系电话</span><span>${quote.phone || "—"}</span></div>
        <div class="info-row"><span class="label">电子邮箱</span><span>${quote.email}</span></div>
      </div>
      <div class="info-block">
        <h3>报价方</h3>
        <div class="info-row"><span class="label">公司</span><span>Foundex</span></div>
        <div class="info-row"><span class="label">平台</span><span>${b.platformName || platform?.platformName || "—"}</span></div>
        <div class="info-row"><span class="label">所选智能体</span><span>${agentNames}</span></div>
        <div class="info-row"><span class="label">商务联系</span><span>${salesEmail}</span></div>
        <div class="info-row"><span class="label">生成时间</span><span>${fmtDateTime(new Date().toISOString())}</span></div>
      </div>
    </div>

    <div class="params-bar">
      <span>门店数量：<strong>${storeCount} 家</strong></span>
      <span>档位：<strong>${quote.tierLabel || "—"}</strong></span>
      <span>合同年限：<strong>${quote.contractYears} 年（${contractMonths} 个月）</strong></span>
      <span>系统对接：<strong>${quote.integrationCount} 套</strong></span>
    </div>

    ${agentBlocks}
    ${bundlePanel}
    ${renderSummary(quote, b)}

    <footer class="doc-footer">
      <strong>报价说明与条款</strong>
      <ul>
        <li>本报价单包含 ${b.agents.length} 个智能体产品的费用明细，有效期 30 天。</li>
        <li>多智能体组合可享受文档中所示组合折扣（如有），具体以正式合同为准。</li>
        <li>各智能体订阅费支持月付或年付；年付折扣见各智能体明细。</li>
        <li>以上金额均为含税报价。</li>
      </ul>
    </footer>`;
}

function showError(message) {
  document.getElementById("doc-loading").innerHTML = `<div class="doc-error">${message}</div>`;
}

async function loadQuote(id) {
  try {
    return await api(`/api/admin/quotes/${encodeURIComponent(id)}`);
  } catch {
    const quotes = await api("/api/admin/quotes");
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw new Error("报价单不存在或已被删除");
    return quote;
  }
}

async function init() {
  if (!getToken()) {
    location.href = "/admin/login.html";
    return;
  }

  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    showError("缺少报价单 ID，请从管理后台进入。");
    return;
  }

  document.getElementById("btn-back").addEventListener("click", () => {
    location.href = "/admin/index.html";
  });
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  try {
    const [quote, platform] = await Promise.all([
      loadQuote(id),
      api("/api/platform").catch(() => ({})),
    ]);
    const doc = document.getElementById("quote-doc");
    doc.innerHTML = renderQuoteDocument(quote, platform);
    doc.hidden = false;
    document.getElementById("doc-loading").hidden = true;
    document.title = `${quote.company || quote.name} · 对客报价单`;
  } catch (err) {
    showError(err.message || "加载报价单失败");
  }
}

init();
