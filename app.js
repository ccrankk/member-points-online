const STORAGE_KEY = "store-points-system-v1";

const defaultState = {
  selectedYear: 2026,
  settings: {
    basePoints: 1,
    settlementDays: 30,
    minCarry: 200,
    studentDiscount: 0.05,
    discountPointMultiplier: 2,
    teacherStudentRate: 0.05,
    teacherPurchaseMultiplier: 1.5,
    tiers: [
      { name: "普通会员", threshold: 0, multiplier: 1 },
      { name: "银卡会员", threshold: 1500, multiplier: 1.2 },
      { name: "金卡会员", threshold: 3000, multiplier: 1.5 },
      { name: "黑卡会员", threshold: 8000, multiplier: 2 }
    ]
  },
  members: [
    { id: "C001", name: "张三", type: "普通客户", teacherId: "", joinedAt: "2026-01-02", initialTier: "普通会员", protectionUntil: 2026, note: "" },
    { id: "C002", name: "李四", type: "普通客户", teacherId: "", joinedAt: "2026-01-10", initialTier: "普通会员", protectionUntil: 2026, note: "" },
    { id: "C003", name: "王五", type: "普通客户", teacherId: "", joinedAt: "2026-02-01", initialTier: "金卡会员", protectionUntil: 2026, note: "" },
    { id: "T001", name: "陈老师", type: "老师本人", teacherId: "", joinedAt: "2026-01-01", initialTier: "普通会员", protectionUntil: 2026, note: "" },
    { id: "S001", name: "赵同学", type: "老师学生", teacherId: "T001", joinedAt: "2026-02-18", initialTier: "普通会员", protectionUntil: 2026, note: "" }
  ],
  transactions: [
    { id: "TX001", date: "2026-01-05", memberId: "C001", amount: 1000, note: "普通客户示例" },
    { id: "TX002", date: "2026-02-12", memberId: "C002", amount: 1800, note: "达到银卡门槛" },
    { id: "TX003", date: "2026-03-03", memberId: "S001", amount: 1200, note: "老师学生 95 折" },
    { id: "TX004", date: "2026-04-22", memberId: "T001", amount: 2000, note: "老师本人 1.5 倍积分" },
    { id: "TX005", date: "2026-05-17", memberId: "C003", amount: 8500, note: "达到黑卡门槛" }
  ],
  redemptions: [
    { id: "RD001", date: "2026-12-10", memberId: "C002", points: 2000, type: "客户积分", note: "年度兑换" },
    { id: "RD002", date: "2026-12-12", memberId: "T001", points: 500, type: "老师积分", note: "老师积分兑换" }
  ]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
const points = value => `${money(value)} 分`;
const yearOf = date => Number(String(date).slice(0, 4));
const clone = value => JSON.parse(JSON.stringify(value));

let state = clone(defaultState);
let currentView = "dashboard";
let currentModal = null;
let editingId = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.settings && saved.members ? saved : clone(defaultState);
  } catch {
    return clone(defaultState);
  }
}

function saveState(message) {
  if (window.cloudStore?.configured) {
    window.cloudStore.save(state);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  if (message) showToast(message);
}

function memberById(id) {
  return state.members.find(member => member.id === id);
}

function memberTransactions(memberId, year = state.selectedYear) {
  return state.transactions.filter(item => item.memberId === memberId && yearOf(item.date) === Number(year));
}

function memberRedemptions(memberId, year = state.selectedYear) {
  return state.redemptions.filter(item => item.memberId === memberId && yearOf(item.date) === Number(year));
}

function annualSpend(memberId, year = state.selectedYear) {
  return memberTransactions(memberId, year).reduce((sum, item) => sum + Number(item.amount), 0);
}

function tierForSpend(spend) {
  return [...state.settings.tiers]
    .sort((a, b) => a.threshold - b.threshold)
    .reduce((tier, item) => spend >= item.threshold ? item : tier, state.settings.tiers[0]);
}

function tierIndex(name) {
  return state.settings.tiers.findIndex(tier => tier.name === name);
}

function achievedTier(member, year = state.selectedYear) {
  if (member.type === "老师本人") return { name: "老师专属", multiplier: state.settings.teacherPurchaseMultiplier };
  return tierForSpend(annualSpend(member.id, year));
}

function nextTier(member, year = state.selectedYear) {
  if (member.type === "老师本人") return "老师专属";
  const achieved = achievedTier(member, year).name;
  const initial = member.initialTier || state.settings.tiers[0].name;
  if (tierIndex(achieved) >= tierIndex(initial)) return achieved;
  return Number(year) <= Number(member.protectionUntil || 0) ? initial : achieved;
}

function transactionMetrics(transaction) {
  const member = memberById(transaction.memberId);
  if (!member) return { discount: 0, paid: 0, multiplier: 1, customerPoints: 0, teacherPoints: 0 };
  const year = yearOf(transaction.date);
  const amount = Number(transaction.amount || 0);
  const discount = member.type === "老师学生" ? amount * state.settings.studentDiscount : 0;
  const paid = amount - discount;
  const discountPoints = discount * state.settings.basePoints * state.settings.discountPointMultiplier;
  const multiplier = member.type === "老师本人"
    ? state.settings.teacherPurchaseMultiplier
    : tierForSpend(annualSpend(member.id, year)).multiplier;
  const customerPoints = Math.round(paid * state.settings.basePoints * multiplier + discountPoints);
  const teacherPoints = member.type === "老师学生"
    ? Math.round(customerPoints * state.settings.teacherStudentRate)
    : 0;
  return { discount, paid, discountPoints, multiplier, customerPoints, teacherPoints };
}

function customerPoints(memberId, year = state.selectedYear) {
  return memberTransactions(memberId, year).reduce((sum, item) => sum + transactionMetrics(item).customerPoints, 0);
}

function teacherContribution(memberId, year = state.selectedYear) {
  return state.transactions
    .filter(item => yearOf(item.date) === Number(year))
    .reduce((sum, item) => {
      const student = memberById(item.memberId);
      return student?.teacherId === memberId ? sum + transactionMetrics(item).teacherPoints : sum;
    }, 0);
}

function redeemedPoints(memberId, year = state.selectedYear) {
  return memberRedemptions(memberId, year).reduce((sum, item) => sum + Number(item.points), 0);
}

function settlementFor(member, year = state.selectedYear) {
  const earned = customerPoints(member.id, year) + (member.type === "老师本人" ? teacherContribution(member.id, year) : 0);
  const redeemed = redeemedPoints(member.id, year);
  const balance = Math.max(0, earned - redeemed);
  const carry = redeemed > 0 && balance < state.settings.minCarry ? balance : 0;
  const expired = Math.max(0, balance - carry);
  return {
    member,
    year,
    spend: annualSpend(member.id, year),
    tier: achievedTier(member, year).name,
    earned,
    redeemed,
    balance,
    carry,
    expired,
    nextTier: nextTier(member, year)
  };
}

function allSettlements(year = state.selectedYear) {
  return state.members.map(member => settlementFor(member, year));
}

function availablePoints(memberId, year = state.selectedYear) {
  return settlementFor(memberById(memberId), year).balance;
}

function typeBadge(type) {
  const className = type === "老师本人" ? "teacher" : type === "老师学生" ? "student" : "normal";
  return `<span class="badge ${className}">${type}</span>`;
}

function initials(name) {
  return String(name || "?").slice(-1);
}

function setupYears() {
  const years = new Set([state.selectedYear, new Date().getFullYear()]);
  state.transactions.forEach(item => years.add(yearOf(item.date)));
  state.redemptions.forEach(item => years.add(yearOf(item.date)));
  const ordered = [...years].filter(Boolean).sort((a, b) => b - a);
  $("#yearSelect").innerHTML = ordered.map(year => `<option value="${year}" ${year === Number(state.selectedYear) ? "selected" : ""}>${year}</option>`).join("");
}

function renderAll() {
  setupYears();
  renderDashboard();
  renderMembers();
  renderTransactions();
  renderRedemptions();
  renderSettlement();
  renderSettings();
}

function renderDashboard() {
  const settlements = allSettlements();
  const totalSpend = settlements.reduce((sum, item) => sum + item.spend, 0);
  const totalEarned = settlements.reduce((sum, item) => sum + item.earned, 0);
  const teacherPoints = state.transactions
    .filter(item => yearOf(item.date) === Number(state.selectedYear))
    .reduce((sum, item) => sum + transactionMetrics(item).teacherPoints, 0);
  const redeemed = settlements.reduce((sum, item) => sum + item.redeemed, 0);
  const kpis = [
    { icon: "◎", label: "会员总数", value: money(state.members.length), foot: `普通客户 ${state.members.filter(m => m.type === "普通客户").length} · 师生 ${state.members.filter(m => m.type !== "普通客户").length}` },
    { icon: "¥", label: "本年消费额", value: `¥ ${money(totalSpend)}`, foot: `${state.selectedYear} 年累计原价消费` },
    { icon: "积", label: "积分发放", value: points(totalEarned), foot: `其中老师贡献 ${money(teacherPoints)} 分` },
    { icon: "◇", label: "已兑换积分", value: points(redeemed), foot: `${state.redemptions.filter(r => yearOf(r.date) === Number(state.selectedYear)).length} 笔兑换记录` }
  ];
  $("#kpiGrid").innerHTML = kpis.map(item => `
    <article class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">${item.label}</span><span class="kpi-icon">${item.icon}</span></div>
      <div class="kpi-value">${item.value}</div>
      <div class="kpi-foot">${item.foot}</div>
    </article>`).join("");

  const tiers = state.settings.tiers;
  const tierData = tiers.map(tier => {
    const rows = settlements.filter(item => item.tier === tier.name);
    return {
      name: tier.name,
      count: rows.length,
      spend: rows.reduce((sum, row) => sum + row.spend, 0),
      earned: rows.reduce((sum, row) => sum + row.earned, 0)
    };
  });
  const max = Math.max(1, ...tierData.flatMap(item => [item.count * 1000, item.spend, item.earned]));
  $("#tierChart").innerHTML = tierData.map(item => `
    <div class="tier-column">
      <div class="bar-track">
        <div class="bar members" style="height:${Math.max(3, item.count * 1000 / max * 100)}%"><span>${item.count}人</span></div>
        <div class="bar spend" style="height:${Math.max(3, item.spend / max * 100)}%"><span>${money(item.spend)}</span></div>
        <div class="bar points" style="height:${Math.max(3, item.earned / max * 100)}%"><span>${money(item.earned)}</span></div>
      </div>
      <div class="tier-label">${item.name.replace("会员", "")}</div>
    </div>`).join("") + `
    <div class="chart-legend">
      <span><i style="background:var(--blue)"></i>人数</span>
      <span><i style="background:var(--accent)"></i>消费额</span>
      <span><i style="background:var(--gold)"></i>积分</span>
    </div>`;
  $("#chartCaption").textContent = `${state.selectedYear} 年`;

  const recent = state.transactions
    .filter(item => yearOf(item.date) === Number(state.selectedYear))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  $("#recentActivity").innerHTML = recent.length ? recent.map(item => {
    const member = memberById(item.memberId);
    const metrics = transactionMetrics(item);
    return `<div class="activity-item">
      <span class="avatar">${initials(member?.name)}</span>
      <div class="activity-main"><strong>${member?.name || "未知会员"}</strong><small>${item.date} · ${item.id} · ${member?.type || ""}</small></div>
      <div class="activity-value"><strong>¥ ${money(metrics.paid)}</strong><small>+${money(metrics.customerPoints)} 分</small></div>
    </div>`;
  }).join("") : `<div class="empty-state show">暂无消费流水</div>`;

  const s = state.settings;
  $("#ruleSummary").innerHTML = [
    ["普通会员等级", s.tiers.map(t => `${t.name.replace("会员", "")} ${t.multiplier}倍`).join(" · ")],
    ["老师本人", `购买积分 ${s.teacherPurchaseMultiplier} 倍`],
    ["老师学生", `${s.studentDiscount * 100}% 折扣额转 ${s.discountPointMultiplier} 倍积分`],
    ["老师贡献", `学生积分的 ${s.teacherStudentRate * 100}%`],
    ["年终保留", `兑换后不足 ${money(s.minCarry)} 分保留`]
  ].map(([label, value]) => `<div class="rule-row"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderMembers() {
  const query = ($("#memberSearch").value || "").trim().toLowerCase();
  const type = $("#memberTypeFilter").value;
  const rows = state.members.filter(member =>
    (!type || member.type === type) &&
    (!query || [member.id, member.name, member.teacherId].some(value => String(value || "").toLowerCase().includes(query)))
  );
  $("#memberTableBody").innerHTML = rows.map(member => {
    const settlement = settlementFor(member);
    const teacher = memberById(member.teacherId);
    return `<tr>
      <td><div class="cell-person"><span class="avatar">${initials(member.name)}</span><div><strong>${member.name}</strong><small>${member.id}</small></div></div></td>
      <td>${typeBadge(member.type)}</td>
      <td><span class="badge tier-badge">${settlement.tier}</span></td>
      <td>${teacher ? `${teacher.name}<small class="muted"> · ${teacher.id}</small>` : "—"}</td>
      <td>¥ ${money(settlement.spend)}</td>
      <td>${points(settlement.earned)}</td>
      <td><strong>${points(settlement.balance)}</strong></td>
      <td><div class="table-actions"><button title="编辑" data-edit-member="${member.id}">✎</button><button title="删除" data-delete-member="${member.id}">×</button></div></td>
    </tr>`;
  }).join("");
  $("#memberEmpty").classList.toggle("show", rows.length === 0);
}

function renderTransactions() {
  const query = ($("#transactionSearch").value || "").trim().toLowerCase();
  const type = $("#transactionTypeFilter").value;
  const rows = state.transactions
    .filter(item => yearOf(item.date) === Number(state.selectedYear))
    .filter(item => {
      const member = memberById(item.memberId);
      return (!type || member?.type === type) &&
        (!query || [item.id, item.memberId, member?.name].some(value => String(value || "").toLowerCase().includes(query)));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#transactionTableBody").innerHTML = rows.map(item => {
    const member = memberById(item.memberId);
    const metrics = transactionMetrics(item);
    return `<tr>
      <td><div class="two-line"><strong>${item.date}</strong><small>${item.id}</small></div></td>
      <td><div class="cell-person"><span class="avatar">${initials(member?.name)}</span><div><strong>${member?.name || "未知会员"}</strong><small>${item.memberId}</small></div></div></td>
      <td>${member ? typeBadge(member.type) : "—"}</td>
      <td>¥ ${money(item.amount)}</td>
      <td>${metrics.discount ? `-¥ ${money(metrics.discount)}` : "—"}</td>
      <td><strong>¥ ${money(metrics.paid)}</strong></td>
      <td>${metrics.multiplier} 倍</td>
      <td class="positive">+${points(metrics.customerPoints)}</td>
      <td>${metrics.teacherPoints ? `+${points(metrics.teacherPoints)}` : "—"}</td>
      <td><div class="table-actions"><button title="编辑" data-edit-transaction="${item.id}">✎</button><button title="删除" data-delete-transaction="${item.id}">×</button></div></td>
    </tr>`;
  }).join("");
  $("#transactionEmpty").classList.toggle("show", rows.length === 0);
}

function redemptionBalanceBefore(redemption) {
  const year = yearOf(redemption.date);
  const earned = customerPoints(redemption.memberId, year) +
    (memberById(redemption.memberId)?.type === "老师本人" ? teacherContribution(redemption.memberId, year) : 0);
  const prior = state.redemptions
    .filter(item => item.memberId === redemption.memberId && yearOf(item.date) === year && (item.date < redemption.date || (item.date === redemption.date && item.id < redemption.id)))
    .reduce((sum, item) => sum + Number(item.points), 0);
  return Math.max(0, earned - prior);
}

function renderRedemptions() {
  const query = ($("#redemptionSearch").value || "").trim().toLowerCase();
  const rows = state.redemptions
    .filter(item => yearOf(item.date) === Number(state.selectedYear))
    .filter(item => {
      const member = memberById(item.memberId);
      return !query || [item.id, item.memberId, member?.name].some(value => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#redemptionTableBody").innerHTML = rows.map(item => {
    const member = memberById(item.memberId);
    const before = redemptionBalanceBefore(item);
    return `<tr>
      <td><div class="two-line"><strong>${item.date}</strong><small>${item.id}</small></div></td>
      <td><div class="cell-person"><span class="avatar">${initials(member?.name)}</span><div><strong>${member?.name || "未知会员"}</strong><small>${item.memberId}</small></div></div></td>
      <td>${item.type}</td>
      <td class="danger">-${points(item.points)}</td>
      <td>${points(before)}</td>
      <td><strong>${points(Math.max(0, before - Number(item.points)))}</strong></td>
      <td>${item.note || "—"}</td>
      <td><div class="table-actions"><button title="编辑" data-edit-redemption="${item.id}">✎</button><button title="删除" data-delete-redemption="${item.id}">×</button></div></td>
    </tr>`;
  }).join("");
  $("#redemptionEmpty").classList.toggle("show", rows.length === 0);
}

function renderSettlement() {
  const rows = allSettlements();
  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  const totalCarry = rows.reduce((sum, row) => sum + row.carry, 0);
  const totalExpired = rows.reduce((sum, row) => sum + row.expired, 0);
  $("#settlementYear").textContent = state.selectedYear;
  $("#settlementStats").innerHTML = [
    ["兑换后积分余额", points(totalBalance), ""],
    ["可带入下一年", points(totalCarry), "positive"],
    ["核算后将失效", points(totalExpired), "danger"]
  ].map(([label, value, cls]) => `<article class="settlement-stat"><span>${label}</span><strong class="${cls}">${value}</strong></article>`).join("");
  $("#settlementTableBody").innerHTML = rows.map(row => `<tr>
    <td><div class="cell-person"><span class="avatar">${initials(row.member.name)}</span><div><strong>${row.member.name}</strong><small>${row.member.id}</small></div></div></td>
    <td>${typeBadge(row.member.type)}</td>
    <td>${row.member.initialTier}</td>
    <td>¥ ${money(row.spend)}</td>
    <td>${points(row.earned)}</td>
    <td>${points(row.redeemed)}</td>
    <td>${points(row.balance)}</td>
    <td class="positive">${points(row.carry)}</td>
    <td class="danger">${points(row.expired)}</td>
    <td><span class="badge tier-badge">${row.nextTier}</span></td>
  </tr>`).join("");
}

function renderSettings() {
  const form = $("#settingsForm");
  const s = state.settings;
  form.elements.basePoints.value = s.basePoints;
  form.elements.settlementDays.value = s.settlementDays;
  form.elements.minCarry.value = s.minCarry;
  form.elements.teacherPurchaseMultiplier.value = s.teacherPurchaseMultiplier;
  form.elements.studentDiscount.value = s.studentDiscount * 100;
  form.elements.discountPointMultiplier.value = s.discountPointMultiplier;
  form.elements.teacherStudentRate.value = s.teacherStudentRate * 100;
  $("#tierSettings").innerHTML = s.tiers.map((tier, index) => `
    <div class="tier-setting-row">
      <strong>${tier.name}</strong>
      <label><span>年消费门槛</span><input type="number" min="0" name="tierThreshold${index}" value="${tier.threshold}"></label>
      <label><span>积分倍率</span><input type="number" min="0" step="0.1" name="tierMultiplier${index}" value="${tier.multiplier}"></label>
    </div>`).join("");
}

function switchView(view) {
  currentView = view;
  $$(".view").forEach(item => item.classList.toggle("active", item.id === `view-${view}`));
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  const labels = {
    dashboard: ["积分运营工作台", "经营总览"],
    members: ["客户与关系管理", "会员管理"],
    transactions: ["自动计算折扣与积分", "消费流水"],
    redemptions: ["积分核销与余额", "积分兑换"],
    settlement: ["年度核算与等级建议", "年度结算"],
    settings: ["可调整的业务口径", "规则参数"]
  };
  $("#pageEyebrow").textContent = labels[view][0];
  $("#pageTitle").textContent = labels[view][1];
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(type, id = null) {
  currentModal = type;
  editingId = id;
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  const body = $("#modalBody");
  if (type === "member") {
    const item = id ? memberById(id) : { id: nextId("member"), name: "", type: "普通客户", teacherId: "", joinedAt: today(), initialTier: "普通会员", protectionUntil: state.selectedYear, note: "" };
    $("#modalKicker").textContent = "会员档案";
    $("#modalTitle").textContent = id ? "编辑会员" : "新增会员";
    body.innerHTML = `
      ${field("客户编号", "id", item.id, "text", true)}
      ${field("姓名", "name", item.name, "text", true)}
      ${selectField("会员体系", "type", ["普通客户", "老师本人", "老师学生"], item.type)}
      ${selectField("关联老师", "teacherId", [{ value: "", label: "无" }, ...state.members.filter(m => m.type === "老师本人").map(m => ({ value: m.id, label: `${m.name} · ${m.id}` }))], item.teacherId)}
      ${field("注册日期", "joinedAt", item.joinedAt, "date", true)}
      ${selectField("期初等级", "initialTier", state.settings.tiers.map(t => t.name), item.initialTier)}
      ${field("等级保护到期年", "protectionUntil", item.protectionUntil, "number", true)}
      ${textareaField("备注", "note", item.note)}`;
    toggleTeacherField();
    $('[name="type"]', body).addEventListener("change", toggleTeacherField);
  } else if (type === "transaction") {
    const item = id ? state.transactions.find(row => row.id === id) : { id: nextId("transaction"), date: today(), memberId: state.members[0]?.id || "", amount: "", note: "" };
    $("#modalKicker").textContent = "消费入账";
    $("#modalTitle").textContent = id ? "编辑消费流水" : "记一笔消费";
    body.innerHTML = `
      ${field("交易编号", "id", item.id, "text", true)}
      ${field("交易日期", "date", item.date, "date", true)}
      ${selectField("选择会员", "memberId", state.members.map(m => ({ value: m.id, label: `${m.name} · ${m.id} · ${m.type}` })), item.memberId, "full")}
      ${field("消费金额原价", "amount", item.amount, "number", true, 'min="0" step="0.01"')}
      ${textareaField("备注", "note", item.note)}
      <div class="calculation-preview" id="transactionPreview"></div>`;
    updateTransactionPreview();
    $('[name="memberId"]', body).addEventListener("change", updateTransactionPreview);
    $('[name="amount"]', body).addEventListener("input", updateTransactionPreview);
    $('[name="date"]', body).addEventListener("change", updateTransactionPreview);
  } else {
    const item = id ? state.redemptions.find(row => row.id === id) : { id: nextId("redemption"), date: today(), memberId: state.members[0]?.id || "", points: "", type: "客户积分", note: "" };
    $("#modalKicker").textContent = "积分核销";
    $("#modalTitle").textContent = id ? "编辑兑换记录" : "新增积分兑换";
    body.innerHTML = `
      ${field("兑换单号", "id", item.id, "text", true)}
      ${field("兑换日期", "date", item.date, "date", true)}
      ${selectField("选择会员", "memberId", state.members.map(m => ({ value: m.id, label: `${m.name} · ${m.id}` })), item.memberId, "full")}
      ${selectField("兑换类型", "type", ["客户积分", "老师积分"], item.type)}
      ${field("兑换积分", "points", item.points, "number", true, 'min="1" step="1"')}
      ${textareaField("备注", "note", item.note)}
      <div class="calculation-preview" id="redemptionPreview"></div>`;
    updateRedemptionPreview();
    $('[name="memberId"]', body).addEventListener("change", updateRedemptionPreview);
    $('[name="points"]', body).addEventListener("input", updateRedemptionPreview);
    $('[name="date"]', body).addEventListener("change", updateRedemptionPreview);
  }
  setTimeout(() => $("input, select", body)?.focus(), 0);
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  document.body.style.overflow = "";
  currentModal = null;
  editingId = null;
  $("#modalForm").reset();
}

function field(label, name, value, type = "text", required = false, extra = "") {
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${value ?? ""}" ${required ? "required" : ""} ${extra}></label>`;
}

function selectField(label, name, options, selected, className = "") {
  const normalized = options.map(option => typeof option === "string" ? { value: option, label: option } : option);
  return `<label class="${className}"><span>${label}</span><select name="${name}">${normalized.map(option => `<option value="${option.value}" ${option.value === selected ? "selected" : ""}>${option.label}</option>`).join("")}</select></label>`;
}

function textareaField(label, name, value) {
  return `<label class="full"><span>${label}</span><textarea name="${name}">${value || ""}</textarea></label>`;
}

function toggleTeacherField() {
  const type = $('[name="type"]', $("#modalBody"))?.value;
  const field = $('[name="teacherId"]', $("#modalBody"))?.closest("label");
  if (field) field.style.display = type === "老师学生" ? "" : "none";
}

function updateTransactionPreview() {
  const form = $("#modalForm");
  const preview = $("#transactionPreview");
  if (!preview) return;
  const memberId = form.elements.memberId?.value;
  const amount = Number(form.elements.amount?.value || 0);
  const date = form.elements.date?.value || today();
  const temp = { id: editingId || "TEMP", memberId, amount, date };
  const existing = editingId ? state.transactions.findIndex(row => row.id === editingId) : -1;
  let removed;
  if (existing >= 0) removed = state.transactions.splice(existing, 1)[0];
  state.transactions.push(temp);
  const metrics = transactionMetrics(temp);
  state.transactions.pop();
  if (removed) state.transactions.splice(existing, 0, removed);
  preview.innerHTML = [
    ["折扣金额", `¥ ${money(metrics.discount)}`],
    ["实付金额", `¥ ${money(metrics.paid)}`],
    ["积分倍率", `${metrics.multiplier} 倍`],
    ["预计获积分", points(metrics.customerPoints)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function updateRedemptionPreview() {
  const form = $("#modalForm");
  const preview = $("#redemptionPreview");
  if (!preview) return;
  const memberId = form.elements.memberId?.value;
  const year = yearOf(form.elements.date?.value || today());
  const requested = Number(form.elements.points?.value || 0);
  const available = memberById(memberId) ? availablePoints(memberId, year) + (editingId ? Number(state.redemptions.find(r => r.id === editingId)?.points || 0) : 0) : 0;
  preview.innerHTML = [
    ["当前可用", points(available)],
    ["本次兑换", points(requested)],
    ["兑换后", points(Math.max(0, available - requested))],
    ["最低保留", points(state.settings.minCarry)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function submitModal(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  if (currentModal === "member") {
    if (!data.id.trim() || !data.name.trim()) return showToast("请填写会员编号和姓名");
    const duplicate = state.members.some(item => item.id === data.id.trim() && item.id !== editingId);
    if (duplicate) return showToast("会员编号已存在");
    const item = {
      id: data.id.trim(), name: data.name.trim(), type: data.type,
      teacherId: data.type === "老师学生" ? data.teacherId : "",
      joinedAt: data.joinedAt, initialTier: data.initialTier,
      protectionUntil: Number(data.protectionUntil), note: data.note.trim()
    };
    upsert(state.members, item);
    saveState(editingId ? "会员资料已更新" : "会员已创建");
  } else if (currentModal === "transaction") {
    const amount = Number(data.amount);
    if (!amount || amount <= 0) return showToast("消费金额必须大于 0");
    if (state.transactions.some(item => item.id === data.id.trim() && item.id !== editingId)) return showToast("交易编号已存在");
    upsert(state.transactions, { id: data.id.trim(), date: data.date, memberId: data.memberId, amount, note: data.note.trim() });
    saveState(editingId ? "消费流水已更新并重新计算" : "消费已入账，积分已自动计算");
  } else {
    const requested = Number(data.points);
    const year = yearOf(data.date);
    const available = availablePoints(data.memberId, year) + (editingId ? Number(state.redemptions.find(r => r.id === editingId)?.points || 0) : 0);
    if (!requested || requested <= 0) return showToast("兑换积分必须大于 0");
    if (requested > available) return showToast(`可用积分不足，当前最多可兑换 ${money(available)} 分`);
    if (state.redemptions.some(item => item.id === data.id.trim() && item.id !== editingId)) return showToast("兑换单号已存在");
    upsert(state.redemptions, { id: data.id.trim(), date: data.date, memberId: data.memberId, points: requested, type: data.type, note: data.note.trim() });
    saveState(editingId ? "兑换记录已更新" : "积分兑换已登记");
  }
  closeModal();
  renderAll();
}

function upsert(collection, item) {
  const index = collection.findIndex(row => row.id === editingId);
  if (index >= 0) collection[index] = item;
  else collection.push(item);
}

function deleteRecord(kind, id) {
  const labels = { member: "会员", transaction: "消费流水", redemption: "兑换记录" };
  if (!confirm(`确定删除这条${labels[kind]}吗？`)) return;
  if (kind === "member") {
    const hasRecords = state.transactions.some(item => item.memberId === id) || state.redemptions.some(item => item.memberId === id);
    if (hasRecords) return showToast("该会员已有消费或兑换记录，不能直接删除");
    state.members = state.members.filter(item => item.id !== id);
  } else if (kind === "transaction") {
    state.transactions = state.transactions.filter(item => item.id !== id);
  } else {
    state.redemptions = state.redemptions.filter(item => item.id !== id);
  }
  saveState(`${labels[kind]}已删除`);
  renderAll();
}

function nextId(type) {
  const config = type === "member" ? ["C", state.members.map(i => i.id)] :
    type === "transaction" ? ["TX", state.transactions.map(i => i.id)] :
    ["RD", state.redemptions.map(i => i.id)];
  let number = 1;
  while (config[1].includes(`${config[0]}${String(number).padStart(3, "0")}`)) number++;
  return `${config[0]}${String(number).padStart(3, "0")}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget.elements;
  state.settings.basePoints = Number(form.basePoints.value);
  state.settings.settlementDays = Number(form.settlementDays.value);
  state.settings.minCarry = Number(form.minCarry.value);
  state.settings.teacherPurchaseMultiplier = Number(form.teacherPurchaseMultiplier.value);
  state.settings.studentDiscount = Number(form.studentDiscount.value) / 100;
  state.settings.discountPointMultiplier = Number(form.discountPointMultiplier.value);
  state.settings.teacherStudentRate = Number(form.teacherStudentRate.value) / 100;
  state.settings.tiers = state.settings.tiers.map((tier, index) => ({
    ...tier,
    threshold: Number(form[`tierThreshold${index}`].value),
    multiplier: Number(form[`tierMultiplier${index}`].value)
  })).sort((a, b) => a.threshold - b.threshold);
  saveState("规则参数已保存，全部数据已重新计算");
  renderAll();
}

function exportData() {
  downloadBlob(`会员积分系统数据-${today()}.json`, JSON.stringify(state, null, 2), "application/json");
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.settings || !Array.isArray(data.members) || !Array.isArray(data.transactions)) throw new Error();
      state = data;
      saveState("数据导入成功");
      renderAll();
    } catch {
      showToast("导入失败：文件格式不正确");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function downloadSettlement() {
  const headers = ["年度", "会员编号", "姓名", "会员体系", "年度消费", "年度积分", "已兑换", "兑换后余额", "可保留", "将失效", "下一年等级"];
  const rows = allSettlements().map(row => [
    state.selectedYear, row.member.id, row.member.name, row.member.type, row.spend,
    row.earned, row.redeemed, row.balance, row.carry, row.expired, row.nextTier
  ]);
  const csv = "\ufeff" + [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(`${state.selectedYear}年度积分结算.csv`, csv, "text/csv;charset=utf-8");
}

function downloadBlob(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view]");
  if (nav) switchView(nav.dataset.view);
  const jump = event.target.closest("[data-view-jump]");
  if (jump) switchView(jump.dataset.viewJump);
  const open = event.target.closest("[data-open-modal]");
  if (open) openModal(open.dataset.openModal);
  const editMember = event.target.closest("[data-edit-member]");
  if (editMember) openModal("member", editMember.dataset.editMember);
  const editTransaction = event.target.closest("[data-edit-transaction]");
  if (editTransaction) openModal("transaction", editTransaction.dataset.editTransaction);
  const editRedemption = event.target.closest("[data-edit-redemption]");
  if (editRedemption) openModal("redemption", editRedemption.dataset.editRedemption);
  const deleteMember = event.target.closest("[data-delete-member]");
  if (deleteMember) deleteRecord("member", deleteMember.dataset.deleteMember);
  const deleteTransaction = event.target.closest("[data-delete-transaction]");
  if (deleteTransaction) deleteRecord("transaction", deleteTransaction.dataset.deleteTransaction);
  const deleteRedemption = event.target.closest("[data-delete-redemption]");
  if (deleteRedemption) deleteRecord("redemption", deleteRedemption.dataset.deleteRedemption);
  if (event.target === $("#modalBackdrop")) closeModal();
});

$("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#closeModal").addEventListener("click", closeModal);
$("#cancelModal").addEventListener("click", closeModal);
$("#modalForm").addEventListener("submit", submitModal);
$("#yearSelect").addEventListener("change", event => {
  state.selectedYear = Number(event.target.value);
  saveState();
  renderAll();
});
$("#memberSearch").addEventListener("input", renderMembers);
$("#memberTypeFilter").addEventListener("change", renderMembers);
$("#transactionSearch").addEventListener("input", renderTransactions);
$("#transactionTypeFilter").addEventListener("change", renderTransactions);
$("#redemptionSearch").addEventListener("input", renderRedemptions);
$("#settingsForm").addEventListener("submit", saveSettings);
$("#exportData").addEventListener("click", exportData);
$("#importData").addEventListener("change", importData);
$("#downloadSettlement").addEventListener("click", downloadSettlement);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#modalBackdrop").hidden) closeModal();
});

async function startOnlineApp() {
  if (!window.cloudStore) {
    state = loadState();
    document.body.classList.remove("cloud-loading");
    renderAll();
    return;
  }
  await window.cloudStore.init(defaultState, cloudState => {
    state = clone(cloudState);
    renderAll();
  });
}

startOnlineApp();
