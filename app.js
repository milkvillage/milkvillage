const STORAGE_KEY = "milk-village-mvp-v1";
const SUPABASE_URL = "https://irfalbrkahcouaugbqwj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KLXkL3WkYQXTTUsdE9WZJw_Vw63SWtM";
const REMOTE_TABLE = "milk_village_state";
const REMOTE_STATE_ID = "main";
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const alarmDayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const alarmDayLabels = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
const LOG_RETENTION_DAYS = {
  alarmEventLogs: 30,
  inventoryTransactions: 90,
  prepBatches: 90,
  operationRecords: 180,
};
const ALARM_HISTORY_LIMIT = 8;
const ALARM_SOUND_BUCKET = "alarm-sounds";
const ALARM_SOUND_PUBLIC_BASE_URL = `${SUPABASE_URL}/storage/v1/object/public/${ALARM_SOUND_BUCKET}`;
const DEFAULT_ALARM_SOUND_ID = "sound_supplies_check";
const INTERNAL_ALARM_SOUNDS = [
  {
    id: "sound_store_cleanliness",
    name: "위생 관리 점검",
    fileName: "store-cleanliness-check.mp3",
    url: `${ALARM_SOUND_PUBLIC_BASE_URL}/store-cleanliness-check.mp3`,
  },
  {
    id: "sound_pre_peak_supplies",
    name: "피크 전 소모품 준비",
    fileName: "pre-peak-supplies.mp3",
    url: `${ALARM_SOUND_PUBLIC_BASE_URL}/pre-peak-supplies.mp3`,
  },
  {
    id: DEFAULT_ALARM_SOUND_ID,
    name: "소모품 확인",
    fileName: "supplies-check.mp3",
    url: `${ALARM_SOUND_PUBLIC_BASE_URL}/supplies-check.mp3`,
  },
];
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
let pendingSpeech = null;
let alarmSpeechLoopTimer = null;
let alarmSpeechRetryTimer = null;
let alarmSoundRetryTimer = null;
let speechKeepAliveTimer = null;
let activeAlarmSoundEventId = "";
let alarmAudio = null;
let previewAudio = null;
let lastSpeechUnlockAttemptAt = 0;
let wakeLock = null;
let audioContext = null;
let speechVoicesPrepared = false;

const state = {
  screen: "make",
  adminUnlocked: false,
  adminMenu: "summary",
  selectedRecipeId: null,
  selectedVariantId: null,
  selectedChecklistTaskId: null,
  selectedAnalysisSupplyId: null,
  selectedAttendanceStaffId: null,
  selectedAttendanceDate: todayDateKey(),
  attendanceMonth: todayDateKey().slice(0, 7),
  selectedAlarmId: null,
  analysisMode: "weekday",
  operatorName: "",
  loadingVariantId: null,
  pendingCancelBatchId: null,
  activeAlarmEventId: null,
  audioUnlocked: false,
  savedMessage: "",
};

const els = {
  screenTitle: document.querySelector("#screenTitle"),
  currentDateTime: document.querySelector("#currentDateTime"),
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
state.selectedAnalysisSupplyId = getSuppliesForAdmin()[0]?.id || null;

function uid(prefix) {
  const value = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isIsoAfter(leftIso, rightIso) {
  if (!leftIso || !rightIso) return false;
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left > right;
}

function todayDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyFromIso(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return todayDateKey(date);
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

function updateCurrentDateTime() {
  if (!els.currentDateTime) return;
  const now = new Date();
  const dateText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(now);
  const timeText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  els.currentDateTime.dateTime = now.toISOString();
  els.currentDateTime.innerHTML = `
    <span>${dateText}</span>
    <strong>${timeText}</strong>
  `;
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
    checklistRecords: db.operations?.checklistRecords?.length || 0,
    handoverNotes: db.operations?.handoverNotes?.length || 0,
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
  if (db.operations) {
    db.operations.checklistRecords = db.operations.checklistRecords.filter((record) =>
      isWithinRetention(record.updatedAt || record.checkedAt, LOG_RETENTION_DAYS.operationRecords, referenceDate),
    );
    db.operations.handoverNotes = db.operations.handoverNotes.filter((note) =>
      note.status === "open" || isWithinRetention(note.createdAt || note.updatedAt, LOG_RETENTION_DAYS.operationRecords, referenceDate),
    );
  }

  return (
    beforeCounts.alarmEventLogs !== db.alarmEventLogs.length ||
    beforeCounts.inventoryTransactions !== db.inventoryTransactions.length ||
    beforeCounts.prepBatches !== db.prepBatches.length ||
    beforeCounts.checklistRecords !== (db.operations?.checklistRecords?.length || 0) ||
    beforeCounts.handoverNotes !== (db.operations?.handoverNotes?.length || 0)
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
    settings: normalizeSettings(nextDb?.settings, fallback.settings),
    supplies: Array.isArray(nextDb?.supplies)
      ? nextDb.supplies.map(normalizeSupply).sort((a, b) => a.sortOrder - b.sortOrder)
      : fallback.supplies,
    recipes: Array.isArray(nextDb?.recipes) ? nextDb.recipes.map(normalizeRecipe) : fallback.recipes,
    recipeVariants: Array.isArray(nextDb?.recipeVariants) ? nextDb.recipeVariants.map(normalizeRecipeVariant) : fallback.recipeVariants,
    recipeVariantIngredients: Array.isArray(nextDb?.recipeVariantIngredients)
      ? nextDb.recipeVariantIngredients
      : fallback.recipeVariantIngredients,
    prepBatches: Array.isArray(nextDb?.prepBatches) ? nextDb.prepBatches : fallback.prepBatches,
    inventoryTransactions: Array.isArray(nextDb?.inventoryTransactions) ? nextDb.inventoryTransactions : fallback.inventoryTransactions,
    alarms: Array.isArray(nextDb?.alarms) ? nextDb.alarms.map(normalizeAlarm) : fallback.alarms,
    alarmSounds: normalizeAlarmSounds(nextDb?.alarmSounds, fallback.alarmSounds),
    alarmEventLogs: Array.isArray(nextDb?.alarmEventLogs) ? nextDb.alarmEventLogs : fallback.alarmEventLogs,
    operations: normalizeOperations(nextDb?.operations, fallback.operations),
  };
}

function normalizeSettings(settings, fallbackSettings) {
  const defaultSoundId =
    settings?.defaultSoundId && settings.defaultSoundId !== "sound_default" ? settings.defaultSoundId : fallbackSettings.defaultSoundId;
  return {
    ...fallbackSettings,
    ...(settings || {}),
    defaultSoundId,
    alarmTitleHistory: normalizeTextHistory(settings?.alarmTitleHistory || fallbackSettings?.alarmTitleHistory),
    alarmMessageHistory: normalizeTextHistory(settings?.alarmMessageHistory || fallbackSettings?.alarmMessageHistory),
  };
}

function normalizeTextHistory(values) {
  return uniqueTextValues(Array.isArray(values) ? values : [], ALARM_HISTORY_LIMIT);
}

function normalizeOperations(operations, fallbackOperations) {
  const fallback = fallbackOperations || makeDefaultOperations();
  return {
    checklistTasks: Array.isArray(operations?.checklistTasks)
      ? operations.checklistTasks.map((task, index) => normalizeChecklistTask(task, index))
      : fallback.checklistTasks,
    checklistRecords: Array.isArray(operations?.checklistRecords)
      ? operations.checklistRecords.map(normalizeChecklistRecord)
      : fallback.checklistRecords,
    handoverNotes: Array.isArray(operations?.handoverNotes)
      ? operations.handoverNotes.map(normalizeHandoverNote)
      : fallback.handoverNotes,
    staffMembers: Array.isArray(operations?.staffMembers)
      ? operations.staffMembers.map((staff, index) => normalizeStaffMember(staff, index))
      : fallback.staffMembers,
    attendanceRecords: Array.isArray(operations?.attendanceRecords)
      ? operations.attendanceRecords.map(normalizeAttendanceRecord)
      : fallback.attendanceRecords,
  };
}

function normalizeChecklistTask(task, index = 0) {
  return {
    id: task?.id || uid("check_task"),
    section: task?.section === "close" ? "close" : "open",
    title: task?.title || "체크 항목",
    isActive: task?.isActive !== false,
    sortOrder: Number.isFinite(Number(task?.sortOrder)) ? Number(task.sortOrder) : index + 1,
    createdAt: task?.createdAt || nowIso(),
    updatedAt: task?.updatedAt || task?.createdAt || nowIso(),
  };
}

function normalizeChecklistRecord(record) {
  return {
    id: record?.id || uid("check_record"),
    date: record?.date || todayDateKey(),
    taskId: record?.taskId || "",
    checked: Boolean(record?.checked),
    checkedAt: record?.checkedAt || "",
    checkedBy: record?.checkedBy || "",
    updatedAt: record?.updatedAt || record?.checkedAt || nowIso(),
  };
}

function normalizeHandoverNote(note) {
  return {
    id: note?.id || uid("handover"),
    date: note?.date || dateKeyFromIso(note?.createdAt || nowIso()),
    category: note?.category || "인수인계",
    message: note?.message || "",
    author: note?.author || "직원",
    status: note?.status === "resolved" ? "resolved" : "open",
    resolvedAt: note?.resolvedAt || "",
    resolvedBy: note?.resolvedBy || "",
    createdAt: note?.createdAt || nowIso(),
    updatedAt: note?.updatedAt || note?.createdAt || nowIso(),
  };
}

function normalizeStaffMember(staff, index = 0) {
  return {
    id: staff?.id || uid("staff"),
    name: staff?.name || "근무자",
    isActive: staff?.isActive !== false,
    sortOrder: Number.isFinite(Number(staff?.sortOrder)) ? Number(staff.sortOrder) : index + 1,
    createdAt: staff?.createdAt || nowIso(),
    updatedAt: staff?.updatedAt || staff?.createdAt || nowIso(),
  };
}

function normalizeAttendanceRecord(record) {
  const status = record?.status === "absent" ? "absent" : "present";
  return {
    id: record?.id || uid("attendance"),
    date: record?.date || todayDateKey(),
    staffId: record?.staffId || "",
    staffName: record?.staffName || "",
    status,
    employeeSignature: record?.employeeSignature || "",
    managerSignature: record?.managerSignature || "",
    recordedAt: record?.recordedAt || record?.updatedAt || nowIso(),
    updatedAt: record?.updatedAt || record?.recordedAt || nowIso(),
  };
}

function normalizeSupply(supply, index = 0) {
  const fallbackQty = Number(supply?.purchaseUnitQty ?? supply?.packageQty ?? 1000);
  const purchaseUnitQty = Number.isFinite(fallbackQty) && fallbackQty > 0 ? fallbackQty : 1000;
  const sortOrder = Number(supply?.sortOrder);
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
    sortOrder: Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : index + 1,
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

function normalizeRecipeVariant(variant, index = 0) {
  const multiplier = Number(variant?.multiplier || 1);
  const sortOrder = Number(variant?.sortOrder);
  return {
    ...variant,
    multiplier: Number.isFinite(multiplier) ? multiplier : 1,
    label: getVariantLabelFromMultiplier(Number.isFinite(multiplier) ? multiplier : 1),
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : index + 1,
    updatedAt: variant?.updatedAt || variant?.createdAt || nowIso(),
  };
}

function normalizeAlarm(alarm) {
  const isDraft = Boolean(alarm.isDraft);
  const soundId = alarm.soundId && alarm.soundId !== "sound_default" ? alarm.soundId : DEFAULT_ALARM_SOUND_ID;
  return {
    ...alarm,
    spokenMessage: alarm.spokenMessage || alarm.message || "",
    message: alarm.spokenMessage || alarm.message || "",
    time: normalizeAlarmTime(alarm.time),
    soundId,
    repeatDays: normalizeAlarmDays(alarm.repeatDays),
    snoozeMinutes: 10,
    isDraft,
    isActive: alarm.isActive !== false && !isDraft,
    requiresAcknowledgement: true,
  };
}

function normalizeAlarmTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return localTimeValue();
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeAlarmDays(days) {
  if (!Array.isArray(days)) return [...alarmDayOrder];
  const uniqueDays = alarmDayOrder.filter((day) => days.includes(day));
  return uniqueDays.length ? uniqueDays : [];
}

function normalizeVoicePreset(sound) {
  return {
    id: sound.id,
    name: sound.name || "기본 음성",
    fileName: sound.fileName || "",
    url: sound.url || "",
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

function normalizeAlarmSounds(values, fallbackValues = []) {
  const byId = new Map();
  [...(Array.isArray(fallbackValues) ? fallbackValues : []), ...(Array.isArray(values) ? values : [])].forEach((sound) => {
    const normalized = normalizeVoicePreset(sound);
    if (normalized.id && normalized.id !== "sound_default") byId.set(normalized.id, normalized);
  });
  INTERNAL_ALARM_SOUNDS.forEach((sound) => {
    byId.set(sound.id, normalizeVoicePreset({ ...byId.get(sound.id), ...sound, isDefault: sound.id === DEFAULT_ALARM_SOUND_ID }));
  });
  return [...byId.values()];
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
    state.selectedAnalysisSupplyId = getSuppliesForAdmin()[0]?.id || null;
  }
  if (state.selectedAttendanceStaffId && !getActiveStaffMembers().some((staff) => staff.id === state.selectedAttendanceStaffId)) {
    state.selectedAttendanceStaffId = null;
  }
  if (!state.selectedChecklistTaskId || !getChecklistTask(state.selectedChecklistTaskId)) {
    state.selectedChecklistTaskId = getChecklistTasksForAdmin()[0]?.id || null;
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
  if (isIsoAfter(localRevisionAt, localUpdatedAt)) {
    queueRemoteSave();
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
  if (isIsoAfter(localRevisionAt, localUpdatedAt)) {
    lastRemoteUpdatedAt = localUpdatedAt;
    setRemoteStatus("DB 저장 중", "saving");
    queueRemoteSave();
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
  supplies.forEach((supply, index) => {
    supply.sortOrder = index + 1;
  });

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
      defaultSoundId: DEFAULT_ALARM_SOUND_ID,
      alarmTitleHistory: [],
      alarmMessageHistory: [],
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
    alarmSounds: INTERNAL_ALARM_SOUNDS.map((sound) => ({
      ...sound,
      voiceURI: "",
      lang: "ko-KR",
      rate: 0.92,
      pitch: 1,
      volume: 1,
      isDefault: sound.id === DEFAULT_ALARM_SOUND_ID,
      createdAt,
      updatedAt: createdAt,
    })),
    alarmEventLogs: [],
    operations: makeDefaultOperations(createdAt),
  };
}

function makeSupply(id, name, unit, currentStock, minStock, recommendedOrderEa, category, purchaseUnitQty = 1000, sortOrder = 0) {
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
    sortOrder,
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
    soundId: DEFAULT_ALARM_SOUND_ID,
    isActive: true,
    requiresAcknowledgement: true,
    snoozeMinutes: 10,
    createdAt,
    updatedAt: createdAt,
  };
}

function getAlarmTitleInputValue(alarm) {
  const title = String(alarm?.title || "").trim();
  return title === "새 알림" ? "" : title;
}

function getAlarmMessageInputValue(alarm) {
  const message = String(alarm?.spokenMessage || alarm?.message || "").trim();
  return message === "알림 내용을 입력해주세요." ? "" : message;
}

function getAlarmListTitle(alarm) {
  return getAlarmTitleInputValue(alarm) || "새 알림";
}

function splitAlarmTime(time) {
  const normalized = normalizeAlarmTime(time);
  const [hour, minute] = normalized.split(":");
  return { hour, minute };
}

function formatAlarmTime(time) {
  const { hour, minute } = splitAlarmTime(time);
  return minute === "00" ? `${Number(hour)}시` : `${Number(hour)}시 ${minute}분`;
}

function formatAlarmDaySummary(days) {
  const normalizedDays = normalizeAlarmDays(days);
  if (normalizedDays.length === alarmDayOrder.length) return "매일";
  if (!normalizedDays.length) return "요일 없음";
  return normalizedDays.map((day) => alarmDayLabels[day]).join("");
}

function renderAlarmTimeControls(time) {
  const { hour, minute } = splitAlarmTime(time);
  return `
    <div class="alarm-time-control">
      <select id="alarmHourInput" aria-label="알림 시">
        ${Array.from({ length: 24 }, (_, value) => {
          const padded = String(value).padStart(2, "0");
          return `<option value="${padded}" ${padded === hour ? "selected" : ""}>${value}시</option>`;
        }).join("")}
      </select>
      <select id="alarmMinuteInput" aria-label="알림 분">
        ${Array.from({ length: 60 }, (_, value) => {
          const padded = String(value).padStart(2, "0");
          return `<option value="${padded}" ${padded === minute ? "selected" : ""}>${padded}분</option>`;
        }).join("")}
      </select>
    </div>
  `;
}

function renderAlarmDayControls(days) {
  const selectedDays = normalizeAlarmDays(days);
  return `
    <fieldset class="alarm-days-field">
      <legend>반복 요일</legend>
      <div class="alarm-day-grid">
        ${alarmDayOrder
          .map(
            (day) => `
              <label class="alarm-day-chip">
                <input type="checkbox" value="${day}" data-alarm-day="${day}" ${selectedDays.includes(day) ? "checked" : ""} />
                <span>${alarmDayLabels[day]}</span>
              </label>
            `,
          )
          .join("")}
      </div>
    </fieldset>
  `;
}

function renderAlarmSoundOptions(selectedSoundId) {
  return db.alarmSounds
    .map(
      (sound) => `
        <option value="${escapeAttr(sound.id)}" ${sound.id === selectedSoundId ? "selected" : ""}>${escapeHtml(sound.name)}</option>
      `,
    )
    .join("");
}

function renderAlarmSoundTestSection() {
  return `
    <section class="alarm-sound-test-panel" aria-label="알림음 테스트">
      <div class="alarm-panel-heading">
        <h3>알림음 테스트</h3>
      </div>
      <div class="alarm-sound-test-list">
        ${db.alarmSounds
          .map(
            (sound) => `
              <div class="alarm-sound-test-row">
                <div>
                  <strong>${escapeHtml(sound.name)}</strong>
                  <span>${escapeHtml(sound.fileName || "Supabase Storage")}</span>
                </div>
                <button class="button button--ghost button--small" type="button" data-test-alarm-sound="${escapeAttr(sound.id)}">테스트 재생</button>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function getAlarmTimeFromForm(container) {
  const hour = container.querySelector("#alarmHourInput")?.value || "00";
  const minute = container.querySelector("#alarmMinuteInput")?.value || "00";
  return normalizeAlarmTime(`${hour}:${minute}`);
}

function getAlarmDaysFromForm(container) {
  return [...container.querySelectorAll("[data-alarm-day]:checked")].map((input) => input.value);
}

function isScheduledAlarmEnabled(alarm) {
  return Boolean(alarm?.isActive && !alarm?.isDraft);
}

function uniqueTextValues(values, limit = ALARM_HISTORY_LIMIT) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase("ko-KR");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function rememberAlarmText(title, message) {
  db.settings.alarmTitleHistory = uniqueTextValues([title, ...(db.settings.alarmTitleHistory || [])]);
  db.settings.alarmMessageHistory = uniqueTextValues([message, ...(db.settings.alarmMessageHistory || [])]);
}

function getAlarmTitleChoices() {
  return uniqueTextValues([
    ...(db.settings.alarmTitleHistory || []),
    ...db.alarms.map(getAlarmTitleInputValue),
  ]);
}

function getAlarmMessageChoices() {
  return uniqueTextValues([
    ...(db.settings.alarmMessageHistory || []),
    ...db.alarms.map(getAlarmMessageInputValue),
  ]);
}

function renderAlarmQuickChoices(values, datasetName) {
  if (!values.length) return "";
  return `
    <div class="quick-choice-row">
      ${values.map((value) => `<button class="quick-choice-button" type="button" data-${datasetName}="${escapeAttr(value)}">${escapeHtml(value)}</button>`).join("")}
    </div>
  `;
}

function makeDefaultOperations(createdAt = nowIso()) {
  const openTasks = [
    "매장 조명과 음악 켜기",
    "POS/결제기 정상 작동 확인",
    "냉장고/냉동고 온도 확인",
    "제빙기와 얼음 상태 확인",
    "오늘 필요한 재료 제조량 확인",
    "영업 공간 청결 상태 확인",
  ];
  const closeTasks = [
    "제조 도구 세척 및 건조",
    "재료 보관 상태 확인",
    "쓰레기 정리",
    "바닥/작업대 마감 청소",
    "내일 필요한 발주 품목 확인",
    "POS 마감 및 전원 확인",
  ];

  const checklistTasks = [
    ...openTasks.map((title, index) => makeChecklistTask(`open_${index + 1}`, "open", title, index + 1, createdAt)),
    ...closeTasks.map((title, index) => makeChecklistTask(`close_${index + 1}`, "close", title, index + 1, createdAt)),
  ];

  return {
    checklistTasks,
    checklistRecords: [],
    handoverNotes: [],
    staffMembers: [],
    attendanceRecords: [],
  };
}

function makeChecklistTask(id, section, title, sortOrder, createdAt = nowIso()) {
  return {
    id,
    section,
    title,
    sortOrder,
    isActive: true,
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

function getSuppliesForAdmin() {
  return [...db.supplies].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function getStaffMembersForAdmin() {
  return [...(db.operations?.staffMembers || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function getActiveStaffMembers() {
  return getStaffMembersForAdmin().filter((staff) => staff.isActive);
}

function getStaffMember(staffId) {
  return (db.operations?.staffMembers || []).find((staff) => staff.id === staffId);
}

function getAttendanceRecordsForMonth(monthKey = state.attendanceMonth) {
  return (db.operations?.attendanceRecords || [])
    .filter((record) => String(record.date || "").startsWith(monthKey))
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName, "ko-KR"));
}

function getAttendanceRecord(date, staffId) {
  return (db.operations?.attendanceRecords || []).find((record) => record.date === date && record.staffId === staffId);
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
    .filter((batch) => dateKeyFromIso(batch.createdAt) === today)
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

function getChecklistTasks(section) {
  return (db.operations?.checklistTasks || [])
    .filter((task) => task.section === section && task.isActive)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.title.localeCompare(b.title, "ko"));
}

function getChecklistTasksForAdmin(section = "") {
  return (db.operations?.checklistTasks || [])
    .filter((task) => !section || task.section === section)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.title.localeCompare(b.title, "ko"));
}

function getChecklistTask(taskId) {
  return (db.operations?.checklistTasks || []).find((task) => task.id === taskId);
}

function checklistSectionLabel(section) {
  return section === "close" ? "마감" : "오픈";
}

function getChecklistRecord(date, taskId) {
  return (db.operations?.checklistRecords || []).find((record) => record.date === date && record.taskId === taskId);
}

function isChecklistTaskChecked(date, taskId) {
  return Boolean(getChecklistRecord(date, taskId)?.checked);
}

function getChecklistStats(date = todayDateKey()) {
  const sections = ["open", "close"];
  const sectionStats = sections.map((section) => {
    const tasks = getChecklistTasks(section);
    const done = tasks.filter((task) => isChecklistTaskChecked(date, task.id)).length;
    return {
      section,
      label: section === "open" ? "오픈" : "마감",
      total: tasks.length,
      done,
      pending: Math.max(0, tasks.length - done),
      tasks,
    };
  });
  const total = sectionStats.reduce((sum, item) => sum + item.total, 0);
  const done = sectionStats.reduce((sum, item) => sum + item.done, 0);
  return {
    date,
    sections: sectionStats,
    total,
    done,
    pending: Math.max(0, total - done),
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

function getHandoverNotes({ openOnly = false, todayOnly = false } = {}) {
  const today = todayDateKey();
  return (db.operations?.handoverNotes || [])
    .filter((note) => !openOnly || note.status === "open")
    .filter((note) => !todayOnly || note.date === today)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function getOpenAlarmEventsToday() {
  const today = todayDateKey();
  return db.alarmEventLogs
    .filter((log) => ["triggered", "snoozed"].includes(log.status) && dateKeyFromIso(log.triggeredAt) === today)
    .sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt));
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

function renderSoundStatus() {
  els.soundUnlockButton.className = `pill-button ${state.audioUnlocked ? "pill-button--ready" : "pill-button--pending"}`;
  els.soundUnlockButton.setAttribute("aria-label", `음성 상태: ${state.audioUnlocked ? "ON" : "OFF"}`);
  els.soundUnlockButton.innerHTML = `
    <span class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>
    </span>
    ${state.audioUnlocked ? "음성 ON" : "음성 OFF"}
  `;
}

function render() {
  const titleMap = {
    make: "재료 만들기(입력필수)",
    orders: "발주(확인사항)",
    ops: "운영 체크(입력필수)",
    attendance: "근퇴기록(입력필수)",
    admin: "관리자",
  };
  els.screenTitle.textContent = titleMap[state.screen];
  els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.screen === state.screen));
  renderSoundStatus();

  if (state.screen === "make") renderMakeScreen();
  if (state.screen === "orders") renderOrderScreen();
  if (state.screen === "ops") renderOpsScreen();
  if (state.screen === "attendance") renderAttendanceScreen();
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
                    <th>주문 단위 용량</th>
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

function renderOpsScreen() {
  const today = todayDateKey();
  const stats = getChecklistStats(today);
  const openNotes = getHandoverNotes({ openOnly: true });
  const recentNotes = getHandoverNotes().slice(0, 8);
  const staffMembers = getActiveStaffMembers();
  if (state.operatorName && !staffMembers.some((staff) => staff.name === state.operatorName)) {
    state.operatorName = "";
  }

  els.workArea.innerHTML = `
    <section class="ops-screen" aria-label="운영 체크">
      <div class="panel-header">
        <h2>오늘 운영 체크</h2>
        <p>오픈/마감 루틴과 특이사항을 같은 화면에서 남깁니다.</p>
      </div>
      <div class="ops-body">
        <section class="ops-card ops-card--summary">
          <div>
            <span class="summary-label">오늘 체크 진행률</span>
            <strong class="summary-value">${stats.percent}%</strong>
          </div>
          <div class="progress-track" aria-label="오늘 체크 진행률">
            <span style="width: ${stats.percent}%"></span>
          </div>
          <div class="summary-meta">
            <span>${stats.done}/${stats.total} 완료</span>
            <span>미완료 ${stats.pending}</span>
            <span>인수인계 ${openNotes.length}</span>
          </div>
          <label class="field operator-field">
            <span>근무자 선택</span>
            <select id="operatorName" ${staffMembers.length ? "" : "disabled"}>
              <option value="">이름 선택</option>
              ${staffMembers
                .map((staff) => `<option value="${escapeAttr(staff.name)}" ${staff.name === state.operatorName ? "selected" : ""}>${escapeHtml(staff.name)}</option>`)
                .join("")}
            </select>
          </label>
        </section>

        ${stats.sections.map((sectionStat) => renderChecklistSection(sectionStat, today)).join("")}

        <section class="ops-card ops-card--wide">
          <div class="ops-card-heading">
            <h3>특이사항 / 인수인계</h3>
            <span>${openNotes.length}건 진행 중</span>
          </div>
          <div class="handover-form">
            <label class="field">
              <span>분류</span>
              <select id="handoverCategory">
                <option value="인수인계">인수인계</option>
                <option value="재고">재고</option>
                <option value="기계/설비">기계/설비</option>
                <option value="고객">고객</option>
                <option value="청소/위생">청소/위생</option>
              </select>
            </label>
            <label class="field handover-message-field">
              <span>내용</span>
              <textarea id="handoverMessage" placeholder="다음 근무자나 점장이 알아야 할 내용을 입력"></textarea>
            </label>
            <button class="button button--primary" id="addHandoverNote" type="button">기록 추가</button>
          </div>
          ${
            recentNotes.length
              ? `<div class="handover-list">
                  ${recentNotes
                    .map(
                      (note) => `
                        <article class="handover-item ${note.status === "resolved" ? "is-resolved" : ""}">
                          <div>
                            <strong>${escapeHtml(note.category)}</strong>
                            <p>${escapeHtml(note.message)}</p>
                            <span>${dateTimeText(note.createdAt)} · ${escapeHtml(note.author)}</span>
                          </div>
                          ${
                            note.status === "open"
                              ? `<button class="button button--ghost button--small" data-resolve-note="${note.id}" type="button">완료</button>`
                              : `<span class="badge badge--ok">완료</span>`
                          }
                        </article>
                      `,
                    )
                    .join("")}
                </div>`
              : `<div class="empty-state">아직 남겨진 인수인계가 없습니다.</div>`
          }
        </section>
      </div>
    </section>
  `;

  const operatorInput = els.workArea.querySelector("#operatorName");
  const getSelectedOperator = () => operatorInput.value.trim();
  operatorInput.addEventListener("change", () => {
    state.operatorName = getSelectedOperator();
  });
  els.workArea.querySelectorAll("[data-check-task]").forEach((input) => {
    input.addEventListener("change", () => {
      const operatorName = getSelectedOperator();
      if (!operatorName) {
        input.checked = false;
        alert("근무자 이름을 먼저 선택해주세요.");
        return;
      }
      updateChecklistRecord(input.dataset.checkTask, input.checked, operatorName);
    });
  });
  els.workArea.querySelector("#addHandoverNote").addEventListener("click", () => {
    const operatorName = getSelectedOperator();
    if (!operatorName) {
      alert("근무자 이름을 먼저 선택해주세요.");
      return;
    }
    addHandoverNote(els.workArea, operatorName);
  });
  els.workArea.querySelectorAll("[data-resolve-note]").forEach((button) => {
    button.addEventListener("click", () => {
      const operatorName = getSelectedOperator();
      if (!operatorName) {
        alert("근무자 이름을 먼저 선택해주세요.");
        return;
      }
      resolveHandoverNote(button.dataset.resolveNote, operatorName);
    });
  });
}

function renderAttendanceScreen() {
  const staffMembers = getActiveStaffMembers();
  const selectedStaff = staffMembers.find((staff) => staff.id === state.selectedAttendanceStaffId) || null;
  const selectedDate = getSelectedAttendanceDate();
  const selectedRecord = selectedStaff ? getAttendanceRecord(selectedDate, selectedStaff.id) : null;

  els.workArea.innerHTML = `
    <section class="attendance-screen" aria-label="근퇴기록">
      <div class="panel-header">
        <h2>근퇴기록</h2>
        <p>달력에서 날짜를 선택한 뒤 근무자 이름, 출근/결근, 서명을 기록합니다.</p>
      </div>
      <div class="attendance-body">
        <section class="attendance-card">
          <div class="attendance-selected-date">
            <span>선택 날짜</span>
            <strong>${formatAttendanceDate(selectedDate)}</strong>
          </div>
          <div class="attendance-form-grid">
            <label class="field">
              <span>근무자 이름</span>
              <select id="attendanceStaff" ${staffMembers.length ? "" : "disabled"}>
                <option value="">이름 선택</option>
                ${staffMembers
                  .map(
                    (staff) => `
                      <option value="${escapeAttr(staff.id)}" ${staff.id === selectedStaff?.id ? "selected" : ""}>${escapeHtml(staff.name)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="signature-section">
            <div class="signature-card">
              <div class="signature-heading">
                <strong>근무자 서명</strong>
                <button class="button button--ghost button--small" type="button" data-clear-signature="employee">지우기</button>
              </div>
              <canvas class="signature-pad" id="employeeSignaturePad" aria-label="근무자 서명 입력"></canvas>
            </div>
            <div class="signature-card">
              <div class="signature-heading">
                <strong>매니저 서명</strong>
                <button class="button button--ghost button--small" type="button" data-clear-signature="manager">지우기</button>
              </div>
              <canvas class="signature-pad" id="managerSignaturePad" aria-label="매니저 서명 입력"></canvas>
            </div>
          </div>
          <div class="attendance-action-row">
            <button class="button button--primary" type="button" data-attendance-status="present" ${selectedStaff ? "" : "disabled"}>출근</button>
            <button class="button button--danger" type="button" data-attendance-status="absent" ${selectedStaff ? "" : "disabled"}>결근</button>
            ${
              selectedRecord
                ? `<span class="attendance-current-status ${selectedRecord.status === "present" ? "is-present" : "is-absent"}">${attendanceRecordStatusText(selectedRecord)} 기록됨</span>`
                : `<span class="muted">선택 날짜 기록 없음</span>`
            }
          </div>
          ${staffMembers.length ? "" : `<div class="empty-state">관리자 화면에서 근무자 이름을 먼저 등록해주세요.</div>`}
        </section>
        <section class="attendance-card attendance-calendar-card">
          <div class="attendance-calendar-heading">
            <button class="button button--ghost button--small" type="button" id="attendancePrevMonth">이전</button>
            <h3>${formatAttendanceMonth(state.attendanceMonth)}</h3>
            <button class="button button--ghost button--small" type="button" id="attendanceNextMonth">다음</button>
          </div>
          ${renderAttendanceCalendar(state.attendanceMonth)}
        </section>
      </div>
    </section>
  `;

  const staffSelect = els.workArea.querySelector("#attendanceStaff");
  staffSelect?.addEventListener("change", () => {
    state.selectedAttendanceStaffId = staffSelect.value || null;
    renderAttendanceScreen();
  });
  setupSignaturePad(els.workArea.querySelector("#employeeSignaturePad"), selectedRecord?.employeeSignature || "");
  setupSignaturePad(els.workArea.querySelector("#managerSignaturePad"), selectedRecord?.managerSignature || "");
  els.workArea.querySelectorAll("[data-clear-signature]").forEach((button) => {
    button.addEventListener("click", () => {
      handleSignatureClearRequest(button, els.workArea.querySelector(`#${button.dataset.clearSignature}SignaturePad`));
    });
  });
  els.workArea.querySelectorAll("[data-attendance-status]").forEach((button) => {
    button.addEventListener("click", () => saveAttendanceRecord(button.dataset.attendanceStatus, els.workArea));
  });
  els.workArea.querySelectorAll("[data-attendance-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAttendanceDate = button.dataset.attendanceDate;
      state.attendanceMonth = state.selectedAttendanceDate.slice(0, 7);
      renderAttendanceScreen();
    });
  });
  els.workArea.querySelector("#attendancePrevMonth")?.addEventListener("click", () => {
    setAttendanceMonthByOffset(-1);
    renderAttendanceScreen();
  });
  els.workArea.querySelector("#attendanceNextMonth")?.addEventListener("click", () => {
    setAttendanceMonthByOffset(1);
    renderAttendanceScreen();
  });
}

function saveAttendanceRecord(status, container) {
  const staff = getStaffMember(state.selectedAttendanceStaffId);
  if (!staff) {
    alert("근무자 이름을 먼저 선택해주세요.");
    return;
  }
  const employeeSignature = getSignaturePadData(container.querySelector("#employeeSignaturePad"));
  if (!employeeSignature) {
    alert("근무자 서명을 손가락으로 입력해주세요.");
    return;
  }

  const selectedDate = getSelectedAttendanceDate();
  const updatedAt = nowIso();
  let record = getAttendanceRecord(selectedDate, staff.id);
  if (!record) {
    record = {
      id: uid("attendance"),
      date: selectedDate,
      staffId: staff.id,
      staffName: staff.name,
      status: "present",
      employeeSignature: "",
      managerSignature: "",
      recordedAt: updatedAt,
      updatedAt,
    };
    db.operations.attendanceRecords.push(record);
  }
  record.staffName = staff.name;
  record.status = status === "absent" ? "absent" : "present";
  record.employeeSignature = employeeSignature;
  record.managerSignature = getSignaturePadData(container.querySelector("#managerSignaturePad"));
  record.recordedAt = record.recordedAt || updatedAt;
  record.updatedAt = updatedAt;
  saveDb();
  renderAttendanceScreen();
}

function renderAttendanceCalendar(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const recordsByDate = new Map();
  getAttendanceRecordsForMonth(monthKey).forEach((record) => {
    if (!recordsByDate.has(record.date)) recordsByDate.set(record.date, []);
    recordsByDate.get(record.date).push(record);
  });
  const cells = [];
  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(`<div class="attendance-day is-empty" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= lastDate; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const records = recordsByDate.get(date) || [];
    cells.push(`
      <button class="attendance-day ${date === todayDateKey() ? "is-today" : ""} ${date === getSelectedAttendanceDate() ? "is-selected" : ""}" type="button" data-attendance-date="${date}">
        <strong>${day}</strong>
        <div class="attendance-day-records">
          ${
            records.length
              ? records
                  .map(
                    (record) => `
                      <span class="attendance-chip ${record.status === "present" ? "is-present" : "is-absent"} ${isSignedPresentRecord(record) ? "is-signed" : ""}">
                        ${escapeHtml(record.staffName)} ${attendanceRecordStatusText(record)}
                      </span>
                    `,
                  )
                  .join("")
              : ""
          }
        </div>
      </button>
    `);
  }
  return `
    <div class="attendance-calendar">
      ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<div class="attendance-weekday">${day}</div>`).join("")}
      ${cells.join("")}
    </div>
  `;
}

function attendanceStatusLabel(status) {
  return status === "absent" ? "결근" : "출근";
}

function isSignedPresentRecord(record) {
  return record?.status === "present" && Boolean(record.employeeSignature) && Boolean(record.managerSignature);
}

function attendanceRecordStatusText(record) {
  return isSignedPresentRecord(record) ? "서명완료 출근" : attendanceStatusLabel(record?.status);
}

function formatAttendanceMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function formatAttendanceDate(dateKey) {
  const [year, month, date] = dateKey.split("-").map(Number);
  if (!year || !month || !date) return dateKey;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(year, month - 1, date));
}

function getSelectedAttendanceDate() {
  const fallback = todayDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.selectedAttendanceDate || "")) {
    state.selectedAttendanceDate = fallback;
  }
  if (!state.attendanceMonth) state.attendanceMonth = state.selectedAttendanceDate.slice(0, 7);
  return state.selectedAttendanceDate;
}

function shiftMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function setAttendanceMonthByOffset(offset) {
  const currentDate = getSelectedAttendanceDate();
  const nextMonth = shiftMonthKey(state.attendanceMonth || currentDate.slice(0, 7), offset);
  const [year, month] = nextMonth.split("-").map(Number);
  const selectedDay = Number(currentDate.slice(8, 10)) || 1;
  const lastDate = new Date(year, month, 0).getDate();
  state.attendanceMonth = nextMonth;
  state.selectedAttendanceDate = `${nextMonth}-${String(Math.min(selectedDay, lastDate)).padStart(2, "0")}`;
}

function isSignatureImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function setupSignaturePad(canvas, initialData = "") {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || 320));
  const height = Math.max(1, Math.round(rect.height || 140));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 4;
  context.strokeStyle = "#0f1b2a";
  context.clearRect(0, 0, width, height);
  canvas.dataset.hasSignature = "0";
  canvas.dataset.initialSignature = "";
  canvas.dataset.signatureDirty = "0";
  canvas.dataset.signatureLoaded = "0";

  if (isSignatureImage(initialData)) {
    canvas.dataset.hasSignature = "1";
    canvas.dataset.initialSignature = initialData;
    const image = new Image();
    image.onload = () => {
      if (canvas.dataset.signatureDirty === "1") return;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.dataset.hasSignature = "1";
      canvas.dataset.signatureLoaded = "1";
    };
    image.src = initialData;
  }

  let isDrawing = false;
  const getPoint = (event) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
  };
  const startDrawing = (event) => {
    event.preventDefault();
    const point = getPoint(event);
    isDrawing = true;
    canvas.dataset.hasSignature = "1";
    canvas.dataset.initialSignature = "";
    canvas.dataset.signatureDirty = "1";
    canvas.setPointerCapture?.(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };
  const draw = (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };
  const stopDrawing = (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    isDrawing = false;
    context.closePath();
    canvas.releasePointerCapture?.(event.pointerId);
  };

  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", draw);
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  canvas.addEventListener("pointerleave", stopDrawing);
}

function clearSignaturePad(canvas) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  canvas.dataset.hasSignature = "0";
  canvas.dataset.initialSignature = "";
  canvas.dataset.signatureDirty = "1";
  canvas.dataset.signatureLoaded = "0";
}

function handleSignatureClearRequest(button, canvas) {
  if (!button || !canvas || canvas.dataset.hasSignature !== "1") return;
  window.clearTimeout(button.clearSignatureTimer);
  if (button.dataset.clearConfirm === "1") {
    button.dataset.clearConfirm = "0";
    button.classList.remove("is-confirming");
    button.textContent = "지우기";
    clearSignaturePad(canvas);
    return;
  }

  button.dataset.clearConfirm = "1";
  button.classList.add("is-confirming");
  button.textContent = "다시 눌러 삭제";
  button.clearSignatureTimer = window.setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.clearConfirm = "0";
    button.classList.remove("is-confirming");
    button.textContent = "지우기";
  }, 2400);
}

function getSignaturePadData(canvas) {
  if (!canvas || canvas.dataset.hasSignature !== "1") return "";
  if (canvas.dataset.initialSignature && canvas.dataset.signatureDirty !== "1" && canvas.dataset.signatureLoaded !== "1") {
    return canvas.dataset.initialSignature;
  }
  return canvas.toDataURL("image/png");
}

function renderChecklistSection(sectionStat, date) {
  return `
    <section class="ops-card">
      <div class="ops-card-heading">
        <h3>${sectionStat.label} 체크</h3>
        <span>${sectionStat.done}/${sectionStat.total}</span>
      </div>
      <div class="checklist-list">
        ${
          sectionStat.tasks.length
            ? sectionStat.tasks
                .map((task) => {
                  const record = getChecklistRecord(date, task.id);
                  return `
                    <label class="checklist-item ${record?.checked ? "is-checked" : ""}">
                      <input type="checkbox" data-check-task="${task.id}" ${record?.checked ? "checked" : ""} />
                      <span>${escapeHtml(task.title)}</span>
                      <small>${record?.checkedAt ? `${timeText(record.checkedAt)} · ${escapeHtml(record.checkedBy || "직원")}` : "미완료"}</small>
                    </label>
                  `;
                })
                .join("")
            : `<div class="empty-state">체크 항목이 없습니다.</div>`
        }
      </div>
    </section>
  `;
}

function updateChecklistRecord(taskId, checked, checkedBy) {
  const date = todayDateKey();
  const updatedAt = nowIso();
  let record = getChecklistRecord(date, taskId);
  if (!record) {
    record = {
      id: uid("check_record"),
      date,
      taskId,
      checked: false,
      checkedAt: "",
      checkedBy: "",
      updatedAt,
    };
    db.operations.checklistRecords.push(record);
  }
  record.checked = checked;
  record.checkedAt = checked ? updatedAt : "";
  record.checkedBy = checked ? checkedBy : "";
  record.updatedAt = updatedAt;
  saveDb();
  renderOpsScreen();
}

function addHandoverNote(container, author) {
  const messageInput = container.querySelector("#handoverMessage");
  const message = messageInput.value.trim();
  if (!message) {
    messageInput.focus();
    return;
  }
  const createdAt = nowIso();
  db.operations.handoverNotes.push({
    id: uid("handover"),
    date: todayDateKey(),
    category: container.querySelector("#handoverCategory").value,
    message,
    author,
    status: "open",
    resolvedAt: "",
    resolvedBy: "",
    createdAt,
    updatedAt: createdAt,
  });
  saveDb();
  renderOpsScreen();
}

function resolveHandoverNote(noteId, resolvedBy) {
  const note = db.operations.handoverNotes.find((item) => item.id === noteId);
  if (!note) return;
  const resolvedAt = nowIso();
  note.status = "resolved";
  note.resolvedAt = resolvedAt;
  note.resolvedBy = resolvedBy;
  note.updatedAt = resolvedAt;
  saveDb();
  renderOpsScreen();
}

function renderAdminScreen() {
  if (!state.adminUnlocked) {
    renderAdminPin();
    return;
  }

  const menuLabels = [
    ["summary", "오늘 요약"],
    ["operationChecks", "운영 체크 관리"],
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
  if (state.adminMenu === "summary") renderManagerSummaryAdmin(body);
  if (state.adminMenu === "operationChecks") renderOperationChecksAdmin(body);
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

function renderManagerSummaryAdmin(container) {
  const today = todayDateKey();
  const checklistStats = getChecklistStats(today);
  const openNotes = getHandoverNotes({ openOnly: true });
  const recentNotes = getHandoverNotes().slice(0, 5);
  const lowSupplies = getOrderNeededSupplies();
  const openAlarms = getOpenAlarmEventsToday();
  const todayBatches = getTodayPrepBatches(false);
  const pendingTasks = checklistStats.sections.flatMap((section) =>
    section.tasks
      .filter((task) => !isChecklistTaskChecked(today, task.id))
      .map((task) => ({ ...task, sectionLabel: section.label })),
  );

  container.innerHTML = `
    <div class="admin-card">
      <div class="manager-summary-grid">
        <article class="summary-tile">
          <span>체크 진행률</span>
          <strong>${checklistStats.percent}%</strong>
          <small>${checklistStats.done}/${checklistStats.total} 완료</small>
        </article>
        <article class="summary-tile ${lowSupplies.length ? "is-warning" : ""}">
          <span>발주 필요</span>
          <strong>${lowSupplies.length}</strong>
          <small>${lowSupplies.length ? lowSupplies.slice(0, 2).map((supply) => supply.name).join(", ") : "없음"}</small>
        </article>
        <article class="summary-tile ${openNotes.length ? "is-warning" : ""}">
          <span>미해결 인수인계</span>
          <strong>${openNotes.length}</strong>
          <small>${openNotes.length ? "확인 필요" : "없음"}</small>
        </article>
        <article class="summary-tile ${openAlarms.length ? "is-warning" : ""}">
          <span>미처리 알림</span>
          <strong>${openAlarms.length}</strong>
          <small>${openAlarms.length ? openAlarms[0].alarmTitle : "없음"}</small>
        </article>
        <article class="summary-tile">
          <span>오늘 제조</span>
          <strong>${todayBatches.length}</strong>
          <small>취소 제외</small>
        </article>
      </div>
    </div>

    <div class="summary-columns">
      <section class="admin-card">
        <h3>미완료 체크</h3>
        ${
          pendingTasks.length
            ? `<ul class="compact-list">
                ${pendingTasks
                  .map((task) => `<li><strong>${task.sectionLabel}</strong><span>${escapeHtml(task.title)}</span></li>`)
                  .join("")}
              </ul>`
            : `<div class="empty-state">오늘 체크가 모두 완료되었습니다.</div>`
        }
      </section>

      <section class="admin-card">
        <h3>최근 인수인계</h3>
        ${
          recentNotes.length
            ? `<div class="handover-list handover-list--compact">
                ${recentNotes
                  .map(
                    (note) => `
                      <article class="handover-item ${note.status === "resolved" ? "is-resolved" : ""}">
                        <div>
                          <strong>${escapeHtml(note.category)}</strong>
                          <p>${escapeHtml(note.message)}</p>
                          <span>${dateTimeText(note.createdAt)} · ${escapeHtml(note.author)}${
                            note.status === "resolved" ? ` · 완료 ${note.resolvedAt ? dateTimeText(note.resolvedAt) : ""}` : ""
                          }</span>
                        </div>
                      </article>
                    `,
                  )
                  .join("")}
              </div>`
            : `<div class="empty-state">최근 인수인계가 없습니다.</div>`
        }
      </section>
    </div>

    <div class="summary-columns">
      <section class="admin-card">
        <h3>발주 필요 품목</h3>
        ${
          lowSupplies.length
            ? `<ul class="compact-list">
                ${lowSupplies
                  .map(
                    (supply) => `
                      <li>
                        <strong>${escapeHtml(supply.name)}</strong>
                        <span>${numberText(supply.currentStock)}${escapeHtml(supply.unit)} / 기준 ${numberText(supply.minStock)}${escapeHtml(supply.unit)}</span>
                      </li>
                    `,
                  )
                  .join("")}
              </ul>`
            : `<div class="empty-state">현재 발주가 필요한 품목이 없습니다.</div>`
        }
      </section>

      <section class="admin-card">
        <h3>오늘 제조 로그</h3>
        ${
          todayBatches.length
            ? `<ul class="compact-list">
                ${todayBatches
                  .slice(0, 8)
                  .map((batch) => `<li><strong>${timeText(batch.createdAt)}</strong><span>${escapeHtml(batch.recipeName)} ${escapeHtml(batch.variantLabel)}</span></li>`)
                  .join("")}
              </ul>`
            : `<div class="empty-state">오늘 제조 로그가 없습니다.</div>`
        }
      </section>
    </div>
  `;
}

function renderOperationChecksAdmin(container) {
  const tasks = getChecklistTasksForAdmin();
  if (!state.selectedChecklistTaskId || !getChecklistTask(state.selectedChecklistTaskId)) {
    state.selectedChecklistTaskId = tasks[0]?.id || null;
  }
  const task = getChecklistTask(state.selectedChecklistTaskId);

  container.innerHTML = `
    <div class="ops-admin-panel">
      <section class="ops-task-list-panel">
        ${renderChecklistTaskAdminSection("open")}
        ${renderChecklistTaskAdminSection("close")}
      </section>
      <section class="ops-task-editor-panel">
        ${
          task
            ? `
              <div class="ops-task-editor">
                <div class="alarm-panel-heading">
                  <h3>체크 항목 편집</h3>
                  ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
                </div>
                <label class="field">
                  <span>항목명</span>
                  <input id="checkTaskTitle" type="text" value="${escapeAttr(task.title)}" placeholder="예: 냉장고 온도 확인" />
                </label>
                <div class="alarm-form-grid">
                  <label class="field">
                    <span>구분</span>
                    <select id="checkTaskSection">
                      <option value="open" ${task.section === "open" ? "selected" : ""}>오픈</option>
                      <option value="close" ${task.section === "close" ? "selected" : ""}>마감</option>
                    </select>
                  </label>
                  <label class="check-field">
                    <input id="checkTaskActive" type="checkbox" ${task.isActive ? "checked" : ""} />
                    직원 화면에 표시
                  </label>
                </div>
                <div class="alarm-action-row">
                  <button class="button button--danger" id="deleteCheckTask" type="button">삭제</button>
                  <button class="button button--primary" id="saveCheckTask" type="button">저장</button>
                </div>
              </div>
            `
            : `<div class="empty-state">체크 항목이 없습니다.</div>`
        }
        ${renderStaffMembersAdmin()}
      </section>
    </div>
  `;

  container.querySelectorAll("[data-select-check-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChecklistTaskId = button.dataset.selectCheckTask;
      state.savedMessage = "";
      renderAdminScreen();
    });
  });
  container.querySelectorAll("[data-add-check-task]").forEach((button) => {
    button.addEventListener("click", () => addChecklistTask(button.dataset.addCheckTask));
  });
  setupChecklistTaskDragSorting(container);
  container.querySelector("#saveCheckTask")?.addEventListener("click", () => saveChecklistTaskAdmin(container));
  container.querySelector("#deleteCheckTask")?.addEventListener("click", deleteChecklistTask);
  container.querySelector("#addStaffMember")?.addEventListener("click", () => addStaffMember(container));
  container.querySelector("#saveStaffMembers")?.addEventListener("click", () => saveStaffMembersAdmin(container));
  container.querySelectorAll("[data-delete-staff]").forEach((button) => {
    button.addEventListener("click", () => deleteStaffMember(container, button.dataset.deleteStaff));
  });
}

function renderStaffMembersAdmin() {
  const staffMembers = getStaffMembersForAdmin();
  return `
    <section class="staff-admin-card">
      <div class="alarm-panel-heading">
        <h3>근무자 이름 관리</h3>
        <button class="button button--ghost button--small" id="addStaffMember" type="button">근무자 추가</button>
      </div>
      <div class="staff-admin-list">
        ${
          staffMembers.length
            ? staffMembers
                .map(
                  (staff) => `
                    <div class="staff-admin-row">
                      <label class="field">
                        <span>이름</span>
                        <input data-staff-name="${staff.id}" type="text" value="${escapeAttr(staff.name)}" />
                      </label>
                      <label class="check-field">
                        <input data-staff-active="${staff.id}" type="checkbox" ${staff.isActive ? "checked" : ""} />
                        사용
                      </label>
                      <button class="icon-button" data-delete-staff="${staff.id}" type="button" aria-label="${escapeAttr(staff.name)} 삭제">
                        <span class="icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>
                        </span>
                      </button>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state">등록된 근무자가 없습니다.</div>`
        }
      </div>
      <div class="button-row">
        <button class="button button--primary" id="saveStaffMembers" type="button">근무자 저장</button>
      </div>
    </section>
  `;
}

function renderChecklistTaskAdminSection(section) {
  const tasks = getChecklistTasksForAdmin(section);
  return `
    <div class="ops-admin-section">
      <div class="ops-admin-section-heading">
        <h3>${checklistSectionLabel(section)} 체크</h3>
        <button class="button button--ghost button--small" type="button" data-add-check-task="${section}">추가</button>
      </div>
      <div class="list-stack ops-task-list-stack" data-check-task-list="${section}">
        ${
          tasks.length
            ? tasks
                .map(
                  (item) => `
                    <button class="list-button list-button--draggable ops-task-button ${item.id === state.selectedChecklistTaskId ? "is-active" : ""} ${item.isActive ? "" : "is-inactive"}" type="button" draggable="true" data-select-check-task="${item.id}" data-check-task-drag="${item.id}" title="드래그해서 순서 변경">
                      <strong>${escapeHtml(item.title)}</strong>
                      <span>${item.isActive ? "표시" : "숨김"}</span>
                    </button>
                  `,
                )
                .join("")
            : `<div class="empty-state">항목 없음</div>`
        }
      </div>
    </div>
  `;
}

function setupChecklistTaskDragSorting(container) {
  let draggedTaskId = "";
  container.querySelectorAll("[data-check-task-drag]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      draggedTaskId = button.dataset.checkTaskDrag;
      button.classList.add("is-dragging");
      if (event.dataTransfer) {
        const dragImage = document.createElement("canvas");
        dragImage.width = 1;
        dragImage.height = 1;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedTaskId);
        event.dataTransfer.setDragImage(dragImage, 0, 0);
      }
    });
    button.addEventListener("dragend", () => {
      draggedTaskId = "";
      clearChecklistTaskDropMarkers(container);
    });
    button.addEventListener("dragover", (event) => {
      if (!draggedTaskId || draggedTaskId === button.dataset.checkTaskDrag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const position = getVerticalDropPosition(event, button);
      clearChecklistTaskDropMarkers(container);
      button.classList.add(position === "after" ? "is-drop-after" : "is-drop-before");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("is-drop-before", "is-drop-after");
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer?.getData("text/plain") || draggedTaskId;
      const position = getVerticalDropPosition(event, button);
      clearChecklistTaskDropMarkers(container);
      moveChecklistTask(sourceId, button.dataset.checkTaskDrag, position);
    });
  });
}

function getVerticalDropPosition(event, target) {
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearChecklistTaskDropMarkers(container) {
  container.querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after").forEach((item) => {
    item.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  });
}

function reorderChecklistSection(section, orderedTasks = getChecklistTasksForAdmin(section)) {
  const updatedAt = nowIso();
  orderedTasks.forEach((task, index) => {
    task.section = section;
    task.sortOrder = index + 1;
    task.updatedAt = updatedAt;
  });
}

function moveChecklistTask(sourceTaskId, targetTaskId, position = "before") {
  if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) return;
  const sourceTask = getChecklistTask(sourceTaskId);
  const targetTask = getChecklistTask(targetTaskId);
  if (!sourceTask || !targetTask) return;

  const originalSection = sourceTask.section;
  const targetSection = targetTask.section;
  sourceTask.section = targetSection;
  const orderedTargetTasks = getChecklistTasksForAdmin(targetSection).filter((task) => task.id !== sourceTaskId);
  const targetIndex = orderedTargetTasks.findIndex((task) => task.id === targetTaskId);
  if (targetIndex < 0) return;

  orderedTargetTasks.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, sourceTask);
  reorderChecklistSection(targetSection, orderedTargetTasks);
  if (originalSection !== targetSection) reorderChecklistSection(originalSection);
  state.selectedChecklistTaskId = sourceTask.id;
  state.savedMessage = "체크 순서를 저장했습니다.";
  saveDb();
  renderAdminScreen();
}

function addChecklistTask(section = "open") {
  const targetSection = section === "close" ? "close" : "open";
  const createdAt = nowIso();
  const task = makeChecklistTask(uid("check_task"), targetSection, "새 체크 항목", getChecklistTasksForAdmin(targetSection).length + 1, createdAt);
  db.operations.checklistTasks.push(task);
  state.selectedChecklistTaskId = task.id;
  state.savedMessage = "항목이 추가되었습니다.";
  saveDb();
  renderAdminScreen();
}

function saveChecklistTaskAdmin(container) {
  const task = getChecklistTask(state.selectedChecklistTaskId);
  if (!task) return;
  const titleInput = container.querySelector("#checkTaskTitle");
  const title = titleInput.value.trim();
  if (!title) {
    titleInput.focus();
    return;
  }

  const originalSection = task.section;
  const nextSection = container.querySelector("#checkTaskSection")?.value === "close" ? "close" : "open";
  task.title = title;
  task.isActive = Boolean(container.querySelector("#checkTaskActive")?.checked);
  task.section = nextSection;
  task.updatedAt = nowIso();
  if (originalSection !== nextSection) {
    task.sortOrder = getChecklistTasksForAdmin(nextSection).filter((item) => item.id !== task.id).length + 1;
    reorderChecklistSection(originalSection);
    reorderChecklistSection(nextSection);
  }
  state.savedMessage = "저장 완료";
  saveDb();
  renderAdminScreen();
}

function deleteChecklistTask() {
  const task = getChecklistTask(state.selectedChecklistTaskId);
  if (!task) return;
  const section = task.section;
  db.operations.checklistTasks = db.operations.checklistTasks.filter((item) => item.id !== task.id);
  db.operations.checklistRecords = db.operations.checklistRecords.filter((record) => record.taskId !== task.id);
  reorderChecklistSection(section);
  state.selectedChecklistTaskId = getChecklistTasksForAdmin(section)[0]?.id || getChecklistTasksForAdmin()[0]?.id || null;
  state.savedMessage = `${task.title} 항목을 삭제했습니다.`;
  saveDb();
  renderAdminScreen();
}

function applyStaffMembersAdminValues(container) {
  const updatedAt = nowIso();
  getStaffMembersForAdmin().forEach((staff) => {
    const nameInput = container.querySelector(`[data-staff-name="${staff.id}"]`);
    if (!nameInput) return;
    staff.name = nameInput.value.trim() || staff.name;
    staff.isActive = Boolean(container.querySelector(`[data-staff-active="${staff.id}"]`)?.checked);
    staff.updatedAt = updatedAt;
  });
}

function addStaffMember(container) {
  applyStaffMembersAdminValues(container);
  const createdAt = nowIso();
  db.operations.staffMembers.push({
    id: uid("staff"),
    name: "새 근무자",
    isActive: true,
    sortOrder: getStaffMembersForAdmin().length + 1,
    createdAt,
    updatedAt: createdAt,
  });
  state.savedMessage = "근무자를 추가했습니다.";
  saveDb();
  renderAdminScreen();
}

function saveStaffMembersAdmin(container) {
  applyStaffMembersAdminValues(container);
  getStaffMembersForAdmin().forEach((staff, index) => {
    staff.sortOrder = index + 1;
  });
  state.savedMessage = "근무자 저장 완료";
  saveDb();
  renderAdminScreen();
}

function deleteStaffMember(container, staffId) {
  applyStaffMembersAdminValues(container);
  const staff = getStaffMember(staffId);
  if (!staff) return;
  db.operations.staffMembers = getStaffMembersForAdmin().filter((item) => item.id !== staffId);
  getStaffMembersForAdmin().forEach((item, index) => {
    item.sortOrder = index + 1;
    item.updatedAt = nowIso();
  });
  if (state.operatorName === staff.name) state.operatorName = "";
  if (state.selectedAttendanceStaffId === staffId) state.selectedAttendanceStaffId = null;
  state.savedMessage = `${staff.name} 근무자를 삭제했습니다.`;
  saveDb();
  renderAdminScreen();
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
                  ${escapeHtml(getVariantLabelFromMultiplier(item.multiplier))}${item.isActive ? "" : " (비활성)"}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="column-footer">
          <button class="button button--ghost button--small" type="button" id="addVariant">배수 추가</button>
          <button class="button button--ghost button--small" type="button" id="cloneVariant" ${variant ? "" : "disabled"}>복제</button>
          <button class="button button--danger button--small" type="button" id="deleteVariant" ${variant ? "" : "disabled"}>삭제</button>
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
                    <input id="variantLabel" type="text" value="${escapeAttr(getVariantLabelFromMultiplier(variant.multiplier))}" readonly />
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
                      ? ingredients.map((ingredient) => renderIngredientRow(ingredient, getIngredientBaseQty(variant, ingredient))).join("")
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
  container.querySelector("#addVariant")?.addEventListener("click", () => addVariant(container));
  container.querySelector("#cloneVariant")?.addEventListener("click", () => cloneVariant(container));
  container.querySelector("#deleteVariant")?.addEventListener("click", () => deleteVariant(container));
  container.querySelector("#addIngredient")?.addEventListener("click", () => addVariantIngredient(container));
  container.querySelector("#saveRecipeAdmin")?.addEventListener("click", () => saveRecipeAdmin(container));
  container.querySelector("#deleteRecipe")?.addEventListener("click", deleteRecipe);
  container.querySelector("#variantMultiplier")?.addEventListener("input", () => updateVariantIngredientQuantityPreview(container));
  container.querySelectorAll("[data-remove-ingredient]").forEach((button) => {
    button.addEventListener("click", () => {
      applyRecipeAdminFormValues(container);
      db.recipeVariantIngredients = db.recipeVariantIngredients.filter((item) => item.id !== button.dataset.removeIngredient);
      state.savedMessage = "소모품을 삭제했습니다.";
      saveDb();
      renderAdminScreen();
    });
  });
}

function getIngredientBaseQty(variant, ingredient) {
  const currentMultiplier = Number(variant?.multiplier || 1) || 1;
  const variants = getVariantsForRecipe(variant?.recipeId, false);
  const baseVariant =
    variants.find((item) => Number(item.multiplier) === 1) ||
    variants.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))[0];
  const baseMultiplier = Number(baseVariant?.multiplier || 1) || 1;
  const baseIngredient = getIngredientsForVariant(baseVariant?.id).find((item) => item.supplyId === ingredient.supplyId);
  const sourceQty = Number(baseIngredient?.qty ?? ingredient.qty ?? 0);
  const divisor = baseIngredient ? baseMultiplier : currentMultiplier;
  return divisor ? sourceQty / divisor : sourceQty;
}

function formatQuantityInputValue(value) {
  const normalized = Math.round(Number(value || 0) * 1000) / 1000;
  return Number.isInteger(normalized) ? String(normalized) : String(normalized).replace(/0+$/, "").replace(/\.$/, "");
}

function getVariantLabelFromMultiplier(multiplier) {
  return `x${formatQuantityInputValue(multiplier || 1)}`;
}

function updateVariantIngredientQuantityPreview(container) {
  const multiplier = Number(container.querySelector("#variantMultiplier")?.value || 0);
  if (!Number.isFinite(multiplier)) return;
  const labelInput = container.querySelector("#variantLabel");
  if (labelInput) labelInput.value = getVariantLabelFromMultiplier(multiplier);
  container.querySelectorAll("[data-ingredient-base-qty]").forEach((input) => {
    const baseQty = Number(input.dataset.ingredientBaseQty || 0);
    input.value = formatQuantityInputValue(baseQty * multiplier);
  });
}

function renderIngredientRow(ingredient, baseQty = Number(ingredient.qty || 0)) {
  return `
    <div class="ingredient-row" data-ingredient-row="${ingredient.id}">
      <label class="field">
        <span>소모품</span>
        <select data-ingredient-supply="${ingredient.id}">
          ${getSuppliesForAdmin()
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
        <input data-ingredient-qty="${ingredient.id}" data-ingredient-base-qty="${escapeAttr(formatQuantityInputValue(baseQty))}" type="number" step="1" value="${ingredient.qty}" />
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

function reorderVariants(recipeId) {
  const now = nowIso();
  getVariantsForRecipe(recipeId, false).forEach((variant, index) => {
    variant.sortOrder = index + 1;
    variant.updatedAt = now;
  });
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

function addVariant(container) {
  if (!state.selectedRecipeId) return;
  applyRecipeAdminFormValues(container);
  const createdAt = nowIso();
  const variants = getVariantsForRecipe(state.selectedRecipeId, false);
  const variant = {
    id: uid("variant"),
    recipeId: state.selectedRecipeId,
    label: getVariantLabelFromMultiplier(variants.length + 1),
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

function cloneVariant(container) {
  applyRecipeAdminFormValues(container);
  const source = getVariant(state.selectedVariantId);
  if (!source) return;
  const createdAt = nowIso();
  const variants = getVariantsForRecipe(source.recipeId, false);
  const variant = {
    ...source,
    id: uid("variant"),
    label: getVariantLabelFromMultiplier(source.multiplier),
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

function deleteVariant(container) {
  const variant = getVariant(state.selectedVariantId);
  if (!variant) return;
  applyRecipeAdminFormValues(container);
  const recipeId = variant.recipeId;
  db.recipeVariants = db.recipeVariants.filter((item) => item.id !== variant.id);
  db.recipeVariantIngredients = db.recipeVariantIngredients.filter((ingredient) => ingredient.recipeVariantId !== variant.id);
  reorderVariants(recipeId);
  state.selectedVariantId = getVariantsForRecipe(recipeId, false)[0]?.id || null;
  state.savedMessage = `${variant.label} 배수를 삭제했습니다.`;
  saveDb();
  renderAdminScreen();
}

function addVariantIngredient(container) {
  const supplies = getSuppliesForAdmin();
  if (!state.selectedVariantId || !supplies.length) return;
  applyRecipeAdminFormValues(container);
  db.recipeVariantIngredients.push(makeIngredient(state.selectedVariantId, supplies[0].id, 0, supplies[0].unit));
  state.savedMessage = "소모품을 추가했습니다.";
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

function applyRecipeAdminFormValues(container) {
  const now = nowIso();
  const recipe = getRecipe(state.selectedRecipeId);
  const variant = getVariant(state.selectedVariantId);
  if (recipe) {
    recipe.name = container.querySelector("#recipeName")?.value.trim() || recipe.name;
    recipe.isActive = Boolean(container.querySelector("#recipeActive")?.checked);
    recipe.updatedAt = now;
  }
  if (variant) {
    const multiplier = Number(container.querySelector("#variantMultiplier")?.value || variant.multiplier);
    variant.multiplier = Number.isFinite(multiplier) ? multiplier : variant.multiplier;
    variant.label = getVariantLabelFromMultiplier(variant.multiplier);
    variant.sortOrder = Number(container.querySelector("#variantSort")?.value || variant.sortOrder);
    variant.isActive = Boolean(container.querySelector("#variantActive")?.checked);
    variant.updatedAt = now;
  }
  getIngredientsForVariant(variant?.id).forEach((ingredient) => {
    const supplyId = container.querySelector(`[data-ingredient-supply="${ingredient.id}"]`)?.value || ingredient.supplyId;
    const qty = Number(container.querySelector(`[data-ingredient-qty="${ingredient.id}"]`)?.value || 0);
    const supply = getSupply(supplyId);
    ingredient.supplyId = supplyId;
    ingredient.qty = qty;
    ingredient.unit = supply?.unit || ingredient.unit;
    ingredient.updatedAt = now;
  });
}

function saveRecipeAdmin(container) {
  applyRecipeAdminFormValues(container);
  state.savedMessage = "저장 완료";
  saveDb();
  renderAdminScreen();
}

function renderSuppliesAdmin(container) {
  const supplies = getSuppliesForAdmin();
  container.innerHTML = `
    <div class="admin-card">
      <div class="table-wrap">
        <table class="supply-admin-table">
          <thead>
            <tr>
              <th></th>
              <th>소모품</th>
              <th>단위</th>
              <th>현재 재고</th>
              <th>발주알림 기준량</th>
              <th>주문 단위 용량</th>
              <th>추천 발주량(ea)</th>
              <th>사용</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${supplies
              .map(
                (supply) => `
                  <tr class="supply-admin-row supply-admin-row--draggable" draggable="true" data-supply-row="${supply.id}" data-supply-drag="${supply.id}">
                    <td class="supply-drag-cell">
                      <span class="drag-handle" data-supply-drag-handle aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M9 5h.01"/><path d="M9 12h.01"/><path d="M9 19h.01"/><path d="M15 5h.01"/><path d="M15 12h.01"/><path d="M15 19h.01"/></svg>
                      </span>
                    </td>
                    <td><input data-supply-name="${supply.id}" value="${escapeAttr(supply.name)}" /></td>
                    <td><input data-supply-unit="${supply.id}" value="${escapeAttr(supply.unit)}" /></td>
                    <td><input data-supply-stock="${supply.id}" type="number" value="${supply.currentStock}" /></td>
                    <td><input data-supply-min="${supply.id}" type="number" value="${supply.minStock}" /></td>
                    <td><input data-supply-purchase="${supply.id}" type="number" min="0" value="${supply.purchaseUnitQty || 1000}" /></td>
                    <td><input data-supply-order="${supply.id}" type="number" min="0" step="1" value="${supply.recommendedOrderEa || supply.recommendedOrderQty || 0}" /></td>
                    <td><input data-supply-active="${supply.id}" type="checkbox" ${supply.isActive ? "checked" : ""} /></td>
                    <td class="supply-action-cell">
                      <button class="icon-button" data-delete-supply="${supply.id}" type="button" aria-label="${escapeAttr(supply.name)} 삭제">
                        <span class="icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>
                        </span>
                      </button>
                    </td>
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
  setupSupplyDragSorting(container);
  container.querySelector("#addSupply").addEventListener("click", () => addSupply(container));
  container.querySelector("#saveSupplies").addEventListener("click", () => saveSuppliesAdmin(container));
  container.querySelectorAll("[data-delete-supply]").forEach((button) => {
    button.addEventListener("click", () => deleteSupply(container, button.dataset.deleteSupply));
  });
}

function applySuppliesAdminFormValues(container) {
  const now = nowIso();
  getSuppliesForAdmin().forEach((supply) => {
    const nameInput = container.querySelector(`[data-supply-name="${supply.id}"]`);
    if (!nameInput) return;
    supply.name = nameInput.value.trim() || supply.name;
    supply.unit = container.querySelector(`[data-supply-unit="${supply.id}"]`)?.value.trim() || supply.unit;
    supply.currentStock = Number(container.querySelector(`[data-supply-stock="${supply.id}"]`)?.value || 0);
    supply.minStock = Number(container.querySelector(`[data-supply-min="${supply.id}"]`)?.value || 0);
    supply.purchaseUnitQty = Number(container.querySelector(`[data-supply-purchase="${supply.id}"]`)?.value || 0);
    supply.recommendedOrderEa = Number(container.querySelector(`[data-supply-order="${supply.id}"]`)?.value || 0);
    supply.recommendedOrderQty = supply.recommendedOrderEa;
    supply.isActive = Boolean(container.querySelector(`[data-supply-active="${supply.id}"]`)?.checked);
    supply.updatedAt = now;
  });
}

function saveSuppliesAdmin(container) {
  applySuppliesAdminFormValues(container);
  state.savedMessage = "저장 완료";
  saveDb();
  renderAdminScreen();
}

function addSupply(container) {
  applySuppliesAdminFormValues(container);
  const nextSortOrder = Math.max(0, ...db.supplies.map((supply) => Number(supply.sortOrder || 0))) + 1;
  db.supplies.push(makeSupply(uid("supply"), "새 소모품", "g", 0, 0, 0, "", 1000, nextSortOrder));
  state.savedMessage = "소모품을 추가했습니다.";
  saveDb();
  renderAdminScreen();
}

function deleteSupply(container, supplyId) {
  applySuppliesAdminFormValues(container);
  const supply = getSupply(supplyId);
  if (!supply) return;
  db.supplies = getSuppliesForAdmin().filter((item) => item.id !== supplyId);
  db.recipeVariantIngredients = db.recipeVariantIngredients.filter((ingredient) => ingredient.supplyId !== supplyId);
  if (state.selectedAnalysisSupplyId === supplyId) {
    state.selectedAnalysisSupplyId = getSuppliesForAdmin()[0]?.id || null;
  }
  reorderSupplies(db.supplies);
  state.savedMessage = `${supply.name} 소모품을 삭제했습니다.`;
  saveDb();
  renderAdminScreen();
}

function setupSupplyDragSorting(container) {
  let draggedSupplyId = "";
  container.querySelectorAll("[data-supply-drag]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      if (!event.target.closest("[data-supply-drag-handle]")) {
        event.preventDefault();
        return;
      }
      draggedSupplyId = row.dataset.supplyDrag;
      row.classList.add("is-dragging");
      if (event.dataTransfer) {
        const dragImage = document.createElement("canvas");
        dragImage.width = 1;
        dragImage.height = 1;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedSupplyId);
        event.dataTransfer.setDragImage(dragImage, 0, 0);
      }
    });
    row.addEventListener("dragend", () => {
      draggedSupplyId = "";
      clearSupplyDropMarkers(container);
      container.querySelectorAll(".supply-admin-row.is-dragging").forEach((item) => item.classList.remove("is-dragging"));
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedSupplyId || draggedSupplyId === row.dataset.supplyDrag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const position = getSupplyDropPosition(event, row);
      clearSupplyDropMarkers(container);
      row.classList.add(position === "after" ? "is-drop-after" : "is-drop-before");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drop-before", "is-drop-after");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer?.getData("text/plain") || draggedSupplyId;
      const position = getSupplyDropPosition(event, row);
      applySuppliesAdminFormValues(container);
      clearSupplyDropMarkers(container);
      moveSupply(sourceId, row.dataset.supplyDrag, position);
    });
  });
}

function getSupplyDropPosition(event, target) {
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearSupplyDropMarkers(container) {
  container.querySelectorAll(".supply-admin-row.is-drop-before, .supply-admin-row.is-drop-after").forEach((item) => {
    item.classList.remove("is-drop-before", "is-drop-after");
  });
}

function moveSupply(sourceSupplyId, targetSupplyId, position = "before") {
  if (!sourceSupplyId || !targetSupplyId || sourceSupplyId === targetSupplyId) return;
  const ordered = getSuppliesForAdmin();
  const sourceIndex = ordered.findIndex((supply) => supply.id === sourceSupplyId);
  const targetIndex = ordered.findIndex((supply) => supply.id === targetSupplyId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [movedSupply] = ordered.splice(sourceIndex, 1);
  const nextTargetIndex = ordered.findIndex((supply) => supply.id === targetSupplyId);
  ordered.splice(position === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedSupply);
  reorderSupplies(ordered);
  state.savedMessage = "소모품 순서를 저장했습니다.";
  saveDb();
  renderAdminScreen();
}

function reorderSupplies(orderedSupplies = getSuppliesForAdmin()) {
  const now = nowIso();
  orderedSupplies.forEach((supply, index) => {
    supply.sortOrder = index + 1;
    supply.updatedAt = now;
  });
  db.supplies = orderedSupplies;
}

function renderAdjustAdmin(container) {
  const supplies = getSuppliesForAdmin();
  const firstSupply = supplies[0] || null;
  const firstPackageQty = Number(firstSupply?.purchaseUnitQty || 1000);
  container.innerHTML = `
    <div class="admin-card">
      <h3>입고 추가</h3>
      <div class="form-grid">
        <label class="field">
          <span>품목</span>
          <select id="receiveSupply">
            ${supplies.map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${numberText(supply.currentStock)}${escapeHtml(supply.unit)})</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>주문 단위 용량</span>
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
            ${supplies.map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${numberText(supply.currentStock)}${escapeHtml(supply.unit)})</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>실제 재고</span>
          <input id="adjustActual" type="number" value="${firstSupply?.currentStock || 0}" />
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
  const selectedAlarmId = state.selectedAlarmId || db.alarms[0]?.id || "";
  const alarm = db.alarms.find((item) => item.id === selectedAlarmId) || db.alarms[0] || null;
  state.selectedAlarmId = alarm?.id || null;
  const alarmTitleValue = getAlarmTitleInputValue(alarm);
  const alarmTitleChoices = getAlarmTitleChoices();
  container.innerHTML = `
    <div class="alarm-admin-panel">
      <section class="alarm-list-panel">
        <div class="alarm-panel-heading">
          <h3>알림</h3>
          <button class="button button--primary button--small" id="addAlarm" type="button">추가</button>
        </div>
        <div class="list-stack alarm-list-stack">
          ${
            db.alarms.length
              ? db.alarms
                  .map(
                    (item) => `
                      <button class="list-button alarm-list-button ${alarm && item.id === alarm.id ? "is-active" : ""}" type="button" data-select-alarm="${item.id}">
                        <strong>${escapeHtml(getAlarmListTitle(item))}</strong>
                        <span>${item.isDraft ? "저장 전" : `${escapeHtml(formatAlarmTime(item.time))} · ${escapeHtml(formatAlarmDaySummary(item.repeatDays))}`}</span>
                      </button>
                    `,
                  )
                  .join("")
              : `<div class="empty-state">등록된 알림이 없습니다.</div>`
          }
        </div>
      </section>
      <section class="alarm-editor-panel">
        ${
          alarm
            ? `
            <div class="alarm-panel-heading">
              <h3>알림 설정</h3>
              ${state.savedMessage ? `<span class="saved-note">${escapeHtml(state.savedMessage)}</span>` : ""}
            </div>
            <div class="alarm-form-grid">
              <label class="field">
                <span>알림 이름</span>
                <input id="alarmTitleInput" list="alarmTitleSuggestions" value="${escapeAttr(alarmTitleValue)}" placeholder="예: 소모품 확인" />
                <datalist id="alarmTitleSuggestions">
                  ${alarmTitleChoices.map((value) => `<option value="${escapeAttr(value)}"></option>`).join("")}
                </datalist>
                ${renderAlarmQuickChoices(alarmTitleChoices, "fill-alarm-title")}
              </label>
              <label class="field">
                <span>알림 시간</span>
                ${renderAlarmTimeControls(alarm.time)}
              </label>
            </div>
            ${renderAlarmDayControls(alarm.repeatDays)}
            <label class="field alarm-sound-field">
              <span>알림음</span>
              <select id="alarmSoundInput">
                ${renderAlarmSoundOptions(alarm.soundId || db.settings.defaultSoundId)}
              </select>
            </label>
            <div class="alarm-action-row">
              <button class="button button--primary" id="saveAlarm" type="button">저장</button>
              <button class="button button--ghost" id="testAlarm" type="button">테스트 실행</button>
              <button class="button button--danger" id="deleteAlarm" type="button">삭제</button>
            </div>
            `
            : `<div class="empty-state">필요할 때만 알림을 추가해서 사용하세요.</div>`
        }
        ${renderAlarmSoundTestSection()}
      </section>
    </div>
  `;
  container.querySelectorAll("[data-select-alarm]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAlarmId = button.dataset.selectAlarm;
      state.savedMessage = "";
      renderAdminScreen();
    });
  });
  container.querySelector("#addAlarm").addEventListener("click", () => {
    const alarm = makeAlarm(uid("alarm"), "", "", localTimeValue());
    alarm.isDraft = true;
    alarm.isActive = false;
    db.alarms.push(alarm);
    state.selectedAlarmId = alarm.id;
    state.savedMessage = "알림 이름, 시간, 요일, 알림음을 선택한 뒤 저장하면 작동합니다.";
    saveDb();
    renderAdminScreen();
  });
  container.querySelectorAll("[data-fill-alarm-title]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = container.querySelector("#alarmTitleInput");
      input.value = button.dataset.fillAlarmTitle || "";
      input.focus();
    });
  });
  container.querySelector("#deleteAlarm")?.addEventListener("click", () => {
    if (!alarm) return;
    db.alarms = db.alarms.filter((item) => item.id !== alarm.id);
    state.selectedAlarmId = db.alarms[0]?.id || null;
    saveDb();
    renderAdminScreen();
  });
  container.querySelector("#testAlarm")?.addEventListener("click", () => {
    if (!alarm) return;
    if (!validateAlarmForm(container)) return;
    applySimpleAlarmForm(container, alarm);
    triggerAlarm(alarm, "test");
  });
  container.querySelector("#saveAlarm")?.addEventListener("click", () => {
    if (!alarm) return;
    if (!validateAlarmForm(container)) return;
    applySimpleAlarmForm(container, alarm, { activate: true });
    state.savedMessage = "저장 완료";
    saveDb();
    state.selectedAlarmId = alarm.id;
    renderAdminScreen();
  });
  container.querySelectorAll("[data-test-alarm-sound]").forEach((button) => {
    button.addEventListener("click", () => testAlarmSound(button.dataset.testAlarmSound));
  });
}

function validateAlarmForm(container) {
  const titleInput = container.querySelector("#alarmTitleInput");
  if (!titleInput.value.trim()) {
    alert("알림 이름을 입력한 뒤 저장해주세요.");
    titleInput.focus();
    return false;
  }
  if (!getAlarmDaysFromForm(container).length) {
    alert("알림이 울릴 요일을 하나 이상 선택해주세요.");
    return false;
  }
  return true;
}

function applySimpleAlarmForm(container, alarm, { activate = false } = {}) {
  const title = container.querySelector("#alarmTitleInput").value.trim();
  alarm.title = title;
  alarm.time = getAlarmTimeFromForm(container);
  alarm.message = `${title} 알림입니다.`;
  alarm.spokenMessage = "";
  alarm.soundId = container.querySelector("#alarmSoundInput")?.value || db.settings.defaultSoundId || DEFAULT_ALARM_SOUND_ID;
  alarm.snoozeMinutes = 10;
  alarm.repeatDays = getAlarmDaysFromForm(container);
  if (activate) {
    alarm.isDraft = false;
    alarm.isActive = true;
    rememberAlarmText(alarm.title, "");
  }
  alarm.requiresAcknowledgement = true;
  alarm.updatedAt = nowIso();
}

function renderAlarmsAdminWithSelection(alarmId) {
  state.selectedAlarmId = alarmId;
  renderAdminScreen();
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
  const supplies = getSuppliesForAdmin();
  const supply = getSupply(state.selectedAnalysisSupplyId) || supplies[0] || null;
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
            ${supplies.map((item) => `<option value="${item.id}" ${item.id === supply.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
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

function triggerAlarm(alarm, source = "schedule", scheduledAt = "") {
  if (source === "schedule" && !isScheduledAlarmEnabled(alarm)) return;
  const triggeredAt = scheduledAt || nowIso();
  const existingEvent = findAlarmEventForMinute(alarm.id, new Date(triggeredAt));
  if (existingEvent?.status === "triggered") {
    state.activeAlarmEventId = existingEvent.id;
    showAlarmModal(getAlarmDisplayFromEvent(existingEvent));
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
  showAlarmModal(getAlarmDisplayFromEvent(eventLog));
}

function showAlarmModal(alarm, { playSound = true, immediate = true } = {}) {
  els.alarmTitle.textContent = alarm.title;
  els.alarmMessage.textContent = alarm.message;
  if (els.soundHelp) els.soundHelp.hidden = true;
  els.alarmModal.hidden = false;
  if (playSound) startAlarmSound(alarm, { immediate });
}

function closeAlarmModal() {
  stopAlarmSound();
  els.alarmModal.hidden = true;
}

function getOpenAlarmEvent() {
  const today = todayDateKey();
  return db.alarmEventLogs
    .filter((log) => log.status === "triggered" && dateKeyFromIso(log.triggeredAt) === today)
    .sort((a, b) => new Date(b.triggeredAt) - new Date(a.triggeredAt))[0];
}

function findAlarmEventForMinute(alarmId, date) {
  const dateKey = todayDateKey(date);
  const minuteKey = localTimeValue(date);
  return db.alarmEventLogs.find((log) => {
    const triggeredAt = log.triggeredAt ? new Date(log.triggeredAt) : null;
    return (
      log.alarmId === alarmId &&
      dateKeyFromIso(log.triggeredAt) === dateKey &&
      triggeredAt &&
      localTimeValue(triggeredAt) === minuteKey
    );
  });
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
  showAlarmModal(alarm, { playSound: false });
  startAlarmSound(alarm, { forceRestart: isNewEvent && source !== "local", immediate: isNewEvent });
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
  let changed = false;

  db.alarms
    .filter((alarm) => isScheduledAlarmEnabled(alarm) && alarm.repeatDays.includes(day))
    .forEach((alarm) => {
      const scheduledAt = getScheduledAlarmDate(alarm, now);
      const isDue = scheduledAt <= now && now - scheduledAt < 2 * 60 * 1000;
      const alreadyTriggered = Boolean(findAlarmEventForMinute(alarm.id, scheduledAt));
      if (isDue && !alreadyTriggered) triggerAlarm(alarm, "schedule", scheduledAt.toISOString());
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

function getScheduledAlarmDate(alarm, date = new Date()) {
  const [hours = 0, minutes = 0] = String(alarm.time || "00:00").split(":").map(Number);
  const scheduledAt = new Date(date);
  scheduledAt.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return scheduledAt;
}

function markSpeechReady() {
  const wasLocked = !state.audioUnlocked;
  state.audioUnlocked = true;
  if (els.soundHelp) els.soundHelp.hidden = true;
  startSpeechKeepAlive();
  if (wasLocked) renderSoundStatus();
}

function markSpeechOff() {
  const wasReady = state.audioUnlocked;
  state.audioUnlocked = false;
  if (wasReady) renderSoundStatus();
}

function showSpeechTouchHelp() {
  if (state.audioUnlocked) return;
  renderSoundStatus();
}

function getAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

function primeAudioOutput() {
  const context = getAudioContext();
  if (!context) return false;

  const pulse = () => {
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.04);
      markSpeechReady();
    } catch {
      markSpeechOff();
    }
  };

  if (context.state === "running") {
    pulse();
    return true;
  }

  context
    .resume()
    .then(() => {
      if (context.state === "running") pulse();
      else markSpeechOff();
    })
    .catch(() => markSpeechOff());
  return true;
}

function unlockAudio({ announce = true, immediate = false } = {}) {
  prepareSpeechVoices();
  primeAudioOutput();
  requestWakeLock();
  const activeEvent = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
  const now = Date.now();
  if (!announce && !activeEvent && now - lastSpeechUnlockAttemptAt < 1200) return;
  lastSpeechUnlockAttemptAt = now;
  pendingSpeech = null;
  if (activeEvent?.status === "triggered") {
    startAlarmSound(getAlarmDisplayFromEvent(activeEvent), { forceRestart: true, immediate });
  }
  if (els.soundHelp) els.soundHelp.hidden = true;
}

function isTextEditingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function setupAutomaticAudioUnlock() {
  const autoUnlock = (event) => {
    if (event?.type === "keydown" && isTextEditingTarget(event?.target)) return;
    if (!state.audioUnlocked) unlockAudio({ announce: false, immediate: Boolean(event) });
  };
  window.setTimeout(autoUnlock, 500);
  window.setTimeout(autoUnlock, 2500);
  window.addEventListener("focus", autoUnlock);
  window.addEventListener("pageshow", autoUnlock);
  ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, autoUnlock, { capture: true });
  });
}

function startAlarmSound(alarm, { forceRestart = false, immediate = false } = {}) {
  const soundEventId = state.activeAlarmEventId || `${alarm?.id || "alarm"}:${alarm?.time || ""}`;
  if (!forceRestart && activeAlarmSoundEventId === soundEventId) return;
  stopAlarmSound();
  activeAlarmSoundEventId = soundEventId;
  requestWakeLock();
  primeAudioOutput();
  playAlarmFileSound(alarm, { eventId: soundEventId });
}

function stopAlarmSound() {
  window.clearTimeout(alarmSpeechLoopTimer);
  window.clearTimeout(alarmSpeechRetryTimer);
  window.clearTimeout(alarmSoundRetryTimer);
  alarmSpeechLoopTimer = null;
  alarmSpeechRetryTimer = null;
  alarmSoundRetryTimer = null;
  activeAlarmSoundEventId = "";
  pendingSpeech = null;
  stopAlarmFileSound();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Speech synthesis can be unavailable or locked by the browser.
  }
}

function stopAlarmFileSound() {
  if (!alarmAudio) return;
  try {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  } catch {
    // Audio elements can fail if the browser has already released them.
  }
  alarmAudio = null;
}

function playAlarmFileSound(alarm, { eventId = "" } = {}) {
  const sound = getVoicePreset(alarm.soundId || db.settings.defaultSoundId);
  if (!sound?.url) return false;
  const soundEventId = eventId || activeAlarmSoundEventId;
  stopAlarmFileSound();
  alarmAudio = new Audio(sound.url);
  alarmAudio.loop = true;
  alarmAudio.preload = "auto";
  alarmAudio.volume = Number(sound.volume || 1);
  alarmAudio.addEventListener("playing", markSpeechReady, { once: true });
  alarmAudio.addEventListener(
    "error",
    () => {
      if (soundEventId && soundEventId !== activeAlarmSoundEventId) return;
      markSpeechOff();
      window.clearTimeout(alarmSoundRetryTimer);
      alarmSoundRetryTimer = window.setTimeout(() => {
        if (!soundEventId || soundEventId === activeAlarmSoundEventId) playAlarmFileSound(alarm, { eventId: soundEventId });
      }, 1200);
    },
    { once: true },
  );
  alarmAudio
    .play()
    .then(markSpeechReady)
    .catch(() => {
      if (soundEventId && soundEventId !== activeAlarmSoundEventId) return;
      markSpeechOff();
      window.clearTimeout(alarmSoundRetryTimer);
      alarmSoundRetryTimer = window.setTimeout(() => {
        if (!soundEventId || soundEventId === activeAlarmSoundEventId) playAlarmFileSound(alarm, { eventId: soundEventId });
      }, 1200);
    });
  return true;
}

function testAlarmSound(soundId) {
  const sound = getVoicePreset(soundId);
  if (!sound?.url) {
    alert("알림음 파일 URL이 없습니다.");
    return;
  }
  try {
    previewAudio?.pause();
    previewAudio = new Audio(sound.url);
    previewAudio.volume = Number(sound.volume || 1);
    previewAudio.play().then(markSpeechReady).catch(() => {
      markSpeechOff();
      alert("알림음을 재생할 수 없습니다. 화면을 한 번 터치한 뒤 다시 시도해주세요.");
    });
  } catch {
    markSpeechOff();
    alert("알림음을 재생할 수 없습니다.");
  }
}

function startSpeechKeepAlive() {
  window.clearInterval(speechKeepAliveTimer);
  speechKeepAliveTimer = window.setInterval(() => {
    if (!state.audioUnlocked || activeAlarmSoundEventId) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
    try {
      const utterance = new window.SpeechSynthesisUtterance(".");
      const preset = getVoicePreset(db.settings.defaultSoundId);
      const selectedVoice = selectSpeechVoice(getSpeechVoices(), preset);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang || preset?.lang || "ko-KR";
      utterance.volume = 0;
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(utterance);
    } catch {
      // Keep-alive is best-effort; real alarms keep retrying independently.
    }
  }, 4 * 60 * 1000);
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

function speakAlarm(alarm, allowWhileLocked = false, options = {}) {
  const preset = getVoicePreset(alarm.soundId || db.settings.defaultSoundId);
  speakText(alarm.spokenMessage || alarm.message || alarm.title, preset, allowWhileLocked, options);
}

function speakText(text, preset, allowWhileLocked = false, { retry = 0, repeat = false, eventId = "", unlockProbe = false, volume = null, immediate = false } = {}) {
  const phrase = String(text || "").trim();
  if (!phrase) return false;
  if (!state.audioUnlocked && !allowWhileLocked) {
    pendingSpeech = { text: phrase, preset, repeat, eventId, unlockProbe, volume, immediate };
    return false;
  }
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    scheduleSpeechRetry(phrase, preset, 1000, retry + 1, { repeat, eventId });
    if (repeat) showSpeechTouchHelp();
    return false;
  }
  const voices = getSpeechVoices();
  const utterance = new window.SpeechSynthesisUtterance(phrase);
  const selectedVoice = selectSpeechVoice(voices, preset);
  const speechEventId = eventId || activeAlarmSoundEventId;
  let started = false;
  let finished = false;
  const isCurrentAlarmSpeech = () => !speechEventId || speechEventId === activeAlarmSoundEventId;
  const scheduleNextSpeech = (delay) => {
    if (!repeat || !isCurrentAlarmSpeech()) return;
    window.clearTimeout(alarmSpeechLoopTimer);
    alarmSpeechLoopTimer = window.setTimeout(() => {
      speakText(phrase, preset, true, { repeat: true, eventId: speechEventId, volume });
    }, delay);
  };
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || preset?.lang || "ko-KR";
  utterance.rate = Number(preset?.rate || 0.92);
  utterance.pitch = Number(preset?.pitch || 1);
  utterance.volume = volume === null ? Number(preset?.volume || 1) : Number(volume);
  utterance.onstart = () => {
    started = true;
    markSpeechReady();
  };
  utterance.onend = () => {
    finished = true;
    if (!unlockProbe) scheduleNextSpeech(900);
  };
  utterance.onerror = () => {
    finished = true;
    if (repeat) markSpeechOff();
    if (repeat) showSpeechTouchHelp();
    scheduleSpeechRetry(phrase, preset, 500, retry + 1, { repeat, eventId: speechEventId, unlockProbe, volume });
  };
  const speakNow = () => {
    if (!isCurrentAlarmSpeech()) return;
    try {
      window.speechSynthesis.speak(utterance);
      window.clearTimeout(alarmSpeechRetryTimer);
      alarmSpeechRetryTimer = window.setTimeout(() => {
        if (!finished && isCurrentAlarmSpeech()) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Keep retrying speech below.
          }
          if (repeat) showSpeechTouchHelp();
          scheduleSpeechRetry(phrase, preset, 500, retry + 1, { repeat, eventId: speechEventId, unlockProbe, volume });
        }
      }, estimateSpeechWatchdogDelay(phrase));
      window.setTimeout(() => {
        if (!started && !finished && isCurrentAlarmSpeech()) {
          window.speechSynthesis.resume?.();
          if (repeat) {
            markSpeechOff();
            showSpeechTouchHelp();
            try {
              window.speechSynthesis.cancel();
            } catch {
              // Keep retrying speech below.
            }
            scheduleSpeechRetry(phrase, preset, 300, retry + 1, { repeat, eventId: speechEventId, unlockProbe, volume });
          }
        }
      }, 1200);
    } catch {
      if (repeat) showSpeechTouchHelp();
      scheduleSpeechRetry(phrase, preset, 500, retry + 1, { repeat, eventId: speechEventId, unlockProbe, volume });
    }
  };
  try {
    if (immediate || window.speechSynthesis.pending || (window.speechSynthesis.speaking && repeat)) {
      window.speechSynthesis.cancel();
    }
    window.speechSynthesis.resume?.();
    if (immediate) {
      speakNow();
    } else {
      window.setTimeout(speakNow, voices.length ? 80 : 350);
    }
    return true;
  } catch {
    if (repeat) showSpeechTouchHelp();
    scheduleSpeechRetry(phrase, preset, 500, retry + 1, { repeat, eventId: speechEventId, unlockProbe, volume });
    return false;
  }
}

function estimateSpeechWatchdogDelay(text) {
  return Math.min(90000, Math.max(15000, String(text || "").length * 700));
}

function selectSpeechVoice(voices, preset) {
  return (
    voices.find((voice) => voice.voiceURI === preset?.voiceURI) ||
    voices.find((voice) => voice.lang.toLowerCase() === "ko-kr") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ko")) ||
    voices[0]
  );
}

function scheduleSpeechRetry(text, preset, delay, retry, { repeat = false, eventId = "", unlockProbe = false, volume = null } = {}) {
  const speechEventId = eventId || activeAlarmSoundEventId;
  if (repeat && speechEventId && speechEventId !== activeAlarmSoundEventId) return;
  window.clearTimeout(alarmSpeechRetryTimer);
  alarmSpeechRetryTimer = window.setTimeout(() => {
    if (repeat && speechEventId && speechEventId !== activeAlarmSoundEventId) return;
    speakText(text, preset, true, { retry, repeat, eventId: speechEventId, unlockProbe, volume });
  }, delay);
}

function prepareSpeechVoices() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  if (speechVoicesPrepared) return;
  speechVoicesPrepared = true;
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    const activeEvent = db.alarmEventLogs.find((log) => log.id === state.activeAlarmEventId);
    if (activeEvent?.status === "triggered") startAlarmSound(getAlarmDisplayFromEvent(activeEvent), { forceRestart: true });
  });
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

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    // Wake lock is optional and depends on browser support.
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
els.soundHelpButton?.addEventListener("click", () => unlockAudio({ announce: true, immediate: true }));
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
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkAlarms();
    if (!state.audioUnlocked) unlockAudio({ announce: false });
    if (state.audioUnlocked) requestWakeLock();
  }
});

render();
updateCurrentDateTime();
prepareSpeechVoices();
checkAlarms();
initRemoteSync();
setupAutomaticAudioUnlock();
setInterval(updateCurrentDateTime, 1000);
setInterval(checkAlarms, 15 * 1000);
