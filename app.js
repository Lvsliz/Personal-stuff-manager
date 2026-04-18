const APP_VERSION = "1.1.0";
const DATA_SCHEMA_VERSION = 1;
const STORAGE_KEY = "home-inventory-tracker-v1";
const EXPIRING_WINDOW_DAYS = 30;

const state = loadState();
let deferredInstallPrompt = null;

const elements = {
  itemForm: document.querySelector("#item-form"),
  resetForm: document.querySelector("#reset-form"),
  usageForm: document.querySelector("#usage-form"),
  inventoryList: document.querySelector("#inventory-list"),
  purchaseList: document.querySelector("#purchase-list"),
  activityList: document.querySelector("#activity-list"),
  alertsList: document.querySelector("#alerts-list"),
  statsGrid: document.querySelector("#stats-grid"),
  usageItemSelect: document.querySelector("#usage-item-id"),
  usageDate: document.querySelector("#usage-date"),
  usageType: document.querySelector("#usage-type"),
  usageLocation: document.querySelector("#usage-location"),
  searchInput: document.querySelector("#search-input"),
  filterStatus: document.querySelector("#filter-status"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  seedDemo: document.querySelector("#seed-demo"),
  installApp: document.querySelector("#install-app"),
  heroTotalStock: document.querySelector("#hero-total-stock"),
  heroExpiringCount: document.querySelector("#hero-expiring-count"),
  heroStockValue: document.querySelector("#hero-stock-value"),
};

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

elements.itemForm.addEventListener("submit", handleItemSubmit);
elements.resetForm.addEventListener("click", resetItemForm);
elements.usageForm.addEventListener("submit", handleUsageSubmit);
elements.searchInput.addEventListener("input", renderAll);
elements.filterStatus.addEventListener("change", renderAll);
elements.exportData.addEventListener("click", exportData);
elements.importData.addEventListener("change", importData);
elements.seedDemo.addEventListener("click", seedDemoData);
elements.usageType.addEventListener("change", toggleUsageLocation);
elements.installApp.addEventListener("click", installApp);

elements.usageDate.value = formatDateInput(new Date());
toggleUsageLocation();
registerInstallPrompt();
registerServiceWorker();
renderAll();

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return migrateDataShape(parsed);
  } catch (error) {
    console.warn("Failed to parse local data", error);
  }
  return createEmptyState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createExportPayload()));
}

function handleItemSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.itemForm);
  const id = formData.get("id") || crypto.randomUUID();
  const quantity = parseNumber(formData.get("quantity"));
  const totalCost = parseNumber(formData.get("totalCost"));
  const packCount = parseNumber(formData.get("packCount"), 1);

  const existing = state.items.find((item) => item.id === id);
  const item = {
    id,
    name: formData.get("name")?.trim(),
    category: formData.get("category")?.trim(),
    brand: formData.get("brand")?.trim(),
    location: formData.get("location")?.trim(),
    unit: formData.get("unit")?.trim(),
    quantity,
    threshold: parseNumber(formData.get("threshold"), 1),
    purchaseDate: formData.get("purchaseDate") || "",
    openDate: formData.get("openDate") || "",
    expiryDate: formData.get("expiryDate") || "",
    packCount,
    totalCost,
    avgCost: packCount > 0 ? totalCost / packCount : 0,
    note: formData.get("note")?.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!item.name || !item.location || !item.unit) {
    return;
  }

  if (existing) {
    Object.assign(existing, item);
    addActivity("edit", item.id, `${item.name} 的资料已更新`);
  } else {
    state.items.unshift(item);
    addActivity("create", item.id, `新增 ${item.name}，入库 ${quantity} ${item.unit}`);
  }

  saveState();
  resetItemForm();
  renderAll();
}

function resetItemForm() {
  elements.itemForm.reset();
  document.querySelector("#item-id").value = "";
  document.querySelector("#item-threshold").value = 1;
  document.querySelector("#item-pack-count").value = 1;
}

function handleUsageSubmit(event) {
  event.preventDefault();
  const itemId = elements.usageItemSelect.value;
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  const amount = parseNumber(document.querySelector("#usage-amount").value, 0);
  const date = elements.usageDate.value || formatDateInput(new Date());
  const note = document.querySelector("#usage-note").value.trim();
  const type = elements.usageType.value;
  const nextLocation = elements.usageLocation.value.trim();

  if (type === "consume") {
    item.quantity = Math.max(0, item.quantity - amount);
    addActivity("consume", item.id, `${item.name} 消耗 ${amount} ${item.unit}`, date, note);
  }

  if (type === "restock") {
    item.quantity += amount;
    addActivity("restock", item.id, `${item.name} 补货 ${amount} ${item.unit}`, date, note);
  }

  if (type === "open") {
    item.openDate = date;
    addActivity("open", item.id, `${item.name} 开始使用`, date, note);
  }

  if (type === "move" && nextLocation) {
    const previous = item.location;
    item.location = nextLocation;
    addActivity("move", item.id, `${item.name} 从 ${previous} 移到 ${nextLocation}`, date, note);
  }

  item.updatedAt = new Date().toISOString();
  saveState();
  elements.usageForm.reset();
  elements.usageDate.value = formatDateInput(new Date());
  toggleUsageLocation();
  renderAll();
}

function addActivity(type, itemId, summary, date = formatDateInput(new Date()), note = "") {
  state.activities.unshift({
    id: crypto.randomUUID(),
    type,
    itemId,
    summary,
    note,
    date,
    createdAt: new Date().toISOString(),
  });
}

function renderAll() {
  saveState();
  const filteredItems = getFilteredItems();
  renderStats();
  renderHeroMetrics();
  renderAlerts();
  renderInventory(filteredItems);
  renderPurchases();
  renderActivities();
  renderUsageOptions();
}

function renderHeroMetrics() {
  const totalStock = state.items.reduce((sum, item) => sum + item.quantity, 0);
  const expiring = state.items.filter((item) => getItemStatus(item).type === "expiring").length;
  const value = state.items.reduce((sum, item) => sum + item.quantity * getPerUnitCost(item), 0);
  elements.heroTotalStock.textContent = totalStock.toFixed(0);
  elements.heroExpiringCount.textContent = String(expiring);
  elements.heroStockValue.textContent = currency(value);
}

function renderStats() {
  const config = [
    {
      label: "总物品数",
      value: state.items.length,
      hint: "按条目管理，不需要再翻备忘录",
    },
    {
      label: "已开封物品",
      value: state.items.filter((item) => item.openDate).length,
      hint: "可以快速知道哪些已经拿出来使用",
    },
    {
      label: "低库存",
      value: state.items.filter((item) => getItemStatus(item).type === "low").length,
      hint: "到阈值就提醒，下次凑单时一起买",
    },
    {
      label: "已过期",
      value: state.items.filter((item) => getItemStatus(item).type === "expired").length,
      hint: "避免忘在角落里",
    },
  ];

  elements.statsGrid.innerHTML = "";
  const template = document.querySelector("#stat-card-template");
  config.forEach((entry) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".stat-card__label").textContent = entry.label;
    node.querySelector(".stat-card__value").textContent = String(entry.value);
    node.querySelector(".stat-card__hint").textContent = entry.hint;
    elements.statsGrid.appendChild(node);
  });
}

function renderAlerts() {
  const alerts = state.items
    .map((item) => ({ item, status: getItemStatus(item) }))
    .filter(({ status }) => status.type !== "healthy")
    .sort((left, right) => left.status.rank - right.status.rank);

  renderEmptyableList(elements.alertsList, alerts, "目前没有需要重点关注的物品。", ({ item, status }) => {
    const alert = document.createElement("article");
    alert.className = "alert-item";
    alert.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="alert-item__meta">${escapeHtml(item.location)} · ${escapeHtml(status.message)}</div>
      </div>
      <span class="badge ${status.badgeClass}">${escapeHtml(status.label)}</span>
    `;
    return alert;
  });
}

function renderInventory(items) {
  const template = document.querySelector("#item-card-template");
  renderEmptyableList(elements.inventoryList, items, "还没有物品，先录入一条试试看。", (item) => {
    const status = getItemStatus(item);
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".item-card__name").textContent = item.name;
    node.querySelector(".item-card__status").textContent = status.label;
    node.querySelector(".item-card__status").classList.add(status.badgeClass);
    node.querySelector(".item-card__meta").textContent = [item.category, item.brand, item.location].filter(Boolean).join(" · ");
    node.querySelector(".item-card__quantity").textContent = `${trimNumber(item.quantity)} ${item.unit}`;
    node.querySelector(".item-card__details").innerHTML = [
      item.purchaseDate ? `购买：${formatDisplayDate(item.purchaseDate)}` : "",
      item.openDate ? `启用：${formatDisplayDate(item.openDate)}` : "未启用",
      item.expiryDate ? `过期：${formatDisplayDate(item.expiryDate)}` : "未记录保质期",
      item.note ? `备注：${escapeHtml(item.note)}` : "",
    ].filter(Boolean).join("<br>");
    node.querySelector(".item-card__pricing").textContent =
      `总价 ${currency(item.totalCost)} · 均价 ${currency(item.avgCost)} / 件 · 估算单单位成本 ${currency(getPerUnitCost(item))}`;

    node.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => handleItemAction(button.dataset.action, item.id));
    });

    return node;
  });
}

function renderPurchases() {
  const purchases = [...state.items]
    .filter((item) => item.purchaseDate)
    .sort((left, right) => right.purchaseDate.localeCompare(left.purchaseDate))
    .slice(0, 8);

  renderEmptyableList(elements.purchaseList, purchases, "采购记录会在这里显示。", (item) => {
    const entry = document.createElement("article");
    entry.className = "timeline-item";
    entry.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="timeline-item__meta">
          ${formatDisplayDate(item.purchaseDate)} · ${trimNumber(item.packCount)} 件 · ${currency(item.totalCost)}
        </div>
      </div>
      <span>${currency(item.avgCost)} / 件</span>
    `;
    return entry;
  });
}

function renderActivities() {
  renderEmptyableList(elements.activityList, state.activities.slice(0, 10), "库存动作会按时间记录在这里。", (activity) => {
    const item = state.items.find((entry) => entry.id === activity.itemId);
    const entry = document.createElement("article");
    entry.className = "timeline-item";
    entry.innerHTML = `
      <div>
        <strong>${escapeHtml(activity.summary)}</strong>
        <div class="timeline-item__meta">
          ${formatDisplayDate(activity.date)} · ${escapeHtml(item?.name || "已删除物品")}
        </div>
        ${activity.note ? `<div class="timeline-item__meta">${escapeHtml(activity.note)}</div>` : ""}
      </div>
      <span class="badge badge--info">${getActivityLabel(activity.type)}</span>
    `;
    return entry;
  });
}

function renderUsageOptions() {
  const currentValue = elements.usageItemSelect.value;
  elements.usageItemSelect.innerHTML = state.items.length
    ? state.items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${trimNumber(item.quantity)} ${escapeHtml(item.unit)}</option>`).join("")
    : '<option value="">请先新增物品</option>';

  if ([...elements.usageItemSelect.options].some((option) => option.value === currentValue)) {
    elements.usageItemSelect.value = currentValue;
  }
}

function handleItemAction(action, itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  if (action === "edit") {
    fillItemForm(item);
    document.querySelector("#item-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (action === "duplicate") {
    const copy = {
      ...item,
      id: crypto.randomUUID(),
      name: `${item.name}（副本）`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.items.unshift(copy);
    addActivity("create", copy.id, `复制 ${item.name} 创建新条目`);
    renderAll();
  }

  if (action === "delete") {
    const confirmed = window.confirm(`确认删除「${item.name}」吗？`);
    if (!confirmed) {
      return;
    }
    state.items = state.items.filter((entry) => entry.id !== itemId);
    addActivity("delete", itemId, `删除 ${item.name}`);
    renderAll();
  }
}

function fillItemForm(item) {
  document.querySelector("#item-id").value = item.id;
  document.querySelector("#item-name").value = item.name;
  document.querySelector("#item-category").value = item.category || "";
  document.querySelector("#item-brand").value = item.brand || "";
  document.querySelector("#item-location").value = item.location;
  document.querySelector("#item-unit").value = item.unit;
  document.querySelector("#item-quantity").value = item.quantity;
  document.querySelector("#item-threshold").value = item.threshold;
  document.querySelector("#item-purchase-date").value = item.purchaseDate || "";
  document.querySelector("#item-open-date").value = item.openDate || "";
  document.querySelector("#item-expiry-date").value = item.expiryDate || "";
  document.querySelector("#item-pack-count").value = item.packCount || 1;
  document.querySelector("#item-total-cost").value = item.totalCost || "";
  document.querySelector("#item-note").value = item.note || "";
}

function getFilteredItems() {
  const keyword = elements.searchInput.value.trim().toLowerCase();
  const filter = elements.filterStatus.value;

  return [...state.items]
    .filter((item) => {
      const haystack = [item.name, item.category, item.brand, item.location].join(" ").toLowerCase();
      return !keyword || haystack.includes(keyword);
    })
    .filter((item) => {
      const status = getItemStatus(item).type;
      if (filter === "all") return true;
      if (filter === "active") return item.quantity > 0;
      return status === filter;
    })
    .sort((left, right) => getItemStatus(left).rank - getItemStatus(right).rank || left.name.localeCompare(right.name, "zh-CN"));
}

function getItemStatus(item) {
  const today = startOfDay(new Date());
  const expiry = item.expiryDate ? parseLocalDate(item.expiryDate) : null;

  if (expiry && expiry < today) {
    return { type: "expired", label: "已过期", badgeClass: "badge--expired", message: `已于 ${formatDisplayDate(item.expiryDate)} 过期`, rank: 0 };
  }

  if (item.quantity <= item.threshold) {
    return { type: "low", label: "低库存", badgeClass: "badge--low", message: `只剩 ${trimNumber(item.quantity)} ${item.unit}`, rank: 1 };
  }

  if (expiry) {
    const diff = Math.ceil((expiry - today) / 86400000);
    if (diff <= EXPIRING_WINDOW_DAYS) {
      return { type: "expiring", label: "即将到期", badgeClass: "badge--expiring", message: `${diff} 天内到期`, rank: 2 };
    }
  }

  if (item.openDate) {
    return { type: "active", label: "使用中", badgeClass: "badge--opened", message: `已于 ${formatDisplayDate(item.openDate)} 启用`, rank: 3 };
  }

  return { type: "healthy", label: "储备中", badgeClass: "badge--healthy", message: "库存状态正常", rank: 4 };
}

function toggleUsageLocation() {
  elements.usageLocation.disabled = elements.usageType.value !== "move";
}

function exportData() {
  const blob = new Blob([JSON.stringify(createExportPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `inventory-backup-v${DATA_SCHEMA_VERSION}-${formatDateInput(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const migrated = migrateDataShape(parsed);
      state.items = migrated.items;
      state.activities = migrated.activities;
      saveState();
      renderAll();
      window.alert("数据已导入。");
    } catch (error) {
      window.alert("导入失败，请确认文件格式正确。");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function seedDemoData() {
  if (state.items.length > 0) {
    const confirmed = window.confirm("填充示例数据会保留当前数据，并额外加入示例条目，是否继续？");
    if (!confirmed) {
      return;
    }
  }

  const now = new Date();
  const samples = [
    {
      name: "抽纸",
      category: "居家",
      brand: "心相印",
      location: "客厅电视柜",
      unit: "包",
      quantity: 10,
      threshold: 3,
      purchaseDate: offsetDate(now, -18),
      openDate: offsetDate(now, -4),
      expiryDate: offsetDate(now, 240),
      packCount: 24,
      totalCost: 79.9,
      note: "常用，记得先拿旧批次",
    },
    {
      name: "洗衣凝珠",
      category: "清洁",
      brand: "汰渍",
      location: "阳台上柜",
      unit: "颗",
      quantity: 12,
      threshold: 8,
      purchaseDate: offsetDate(now, -40),
      openDate: "",
      expiryDate: offsetDate(now, 120),
      packCount: 52,
      totalCost: 55.6,
      note: "大促囤货",
    },
    {
      name: "漱口水",
      category: "洗护",
      brand: "李施德林",
      location: "卫生间镜柜",
      unit: "瓶",
      quantity: 1,
      threshold: 1,
      purchaseDate: offsetDate(now, -65),
      openDate: offsetDate(now, -2),
      expiryDate: offsetDate(now, 65),
      packCount: 3,
      totalCost: 72,
      note: "快用完了，下次可凑单",
    },
  ];

  samples.forEach((sample) => {
    const item = {
      id: crypto.randomUUID(),
      ...sample,
      avgCost: sample.totalCost / sample.packCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.items.unshift(item);
    addActivity("create", item.id, `新增 ${item.name}，入库 ${item.quantity} ${item.unit}`, item.purchaseDate);
  });

  saveState();
  renderAll();
}

function createEmptyState() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    items: [],
    activities: [],
  };
}

function createExportPayload() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    items: state.items.map(normalizeItem),
    activities: state.activities.map(normalizeActivity),
  };
}

function migrateDataShape(input) {
  if (!input) {
    return createEmptyState();
  }

  if (Array.isArray(input.items) && Array.isArray(input.activities)) {
    return {
      schemaVersion: Number(input.schemaVersion) || 1,
      appVersion: input.appVersion || "legacy",
      items: input.items.map(normalizeItem),
      activities: input.activities.map(normalizeActivity),
    };
  }

  if (Array.isArray(input)) {
    return {
      schemaVersion: 1,
      appVersion: "legacy-array",
      items: input.map(normalizeItem),
      activities: [],
    };
  }

  return createEmptyState();
}

function normalizeItem(item) {
  return {
    id: item.id || crypto.randomUUID(),
    name: String(item.name || "").trim(),
    category: String(item.category || "").trim(),
    brand: String(item.brand || "").trim(),
    location: String(item.location || "").trim(),
    unit: String(item.unit || "件").trim(),
    quantity: parseNumber(item.quantity),
    threshold: parseNumber(item.threshold, 1),
    purchaseDate: item.purchaseDate || "",
    openDate: item.openDate || "",
    expiryDate: item.expiryDate || "",
    packCount: Math.max(1, parseNumber(item.packCount, 1)),
    totalCost: parseNumber(item.totalCost),
    avgCost: parseNumber(item.avgCost),
    note: String(item.note || "").trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function normalizeActivity(activity) {
  return {
    id: activity.id || crypto.randomUUID(),
    type: activity.type || "log",
    itemId: activity.itemId || "",
    summary: String(activity.summary || "").trim(),
    note: String(activity.note || "").trim(),
    date: activity.date || formatDateInput(new Date()),
    createdAt: activity.createdAt || new Date().toISOString(),
  };
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

function registerInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installApp.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.installApp.hidden = true;
  });
}

async function installApp() {
  if (!deferredInstallPrompt) {
    window.alert("当前浏览器还没有提供安装提示。你也可以使用浏览器菜单中的“安装应用”或“创建快捷方式”。");
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  elements.installApp.hidden = true;
}

function renderEmptyableList(container, entries, emptyText, renderItem) {
  container.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    container.appendChild(renderItem(entry));
  });
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPerUnitCost(item) {
  return item.packCount > 0 ? item.totalCost / item.packCount : 0;
}

function currency(value) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value || 0);
}

function trimNumber(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function formatDateInput(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(parseLocalDate(value)) : "未记录";
}

function offsetDate(base, days) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value) {
  if (!value) {
    return new Date("");
  }
  if (value instanceof Date) {
    return startOfDay(value);
  }
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getActivityLabel(type) {
  return {
    create: "新增",
    edit: "编辑",
    consume: "消耗",
    restock: "补货",
    open: "启用",
    move: "移位",
    delete: "删除",
  }[type] || "动作";
}
