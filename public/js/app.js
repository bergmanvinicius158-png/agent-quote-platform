const state = {
  pricing: null,
  addons: [],
  selectedAddonIds: new Set(["dedicated-service", "maintenance"]),
  calcResult: null,
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

function getParams() {
  return {
    storeCount: Number(document.getElementById("store-count").value) || 1,
    contractYears: Number(document.getElementById("contract-years").value) || 2,
    integrationCount: Number(document.getElementById("integration-count").value) || 0,
    addonIds: [...state.selectedAddonIds],
  };
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

function renderSubscriptionSection(section, tierId) {
  const tierRows = section.tiers
    .map((t) => {
      const active = t.id === tierId ? " tier-active" : "";
      const price = t.customQuote ? "面议" : `${t.pricePerStore} 元/门店/月`;
      const range =
        t.maxStores == null
          ? `>${(section.tiers[section.tiers.length - 2]?.maxStores || 1000).toLocaleString()} 家`
          : t.minStores === 1
            ? `≤${t.maxStores} 家`
            : `${t.minStores.toLocaleString()}–${t.maxStores.toLocaleString()} 家`;
      return `<tr class="${active.trim()}">
        <td>${t.name}</td>
        <td>${range}</td>
        <td class="col-ref">${price}</td>
        <td>${t.description}</td>
      </tr>`;
    })
    .join("");

  if (section.customQuote) {
    return `
      <div class="fee-block">
        <h3 class="subsection-title">${section.title}</h3>
        <div class="custom-quote-notice">门店数超过 1,000 家，请<a href="mailto:sales@example.com">联系商务</a>获取专属报价与定制 SLA。</div>
      </div>`;
  }

  return `
    <div class="fee-block">
      <h3 class="subsection-title">${section.title}</h3>
      <div class="data-table-wrap">
        <table class="data-table tier-table">
          <thead>
            <tr>
              <th>档位</th>
              <th>门店数范围</th>
              <th>月单价（元/门店/月）</th>
              <th>计费特点</th>
            </tr>
          </thead>
          <tbody>${tierRows}</tbody>
        </table>
      </div>
      <p class="subsection-title" style="margin-top:1rem;">▶ 订阅费计算（自动根据企业信息计算）</p>
      <div class="calc-result-grid">
        <div class="calc-result-item"><label>所在档位</label><strong>${state.calcResult.tier?.label || "—"}</strong></div>
        <div class="calc-result-item"><label>月单价</label><strong>${section.monthlyPerStore} 元/门店/月</strong></div>
        <div class="calc-result-item"><label>门店数量</label><strong>${state.calcResult.storeCount} 家</strong></div>
        <div class="calc-result-item"><label>月订阅费</label><strong class="large">${fmt(section.monthlyAmount)}</strong></div>
        <div class="calc-result-item"><label>年订阅费（月付）</label><strong>${fmt(section.yearlyAmount)}</strong></div>
        <div class="calc-result-item"><label>合同期订阅费</label><strong>${fmt(section.contractAmount)}</strong></div>
        <div class="calc-result-item"><label>年付优惠（节省）</label><strong style="color:var(--accent-green)">${fmt(section.annualPaySavings)}</strong></div>
        <div class="calc-result-item"><label>年付实付年费</label><strong>${fmt(section.annualPayAmount)}（${Math.round(section.annualPayDiscount * 100)} 折）</strong></div>
      </div>
    </div>`;
}

function renderAddonsSection(section) {
  const rows = state.addons
    .map((a) => {
      const checked = state.selectedAddonIds.has(a.id);
      return `<tr class="${checked ? "row-highlight" : ""}">
        <td>${a.name}</td>
        <td class="col-price col-ref">${a.monthlyPrice.toLocaleString("zh-CN")}</td>
        <td class="toggle-cell"><input type="checkbox" data-addon="${a.id}" ${checked ? "checked" : ""} /></td>
        <td>${a.description}</td>
        <td class="col-sub">${checked ? (a.monthlyPrice * 1).toLocaleString("zh-CN") : "0"}</td>
        <td class="col-sub">${checked ? (a.monthlyPrice * state.calcResult.contractMonths).toLocaleString("zh-CN") : "0"}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="fee-block">
      <h3 class="subsection-title">${section.title}</h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>服务项</th>
              <th class="col-price">月费（元）</th>
              <th>是否启用</th>
              <th>功能说明</th>
              <th class="col-sub">月合计（元）</th>
              <th class="col-sub">合同期合计（元）</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="row-total">
              <td colspan="4">增值服务 月合计</td>
              <td class="col-sub">${section.monthlyAmount.toLocaleString("zh-CN")}</td>
              <td></td>
            </tr>
            <tr class="row-total">
              <td colspan="5">增值服务 合同期合计</td>
              <td class="col-sub">${section.contractAmount.toLocaleString("zh-CN")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function renderOverview(result) {
  const body = document.getElementById("overview-body");
  if (!result || result.customQuote) {
    body.innerHTML = `<tr><td colspan="3" class="custom-quote-notice">请先填写企业信息，或联系商务获取大规模门店专属报价。</td></tr>`;
    return;
  }

  const rows = result.overview
    .map(
      (o) => `<tr>
      <td>${o.label}</td>
      <td class="col-amount">${fmt(o.amount)}</td>
      <td>${o.note}</td>
    </tr>`
    )
    .join("");

  body.innerHTML =
    rows +
    `<tr class="row-contract">
      <td>合同总金额</td>
      <td class="col-amount">${fmt(result.summary.contractTotal)}</td>
      <td>含以上三项，含税报价</td>
    </tr>
    <tr class="row-first-year">
      <td>首年预算参考</td>
      <td class="col-amount">${fmt(result.summary.firstYearBudget)}</td>
      <td>一次性费用＋首年订阅（月付）＋首年增值服务</td>
    </tr>`;
}

function renderAll(result) {
  state.calcResult = result;
  const container = document.getElementById("fee-sections");
  if (!result) {
    container.innerHTML = '<p style="color:var(--text-muted)">正在加载…</p>';
    renderOverview(null);
    return;
  }

  const impl = result.sections.find((s) => s.id === "implementation");
  const sub = result.sections.find((s) => s.id === "subscription");
  const addons = result.sections.find((s) => s.id === "addons");

  container.innerHTML =
    renderImplementationSection(impl) +
    renderSubscriptionSection(sub, result.tier?.id) +
    renderAddonsSection(addons);

  container.querySelectorAll("[data-addon]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedAddonIds.add(cb.dataset.addon);
      else state.selectedAddonIds.delete(cb.dataset.addon);
      updateQuote();
    });
  });

  renderOverview(result);
}

async function updateQuote() {
  try {
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
      showToast("大规模门店请联系商务获取专属报价", true);
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
  [state.pricing, state.addons] = await Promise.all([api("/api/pricing"), api("/api/addons")]);

  document.getElementById("product-name").textContent = state.pricing.productName;
  document.getElementById("sheet-title").textContent = `${state.pricing.productName} — 报价计算器`;
  document.title = `${state.pricing.productName} · 报价计算器`;

  bindEvents();
  await updateQuote();
}

init();
