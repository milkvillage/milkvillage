const STORAGE_KEY = "milk-village-mvp-v1";
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const state = {
  screen: "make",
  adminUnlocked: false,
  adminMenu: "recipes",
  selectedRecipeId: null,
  selectedVariantId: null,
  loadingVariantId: null,
  pendingCancelBatchId: null,
  activeAlarmEventId: null,
  audioUnlocked: false,
  savedMessage: "",
};

const els = {
  screenTitle: document.querySelector("#screenTitle"),
  workArea: document.querySelector("#workArea"),
  navButtons: [...document.querySelectorAll(".nav-item")],
  adminShortcut: document.querySelector("#adminShortcut"),
  soundUnlockButton: document.querySelector("#soundUnlockButton"),
  cancelModal: document.querySelector("#cancelModal"),
  cancelMessage: document.querySelector("#cancelMessage"),
  cancelReason: document.querySelector("#cancelReason"),
  cancelClose: document.querySelector("#cancelClose"),
  cancelConfirm: document.querySelector("#cancelConfirm"),
  alarmModal: document.querySelector("#alarmModal"),
  alarmTitle: document.querySelector("#alarmTitle"),
  alarmMessage: document.querySelector("#alarmMessage"),
  alarmAck: document.querySelector("#alarmAck"),
  alarmSnooze: document.querySelector("#alarmSnooze"),
  soundHelp: document.querySelector("#soundHelp"),
  soundHelpButton: document.querySelector("#soundHelpButton"),
};

let db = loadDb();
state.selectedRecipeId = getActiveRecipes()[0]?.id || null;
state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId)[0]?.id || null;

function uid(prefix) {
  const value = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

function nowIso() {
  return new Date().toISOString();
}

function todayDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timeText(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dateTimeText(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function localTimeValue(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function loadDb() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const seeded = seedDb();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function seedDb() {
  const createdAt = nowIso();
  const supplies = [
    makeSupply("supply_tapioca", "냉동타피오카펄", "g", 1000, 1000, 5000, "재료"),
    makeSupply("supply_sugar", "흑설탕", "g", 1000, 1000, 3000, "재료"),
    makeSupply("supply_milk", "우유", "g", 1000, 500, 3000, "유제품"),
    makeSupply("supply_cream", "생크림", "g", 1000, 500, 3000, "유제품"),
    makeSupply("supply_cheese_powder", "치즈파우더", "g", 1000, 300, 1500, "분말"),
  ];

  const recipes = [
    {
      id: "recipe_pearl",
      name: "흑당펄",
      category: "재료준비",
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "recipe_cheese",
      name: "치즈폼",
      category: "재료준비",
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const variantSpecs = [
    ["variant_pearl_1", "recipe_pearl", "x1", 1, 1],
    ["variant_pearl_1_5", "recipe_pearl", "x1.5", 1.5, 2],
    ["variant_pearl_2", "recipe_pearl", "x2", 2, 3],
    ["variant_pearl_2_5", "recipe_pearl", "x2.5", 2.5, 4],
    ["variant_pearl_5", "recipe_pearl", "x5", 5, 5],
    ["variant_pearl_10", "recipe_pearl", "x10", 10, 6],
    ["variant_cheese_1", "recipe_cheese", "x1", 1, 1],
    ["variant_cheese_2", "recipe_cheese", "x2", 2, 2],
  ];

  const recipeVariants = variantSpecs.map(([id, recipeId, label, multiplier, sortOrder]) => ({
    id,
    recipeId,
    label,
    multiplier,
    sortOrder,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  }));

  const recipeVariantIngredients = [
    makeIngredient("variant_pearl_1", "supply_tapioca", 100, "g"),
    makeIngredient("variant_pearl_1", "supply_sugar", 100, "g"),
    makeIngredient("variant_pearl_1_5", "supply_tapioca", 150, "g"),
    makeIngredient("variant_pearl_1_5", "supply_sugar", 150, "g"),
    makeIngredient("variant_pearl_2", "supply_tapioca", 200, "g"),
    makeIngredient("variant_pearl_2", "supply_sugar", 200, "g"),
    makeIngredient("variant_pearl_2_5", "supply_tapioca", 250, "g"),
    makeIngredient("variant_pearl_2_5", "supply_sugar", 250, "g"),
    makeIngredient("variant_pearl_5", "supply_tapioca", 500, "g"),
    makeIngredient("variant_pearl_5", "supply_sugar", 500, "g"),
    makeIngredient("variant_pearl_10", "supply_tapioca", 1000, "g"),
    makeIngredient("variant_pearl_10", "supply_sugar", 1000, "g"),
    makeIngredient("variant_cheese_1", "supply_milk", 60, "g"),
    makeIngredient("variant_cheese_1", "supply_cream", 150, "g"),
    makeIngredient("variant_cheese_1", "supply_cheese_powder", 50, "g"),
    makeIngredient("variant_cheese_2", "supply_milk", 120, "g"),
    makeIngredient("variant_cheese_2", "supply_cream", 300, "g"),
    makeIngredient("variant_cheese_2", "supply_cheese_powder", 100, "g"),
  ];

  return {
    settings: {
      adminPin: "1234",
      defaultSoundId: "sound_default",
    },
    supplies,
    recipes,
    recipeVariants,
    recipeVariantIngredients,
    prepBatches: [],
    inventoryTransactions: [],
    alarms: [
      makeAlarm("alarm_supplies", "소모품 확인", "소모품 확인 및 채우기를 할 시간입니다.", "14:00"),
      makeAlarm("alarm_cleaning", "위생 작업 확인", "위생 작업을 확인 및 수행해주세요.", "17:00"),
    ],
    alarmSounds: [
      {
        id: "sound_default",
        name: "기본 알림음",
        fileUrl: "",
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    alarmEventLogs: [],
  };
}

function makeSupply(id, name, unit, currentStock, minStock, recommendedOrderQty, category) {
  const createdAt = nowIso();
  return {
    id,
    name,
    unit,
    currentStock,
    minStock,
    recommendedOrderQty,
    category,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeIngredient(recipeVariantId, supplyId, qty, unit) {
  const createdAt = nowIso();
  return {
    id: uid("ingredient"),
    recipeVariantId,
    supplyId,
    qty,
    unit,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeAlarm(id, title, message, time) {
  const createdAt = nowIso();
  return {
    id,
    title,
    message,
    time,
    repeatDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    soundId: "sound_default",
    isActive: true,
    requiresAcknowledgement: true,
    snoozeMinutes: 10,
    createdAt,
    updatedAt: createdAt,
  };
}

function getActiveRecipes() {
  return db.recipes.filter((recipe) => recipe.isActive).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function getRecipe(recipeId) {
  return db.recipes.find((recipe) => recipe.id === recipeId);
}

function getVariant(variantId) {
  return db.recipeVariants.find((variant) => variant.id === variantId);
}

function getSupply(supplyId) {
  return db.supplies.find((supply) => supply.id === supplyId);
}

function getVariantsForRecipe(recipeId, activeOnly = true) {
  return db.recipeVariants
    .filter((variant) => variant.recipeId === recipeId && (!activeOnly || variant.isActive))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function getIngredientsForVariant(variantId) {
  return db.recipeVariantIngredients.filter((ingredient) => ingredient.recipeVariantId === variantId);
}

function getTodayPrepBatches(includeCanceled = true) {
  const today = todayDateKey();
  return db.prepBatches
    .filter((batch) => batch.createdAt.slice(0, 10) === today)
    .filter((batch) => includeCanceled || batch.status === "active")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getOrderNeededSupplies() {
  return db.supplies
    .filter((supply) => supply.isActive && Number(supply.currentStock) <= Number(supply.minStock))
    .sort((a, b) => a.currentStock - b.currentStock);
}

function getLatestTransactionForSupply(supplyId) {
  return db.inventoryTransactions
    .filter((transaction) => transaction.supplyId === supplyId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function setScreen(screen) {
  state.screen = screen;
  state.savedMessage = "";
  if (screen === "admin" && !state.adminUnlocked) {
    render();
    return;
  }
  render();
}

function render() {
  const titleMap = {
    make: "재료 만들기",
    orders: "발주",
    admin: "관리자",
  };
  els.screenTitle.textContent = titleMap[state.screen];
  els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.screen === state.screen));
  els.soundUnlockButton.innerHTML = `
    <span class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>
    </span>
    ${state.audioUnlocked ? "알림 준비됨" : "알림 활성화"}
  `;

  if (state.screen === "make") renderMakeScreen();
  if (state.screen === "orders") renderOrderScreen();
  if (state.screen === "admin") renderAdminScreen();
}

function renderMakeScreen() {
  const activeRecipes = getActiveRecipes();
  if (!state.selectedRecipeId || !getRecipe(state.selectedRecipeId)?.isActive) {
    state.selectedRecipeId = activeRecipes[0]?.id || null;
  }
  const recipe = getRecipe(state.selectedRecipeId);
  const variants = getVariantsForRecipe(recipe?.id);
  if (!state.selectedVariantId || !variants.some((variant) => variant.id === state.selectedVariantId)) {
    state.selectedVariantId = variants[0]?.id || null;
  }
  const lowSupplies = getOrderNeededSupplies();
  const todayLogs = getTodayPrepBatches(true);

  els.workArea.innerHTML = `
    <div class="make-layout">
      <section class="panel" aria-label="재료 제조">
        <div class="panel-header">
          <h2>선택한 재료</h2>
          <p>재료를 고르고 배수 버튼만 누르면 재고가 자동 차감됩니다.</p>
        </div>
        ${
          lowSupplies.length
            ? `<div class="notice">발주 필요 품목 ${lowSupplies.length}개가 있습니다. 발주 화면에서 확인하세요.</div>`
            : ""
        }
        <div class="recipe-tabs">
          ${activeRecipes
            .map(
              (item) => `
                <button class="tab-button ${item.id === recipe?.id ? "is-active" : ""}" type="button" data-recipe-id="${item.id}">
                  ${escapeHtml(item.name)}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="selected-recipe">
          <h3>${escapeHtml(recipe?.name || "재료 없음")}</h3>
          <div class="batch-grid">
            ${variants
              .map(
                (variant) => `
                  <button class="batch-button ${state.loadingVariantId === variant.id ? "is-loading" : ""}" type="button" data-create-variant="${variant.id}" ${
                    state.loadingVariantId ? "disabled" : ""
                  }>
                    ${state.loadingVariantId === variant.id ? "처리 중" : `${escapeHtml(variant.label)} 만들기`}
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="stock-summary">
          <strong>현재 낮은 재고</strong>
          <div class="stock-pills">
            ${
              lowSupplies.length
                ? lowSupplies
                    .map(
                      (supply) => `
                        <span class="stock-pill is-low">${escapeHtml(supply.name)} ${numberText(supply.currentStock)}${escapeHtml(supply.unit)}</span>
                      `,
                    )
                    .join("")
                : `<span class="stock-pill">기준량 이하 품목 없음</span>`
            }
          </div>
        </div>
      </section>

      <section class="panel" aria-label="오늘 제조 로그">
        <div class="panel-header">
          <h2>오늘 제조 로그</h2>
          <p>직원 화면에는 배치 단위 기록만 표시됩니다.</p>
        </div>
        ${
          todayLogs.length
            ? `<ul class="log-list">
                ${todayLogs
                  .map(
                    (batch) => `
                      <li class="log-item ${batch.status === "canceled" ? "is-canceled" : ""}">
                        <div>
                          <div class="log-name">${escapeHtml(batch.recipeName)} ${escapeHtml(batch.variantLabel)} ${
                      batch.status === "canceled" ? "(취소됨)" : ""
                    }</div>
                          <div class="log-meta">${timeText(batch.createdAt)}${batch.canceledAt ? ` · 취소 ${timeText(batch.canceledAt)}` : ""}</div>
                        </div>
                        ${
                          batch.status === "active"
                            ? `<button class="row-action" type="button" data-open-cancel="${batch.id}">취소</button>`
                            : `<span class="badge badge--ok">복구 완료</span>`
                        }
                      </li>
                    `,
                  )
                  .join("")}
              </ul>`
            : `<div class="empty-state">오늘 제조 로그가 없습니다.</div>`
        }
      </section>
    </div>
  `;

  els.workArea.querySelectorAll("[data-recipe-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRecipeId = button.dataset.recipeId;
      state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId)[0]?.id || null;
      renderMakeScreen();
    });
  });
  els.workArea.querySelectorAll("[data-create-variant]").forEach((button) => {
    button.addEventListener("click", () => createPrepBatch(button.dataset.createVariant));
  });
  els.workArea.querySelectorAll("[data-open-cancel]").forEach((button) => {
    button.addEventListener("click", () => openCancelModal(button.dataset.openCancel));
  });
}

function createPrepBatch(recipeVariantId) {
  if (state.loadingVariantId) return;
  const variant = getVariant(recipeVariantId);
  const recipe = getRecipe(variant?.recipeId);
  const ingredients = getIngredientsForVariant(recipeVariantId);
  if (!variant || !recipe || !ingredients.length) {
    alert("선택한 배수의 레시피가 비어 있습니다. 관리자 화면에서 소모품 사용량을 확인해주세요.");
    return;
  }

  state.loadingVariantId = recipeVariantId;
  renderMakeScreen();

  window.setTimeout(() => {
    const createdAt = nowIso();
    const prepBatch = {
      id: uid("prep"),
      recipeId: recipe.id,
      recipeVariantId: variant.id,
      recipeName: recipe.name,
      variantLabel: variant.label,
      createdAt,
      createdBy: "직원",
      status: "active",
    };

    db.prepBatches.push(prepBatch);
    ingredients.forEach((ingredient) => {
      const supply = getSupply(ingredient.supplyId);
      if (!supply) return;
      const qty = Number(ingredient.qty);
      supply.currentStock = Number(supply.currentStock) - qty;
      supply.updatedAt = createdAt;
      db.inventoryTransactions.push({
        id: uid("txn"),
        prepBatchId: prepBatch.id,
        supplyId: supply.id,
        supplyName: supply.name,
        recipeId: recipe.id,
        recipeVariantId: variant.id,
        qtyChange: -qty,
        unit: ingredient.unit || supply.unit,
        type: "prep_consume",
        createdAt,
        note: `${recipe.name} ${variant.label} 제조`,
      });
    });

    saveDb();
    state.loadingVariantId = null;
    renderMakeScreen();
  }, 450);
}

function openCancelModal(prepBatchId) {
  const batch = db.prepBatches.find((item) => item.id === prepBatchId);
  if (!batch || batch.status === "canceled") return;
  state.pendingCancelBatchId = prepBatchId;
  els.cancelMessage.textContent = `${batch.recipeName} ${batch.variantLabel} 기록을 취소하고 차감된 재고를 되돌릴까요?`;
  els.cancelReason.value = "";
  els.cancelModal.hidden = false;
}

function closeCancelModal() {
  state.pendingCancelBatchId = null;
  els.cancelModal.hidden = true;
}

function cancelPrepBatch(prepBatchId, reason = "") {
  const batch = db.prepBatches.find((item) => item.id === prepBatchId);
  if (!batch || batch.status === "canceled") return;
  const sourceTransactions = db.inventoryTransactions.filter(
    (transaction) => transaction.prepBatchId === prepBatchId && transaction.type === "prep_consume",
  );
  const canceledAt = nowIso();

  sourceTransactions.forEach((transaction) => {
    const supply = getSupply(transaction.supplyId);
    const reverseQty = -Number(transaction.qtyChange);
    if (supply) {
      supply.currentStock = Number(supply.currentStock) + reverseQty;
      supply.updatedAt = canceledAt;
    }
    db.inventoryTransactions.push({
      id: uid("txn"),
      prepBatchId,
      supplyId: transaction.supplyId,
      supplyName: transaction.supplyName,
      recipeId: transaction.recipeId,
      recipeVariantId: transaction.recipeVariantId,
      qtyChange: reverseQty,
      unit: transaction.unit,
      type: "prep_cancel_reverse",
      createdAt: canceledAt,
      note: reason || "직원 제조 취소",
    });
  });

  batch.status = "canceled";
  batch.canceledAt = canceledAt;
  batch.cancelReason = reason;
  saveDb();
}

function renderOrderScreen() {
  const orderNeeded = getOrderNeededSupplies();
  els.workArea.innerHTML = `
    <section class="order-screen" aria-label="발주 필요 품목">
      <div class="panel-header">
        <h2>발주 필요 품목</h2>
        <p>현재 재고가 기준량 이하인 활성 소모품만 표시합니다.</p>
      </div>
      ${
        orderNeeded.length
          ? `<div class="table-wrap">
              <table class="order-table">
                <thead>
                  <tr>
                    <th>품목명</th>
                    <th>현재 재고</th>
                    <th>기준량</th>
                    <th>추천 발주량</th>
                    <th>단위</th>
                    <th>최근 사용</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderNeeded
                    .map((supply) => {
                      const latest = getLatestTransactionForSupply(supply.id);
                      return `
                        <tr>
                          <td><strong>${escapeHtml(supply.name)}</strong><br><span class="badge">발주 필요</span></td>
                          <td><span class="big-number is-warning">${numberText(supply.currentStock)}</span></td>
                          <td>${numberText(supply.minStock)}</td>
                          <td><span class="big-number">${numberText(supply.recommendedOrderQty)}</span></td>
                          <td>${escapeHtml(supply.unit)}</td>
                          <td>${latest ? `${dateTimeText(latest.createdAt)}<br><span class="muted">${escapeHtml(latest.note || latest.type)}</span>` : "기록 없음"}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="empty-state">현재 발주가 필요한 품목이 없습니다.</div>`
      }
    </section>
  `;
}

function renderAdminScreen() {
  if (!state.adminUnlocked) {
    renderAdminPin();
    return;
  }

  const menuLabels = [
    ["recipes", "레시피 관리"],
    ["supplies", "소모품/발주량 관리"],
    ["adjust", "재고 수동 조정"],
    ["alarms", "알림 관리"],
    ["sounds", "알림음 관리"],
    ["alarmLogs", "알림 기록"],
    ["logs", "전체 로그 확인"],
  ];
  const activeLabel = menuLabels.find(([key]) => key === state.adminMenu)?.[1] || "관리자";

  els.workArea.innerHTML = `
    <section class="admin-screen" aria-label="관리자 화면">
      <aside class="admin-menu" aria-label="관리자 메뉴">
        ${menuLabels
          .map(
            ([key, label]) => `
              <button class="admin-menu-button ${state.adminMenu === key ? "is-active" : ""}" type="button" data-admin-menu="${key}">
                ${label}
              </button>
            `,
          )
          .join("")}
      </aside>
      <div class="admin-content">
        <div class="panel-header">
          <h2>${activeLabel}</h2>
          <p>직원 화면에 복잡한 설정이 노출되지 않도록 관리자 화면에서만 수정합니다.</p>
        </div>
        <div class="admin-body" id="adminBody"></div>
      </div>
    </section>
  `;

  els.workArea.querySelectorAll("[data-admin-menu]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminMenu = button.dataset.adminMenu;
      state.savedMessage = "";
      renderAdminScreen();
    });
  });

  const body = els.workArea.querySelector("#adminBody");
  if (state.adminMenu === "recipes") renderRecipeAdmin(body);
  if (state.adminMenu === "supplies") renderSuppliesAdmin(body);
  if (state.adminMenu === "adjust") renderAdjustAdmin(body);
  if (state.adminMenu === "alarms") renderAlarmsAdmin(body);
  if (state.adminMenu === "sounds") renderSoundsAdmin(body);
  if (state.adminMenu === "alarmLogs") renderAlarmLogsAdmin(body);
  if (state.adminMenu === "logs") renderAllLogsAdmin(body);
}

function renderAdminPin() {
  els.workArea.innerHTML = `
    <section class="pin-screen" aria-label="관리자 PIN 입력">
      <h2>관리자 PIN</h2>
      <p>관리자 기능은 PIN 입력 후 사용할 수 있습니다. MVP 기본 PIN은 앱 설정값에 저장되어 있으며, 초기값은 1234입니다.</p>
      <label class="field">
        <span>PIN</span>
        <input id="pinInput" type="password" inputmode="numeric" autocomplete="off" />
      </label>
      <div class="button-row">
        <button class="button button--primary" id="pinSubmit" type="button">관리자 진입</button>
      </div>
    </section>
  `;
  const input = els.workArea.querySelector("#pinInput");
  const submit = els.workArea.querySelector("#pinSubmit");
  const unlock = () => {
    if (input.value === db.settings.adminPin) {
      state.adminUnlocked = true;
      renderAdminScreen();
    } else {
      alert("PIN이 맞지 않습니다.");
      input.value = "";
      input.focus();
    }
  };
  submit.addEventListener("click", unlock);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlock();
  });
  input.focus();
}

function renderRecipeAdmin(container) {
  const recipes = db.recipes;
  if (!state.selectedRecipeId || !getRecipe(state.selectedRecipeId)) {
    state.selectedRecipeId = recipes[0]?.id || null;
  }
  const recipe = getRecipe(state.selectedRecipeId);
  const variants = getVariantsForRecipe(recipe?.id, false);
  if (!state.selectedVariantId || !variants.some((variant) => variant.id === state.selectedVariantId)) {
    state.selectedVariantId = variants[0]?.id || null;
  }
  const variant = getVariant(state.selectedVariantId);
  const ingredients = getIngredientsForVariant(variant?.id);

  container.innerHTML = `
    <div class="recipe-admin-grid">
      <section class="admin-column">
        <h3>재료</h3>
        <div class="list-stack">
          ${recipes
            .map(
              (item) => `
                <button class="list-button ${item.id === recipe?.id ? "is-active" : ""}" type="button" data-select-recipe="${item.id}">
                  ${escapeHtml(item.name)}${item.isActive ? "" : " (비활성)"}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="column-footer">
          <button class="button button--ghost button--small" type="button" id="addRecipe">재료 추가</button>
        </div>
      </section>
      <section class="admin-column">
        <h3>배수</h3>
        <div class="list-stack">
          ${variants
            .map(
              (item) => `
                <button class="list-button ${item.id === variant?.id ? "is-active" : ""}" type="button" data-select-variant="${item.id}">
                  ${escapeHtml(item.label)}${item.isActive ? "" : " (비활성)"}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="column-footer">
          <button class="button button--ghost button--small" type="button" id="addVariant">배수 추가</button>
          <button class="button button--ghost button--small" type="button" id="cloneVariant" ${variant ? "" : "disabled"}>복제</button>
        </div>
      </section>
      <section class="admin-column">
        <h3>사용량 편집</h3>
        <div class="editor-panel">
          ${
            recipe
              ? `
                <div class="form-grid">
                  <label class="field">
                    <span>재료명</span>
                    <input id="recipeName" type="text" value="${escapeAttr(recipe.name)}" />
                  </label>
                  <label class="check-field">
                    <input id="recipeActive" type="checkbox" ${recipe.isActive ? "checked" : ""} />
                    직원 화면에 표시
                  </label>
                </div>
              `
              : ""
          }
          ${
            variant
              ? `
                <h4 class="subheading">배수 설정</h4>
                <div class="dense-grid">
                  <label class="field">
                    <span>배수명</span>
                    <input id="variantLabel" type="text" value="${escapeAttr(variant.label)}" />
                  </label>
                  <label class="field">
                    <span>배수값</span>
                    <input id="variantMultiplier" type="number" step="0.1" value="${variant.multiplier}" />
                  </label>
                  <label class="field">
                    <span>정렬</span>
                    <input id="variantSort" type="number" value="${variant.sortOrder}" />
                  </label>
                  <label class="check-field">
                    <input id="variantActive" type="checkbox" ${variant.isActive ? "checked" : ""} />
                    사용
                  </label>
                </div>
                <h4 class="subheading">소모품 사용량</h4>
                <div id="ingredientEditor">
                  ${
                    ingredients.length
                      ? ingredients.map((ingredient) => renderIngredientRow(ingredient)).join("")
                      : `<p class="muted">등록된 소모품 사용량이 없습니다.</p>`
                  }
                </div>
                <div class="button-row">
                  ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
                  <button class="button button--ghost" type="button" id="addIngredient">소모품 추가</button>
                  <button class="button button--primary" type="button" id="saveRecipeAdmin">저장</button>
                </div>
              `
              : `<p class="muted">배수를 선택하거나 추가해주세요.</p>`
          }
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll("[data-select-recipe]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRecipeId = button.dataset.selectRecipe;
      state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId, false)[0]?.id || null;
      state.savedMessage = "";
      renderAdminScreen();
    });
  });
  container.querySelectorAll("[data-select-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedVariantId = button.dataset.selectVariant;
      state.savedMessage = "";
      renderAdminScreen();
    });
  });
  container.querySelector("#addRecipe")?.addEventListener("click", addRecipe);
  container.querySelector("#addVariant")?.addEventListener("click", addVariant);
  container.querySelector("#cloneVariant")?.addEventListener("click", cloneVariant);
  container.querySelector("#addIngredient")?.addEventListener("click", addVariantIngredient);
  container.querySelector("#saveRecipeAdmin")?.addEventListener("click", () => saveRecipeAdmin(container));
  container.querySelectorAll("[data-remove-ingredient]").forEach((button) => {
    button.addEventListener("click", () => {
      db.recipeVariantIngredients = db.recipeVariantIngredients.filter((item) => item.id !== button.dataset.removeIngredient);
      saveDb();
      renderAdminScreen();
    });
  });
}

function renderIngredientRow(ingredient) {
  return `
    <div class="ingredient-row" data-ingredient-row="${ingredient.id}">
      <label class="field">
        <span>소모품</span>
        <select data-ingredient-supply="${ingredient.id}">
          ${db.supplies
            .map(
              (supply) => `
                <option value="${supply.id}" ${supply.id === ingredient.supplyId ? "selected" : ""}>${escapeHtml(supply.name)}</option>
              `,
            )
            .join("")}
        </select>
      </label>
      <label class="field">
        <span>수량</span>
        <input data-ingredient-qty="${ingredient.id}" type="number" step="1" value="${ingredient.qty}" />
      </label>
      <button class="icon-button" data-remove-ingredient="${ingredient.id}" type="button" aria-label="소모품 삭제">
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>
        </span>
      </button>
    </div>
  `;
}

function addRecipe() {
  const createdAt = nowIso();
  const recipe = {
    id: uid("recipe"),
    name: "새 재료",
    category: "재료준비",
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  };
  db.recipes.push(recipe);
  state.selectedRecipeId = recipe.id;
  state.selectedVariantId = null;
  state.savedMessage = "재료가 추가되었습니다.";
  saveDb();
  renderAdminScreen();
}

function addVariant() {
  if (!state.selectedRecipeId) return;
  const createdAt = nowIso();
  const variants = getVariantsForRecipe(state.selectedRecipeId, false);
  const variant = {
    id: uid("variant"),
    recipeId: state.selectedRecipeId,
    label: `x${variants.length + 1}`,
    multiplier: variants.length + 1,
    sortOrder: variants.length + 1,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  };
  db.recipeVariants.push(variant);
  state.selectedVariantId = variant.id;
  state.savedMessage = "배수가 추가되었습니다.";
  saveDb();
  renderAdminScreen();
}

function cloneVariant() {
  const source = getVariant(state.selectedVariantId);
  if (!source) return;
  const createdAt = nowIso();
  const variants = getVariantsForRecipe(source.recipeId, false);
  const variant = {
    ...source,
    id: uid("variant"),
    label: `${source.label} 복제`,
    sortOrder: variants.length + 1,
    createdAt,
    updatedAt: createdAt,
  };
  db.recipeVariants.push(variant);
  getIngredientsForVariant(source.id).forEach((ingredient) => {
    db.recipeVariantIngredients.push({
      ...ingredient,
      id: uid("ingredient"),
      recipeVariantId: variant.id,
      createdAt,
      updatedAt: createdAt,
    });
  });
  state.selectedVariantId = variant.id;
  state.savedMessage = "배수가 복제되었습니다.";
  saveDb();
  renderAdminScreen();
}

function addVariantIngredient() {
  if (!state.selectedVariantId || !db.supplies.length) return;
  db.recipeVariantIngredients.push(makeIngredient(state.selectedVariantId, db.supplies[0].id, 0, db.supplies[0].unit));
  saveDb();
  renderAdminScreen();
}

function saveRecipeAdmin(container) {
  const now = nowIso();
  const recipe = getRecipe(state.selectedRecipeId);
  const variant = getVariant(state.selectedVariantId);
  if (recipe) {
    recipe.name = container.querySelector("#recipeName")?.value.trim() || recipe.name;
    recipe.isActive = Boolean(container.querySelector("#recipeActive")?.checked);
    recipe.updatedAt = now;
  }
  if (variant) {
    variant.label = container.querySelector("#variantLabel")?.value.trim() || variant.label;
    variant.multiplier = Number(container.querySelector("#variantMultiplier")?.value || variant.multiplier);
    variant.sortOrder = Number(container.querySelector("#variantSort")?.value || variant.sortOrder);
    variant.isActive = Boolean(container.querySelector("#variantActive")?.checked);
    variant.updatedAt = now;
  }
  getIngredientsForVariant(variant?.id).forEach((ingredient) => {
    const supplyId = container.querySelector(`[data-ingredient-supply="${ingredient.id}"]`)?.value;
    const qty = Number(container.querySelector(`[data-ingredient-qty="${ingredient.id}"]`)?.value || 0);
    const supply = getSupply(supplyId);
    ingredient.supplyId = supplyId;
    ingredient.qty = qty;
    ingredient.unit = supply?.unit || ingredient.unit;
    ingredient.updatedAt = now;
  });
  state.savedMessage = "저장 완료";
  saveDb();
  renderAdminScreen();
}

function renderSuppliesAdmin(container) {
  container.innerHTML = `
    <div class="admin-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>소모품</th>
              <th>단위</th>
              <th>현재 재고</th>
              <th>기준량</th>
              <th>추천 발주량</th>
              <th>카테고리</th>
              <th>사용</th>
            </tr>
          </thead>
          <tbody>
            ${db.supplies
              .map(
                (supply) => `
                  <tr data-supply-row="${supply.id}">
                    <td><input data-supply-name="${supply.id}" value="${escapeAttr(supply.name)}" /></td>
                    <td><input data-supply-unit="${supply.id}" value="${escapeAttr(supply.unit)}" /></td>
                    <td><input data-supply-stock="${supply.id}" type="number" value="${supply.currentStock}" /></td>
                    <td><input data-supply-min="${supply.id}" type="number" value="${supply.minStock}" /></td>
                    <td><input data-supply-order="${supply.id}" type="number" value="${supply.recommendedOrderQty}" /></td>
                    <td><input data-supply-category="${supply.id}" value="${escapeAttr(supply.category || "")}" /></td>
                    <td><input data-supply-active="${supply.id}" type="checkbox" ${supply.isActive ? "checked" : ""} /></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="button-row">
        ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
        <button class="button button--ghost" id="addSupply" type="button">소모품 추가</button>
        <button class="button button--primary" id="saveSupplies" type="button">저장</button>
      </div>
    </div>
  `;
  container.querySelector("#addSupply").addEventListener("click", () => {
    db.supplies.push(makeSupply(uid("supply"), "새 소모품", "g", 0, 0, 0, ""));
    saveDb();
    renderAdminScreen();
  });
  container.querySelector("#saveSupplies").addEventListener("click", () => {
    const now = nowIso();
    db.supplies.forEach((supply) => {
      supply.name = container.querySelector(`[data-supply-name="${supply.id}"]`).value.trim() || supply.name;
      supply.unit = container.querySelector(`[data-supply-unit="${supply.id}"]`).value.trim() || supply.unit;
      supply.currentStock = Number(container.querySelector(`[data-supply-stock="${supply.id}"]`).value || 0);
      supply.minStock = Number(container.querySelector(`[data-supply-min="${supply.id}"]`).value || 0);
      supply.recommendedOrderQty = Number(container.querySelector(`[data-supply-order="${supply.id}"]`).value || 0);
      supply.category = container.querySelector(`[data-supply-category="${supply.id}"]`).value.trim();
      supply.isActive = Boolean(container.querySelector(`[data-supply-active="${supply.id}"]`).checked);
      supply.updatedAt = now;
    });
    state.savedMessage = "저장 완료";
    saveDb();
    renderAdminScreen();
  });
}

function renderAdjustAdmin(container) {
  container.innerHTML = `
    <div class="admin-card">
      <div class="form-grid">
        <label class="field">
          <span>소모품</span>
          <select id="adjustSupply">
            ${db.supplies.map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${numberText(supply.currentStock)}${escapeHtml(supply.unit)})</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>실제 재고</span>
          <input id="adjustActual" type="number" value="${db.supplies[0]?.currentStock || 0}" />
        </label>
        <label class="field">
          <span>사유</span>
          <input id="adjustReason" type="text" value="실사 조정" />
        </label>
      </div>
      <div class="button-row">
        ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
        <button class="button button--primary" id="applyAdjust" type="button">재고 조정 기록</button>
      </div>
    </div>
  `;
  const supplySelect = container.querySelector("#adjustSupply");
  const actualInput = container.querySelector("#adjustActual");
  supplySelect.addEventListener("change", () => {
    actualInput.value = getSupply(supplySelect.value)?.currentStock || 0;
  });
  container.querySelector("#applyAdjust").addEventListener("click", () => {
    const supply = getSupply(supplySelect.value);
    if (!supply) return;
    const actual = Number(actualInput.value || 0);
    const diff = actual - Number(supply.currentStock);
    const createdAt = nowIso();
    supply.currentStock = actual;
    supply.updatedAt = createdAt;
    db.inventoryTransactions.push({
      id: uid("txn"),
      supplyId: supply.id,
      supplyName: supply.name,
      qtyChange: diff,
      unit: supply.unit,
      type: "manual_adjustment",
      createdAt,
      note: container.querySelector("#adjustReason").value.trim() || "수동 조정",
    });
    state.savedMessage = `${supply.name} 재고를 ${numberText(actual)}${supply.unit}로 조정했습니다.`;
    saveDb();
    renderAdminScreen();
  });
}

function renderAlarmsAdmin(container) {
  if (!db.alarms.length) {
    db.alarms.push(makeAlarm(uid("alarm"), "새 알림", "알림 내용을 입력해주세요.", localTimeValue()));
  }
  const selectedAlarmId = container.dataset.selectedAlarmId || db.alarms[0].id;
  const alarm = db.alarms.find((item) => item.id === selectedAlarmId) || db.alarms[0];
  container.innerHTML = `
    <div class="admin-card">
      <div class="alarm-row">
        <strong>알림 목록</strong>
        <button class="button button--ghost button--small" id="addAlarm" type="button">알림 추가</button>
        <button class="button button--ghost button--small" id="testAlarm" type="button">테스트 실행</button>
        <button class="button button--danger button--small" id="deleteAlarm" type="button">삭제</button>
      </div>
      <div class="list-stack">
        ${db.alarms
          .map(
            (item) => `
              <button class="list-button ${item.id === alarm.id ? "is-active" : ""}" type="button" data-select-alarm="${item.id}">
                ${escapeHtml(item.title)} · ${escapeHtml(item.time)}${item.isActive ? "" : " (꺼짐)"}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
    <div class="admin-card">
      <div class="form-grid">
        <label class="field">
          <span>알림 이름</span>
          <input id="alarmTitleInput" value="${escapeAttr(alarm.title)}" />
        </label>
        <label class="field">
          <span>알림 시간</span>
          <input id="alarmTimeInput" type="time" value="${escapeAttr(alarm.time)}" />
        </label>
        <label class="field">
          <span>알림음</span>
          <select id="alarmSoundInput">
            ${db.alarmSounds.map((sound) => `<option value="${sound.id}" ${sound.id === alarm.soundId ? "selected" : ""}>${escapeHtml(sound.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>스누즈 분</span>
          <input id="alarmSnoozeInput" type="number" min="1" value="${alarm.snoozeMinutes}" />
        </label>
      </div>
      <label class="field">
        <span>알림 문구</span>
        <textarea id="alarmMessageInput">${escapeHtml(alarm.message)}</textarea>
      </label>
      <div class="dense-grid">
        ${dayKeys
          .map(
            (day) => `
              <label class="check-field">
                <input data-repeat-day="${day}" type="checkbox" ${alarm.repeatDays.includes(day) ? "checked" : ""} />
                ${dayLabel(day)}
              </label>
            `,
          )
          .join("")}
      </div>
      <div class="button-row">
        <label class="check-field">
          <input id="alarmActiveInput" type="checkbox" ${alarm.isActive ? "checked" : ""} />
          알림 사용
        </label>
        <label class="check-field">
          <input id="alarmAckInput" type="checkbox" ${alarm.requiresAcknowledgement ? "checked" : ""} />
          확인 필요
        </label>
        ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
        <button class="button button--primary" id="saveAlarm" type="button">저장</button>
      </div>
    </div>
  `;
  container.querySelectorAll("[data-select-alarm]").forEach((button) => {
    button.addEventListener("click", () => {
      renderAlarmsAdminWithSelection(button.dataset.selectAlarm);
    });
  });
  container.querySelector("#addAlarm").addEventListener("click", () => {
    const alarm = makeAlarm(uid("alarm"), "새 알림", "알림 내용을 입력해주세요.", localTimeValue());
    db.alarms.push(alarm);
    saveDb();
    state.savedMessage = "알림이 추가되었습니다.";
    renderAlarmsAdminWithSelection(alarm.id);
  });
  container.querySelector("#deleteAlarm").addEventListener("click", () => {
    if (db.alarms.length <= 1) {
      alert("알림은 최소 1개 이상 필요합니다.");
      return;
    }
    db.alarms = db.alarms.filter((item) => item.id !== alarm.id);
    saveDb();
    renderAdminScreen();
  });
  container.querySelector("#testAlarm").addEventListener("click", () => triggerAlarm(alarm, "test"));
  container.querySelector("#saveAlarm").addEventListener("click", () => {
    const now = nowIso();
    alarm.title = container.querySelector("#alarmTitleInput").value.trim() || alarm.title;
    alarm.message = container.querySelector("#alarmMessageInput").value.trim() || alarm.message;
    alarm.time = container.querySelector("#alarmTimeInput").value || alarm.time;
    alarm.soundId = container.querySelector("#alarmSoundInput").value;
    alarm.snoozeMinutes = Number(container.querySelector("#alarmSnoozeInput").value || 10);
    alarm.repeatDays = [...container.querySelectorAll("[data-repeat-day]")]
      .filter((input) => input.checked)
      .map((input) => input.dataset.repeatDay);
    alarm.isActive = Boolean(container.querySelector("#alarmActiveInput").checked);
    alarm.requiresAcknowledgement = Boolean(container.querySelector("#alarmAckInput").checked);
    alarm.updatedAt = now;
    state.savedMessage = "저장 완료";
    saveDb();
    renderAlarmsAdminWithSelection(alarm.id);
  });
}

function renderAlarmsAdminWithSelection(alarmId) {
  renderAdminScreen();
  const body = els.workArea.querySelector("#adminBody");
  if (body) {
    body.dataset.selectedAlarmId = alarmId;
    renderAlarmsAdmin(body);
  }
}

function renderSoundsAdmin(container) {
  container.innerHTML = `
    <div class="admin-card">
      <div class="form-grid">
        <label class="field">
          <span>알림음 파일</span>
          <input id="soundFile" type="file" accept=".mp3,.wav,.m4a,.ogg,audio/*" />
        </label>
        <label class="field">
          <span>알림음 이름</span>
          <input id="soundName" type="text" placeholder="예: 큰 벨소리" />
        </label>
      </div>
      <div class="button-row">
        ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
        <button class="button button--primary" id="addSound" type="button">알림음 추가</button>
      </div>
    </div>
    <div class="admin-card">
      ${db.alarmSounds
        .map(
          (sound) => `
            <div class="sound-row">
              <strong>${escapeHtml(sound.name)}${sound.isDefault ? " · 기본" : ""}</strong>
              <button class="button button--ghost button--small" data-preview-sound="${sound.id}" type="button">미리듣기</button>
              <button class="button button--ghost button--small" data-default-sound="${sound.id}" type="button">기본 설정</button>
              <button class="button button--danger button--small" data-delete-sound="${sound.id}" ${sound.id === "sound_default" ? "disabled" : ""} type="button">삭제</button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
  container.querySelector("#addSound").addEventListener("click", async () => {
    const file = container.querySelector("#soundFile").files[0];
    const name = container.querySelector("#soundName").value.trim() || file?.name || "새 알림음";
    if (!file) {
      alert("알림음 파일을 선택해주세요.");
      return;
    }
    const fileUrl = await readFileAsDataUrl(file);
    const createdAt = nowIso();
    db.alarmSounds.push({
      id: uid("sound"),
      name,
      fileUrl,
      isDefault: false,
      createdAt,
      updatedAt: createdAt,
    });
    state.savedMessage = "알림음이 추가되었습니다.";
    saveDb();
    renderAdminScreen();
  });
  container.querySelectorAll("[data-preview-sound]").forEach((button) => {
    button.addEventListener("click", () => playSoundById(button.dataset.previewSound));
  });
  container.querySelectorAll("[data-default-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      db.alarmSounds.forEach((sound) => {
        sound.isDefault = sound.id === button.dataset.defaultSound;
      });
      db.settings.defaultSoundId = button.dataset.defaultSound;
      state.savedMessage = "기본 알림음을 변경했습니다.";
      saveDb();
      renderAdminScreen();
    });
  });
  container.querySelectorAll("[data-delete-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      db.alarmSounds = db.alarmSounds.filter((sound) => sound.id !== button.dataset.deleteSound);
      db.alarms.forEach((alarm) => {
        if (alarm.soundId === button.dataset.deleteSound) alarm.soundId = db.settings.defaultSoundId;
      });
      saveDb();
      renderAdminScreen();
    });
  });
}

function renderAlarmLogsAdmin(container) {
  const logs = [...db.alarmEventLogs].sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt));
  container.innerHTML = `
    <div class="admin-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>알림</th>
              <th>울린 시간</th>
              <th>상태</th>
              <th>확인/스누즈</th>
            </tr>
          </thead>
          <tbody>
            ${
              logs.length
                ? logs
                    .map(
                      (log) => `
                        <tr>
                          <td>${escapeHtml(log.alarmTitle)}</td>
                          <td>${dateTimeText(log.triggeredAt)}</td>
                          <td>${alarmStatusLabel(log.status)}</td>
                          <td>${log.acknowledgedAt ? dateTimeText(log.acknowledgedAt) : log.snoozedUntil ? dateTimeText(log.snoozedUntil) : "-"}</td>
                        </tr>
                      `,
                    )
                    .join("")
                : `<tr><td colspan="4">알림 기록이 없습니다.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAllLogsAdmin(container) {
  const batches = [...db.prepBatches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const transactions = [...db.inventoryTransactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  container.innerHTML = `
    <div class="admin-card">
      <h3>제조 배치 로그</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>재료</th>
              <th>시간</th>
              <th>상태</th>
              <th>취소 사유</th>
            </tr>
          </thead>
          <tbody>
            ${
              batches.length
                ? batches
                    .map(
                      (batch) => `
                        <tr>
                          <td>${escapeHtml(batch.recipeName)} ${escapeHtml(batch.variantLabel)}</td>
                          <td>${dateTimeText(batch.createdAt)}</td>
                          <td>${batch.status === "active" ? "정상" : "취소"}</td>
                          <td>${escapeHtml(batch.cancelReason || "-")}</td>
                        </tr>
                      `,
                    )
                    .join("")
                : `<tr><td colspan="4">제조 로그가 없습니다.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    <div class="admin-card">
      <h3>재고 상세 거래 로그</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>소모품</th>
              <th>변동량</th>
              <th>유형</th>
              <th>시간</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            ${
              transactions.length
                ? transactions
                    .map(
                      (transaction) => `
                        <tr>
                          <td>${escapeHtml(transaction.supplyName)}</td>
                          <td>${numberText(transaction.qtyChange)}${escapeHtml(transaction.unit)}</td>
                          <td>${transactionTypeLabel(transaction.type)}</td>
                          <td>${dateTimeText(transaction.createdAt)}</td>
                          <td>${escapeHtml(transaction.note || "-")}</td>
                        </tr>
                      `,
                    )
                    .join("")
                : `<tr><td colspan="5">거래 로그가 없습니다.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function triggerAlarm(alarm, source = "schedule") {
  const triggeredAt = nowIso();
  const eventLog = {
    id: uid("alarm_event"),
    alarmId: alarm.id,
    alarmTitle: alarm.title,
    triggeredAt,
    acknowledgedAt: "",
    acknowledgedBy: "",
    snoozedUntil: "",
    status: "triggered",
    source,
  };
  db.alarmEventLogs.push(eventLog);
  state.activeAlarmEventId = eventLog.id;
  saveDb();
  showAlarmModal(alarm);
  playSoundById(alarm.soundId || db.settings.defaultSoundId);
}

function showAlarmModal(alarm) {
  els.alarmTitle.textContent = alarm.title;
  els.alarmMessage.textContent = alarm.message;
  els.soundHelp.hidden = state.audioUnlocked;
  els.alarmModal.hidden = false;
}

function closeAlarmModal() {
  els.alarmModal.hidden = true;
}

function acknowledgeAlarm() {
  const eventLog = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
  if (eventLog) {
    eventLog.status = "acknowledged";
    eventLog.acknowledgedAt = nowIso();
    eventLog.acknowledgedBy = "직원";
    saveDb();
  }
  closeAlarmModal();
  if (state.screen === "admin" && state.adminMenu === "alarmLogs") renderAdminScreen();
}

function snoozeAlarm() {
  const eventLog = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
  const alarm = db.alarms.find((item) => item.id === eventLog?.alarmId);
  if (eventLog && alarm) {
    const snoozedUntil = new Date(Date.now() + Number(alarm.snoozeMinutes || 10) * 60 * 1000);
    eventLog.status = "snoozed";
    eventLog.snoozedUntil = snoozedUntil.toISOString();
    saveDb();
  }
  closeAlarmModal();
  if (state.screen === "admin" && state.adminMenu === "alarmLogs") renderAdminScreen();
}

function checkAlarms() {
  const now = new Date();
  const today = todayDateKey(now);
  const day = dayKeys[now.getDay()];
  const currentTime = localTimeValue(now);

  db.alarms
    .filter((alarm) => alarm.isActive && alarm.repeatDays.includes(day) && alarm.time === currentTime)
    .forEach((alarm) => {
      const alreadyTriggered = db.alarmEventLogs.some(
        (log) => log.alarmId === alarm.id && log.triggeredAt.slice(0, 10) === today && log.triggeredAt.slice(11, 16) === currentTime,
      );
      if (!alreadyTriggered) triggerAlarm(alarm);
    });

  db.alarmEventLogs
    .filter((log) => log.status === "snoozed" && log.snoozedUntil && new Date(log.snoozedUntil) <= now)
    .forEach((log) => {
      const alarm = db.alarms.find((item) => item.id === log.alarmId);
      if (alarm) triggerAlarm(alarm, "snooze");
      log.status = "missed";
    });
  saveDb();
}

function unlockAudio() {
  state.audioUnlocked = true;
  playDefaultBeep();
  render();
  els.soundHelp.hidden = true;
}

function playSoundById(soundId) {
  if (!state.audioUnlocked) {
    els.soundHelp.hidden = false;
    return;
  }
  const sound = db.alarmSounds.find((item) => item.id === soundId) || db.alarmSounds.find((item) => item.isDefault);
  if (sound?.fileUrl) {
    const audio = new Audio(sound.fileUrl);
    audio.play().catch(() => {
      els.soundHelp.hidden = false;
    });
    return;
  }
  playDefaultBeep();
}

function playDefaultBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.24);
  } catch {
    els.soundHelp.hidden = false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dayLabel(day) {
  return {
    sun: "일",
    mon: "월",
    tue: "화",
    wed: "수",
    thu: "목",
    fri: "금",
    sat: "토",
  }[day];
}

function alarmStatusLabel(status) {
  return {
    triggered: "울림",
    acknowledged: "확인 완료",
    snoozed: "스누즈",
    missed: "재알림 처리",
  }[status] || status;
}

function transactionTypeLabel(type) {
  return {
    prep_consume: "제조 차감",
    prep_cancel_reverse: "취소 복구",
    manual_adjustment: "수동 조정",
  }[type] || type;
}

function numberText(value) {
  return Number(value).toLocaleString("ko-KR");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

els.navButtons.forEach((button) => {
  button.addEventListener("click", () => setScreen(button.dataset.screen));
});
els.adminShortcut.addEventListener("click", () => setScreen("admin"));
els.soundUnlockButton.addEventListener("click", unlockAudio);
els.soundHelpButton.addEventListener("click", unlockAudio);
els.cancelClose.addEventListener("click", closeCancelModal);
els.cancelConfirm.addEventListener("click", () => {
  cancelPrepBatch(state.pendingCancelBatchId, els.cancelReason.value.trim());
  closeCancelModal();
  renderMakeScreen();
});
els.alarmAck.addEventListener("click", acknowledgeAlarm);
els.alarmSnooze.addEventListener("click", snoozeAlarm);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCancelModal();
    closeAlarmModal();
  }
});

render();
checkAlarms();
setInterval(checkAlarms, 60 * 1000);
