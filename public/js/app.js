const state = {
  platform: null,
  agents: [],
  selectedAgentIds: new Set(["scheduling-agent"]),
  addonSelections: {},
  agentAddons: {},
  activeFeeTab: null,
  calcResult: null,
};

const DEFAULT_ADDONS = {
  "scheduling-agent": ["dedicated-service", "maintenance"],
  "ordering-agent": ["dedicated-service", "maintenance"],
  "store-ops-agent": ["dedicated-service", "maintenance"],
  "kitchen-agent": ["dedicated-service", "maintenance"],
  "marketing-agent": ["dedicated-service", "maintenance"],
  "menu-agent": ["dedicated-service", "maintenance"],
};

const fmt = (n) => (n == null ? "面议" : "¥" + n.toLocaleString("zh-CN"));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function showToast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => el.classList.remove("show"), 4000);
}

function getSelectedAddonIds(agentId) {
  if (!state.addonSelections[agentId]) {
    state.addonSelections[agentId] = new Set(DEFAULT_ADDONS[agentId] || []);
  }
  return state.addonSelections[agentId];
}

function getParams() {
  const addonSelections = {};
  for (const agentId of state.selectedAgentIds) {
    addonSelections[agentId] = [...getSelectedAddonIds(agentId)];
  }
  return {
    agentIds: [...state.selectedAgentIds],
    storeCount: Number(document.getElementById("store-count").value) || 1,
    contractYears: Number(document.getElementById("contract-years").value) || 2,
    integrationCount: Number(document.getElementById("integration-count").value) || 0,
    addonSelections,
  };
}

function formatTierRange(t) {
  if (t.maxStores == null) return `${Number(t.minStores).toLocaleString()} 家以上`;
  if (t.minStores === 1) return `≤${Number(t.maxStores).toLocaleString()} 家`;
  return `${Number(t.minStores).toLocaleString()}–${Number(t.maxStores).toLocaleString()} 家`;
}

function renderAgentSelector() {
  const container = document.getElementById("agent-selector");
  container.innerHTML = state.agents
    .map((a) => {
      const checked = state.selectedAgentIds.has(a.id);
      return `<label class="agent-card ${checked ? "selected" : ""}">
        <input type="checkbox" data-agent="${a.id}" ${checked ? "checked" : ""} />
        <span class="agent-card-icon">${a.icon || "智"}</span>
        <span class="agent-card-body">
          <strong>${a.name}</strong>
          <small>${a.description || ""}</small>
        </span>
      </label>`;
    })
    .join("");

  container.querySelectorAll("[data-agent]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedAgentIds.add(cb.dataset.agent);
        if (!state.activeFeeTab) state.activeFeeTab = cb.dataset.agent;
      } else {
        if (state.selectedAgentIds.size <= 1) {
          cb.checked = true;
          showToast("请至少选择一个智能体", true);
          return;
        }
        state.selectedAgentIds.delete(cb.dataset.agent);
        if (state.activeFeeTab === cb.dataset.agent) {
          state.activeFeeTab = [...state.selectedAgentIds][0];
        }
      }
      renderAgentSelector();
      updateBundleHint();
      updateQuote();
    });
  });

  updateBundleHint();
}

function updateBundleHint() {
  const el = document.getElementById("bundle-hint");
  const count = state.selectedAgentIds.size;
  const rules = state.platform?.bundleDiscounts || [];
  const applicable = [...rules].sort((a, b) => b.minAgents - a.minAgents).find((r) => count >= r.minAgents);
  if (applicable && count >= 2) {
    el.textContent = `已选 ${count} 个智能体，可享受：${applicable.label}（订阅费合同期合计）`;
    el.className = "bundle-hint active";
  } else if (count === 1 && rules.length) {
    const next = rules.find((r) => r.minAgents > count);
    el.textContent = next ? `再选 ${next.minAgents - count} 个智能体可享受${next.label}` : "";
    el.className = "bundle-hint";
  } else {
    el.textContent = "";
    el.className = "bundle-hint";
  }
}

function renderImplementationSection(section) {
  const rows = section.lines
    .map(
      (l) => `<tr>
      <td>${l.name}</td>
      <td class="col-price col-ref">${fmt(l.unitPrice)}</td>
      <td class="col-qty">${l.qty}</td>
      <td>${l.description}</td>
      <td class="col-sub">${fmt(l.amount)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="fee-block">
      <h3 class="subsection-title">${section.title}</h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>费用项</th>
              <th class="col-price">单价（元）</th>
              <th class="col-qty">数量</th>
              <th>说明</th>
              <th class="col-sub">小计（元）</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="row-total">
              <td colspan="4">企业建模实施费 合计</td>
              <td class="col-sub">${fmt(section.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function renderSubscriptionSection(section, tierId, agentResult) {
  const tierRows = section.tiers
    .map((t) => {
      const active = t.id === tierId ? " tier-active" : "";
      const price = t.pricePerStore == null ? "面议" : `${t.pricePerStore} 元/门店/月`;
      return `<tr class="${active.trim()}">
        <td>${t.name}</td>
        <td>${formatTierRange(t)}</td>
        <td class="col-ref">${price}</td>
        <td>${t.description}</td>
      </tr>`;
    })
    .join("");

  if (section.customQuote) {
    return `<div class="fee-block"><h3 class="subsection-title">${section.title}</h3>
      <div class="custom-quote-notice">当前门店规模需面议，请联系商务。</div></div>`;
  }

  return `
    <div class="fee-block">
      <h3 class="subsection-title">${section.title}</h3>
      <div class="data-table-wrap">
        <table class="data-table tier-table">
          <thead><tr><th>档位</th><th>门店数范围</th><th>月单价</th><th>计费特点</th></tr></thead>
          <tbody>${tierRows}</tbody>
        </table>
      </div>
      <div class="calc-result-grid">
        <div class="calc-result-item"><label>所在档位</label><strong>${agentResult.tier?.label || "—"}</strong></div>
        <div class="calc-result-item"><label>月单价</label><strong>${section.monthlyPerStore} 元/店/月</strong></div>
        <div class="calc-result-item"><label>月订阅费</label><strong class="large">${fmt(section.monthlyAmount)}</strong></div>
        <div class="calc-result-item"><label>合同期订阅费</label><strong>${fmt(section.contractAmount)}</strong></div>
        <div class="calc-result-item"><label>年付节省</label><strong style="color:var(--accent-green)">${fmt(section.annualPaySavings)}</strong></div>
      </div>
    </div>`;
}

function renderAddonsSection(section, agentId) {
  const addons = state.agentAddons[agentId] || [];
  const selected = getSelectedAddonIds(agentId);
  const contractMonths = state.calcResult?.sharedInput?.contractMonths || 24;

  const rows = addons
    .map((a) => {
      const checked = selected.has(a.id);
      return `<tr class="${checked ? "row-highlight" : ""}">
        <td>${a.name}</td>
        <td class="col-price col-ref">${a.monthlyPrice.toLocaleString("zh-CN")}</td>
        <td class="toggle-cell"><input type="checkbox" data-agent="${agentId}" data-addon="${a.id}" ${checked ? "checked" : ""} /></td>
        <td>${a.description}</td>
        <td class="col-sub">${checked ? a.monthlyPrice.toLocaleString("zh-CN") : "0"}</td>
        <td class="col-sub">${checked ? (a.monthlyPrice * contractMonths).toLocaleString("zh-CN") : "0"}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="fee-block">
      <h3 class="subsection-title">${section.title}</h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>服务项</th><th class="col-price">月费</th><th>启用</th><th>说明</th><th class="col-sub">月合计</th><th class="col-sub">合同期合计</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="row-total"><td colspan="4">增值服务 合同期合计</td><td></td><td class="col-sub">${section.contractAmount.toLocaleString("zh-CN")}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function renderAgentFeePanel(agentResult) {
  const impl = agentResult.sections.find((s) => s.id === "implementation");
  const sub = agentResult.sections.find((s) => s.id === "subscription");
  const addons = agentResult.sections.find((s) => s.id === "addons");
  return `
    <div class="agent-fee-panel" data-agent-panel="${agentResult.agentId}">
      <div class="agent-fee-header">
        <span class="agent-fee-icon">${state.agents.find((a) => a.id === agentResult.agentId)?.icon || "智"}</span>
        <div>
          <strong>${agentResult.agentName}</strong>
          <small>小计：${fmt(agentResult.summary.contractTotal)}（合同期）</small>
        </div>
      </div>
      ${renderImplementationSection(impl)}
      ${renderSubscriptionSection(sub, agentResult.tier?.id, agentResult)}
      ${renderAddonsSection(addons, agentResult.agentId)}
    </div>`;
}

function renderFeeTabs(result) {
  if (!result?.agents?.length) return '<p class="empty-state">请先选择智能体</p>';

  const tabs = result.agents
    .map((a) => {
      const active = state.activeFeeTab === a.agentId ? " active" : "";
      return `<button type="button" class="fee-tab${active}" data-fee-tab="${a.agentId}">${a.agentName}</button>`;
    })
    .join("");

  const panels =
    result.agents.length === 1
      ? renderAgentFeePanel(result.agents[0])
      : result.agents
          .map((a) => {
            const hidden = state.activeFeeTab !== a.agentId ? ' style="display:none"' : "";
            return `<div class="fee-tab-panel" data-fee-panel="${a.agentId}"${hidden}>${renderAgentFeePanel(a)}</div>`;
          })
          .join("");

  return `
    <h2 class="section-bar">▌ 费用明细</h2>
    ${result.agents.length > 1 ? `<div class="fee-tabs">${tabs}</div>` : ""}
    <div id="fee-panels">${panels}</div>`;
}

function renderOverview(result) {
  const body = document.getElementById("overview-body");
  if (!result || result.customQuote) {
    body.innerHTML = `<tr><td colspan="3" class="custom-quote-notice">请先选择智能体并填写企业信息，或联系商务获取专属报价。</td></tr>`;
    return;
  }

  const rows = (result.overview || [])
    .map(
      (o) => `<tr class="${o.isDiscount ? "row-discount" : ""}">
      <td>${o.label}</td>
      <td class="col-amount">${o.amount < 0 ? "-" + fmt(Math.abs(o.amount)) : fmt(o.amount)}</td>
      <td>${o.note || ""}</td>
    </tr>`
    )
    .join("");

  const summary = result.combinedSummary || result.summary;
  body.innerHTML =
    rows +
    `<tr class="row-contract">
      <td>合同总金额</td>
      <td class="col-amount">${fmt(summary.contractTotal)}</td>
      <td>含所选智能体全部费用${summary.bundleSavings ? "，已扣组合折扣" : ""}，含税报价</td>
    </tr>
    <tr class="row-first-year">
      <td>首年预算参考</td>
      <td class="col-amount">${fmt(summary.firstYearBudget)}</td>
      <td>一次性费用＋首年订阅（月付）＋首年增值服务</td>
    </tr>`;
}

function bindFeeInteractions() {
  document.querySelectorAll("[data-fee-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeFeeTab = btn.dataset.feeTab;
      document.querySelectorAll("[data-fee-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll("[data-fee-panel]").forEach((p) => {
        p.style.display = p.dataset.feePanel === state.activeFeeTab ? "" : "none";
      });
    });
  });

  document.querySelectorAll("[data-addon]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const agentId = cb.dataset.agent;
      const set = getSelectedAddonIds(agentId);
      if (cb.checked) set.add(cb.dataset.addon);
      else set.delete(cb.dataset.addon);
      updateQuote();
    });
  });
}

function renderAll(result) {
  state.calcResult = result;
  const container = document.getElementById("fee-sections");
  if (!result) {
    container.innerHTML = '<p style="color:var(--text-muted)">正在加载…</p>';
    renderOverview(null);
    return;
  }

  if (!state.activeFeeTab || !state.selectedAgentIds.has(state.activeFeeTab)) {
    state.activeFeeTab = result.agents?.[0]?.agentId || [...state.selectedAgentIds][0];
  }

  container.innerHTML = renderFeeTabs(result);
  bindFeeInteractions();
  renderOverview(result);
}

async function loadAgentAddons(agentId) {
  if (state.agentAddons[agentId]) return;
  state.agentAddons[agentId] = await api(`/api/agents/${agentId}/addons`);
}

async function updateQuote() {
  if (!state.selectedAgentIds.size) return;
  try {
    await Promise.all([...state.selectedAgentIds].map(loadAgentAddons));
    const result = await api("/api/calculate", {
      method: "POST",
      body: JSON.stringify(getParams()),
    });
    renderAll(result);
  } catch (err) {
    showToast(err.message, true);
  }
}

function bindEvents() {
  ["store-count", "contract-years", "integration-count"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateQuote);
  });

  document.getElementById("quote-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.calcResult?.customQuote) {
      showToast(state.calcResult.customQuoteAgent ? `「${state.calcResult.customQuoteAgent}」需面议` : "请联系商务获取专属报价", true);
      return;
    }
    if (!state.selectedAgentIds.size) {
      showToast("请至少选择一个智能体", true);
      return;
    }
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    if (!name || !email) {
      showToast("请填写联系人和邮箱", true);
      return;
    }
    try {
      await api("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          ...getParams(),
          name,
          email,
          company: document.getElementById("company").value.trim(),
          phone: document.getElementById("phone").value.trim(),
          notes: document.getElementById("notes").value.trim(),
        }),
      });
      showToast("报价申请已提交！商务将在 1 个工作日内联系您。");
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  const platform = await api("/api/platform");
  state.platform = platform;
  state.agents = platform.agents || [];

  document.getElementById("platform-name").textContent = platform.platformName;
  document.getElementById("platform-tagline").textContent = platform.tagline || "多智能体组合报价计算器";
  document.getElementById("sheet-title").textContent = `${platform.platformName} — 报价计算器`;
  document.getElementById("footer-name").textContent = platform.platformName;
  document.title = `${platform.platformName} · 报价计算器`;

  if (state.agents.length && !state.agents.some((a) => state.selectedAgentIds.has(a.id))) {
    state.selectedAgentIds = new Set([state.agents[0].id]);
  }
  state.activeFeeTab = [...state.selectedAgentIds][0];

  renderAgentSelector();
  bindEvents();
  await updateQuote();
}

init();
