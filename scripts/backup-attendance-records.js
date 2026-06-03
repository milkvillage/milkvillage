const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultEnvPath = path.join(repoRoot, ".env.local");
const statePath = path.join(__dirname, ".attendance-backup-state.json");
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_KLXkL3WkYQXTTUsdE9WZJw_Vw63SWtM";

loadEnvFile(defaultEnvPath);
loadEnvFile(path.join(process.env.APPDATA || "", "MilkVillage", "attendance-backup.env"));

const config = {
  supabaseUrl: readRequiredEnv("SUPABASE_URL"),
  accessKey: process.env.SUPABASE_STATE_ACCESS_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY,
  table: process.env.SUPABASE_STATE_TABLE || "milk_village_state",
  stateId: process.env.SUPABASE_STATE_ID || "main",
  backupFolder: process.env.ATTENDANCE_BACKUP_FOLDER || "C:\\milk village\\03_attendance_backups",
};

main().catch((error) => {
  console.error(`[attendance-backup] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const now = new Date();
  const target = args.has("--current") ? getQuarterInfo(now) : getPreviousQuarterInfo(now);
  const backupKey = `${target.year}-Q${target.quarter}`;
  const state = await readJsonFile(statePath, {});

  if (!args.has("--force") && state.lastBackupKey === backupKey) {
    console.log(`[attendance-backup] ${backupKey} already backed up`);
    return;
  }

  const remoteData = await fetchRemoteState();
  const records = Array.isArray(remoteData.operations?.attendanceRecords) ? remoteData.operations.attendanceRecords : [];
  const quarterRecords = records
    .filter((record) => isDateInQuarter(record.date, target.year, target.quarter))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.staffName || "").localeCompare(String(b.staffName || ""), "ko-KR"));

  await fsp.mkdir(config.backupFolder, { recursive: true });
  const createdAt = new Date().toISOString();
  const baseName = `milk-village-attendance-${backupKey}`;
  const jsonPath = path.join(config.backupFolder, `${baseName}.json`);
  const csvPath = path.join(config.backupFolder, `${baseName}.csv`);

  await fsp.writeFile(
    jsonPath,
    JSON.stringify(
      {
        app: "Milk Village",
        backupType: "attendance-quarterly",
        quarter: backupKey,
        createdAt,
        recordCount: quarterRecords.length,
        records: quarterRecords,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fsp.writeFile(csvPath, toAttendanceCsv(quarterRecords), "utf8");

  state.lastBackupKey = backupKey;
  state.lastBackupAt = createdAt;
  state.lastJsonPath = jsonPath;
  state.lastCsvPath = csvPath;
  await writeJsonFile(statePath, state);

  console.log(`[attendance-backup] wrote ${quarterRecords.length} records for ${backupKey}`);
  console.log(`[attendance-backup] ${jsonPath}`);
  console.log(`[attendance-backup] ${csvPath}`);
}

async function fetchRemoteState() {
  const url = `${config.supabaseUrl}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.stateId)}&select=data`;
  const response = await fetch(url, {
    headers: makeApiHeaders(config.accessKey, { Accept: "application/json" }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`remote state fetch failed: ${response.status} ${body}`);
  }
  const rows = await response.json();
  const row = rows[0];
  if (!row?.data) {
    throw new Error("remote app state not found. Open the app once first, then run backup again.");
  }
  return row.data;
}

function getQuarterInfo(date) {
  return {
    year: date.getFullYear(),
    quarter: Math.floor(date.getMonth() / 3) + 1,
  };
}

function getPreviousQuarterInfo(date) {
  const current = getQuarterInfo(date);
  if (current.quarter === 1) return { year: current.year - 1, quarter: 4 };
  return { year: current.year, quarter: current.quarter - 1 };
}

function isDateInQuarter(dateKey, year, quarter) {
  const [recordYear, month] = String(dateKey || "").split("-").map(Number);
  if (recordYear !== year || !month) return false;
  return Math.floor((month - 1) / 3) + 1 === quarter;
}

function toAttendanceCsv(records) {
  const header = [
    "date",
    "staffName",
    "status",
    "scheduledStart",
    "scheduledEnd",
    "actualStart",
    "actualEnd",
    "adjustmentReason",
    "employeeSigned",
    "managerConfirmed",
    "recordedAt",
    "updatedAt",
  ];
  const rows = records.map((record) => [
    record.date || "",
    record.staffName || "",
    record.status || "",
    record.scheduledStart || "",
    record.scheduledEnd || "",
    record.actualStart || "",
    record.actualEnd || "",
    record.adjustmentReason || "",
    record.employeeSignature ? "yes" : "no",
    record.managerSignature ? "yes" : "no",
    record.recordedAt || "",
    record.updatedAt || "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  });
}

function makeApiHeaders(accessKey, extraHeaders = {}) {
  const headers = {
    apikey: accessKey,
    ...extraHeaders,
  };
  if (String(accessKey || "").split(".").length === 3) {
    headers.Authorization = `Bearer ${accessKey}`;
  }
  return headers;
}

function readRequiredEnv(key) {
  const value = process.env[key];
  if (!value || value.includes("put-your-service-role-key-here")) {
    throw new Error(`${key} is missing. Create .env.local from .env.local.example first.`);
  }
  return value;
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
