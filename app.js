const STORAGE_KEY = "milk-village-mvp-v1";
const SUPABASE_URL = "https://irfalbrkahcouaugbqwj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KLXkL3WkYQXTTUsdE9WZJw_Vw63SWtM";
const REMOTE_TABLE = "milk_village_state";
const REMOTE_STATE_ID = "main";
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const LOG_RETENTION_DAYS = {
  alarmEventLogs: 30,
  inventoryTransactions: 90,
  prepBatches: 90,
};
const supabaseClient =
  window.supabase && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

let remoteSaveTimer = null;
let applyingRemoteState = false;
let remoteChannel = null;
let remotePollTimer = null;
let lastRemoteUpdatedAt = "";
let localRevisionAt = "";
let audioContext = null;
let pendingSpeech = null;

const state = {
  screen: "make",
  adminUnlocked: false,
  adminMenu: "recipes",
  selectedRecipeId: null,
  selectedVariantId: null,
  selectedAnalysisSupplyId: null,
  analysisMode: "weekday",
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
  remoteStatus: document.querySelector("#remoteStatus"),
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
localRevisionAt = db.meta?.updatedAt || "";
if (pruneExpiredLogs()) {
  markDbChanged();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
state.selectedRecipeId = getActiveRecipes()[0]?.id || null;
state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId)[0]?.id || null;
state.selectedAnalysisSupplyId = db.supplies[0]?.id || null;

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
  pruneExpiredLogs();
  if (!applyingRemoteState) markDbChanged();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  queueRemoteSave();
}

function markDbChanged() {
  const updatedAt = nowIso();
  db.meta = { ...(db.meta || {}), updatedAt };
  localRevisionAt = updatedAt;
}

function isWithinRetention(iso, days, referenceDate = new Date()) {
  if (!iso) return true;
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return true;
  const cutoff = referenceDate.getTime() - days * 24 * 60 * 60 * 1000;
  return value >= cutoff;
}

function pruneExpiredLogs(referenceDate = new Date()) {
  const beforeCounts = {
    alarmEventLogs: db.alarmEventLogs.length,
    inventoryTransactions: db.inventoryTransactions.length,
    prepBatches: db.prepBatches.length,
  };

  db.alarmEventLogs = db.alarmEventLogs.filter((log) =>
    isWithinRetention(log.triggeredAt || log.createdAt || log.updatedAt, LOG_RETENTION_DAYS.alarmEventLogs, referenceDate),
  );
  db.inventoryTransactions = db.inventoryTransactions.filter((transaction) =>
    isWithinRetention(transaction.createdAt || transaction.updatedAt, LOG_RETENTION_DAYS.inventoryTransactions, referenceDate),
  );
  db.prepBatches = db.prepBatches.filter((batch) =>
    isWithinRetention(batch.createdAt || batch.updatedAt, LOG_RETENTION_DAYS.prepBatches, referenceDate),
  );

  return (
    beforeCounts.alarmEventLogs !== db.alarmEventLogs.length ||
    beforeCounts.inventoryTransactions !== db.inventoryTransactions.length ||
    beforeCounts.prepBatches !== db.prepBatches.length
  );
}

function loadDb() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return normalizeDb(JSON.parse(saved));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const seeded = seedDb();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function normalizeDb(nextDb) {
  const fallback = seedDb();
  return {
    meta: { ...fallback.meta, ...(nextDb?.meta || {}), updatedAt: nextDb?.meta?.updatedAt || nextDb?.updatedAt || fallback.meta.updatedAt },
    settings: { ...fallback.settings, ...(nextDb?.settings || {}) },
    supplies: Array.isArray(nextDb?.supplies) ? nextDb.supplies.map(normalizeSupply) : fallback.supplies,
    recipes: Array.isArray(nextDb?.recipes) ? nextDb.recipes.map(normalizeRecipe) : fallback.recipes,
    recipeVariants: Array.isArray(nextDb?.recipeVariants) ? nextDb.recipeVariants : fallback.recipeVariants,
    recipeVariantIngredients: Array.isArray(nextDb?.recipeVariantIngredients)
      ? nextDb.recipeVariantIngredients
      : fallback.recipeVariantIngredients,
    prepBatches: Array.isArray(nextDb?.prepBatches) ? nextDb.prepBatches : fallback.prepBatches,
    inventoryTransactions: Array.isArray(nextDb?.inventoryTransactions) ? nextDb.inventoryTransactions : fallback.inventoryTransactions,
    alarms: Array.isArray(nextDb?.alarms) ? nextDb.alarms.map(normalizeAlarm) : fallback.alarms,
    alarmSounds: Array.isArray(nextDb?.alarmSounds) ? nextDb.alarmSounds.map(normalizeVoicePreset) : fallback.alarmSounds,
    alarmEventLogs: Array.isArray(nextDb?.alarmEventLogs) ? nextDb.alarmEventLogs : fallback.alarmEventLogs,
  };
}

function normalizeSupply(supply) {
  const fallbackQty = Number(supply?.purchaseUnitQty ?? supply?.packageQty ?? 1000);
  const purchaseUnitQty = Number.isFinite(fallbackQty) && fallbackQty > 0 ? fallbackQty : 1000;
  const savedRecommendedEa = Number(supply?.recommendedOrderEa);
  const savedRecommendedQty = Number(supply?.recommendedOrderQty || 0);
  const recommendedOrderEa =
    Number.isFinite(savedRecommendedEa) && savedRecommendedEa >= 0
      ? savedRecommendedEa
      : purchaseUnitQty > 0 && savedRecommendedQty > purchaseUnitQty
        ? Math.ceil(savedRecommendedQty / purchaseUnitQty)
        : savedRecommendedQty;
  return {
    ...supply,
    currentStock: Number(supply?.currentStock || 0),
    minStock: Number(supply?.minStock || 0),
    recommendedOrderQty: recommendedOrderEa,
    recommendedOrderEa,
    purchaseUnitQty,
    updatedAt: supply?.updatedAt || supply?.createdAt || nowIso(),
  };
}

function normalizeRecipe(recipe, index = 0) {
  const sortOrder = Number(recipe?.sortOrder);
  return {
    ...recipe,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : index + 1,
    updatedAt: recipe?.updatedAt || recipe?.createdAt || nowIso(),
  };
}

function normalizeAlarm(alarm) {
  return {
    ...alarm,
    spokenMessage: alarm.spokenMessage || alarm.message || "",
    message: alarm.spokenMessage || alarm.message || "",
    soundId: "sound_default",
    repeatDays: Array.isArray(alarm.repeatDays) ? alarm.repeatDays : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    snoozeMinutes: 10,
    isActive: true,
    requiresAcknowledgement: true,
  };
}

function normalizeVoicePreset(sound) {
  return {
    id: sound.id,
    name: sound.name || "기본 음성",
    voiceURI: sound.voiceURI || "",
    lang: sound.lang || "ko-KR",
    rate: Number(sound.rate || 0.92),
    pitch: Number(sound.pitch || 1),
    volume: Number(sound.volume || 1),
    isDefault: Boolean(sound.isDefault),
    createdAt: sound.createdAt || nowIso(),
    updatedAt: sound.updatedAt || nowIso(),
  };
}

function setRemoteStatus(text, status = "") {
  if (!els.remoteStatus) return;
  els.remoteStatus.textContent = text;
  els.remoteStatus.className = `remote-status${status ? ` is-${status}` : ""}`;
}

async function initRemoteSync() {
  if (!supabaseClient) {
    setRemoteStatus("로컬 저장", "");
    return;
  }

  setRemoteStatus("DB 불러오는 중", "saving");
  try {
    const hasRemoteState = await fetchRemoteState({ force: true, source: "initial" });
    if (!hasRemoteState) await saveRemoteNow();
    subscribeRemoteChanges();
    startRemotePolling();
    setRemoteStatus("DB 연결됨", "online");
  } catch (error) {
    applyingRemoteState = false;
    console.error(error);
    setRemoteStatus("DB 설정 필요", "error");
  }
}

async function fetchRemoteState({ force = false, source = "poll" } = {}) {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient.from(REMOTE_TABLE).select("data, updated_at").eq("id", REMOTE_STATE_ID).maybeSingle();
  if (error) throw error;
  if (!data?.data) return false;
  applyRemoteState(data, { force, source });
  return true;
}

function applyRemoteState(row, { force = false, source = "realtime" } = {}) {
  const nextUpdatedAt = row.updated_at || "";
  if (!force && nextUpdatedAt && lastRemoteUpdatedAt && new Date(nextUpdatedAt) <= new Date(lastRemoteUpdatedAt)) return;

  applyingRemoteState = true;
  db = normalizeDb(row.data);
  const prunedExpiredLogs = pruneExpiredLogs();
  if (prunedExpiredLogs) markDbChanged();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  lastRemoteUpdatedAt = nextUpdatedAt || nowIso();
  localRevisionAt = db.meta?.updatedAt || lastRemoteUpdatedAt;
  syncSelectedIds();
  applyingRemoteState = false;
  setRemoteStatus(source === "realtime" ? "실시간 동기화됨" : "DB 동기화됨", "online");
  render();
  syncAlarmModalFromRemote(source);
  if (prunedExpiredLogs) queueRemoteSave();
}

function syncSelectedIds() {
  const activeRecipes = getActiveRecipes();
  if (!state.selectedRecipeId || !activeRecipes.some((recipe) => recipe.id === state.selectedRecipeId)) {
    state.selectedRecipeId = activeRecipes[0]?.id || null;
  }
  const variants = getVariantsForRecipe(state.selectedRecipeId);
  if (!state.selectedVariantId || !variants.some((variant) => variant.id === state.selectedVariantId)) {
    state.selectedVariantId = variants[0]?.id || null;
  }
  if (!state.selectedAnalysisSupplyId || !db.supplies.some((supply) => supply.id === state.selectedAnalysisSupplyId)) {
    state.selectedAnalysisSupplyId = db.supplies[0]?.id || null;
  }
}

function subscribeRemoteChanges() {
  if (!supabaseClient || remoteChannel) return;
  remoteChannel = supabaseClient
    .channel("milk-village-state-sync")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: REMOTE_TABLE,
        filter: `id=eq.${REMOTE_STATE_ID}`,
      },
      (payload) => {
        if (payload.new?.data) applyRemoteState(payload.new, { source: "realtime" });
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setRemoteStatus("실시간 연결됨", "online");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRemoteStatus("실시간 재연결 중", "saving");
    });
}

function startRemotePolling() {
  if (!supabaseClient || remotePollTimer) return;
  remotePollTimer = window.setInterval(() => {
    fetchRemoteState({ source: "poll" }).catch((error) => {
      console.error(error);
      setRemoteStatus("DB 동기화 지연", "error");
    });
  }, 10000);
}

function queueRemoteSave() {
  if (!supabaseClient || applyingRemoteState) return;
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(saveRemoteNow, 350);
}

async function saveRemoteNow() {
  if (!supabaseClient) return;
  remoteSaveTimer = null;
  setRemoteStatus("DB 저장 중", "saving");
  const dataToSave = normalizeDb(db);
  const localUpdatedAt = dataToSave.meta?.updatedAt || localRevisionAt || nowIso();

  const { data: remoteRow, error: fetchError } = await supabaseClient
    .from(REMOTE_TABLE)
    .select("data, updated_at")
    .eq("id", REMOTE_STATE_ID)
    .maybeSingle();
  if (fetchError) {
    console.error(fetchError);
    setRemoteStatus("DB 저장 실패", "error");
    return;
  }
  if (remoteRow?.data && remoteRow.updated_at) {
    const remoteIsNewerThanLastSync = !lastRemoteUpdatedAt || new Date(remoteRow.updated_at) > new Date(lastRemoteUpdatedAt);
    const remoteIsNewerThanLocal = new Date(remoteRow.updated_at) > new Date(localUpdatedAt);
    if (remoteIsNewerThanLastSync && remoteIsNewerThanLocal) {
      applyRemoteState(remoteRow, { force: true, source: "save" });
      return;
    }
  }

  const { error } = await supabaseClient.from(REMOTE_TABLE).upsert({
    id: REMOTE_STATE_ID,
    data: dataToSave,
    updated_at: localUpdatedAt,
  });
  if (error) {
    console.error(error);
    setRemoteStatus("DB 저장 실패", "error");
    return;
  }
  db = dataToSave;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  lastRemoteUpdatedAt = localUpdatedAt;
  setRemoteStatus("DB 연결됨", "online");
}

function seedDb() {
  const createdAt = nowIso();
  const supplies = [
    makeSupply("supply_tapioca", "냉동타피오카펄", "g", 1000, 1000, 5, "재료"),
    makeSupply("supply_sugar", "흑설탕", "g", 1000, 1000, 3, "재료"),
    makeSupply("supply_milk", "우유", "g", 1000, 500, 3, "유제품"),
    makeSupply("supply_cream", "생크림", "g", 1000, 500, 3, "유제품"),
    makeSupply("supply_cheese_powder", "치즈파우더", "g", 1000, 300, 2, "분말"),
  ];

  const recipes = [
    {
      id: "recipe_pearl",
      name: "흑당펄",
      category: "재료준비",
      isActive: true,
      sortOrder: 1,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "recipe_cheese",
      name: "치즈폼",
      category: "재료준비",
      isActive: true,
      sortOrder: 2,
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
    meta: {
      updatedAt: createdAt,
    },
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
        name: "기본 한국어 음성",
        voiceURI: "",
        lang: "ko-KR",
        rate: 0.92,
        pitch: 1,
        volume: 1,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    alarmEventLogs: [],
  };
}

function makeSupply(id, name, unit, currentStock, minStock, recommendedOrderEa, category, purchaseUnitQty = 1000) {
  const createdAt = nowIso();
  return {
    id,
    name,
    unit,
    currentStock,
    minStock,
    recommendedOrderQty: recommendedOrderEa,
    recommendedOrderEa,
    purchaseUnitQty,
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
    spokenMessage: message,
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

function recipeSortValue(recipe, index = 0) {
  const sortOrder = Number(recipe?.sortOrder);
  return Number.isFinite(sortOrder) ? sortOrder : index + 1;
}

function sortRecipes(recipes) {
  return [...recipes].sort((a, b) => recipeSortValue(a) - recipeSortValue(b) || a.name.localeCompare(b.name, "ko"));
}

function getRecipesForAdmin() {
  return sortRecipes(db.recipes);
}

function getActiveRecipes() {
  return sortRecipes(db.recipes.filter((recipe) => recipe.isActive));
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
  els.soundUnlockButton.className = `pill-button ${state.audioUnlocked ? "pill-button--ready" : "pill-button--pending"}`;
  els.soundUnlockButton.innerHTML = `
    <span class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>
    </span>
    ${state.audioUnlocked ? "음성 알림 준비됨" : "음성 알림 대기 중"}
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
                : `<span class="stock-pill">발주알림 기준량 이하 품목 없음</span>`
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
      updatedAt: createdAt,
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
  batch.updatedAt = canceledAt;
  saveDb();
}

function renderOrderScreen() {
  const orderNeeded = getOrderNeededSupplies();
  els.workArea.innerHTML = `
    <section class="order-screen" aria-label="발주 필요 품목">
      <div class="panel-header">
        <h2>발주 필요 품목</h2>
        <p>현재 재고가 발주알림 기준량 이하인 활성 소모품만 표시합니다.</p>
      </div>
      ${
        orderNeeded.length
          ? `<div class="table-wrap">
              <table class="order-table">
                <thead>
                  <tr>
                    <th>품목명</th>
                    <th>현재 재고(g)</th>
                    <th>발주알림 기준량</th>
                    <th>1ea 용량</th>
                    <th>추천 발주량(ea)</th>
                    <th>최근 사용</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderNeeded
                    .map((supply) => {
                      const latest = getLatestTransactionForSupply(supply.id);
                      const purchaseUnitQty = Number(supply.purchaseUnitQty || 0);
                      const recommendedOrderEa = Number(supply.recommendedOrderEa || supply.recommendedOrderQty || 0);
                      return `
                        <tr>
                          <td><strong>${escapeHtml(supply.name)}</strong><br><span class="badge">발주 필요</span></td>
                          <td><span class="big-number is-warning">${numberText(supply.currentStock)}</span></td>
                          <td>${numberText(supply.minStock)}</td>
                          <td>${purchaseUnitQty > 0 ? `${numberText(purchaseUnitQty)}${escapeHtml(supply.unit)}` : "-"}</td>
                          <td><span class="big-number">${numberText(recommendedOrderEa)}ea</span></td>
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
    ["adjust", "입고/재고 조정"],
    ["alarms", "알림 관리"],
    ["alarmLogs", "알림 기록"],
    ["analysis", "소모량 분석"],
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
  if (state.adminMenu === "alarmLogs") renderAlarmLogsAdmin(body);
  if (state.adminMenu === "analysis") renderUsageAnalysisAdmin(body);
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
  const recipes = getRecipesForAdmin();
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
                <button class="list-button list-button--draggable ${item.id === recipe?.id ? "is-active" : ""}" type="button" draggable="true" data-select-recipe="${item.id}" data-recipe-drag="${item.id}" title="드래그해서 순서 변경">
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
                <div class="button-row">
                  ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
                  <button class="button button--danger" type="button" id="deleteRecipe">재료 삭제</button>
                  <button class="button button--primary" type="button" id="saveRecipeAdmin">저장</button>
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
                  <button class="button button--ghost" type="button" id="addIngredient">소모품 추가</button>
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
  setupRecipeDragSorting(container);
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
  container.querySelector("#deleteRecipe")?.addEventListener("click", deleteRecipe);
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

function setupRecipeDragSorting(container) {
  let draggedRecipeId = "";
  container.querySelectorAll("[data-recipe-drag]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      draggedRecipeId = button.dataset.recipeDrag;
      button.classList.add("is-dragging");
      if (event.dataTransfer) {
        const dragImage = document.createElement("canvas");
        dragImage.width = 1;
        dragImage.height = 1;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedRecipeId);
        event.dataTransfer.setDragImage(dragImage, 0, 0);
      }
    });
    button.addEventListener("dragend", () => {
      draggedRecipeId = "";
      container.querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after").forEach((item) => {
        item.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
      });
    });
    button.addEventListener("dragover", (event) => {
      if (!draggedRecipeId || draggedRecipeId === button.dataset.recipeDrag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const position = getRecipeDropPosition(event, button);
      clearRecipeDropMarkers(container);
      button.classList.add(position === "after" ? "is-drop-after" : "is-drop-before");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("is-drop-before", "is-drop-after");
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer?.getData("text/plain") || draggedRecipeId;
      const position = getRecipeDropPosition(event, button);
      clearRecipeDropMarkers(container);
      moveRecipe(sourceId, button.dataset.recipeDrag, position);
    });
  });
}

function getRecipeDropPosition(event, target) {
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearRecipeDropMarkers(container) {
  container.querySelectorAll(".is-drop-before, .is-drop-after").forEach((item) => {
    item.classList.remove("is-drop-before", "is-drop-after");
  });
}

function moveRecipe(sourceRecipeId, targetRecipeId, position = "before") {
  if (!sourceRecipeId || !targetRecipeId || sourceRecipeId === targetRecipeId) return;
  const ordered = getRecipesForAdmin();
  const sourceIndex = ordered.findIndex((recipe) => recipe.id === sourceRecipeId);
  const targetIndex = ordered.findIndex((recipe) => recipe.id === targetRecipeId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [movedRecipe] = ordered.splice(sourceIndex, 1);
  const nextTargetIndex = ordered.findIndex((recipe) => recipe.id === targetRecipeId);
  ordered.splice(position === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedRecipe);
  const now = nowIso();
  ordered.forEach((recipe, index) => {
    recipe.sortOrder = index + 1;
    recipe.updatedAt = now;
  });
  db.recipes = ordered;
  state.selectedRecipeId = movedRecipe.id;
  state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId, false)[0]?.id || null;
  state.savedMessage = "재료 순서를 저장했습니다.";
  saveDb();
  renderAdminScreen();
}

function addRecipe() {
  const createdAt = nowIso();
  const recipe = {
    id: uid("recipe"),
    name: "새 재료",
    category: "재료준비",
    isActive: true,
    sortOrder: getRecipesForAdmin().length + 1,
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

function deleteRecipe() {
  const recipe = getRecipe(state.selectedRecipeId);
  if (!recipe) return;
  const variantIds = db.recipeVariants.filter((variant) => variant.recipeId === recipe.id).map((variant) => variant.id);
  db.recipes = db.recipes.filter((item) => item.id !== recipe.id);
  db.recipeVariants = db.recipeVariants.filter((variant) => variant.recipeId !== recipe.id);
  db.recipeVariantIngredients = db.recipeVariantIngredients.filter((ingredient) => !variantIds.includes(ingredient.recipeVariantId));
  db.recipes = getRecipesForAdmin().map((item, index) => ({ ...item, sortOrder: index + 1, updatedAt: nowIso() }));
  state.selectedRecipeId = db.recipes[0]?.id || null;
  state.selectedVariantId = getVariantsForRecipe(state.selectedRecipeId, false)[0]?.id || null;
  state.savedMessage = `${recipe.name} 재료를 삭제했습니다.`;
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
              <th>발주알림 기준량</th>
              <th>1ea 용량</th>
              <th>추천 발주량(ea)</th>
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
                    <td><input data-supply-purchase="${supply.id}" type="number" min="0" value="${supply.purchaseUnitQty || 1000}" /></td>
                    <td><input data-supply-order="${supply.id}" type="number" min="0" step="1" value="${supply.recommendedOrderEa || supply.recommendedOrderQty || 0}" /></td>
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
      supply.purchaseUnitQty = Number(container.querySelector(`[data-supply-purchase="${supply.id}"]`).value || 0);
      supply.recommendedOrderEa = Number(container.querySelector(`[data-supply-order="${supply.id}"]`).value || 0);
      supply.recommendedOrderQty = supply.recommendedOrderEa;
      supply.isActive = Boolean(container.querySelector(`[data-supply-active="${supply.id}"]`).checked);
      supply.updatedAt = now;
    });
    state.savedMessage = "저장 완료";
    saveDb();
    renderAdminScreen();
  });
}

function renderAdjustAdmin(container) {
  const firstSupply = db.supplies[0] || null;
  const firstPackageQty = Number(firstSupply?.purchaseUnitQty || 1000);
  container.innerHTML = `
    <div class="admin-card">
      <h3>입고 추가</h3>
      <div class="form-grid">
        <label class="field">
          <span>품목</span>
          <select id="receiveSupply">
            ${db.supplies.map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${numberText(supply.currentStock)}${escapeHtml(supply.unit)})</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>1ea 용량</span>
          <input id="receiveUnitQty" type="number" min="0" value="${firstPackageQty}" />
        </label>
        <label class="field">
          <span>구매 수량(ea)</span>
          <input id="receivePackageCount" type="number" min="0" step="1" value="1" />
        </label>
        <label class="field">
          <span>추가될 재고</span>
          <input id="receiveTotalQty" type="number" value="${firstPackageQty}" readonly />
        </label>
        <label class="field">
          <span>메모</span>
          <input id="receiveReason" type="text" value="입고" />
        </label>
      </div>
      <div class="quick-count-row" aria-label="구매 수량 빠른 선택">
        ${Array.from({ length: 12 }, (_, index) => {
          const count = index + 1;
          return `<button class="button button--ghost button--small" data-package-count="${count}" type="button">x${count}</button>`;
        }).join("")}
      </div>
      <div class="button-row">
        ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
        <button class="button button--primary" id="applyReceive" type="button">입고 추가</button>
      </div>
    </div>
    <div class="admin-card">
      <h3>실사 재고 조정</h3>
      <div class="form-grid">
        <label class="field">
          <span>품목</span>
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
        <button class="button button--ghost" id="applyAdjust" type="button">실제 재고로 맞추기</button>
      </div>
    </div>
  `;
  const receiveSelect = container.querySelector("#receiveSupply");
  const receiveUnitQty = container.querySelector("#receiveUnitQty");
  const receivePackageCount = container.querySelector("#receivePackageCount");
  const receiveTotalQty = container.querySelector("#receiveTotalQty");
  const updateReceivePreview = () => {
    const unitQty = Number(receiveUnitQty.value || 0);
    const packageCount = Number(receivePackageCount.value || 0);
    receiveTotalQty.value = Math.max(0, unitQty * packageCount);
  };
  receiveSelect.addEventListener("change", () => {
    const supply = getSupply(receiveSelect.value);
    receiveUnitQty.value = supply?.purchaseUnitQty || 1000;
    updateReceivePreview();
  });
  receiveUnitQty.addEventListener("input", updateReceivePreview);
  receivePackageCount.addEventListener("input", updateReceivePreview);
  container.querySelectorAll("[data-package-count]").forEach((button) => {
    button.addEventListener("click", () => {
      receivePackageCount.value = button.dataset.packageCount;
      updateReceivePreview();
    });
  });
  container.querySelector("#applyReceive").addEventListener("click", () => {
    const supply = getSupply(receiveSelect.value);
    if (!supply) return;
    const unitQty = Number(receiveUnitQty.value || 0);
    const packageCount = Number(receivePackageCount.value || 0);
    const qtyChange = unitQty * packageCount;
    if (qtyChange <= 0) return;
    const createdAt = nowIso();
    supply.currentStock = Number(supply.currentStock) + qtyChange;
    supply.purchaseUnitQty = unitQty;
    supply.updatedAt = createdAt;
    db.inventoryTransactions.push({
      id: uid("txn"),
      supplyId: supply.id,
      supplyName: supply.name,
      qtyChange,
      unit: supply.unit,
      type: "stock_received",
      createdAt,
      note: container.querySelector("#receiveReason").value.trim() || `${numberText(packageCount)}ea 입고`,
      packageCount,
      purchaseUnitQty: unitQty,
    });
    state.savedMessage = `${supply.name} ${numberText(packageCount)}ea, ${numberText(qtyChange)}${supply.unit} 입고 처리했습니다.`;
    saveDb();
    renderAdminScreen();
  });
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
  const selectedAlarmId = container.dataset.selectedAlarmId || db.alarms[0]?.id || "";
  const alarm = db.alarms.find((item) => item.id === selectedAlarmId) || db.alarms[0] || null;
  container.innerHTML = `
    <div class="admin-card">
      <div class="alarm-row">
        <strong>알림 목록</strong>
        <button class="button button--ghost button--small" id="addAlarm" type="button">알림 추가</button>
        <button class="button button--ghost button--small" id="testAlarm" type="button" ${alarm ? "" : "disabled"}>테스트 실행</button>
        <button class="button button--danger button--small" id="deleteAlarm" type="button" ${alarm ? "" : "disabled"}>삭제</button>
      </div>
      <div class="list-stack">
        ${
          db.alarms.length
            ? db.alarms
                .map(
                  (item) => `
                    <button class="list-button ${alarm && item.id === alarm.id ? "is-active" : ""}" type="button" data-select-alarm="${item.id}">
                      ${escapeHtml(item.title)} · ${escapeHtml(item.time)}
                    </button>
                  `,
                )
                .join("")
            : `<div class="empty-state">등록된 알림이 없습니다.</div>`
        }
      </div>
    </div>
    ${
      alarm
        ? `
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
            </div>
            <label class="field">
              <span>음성으로 읽을 문구</span>
              <textarea id="alarmSpokenMessageInput">${escapeHtml(alarm.spokenMessage || alarm.message)}</textarea>
            </label>
            <div class="button-row">
              ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
              <button class="button button--primary" id="saveAlarm" type="button">저장</button>
            </div>
          </div>
        `
        : `
          <div class="admin-card">
            <div class="empty-state">필요할 때만 알림을 추가해서 사용하세요.</div>
          </div>
        `
    }
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
    if (!alarm) return;
    db.alarms = db.alarms.filter((item) => item.id !== alarm.id);
    container.dataset.selectedAlarmId = db.alarms[0]?.id || "";
    saveDb();
    renderAdminScreen();
  });
  container.querySelector("#testAlarm").addEventListener("click", () => {
    if (!alarm) return;
    applySimpleAlarmForm(container, alarm);
    triggerAlarm(alarm, "test");
  });
  container.querySelector("#saveAlarm")?.addEventListener("click", () => {
    if (!alarm) return;
    applySimpleAlarmForm(container, alarm);
    state.savedMessage = "저장 완료";
    saveDb();
    renderAlarmsAdminWithSelection(alarm.id);
  });
}

function applySimpleAlarmForm(container, alarm) {
  const spokenMessage = container.querySelector("#alarmSpokenMessageInput").value.trim() || "확인이 필요한 알림입니다.";
  alarm.title = container.querySelector("#alarmTitleInput").value.trim() || "알림";
  alarm.time = container.querySelector("#alarmTimeInput").value || alarm.time;
  alarm.message = spokenMessage;
  alarm.spokenMessage = spokenMessage;
  alarm.soundId = "sound_default";
  alarm.snoozeMinutes = 10;
  alarm.repeatDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  alarm.isActive = true;
  alarm.requiresAcknowledgement = true;
  alarm.updatedAt = nowIso();
}

function renderAlarmsAdminWithSelection(alarmId) {
  renderAdminScreen();
  const body = els.workArea.querySelector("#adminBody");
  if (body) {
    body.dataset.selectedAlarmId = alarmId;
    renderAlarmsAdmin(body);
  }
}

function renderAlarmLogsAdmin(container) {
  const logs = [...db.alarmEventLogs].sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt));
  container.innerHTML = `
    <div class="admin-card">
      <h3>알림 로그</h3>
      <p class="muted">알림 로그는 최근 ${LOG_RETENTION_DAYS.alarmEventLogs}일만 자동 보관합니다.</p>
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

function getConsumptionRowsForSupply(supplyId) {
  const canceledBatchIds = new Set(db.prepBatches.filter((batch) => batch.status === "canceled").map((batch) => batch.id));
  return db.inventoryTransactions
    .filter((transaction) => transaction.supplyId === supplyId && transaction.type === "prep_consume")
    .filter((transaction) => !transaction.prepBatchId || !canceledBatchIds.has(transaction.prepBatchId))
    .map((transaction) => ({
      date: new Date(transaction.createdAt),
      qty: Math.abs(Number(transaction.qtyChange || 0)),
      unit: transaction.unit,
    }))
    .filter((row) => Number.isFinite(row.date.getTime()) && row.qty > 0);
}

function buildWeekdayConsumptionPoints(rows) {
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const labels = ["월", "화", "수", "목", "금", "토", "일"];
  const totals = new Map(dayOrder.map((day) => [day, 0]));
  rows.forEach((row) => {
    const day = row.date.getDay();
    totals.set(day, (totals.get(day) || 0) + row.qty);
  });
  return dayOrder.map((day, index) => ({ label: labels[index], value: totals.get(day) || 0 }));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-");
  return `${year.slice(2)}.${month}`;
}

function buildMonthlyConsumptionPoints(rows) {
  const start = new Date();
  start.setDate(start.getDate() - LOG_RETENTION_DAYS.inventoryTransactions + 1);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setDate(1);
  end.setHours(0, 0, 0, 0);

  const months = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
    months.push(monthKey(cursor));
  }

  const totals = new Map(months.map((key) => [key, 0]));
  rows.forEach((row) => {
    const key = monthKey(row.date);
    if (totals.has(key)) totals.set(key, (totals.get(key) || 0) + row.qty);
  });
  return months.map((key) => ({ label: monthLabel(key), value: totals.get(key) || 0 }));
}

function renderUsageLineChart(points, unit) {
  const width = 720;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 56, left: 72 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? pad.left + plotWidth / 2 : pad.left + (plotWidth * index) / (points.length - 1);
    const y = pad.top + plotHeight - (point.value / maxValue) * plotHeight;
    return { ...point, x, y };
  });
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue * (4 - index)) / 4;
    const y = pad.top + (plotHeight * index) / 4;
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="usage-chart-grid" />
      <text x="${pad.left - 10}" y="${y + 5}" text-anchor="end" class="usage-chart-y">${numberText(Math.round(value))}</text>
    `;
  }).join("");
  const linePoints = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const dots = coords
    .map(
      (point) => `
        <circle cx="${point.x}" cy="${point.y}" r="5" class="usage-chart-dot" />
        <text x="${point.x}" y="${point.y - 12}" text-anchor="middle" class="usage-chart-value">${numberText(Math.round(point.value))}</text>
        <text x="${point.x}" y="${height - 22}" text-anchor="middle" class="usage-chart-x">${escapeHtml(point.label)}</text>
      `,
    )
    .join("");

  return `
    <svg class="usage-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="소모량 추이 그래프">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" class="usage-chart-bg" />
      ${gridLines}
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" class="usage-chart-axis" />
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" class="usage-chart-axis" />
      <polyline points="${linePoints}" class="usage-chart-line" />
      ${dots}
      <text x="${pad.left}" y="${height - 6}" class="usage-chart-unit">단위: ${escapeHtml(unit)}</text>
    </svg>
  `;
}

function renderUsageAnalysisAdmin(container) {
  const supply = getSupply(state.selectedAnalysisSupplyId) || db.supplies[0] || null;
  if (!supply) {
    container.innerHTML = `<div class="admin-card"><div class="empty-state">분석할 소모품이 없습니다.</div></div>`;
    return;
  }
  state.selectedAnalysisSupplyId = supply.id;
  const rows = getConsumptionRowsForSupply(supply.id);
  const points = state.analysisMode === "month" ? buildMonthlyConsumptionPoints(rows) : buildWeekdayConsumptionPoints(rows);
  const unit = supply.unit || rows[0]?.unit || "g";
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const average = points.length ? total / points.length : 0;
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0] || { label: "-", value: 0 });

  container.innerHTML = `
    <div class="admin-card">
      <div class="analysis-toolbar">
        <label class="field">
          <span>재료</span>
          <select id="analysisSupply">
            ${db.supplies.map((item) => `<option value="${item.id}" ${item.id === supply.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <div class="segmented-control" aria-label="분석 기준">
          <button class="segment-button ${state.analysisMode === "weekday" ? "is-active" : ""}" type="button" data-analysis-mode="weekday">요일별</button>
          <button class="segment-button ${state.analysisMode === "month" ? "is-active" : ""}" type="button" data-analysis-mode="month">월별</button>
        </div>
      </div>
      <div class="analysis-summary">
        <div><span>총 소모량</span><strong>${numberText(Math.round(total))}${escapeHtml(unit)}</strong></div>
        <div><span>평균</span><strong>${numberText(Math.round(average))}${escapeHtml(unit)}</strong></div>
        <div><span>최다</span><strong>${escapeHtml(peak.label)} · ${numberText(Math.round(peak.value))}${escapeHtml(unit)}</strong></div>
      </div>
      <div class="usage-chart-wrap">
        ${renderUsageLineChart(points, unit)}
      </div>
      <p class="muted">제조 차감 로그만 집계하며, 취소된 제조 배치는 제외합니다. 현재 로그 보관 기준상 최근 ${LOG_RETENTION_DAYS.inventoryTransactions}일 안의 소모량만 분석합니다.</p>
    </div>
  `;

  container.querySelector("#analysisSupply").addEventListener("change", (event) => {
    state.selectedAnalysisSupplyId = event.target.value;
    renderUsageAnalysisAdmin(container);
  });
  container.querySelectorAll("[data-analysis-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.analysisMode = button.dataset.analysisMode;
      renderUsageAnalysisAdmin(container);
    });
  });
}

function renderAllLogsAdmin(container) {
  const batches = [...db.prepBatches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const transactions = [...db.inventoryTransactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  container.innerHTML = `
    <div class="admin-card">
      <h3>제조 배치 로그</h3>
      <p class="muted">제조 로그는 최근 ${LOG_RETENTION_DAYS.prepBatches}일만 자동 보관합니다.</p>
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
      <p class="muted">재고 상세 거래 로그는 최근 ${LOG_RETENTION_DAYS.inventoryTransactions}일만 자동 보관합니다.</p>
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
  const existingEvent = findAlarmEventForMinute(alarm.id, new Date(triggeredAt));
  if (existingEvent?.status === "triggered") {
    state.activeAlarmEventId = existingEvent.id;
    showAlarmModal(getAlarmDisplayFromEvent(existingEvent));
    speakAlarm(getAlarmDisplayFromEvent(existingEvent), source === "test");
    return;
  }

  const eventLog = {
    id: uid("alarm_event"),
    alarmId: alarm.id,
    alarmTitle: alarm.title,
    alarmMessage: alarm.message,
    spokenMessage: alarm.spokenMessage || alarm.message || alarm.title,
    soundId: alarm.soundId || db.settings.defaultSoundId,
    snoozeMinutes: Number(alarm.snoozeMinutes || 10),
    triggeredAt,
    acknowledgedAt: "",
    acknowledgedBy: "",
    snoozedUntil: "",
    status: "triggered",
    source,
    createdAt: triggeredAt,
    updatedAt: triggeredAt,
  };
  db.alarmEventLogs.push(eventLog);
  state.activeAlarmEventId = eventLog.id;
  saveDb();
  showAlarmModal(alarm);
  speakAlarm(alarm, source === "test");
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

function getOpenAlarmEvent() {
  const today = todayDateKey();
  return db.alarmEventLogs
    .filter((log) => log.status === "triggered" && log.triggeredAt?.slice(0, 10) === today)
    .sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt))[0];
}

function findAlarmEventForMinute(alarmId, date) {
  const dateKey = todayDateKey(date);
  const minuteKey = date.toISOString().slice(11, 16);
  return db.alarmEventLogs.find((log) => log.alarmId === alarmId && log.triggeredAt?.slice(0, 10) === dateKey && log.triggeredAt?.slice(11, 16) === minuteKey);
}

function getAlarmDisplayFromEvent(eventLog) {
  const alarm = db.alarms.find((item) => item.id === eventLog?.alarmId);
  return {
    ...(alarm || {}),
    id: alarm?.id || eventLog?.alarmId,
    title: eventLog?.alarmTitle || alarm?.title || "알림",
    message: eventLog?.alarmMessage || alarm?.message || "확인이 필요한 알림입니다.",
    spokenMessage: eventLog?.spokenMessage || alarm?.spokenMessage || alarm?.message || eventLog?.alarmMessage || eventLog?.alarmTitle || "확인이 필요한 알림입니다.",
    soundId: eventLog?.soundId || alarm?.soundId || db.settings.defaultSoundId,
    snoozeMinutes: Number(eventLog?.snoozeMinutes || alarm?.snoozeMinutes || 10),
  };
}

function syncAlarmModalFromRemote(source = "realtime") {
  const openEvent = getOpenAlarmEvent();
  if (!openEvent) {
    if (state.activeAlarmEventId) {
      state.activeAlarmEventId = null;
      closeAlarmModal();
    }
    return;
  }

  const isNewEvent = state.activeAlarmEventId !== openEvent.id;
  state.activeAlarmEventId = openEvent.id;
  const alarm = getAlarmDisplayFromEvent(openEvent);
  showAlarmModal(alarm);
  if (isNewEvent && source !== "local") speakAlarm(alarm);
}

function acknowledgeAlarm() {
  const eventLog = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
  if (eventLog) {
    const acknowledgedAt = nowIso();
    eventLog.status = "acknowledged";
    eventLog.acknowledgedAt = acknowledgedAt;
    eventLog.acknowledgedBy = "직원";
    eventLog.updatedAt = acknowledgedAt;
    saveDb();
  }
  closeAlarmModal();
  if (state.screen === "admin" && state.adminMenu === "alarmLogs") renderAdminScreen();
}

function snoozeAlarm() {
  const eventLog = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
  const alarm = getAlarmDisplayFromEvent(eventLog);
  if (eventLog && alarm) {
    const snoozedUntil = new Date(Date.now() + Number(alarm.snoozeMinutes || 10) * 60 * 1000);
    const updatedAt = nowIso();
    eventLog.status = "snoozed";
    eventLog.snoozedUntil = snoozedUntil.toISOString();
    eventLog.updatedAt = updatedAt;
    saveDb();
  }
  closeAlarmModal();
  if (state.screen === "admin" && state.adminMenu === "alarmLogs") renderAdminScreen();
}

function checkAlarms() {
  const now = new Date();
  const day = dayKeys[now.getDay()];
  const currentTime = localTimeValue(now);
  let changed = false;

  db.alarms
    .filter((alarm) => alarm.isActive && alarm.repeatDays.includes(day) && alarm.time === currentTime)
    .forEach((alarm) => {
      const alreadyTriggered = Boolean(findAlarmEventForMinute(alarm.id, now));
      if (!alreadyTriggered) triggerAlarm(alarm);
    });

  db.alarmEventLogs
    .filter((log) => log.status === "snoozed" && log.snoozedUntil && new Date(log.snoozedUntil) <= now)
    .forEach((log) => {
      const alarm = db.alarms.find((item) => item.id === log.alarmId);
      if (alarm) triggerAlarm(alarm, "snooze");
      log.status = "missed";
      log.updatedAt = nowIso();
      changed = true;
    });
  if (changed) saveDb();
}

function unlockAudio({ announce = true } = {}) {
  state.audioUnlocked = true;
  ensureAudioReady();
  const queuedSpeech = pendingSpeech;
  pendingSpeech = null;
  if (queuedSpeech) {
    speakText(queuedSpeech.text, queuedSpeech.preset, true);
  } else if (announce) {
    speakText("음성 알림이 준비되었습니다.", getVoicePreset(db.settings.defaultSoundId), true);
  } else {
    primeSpeechSynthesis();
  }
  render();
  els.soundHelp.hidden = true;
}

function setupAutomaticAudioUnlock() {
  const autoUnlock = () => {
    if (!state.audioUnlocked) unlockAudio({ announce: false });
  };
  ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, autoUnlock, { once: true, capture: true });
  });
}

function getSpeechVoices() {
  if (!window.speechSynthesis) return [];
  return window.speechSynthesis
    .getVoices()
    .slice()
    .sort((a, b) => {
      const aKo = a.lang.toLowerCase().startsWith("ko") ? 0 : 1;
      const bKo = b.lang.toLowerCase().startsWith("ko") ? 0 : 1;
      return aKo - bKo || a.name.localeCompare(b.name);
    });
}

function getVoicePreset(soundId) {
  return db.alarmSounds.find((item) => item.id === soundId) || db.alarmSounds.find((item) => item.isDefault) || normalizeVoicePreset({});
}

function speakAlarm(alarm, allowWhileLocked = false) {
  const preset = getVoicePreset(alarm.soundId || db.settings.defaultSoundId);
  speakText(alarm.spokenMessage || alarm.message || alarm.title, preset, allowWhileLocked);
}

function speakText(text, preset, allowWhileLocked = false) {
  if (allowWhileLocked) state.audioUnlocked = true;
  if (!state.audioUnlocked) {
    pendingSpeech = { text, preset };
    els.soundHelp.hidden = false;
    return;
  }
  els.soundHelp.hidden = true;
  ensureAudioReady();
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    playDefaultBeep();
    return;
  }
  const utterance = new window.SpeechSynthesisUtterance(text);
  const voices = getSpeechVoices();
  const selectedVoice = voices.find((voice) => voice.voiceURI === preset?.voiceURI) || voices.find((voice) => voice.lang.toLowerCase().startsWith("ko"));
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || preset?.lang || "ko-KR";
  utterance.rate = Number(preset?.rate || 0.92);
  utterance.pitch = Number(preset?.pitch || 1);
  utterance.volume = Number(preset?.volume || 1);
  utterance.onerror = () => {
    playDefaultBeep();
    els.soundHelp.hidden = false;
  };
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume?.();
    playDefaultBeep();
    window.setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 140);
  } catch {
    playDefaultBeep();
    return;
  }
}

function primeSpeechSynthesis() {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  try {
    const utterance = new window.SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    utterance.lang = "ko-KR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // Some browsers only unlock speech when an audible utterance is played.
  }
}

function ensureAudioReady() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume?.();
    return audioContext;
  } catch {
    return null;
  }
}

function playDefaultBeep() {
  try {
    const context = ensureAudioReady();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    els.soundHelp.hidden = false;
  }
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
    stock_received: "입고 추가",
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
els.soundUnlockButton.addEventListener("click", () => unlockAudio({ announce: true }));
els.soundHelpButton.addEventListener("click", () => unlockAudio({ announce: true }));
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
initRemoteSync();
setupAutomaticAudioUnlock();
setInterval(checkAlarms, 60 * 1000);
