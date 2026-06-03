const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

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
  pdfBrowserPath: process.env.ATTENDANCE_PDF_BROWSER_PATH || "",
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
  const pdfPath = path.join(config.backupFolder, `${baseName}.pdf`);
  const htmlPath = path.join(config.backupFolder, `${baseName}.print.html`);

  await fsp.writeFile(htmlPath, renderAttendanceBackupHtml({ backupKey, createdAt, records: quarterRecords }), "utf8");
  await printHtmlToPdf(htmlPath, pdfPath);
  await fsp.rm(htmlPath, { force: true });

  state.lastBackupKey = backupKey;
  state.lastBackupAt = createdAt;
  delete state.lastJsonPath;
  delete state.lastCsvPath;
  state.lastPdfPath = pdfPath;
  await writeJsonFile(statePath, state);

  console.log(`[attendance-backup] wrote PDF with ${quarterRecords.length} records for ${backupKey}`);
  console.log(`[attendance-backup] ${pdfPath}`);
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

function renderAttendanceBackupHtml({ backupKey, createdAt, records }) {
  const byDate = new Map();
  records.forEach((record) => {
    const date = record.date || "날짜 없음";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(record);
  });

  const dateSections = [...byDate.entries()]
    .map(
      ([date, items]) => `
        <section class="date-section">
          <h2>${escapeHtml(formatDateLabel(date))}</h2>
          <div class="record-list">
            ${items.map(renderAttendanceRecordCard).join("")}
          </div>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Milk Village 근퇴기록 ${escapeHtml(backupKey)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111827;
        font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif;
        font-size: 12px;
        line-height: 1.45;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 14px;
        border-bottom: 2px solid #0f766e;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 24px;
      }
      .meta {
        color: #596572;
        font-weight: 700;
      }
      .summary {
        min-width: 160px;
        text-align: right;
        font-weight: 900;
      }
      .summary strong {
        display: block;
        color: #0f766e;
        font-size: 28px;
      }
      .empty {
        margin-top: 24px;
        padding: 18px;
        border: 1px solid #d9e1e6;
        border-radius: 8px;
        color: #596572;
        font-weight: 800;
      }
      .date-section {
        break-inside: avoid;
        margin-top: 18px;
      }
      h2 {
        margin: 0 0 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: #eef7f5;
        color: #0f766e;
        font-size: 16px;
      }
      .record-list {
        display: grid;
        gap: 10px;
      }
      .record-card {
        break-inside: avoid;
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid #d9e1e6;
        border-radius: 8px;
      }
      .record-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .name {
        font-size: 16px;
        font-weight: 900;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #eef1f3;
        color: #596572;
        font-weight: 900;
      }
      .badge.present { background: #e2f3ef; color: #0f766e; }
      .badge.absent { background: #fde2e2; color: #c92a22; }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 7px 8px;
        border: 1px solid #d9e1e6;
        text-align: left;
        vertical-align: top;
      }
      th {
        width: 110px;
        background: #f5f7f8;
        color: #596572;
        font-weight: 900;
      }
      .signature-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .signature-box {
        min-height: 96px;
        padding: 8px;
        border: 1px solid #d9e1e6;
        border-radius: 8px;
      }
      .signature-box strong {
        display: block;
        margin-bottom: 6px;
        color: #596572;
      }
      .signature-box img {
        width: 100%;
        max-height: 72px;
        object-fit: contain;
      }
      .signature-empty {
        color: #9aa4ad;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Milk Village 근퇴기록</h1>
        <div class="meta">${escapeHtml(backupKey)} 분기 백업</div>
        <div class="meta">생성일: ${escapeHtml(formatDateTime(createdAt))}</div>
      </div>
      <div class="summary">
        기록 수
        <strong>${records.length}</strong>
      </div>
    </header>
    ${records.length ? dateSections : `<div class="empty">이 분기에 저장된 근퇴기록이 없습니다.</div>`}
  </body>
</html>`;
}

function renderAttendanceRecordCard(record) {
  const status = record.status === "absent" ? "결근" : record.managerSignature ? "출근 확인 완료" : "출근 확인 대기";
  const statusClass = record.status === "absent" ? "absent" : record.managerSignature ? "present" : "";
  return `
    <article class="record-card">
      <div class="record-top">
        <div class="name">${escapeHtml(record.staffName || "이름 없음")}</div>
        <div class="badge ${statusClass}">${escapeHtml(status)}</div>
      </div>
      <table>
        <tr>
          <th>예정 시간</th>
          <td>${escapeHtml(formatTimeRange(record.scheduledStart, record.scheduledEnd))}</td>
          <th>실제 시간</th>
          <td>${escapeHtml(record.status === "absent" ? "-" : formatTimeRange(record.actualStart, record.actualEnd))}</td>
        </tr>
        <tr>
          <th>변경 사유</th>
          <td colspan="3">${escapeHtml(record.adjustmentReason || "-")}</td>
        </tr>
        <tr>
          <th>기록 시각</th>
          <td>${escapeHtml(formatDateTime(record.recordedAt))}</td>
          <th>수정 시각</th>
          <td>${escapeHtml(formatDateTime(record.updatedAt))}</td>
        </tr>
      </table>
      <div class="signature-grid">
        ${renderSignatureBox("근무자 서명", record.employeeSignature)}
        ${renderSignatureBox("매니저 확인 서명", record.managerSignature)}
      </div>
    </article>
  `;
}

function renderSignatureBox(label, imageData) {
  return `
    <div class="signature-box">
      <strong>${escapeHtml(label)}</strong>
      ${isSignatureImage(imageData) ? `<img src="${imageData}" alt="${escapeHtml(label)}" />` : `<div class="signature-empty">서명 없음</div>`}
    </div>
  `;
}

async function printHtmlToPdf(htmlPath, pdfPath) {
  const browserPath = findPdfBrowserPath();
  const userDataDir = path.join(os.tmpdir(), `milk-village-pdf-${process.pid}-${Date.now()}`);
  await fsp.rm(pdfPath, { force: true });
  await fsp.mkdir(userDataDir, { recursive: true });

  const result = spawnSync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${userDataDir}`,
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });

  await fsp.rm(userDataDir, { recursive: true, force: true });

  if (result.status !== 0) {
    throw new Error(`PDF print failed: ${(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`);
  }
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file was not created: ${pdfPath}`);
  }
}

function findPdfBrowserPath() {
  const candidates = [
    config.pdfBrowserPath,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("PDF browser not found. Install Microsoft Edge or set ATTENDANCE_PDF_BROWSER_PATH in .env.local.");
  }
  return found;
}

function isSignatureImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function formatTimeRange(startTime, endTime) {
  return startTime && endTime ? `${startTime}-${endTime}` : "-";
}

function formatDateLabel(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return dateKey || "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
