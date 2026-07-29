const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const defaultEnvPath = path.join(repoRoot, ".env.local");
const statePath = path.join(__dirname, ".attendance-backup-state.json");
loadEnvFile(defaultEnvPath);
loadEnvFile(path.join(process.env.APPDATA || "", "MilkVillage", "attendance-backup.env"));

const DEFAULT_BACKUP_FOLDER = "C:\\milk village\\03_attendance_backups";
const DEFAULT_RETENTION_MONTHS = 3;

const cloudflareApiBaseUrl = normalizeRemoteApiBaseUrl(process.env.MILK_VILLAGE_API_BASE_URL || process.env.CLOUDFLARE_API_BASE_URL);
const config = cloudflareApiBaseUrl
  ? {
      backend: "cloudflare",
      apiBaseUrl: cloudflareApiBaseUrl,
      stateId: process.env.REMOTE_STATE_ID || process.env.SUPABASE_STATE_ID || "main",
      backupFolder: process.env.ATTENDANCE_BACKUP_FOLDER || DEFAULT_BACKUP_FOLDER,
      pdfBrowserPath: process.env.ATTENDANCE_PDF_BROWSER_PATH || "",
      retentionMonths: normalizePositiveInt(process.env.ATTENDANCE_DETAIL_RETENTION_MONTHS, DEFAULT_RETENTION_MONTHS),
    }
  : {
      backend: "supabase",
      supabaseUrl: readRequiredEnv("SUPABASE_URL"),
      accessKey: process.env.SUPABASE_STATE_ACCESS_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
      table: process.env.SUPABASE_STATE_TABLE || "milk_village_state",
      stateId: process.env.SUPABASE_STATE_ID || "main",
      backupFolder: process.env.ATTENDANCE_BACKUP_FOLDER || DEFAULT_BACKUP_FOLDER,
      pdfBrowserPath: process.env.ATTENDANCE_PDF_BROWSER_PATH || "",
      retentionMonths: normalizePositiveInt(process.env.ATTENDANCE_DETAIL_RETENTION_MONTHS, DEFAULT_RETENTION_MONTHS),
    };

main().catch((error) => {
  console.error(`[attendance-backup] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const now = new Date();
  const nowIsoText = now.toISOString();
  const cutoffDateKey = formatDateKey(subtractMonths(now, config.retentionMonths));
  const state = await readJsonFile(statePath, { archivedMonths: {} });
  if (!state.archivedMonths || typeof state.archivedMonths !== "object") state.archivedMonths = {};

  const row = await fetchRemoteStateRow();
  const remoteData = row.data || {};
  const records = normalizeAttendanceRecords(remoteData.operations?.attendanceRecords);
  const targetMonths = resolveTargetMonths(records, { args, cutoffDateKey, now });

  await fsp.mkdir(config.backupFolder, { recursive: true });

  const archivedThisRun = [];
  for (const monthKey of targetMonths) {
    const monthRecords = records.filter((record) => getMonthKey(record.date) === monthKey);
    const fingerprint = hashString(JSON.stringify(monthRecords));
    const archive = state.archivedMonths[monthKey] || {};
    const pdfPath = getMonthPdfPath(monthKey);
    const shouldWritePdf =
      args.has("--force") ||
      archive.fingerprint !== fingerprint ||
      archive.pdfPath !== pdfPath ||
      !fs.existsSync(pdfPath);

    if (shouldWritePdf) {
      const htmlPath = path.join(config.backupFolder, `.milk-village-attendance-${monthKey}.print.html`);
      await fsp.mkdir(path.dirname(pdfPath), { recursive: true });
      await fsp.writeFile(
        htmlPath,
        renderAttendanceBackupHtml({ monthKey, createdAt: nowIsoText, records: monthRecords }),
        "utf8",
      );
      await printHtmlToPdf(htmlPath, pdfPath);
      await fsp.rm(htmlPath, { force: true });
    }

    state.archivedMonths[monthKey] = {
      pdfPath,
      archivedAt: nowIsoText,
      count: monthRecords.length,
      fingerprint,
    };
    archivedThisRun.push(monthKey);
  }

  let prunedCount = 0;
  if (!args.has("--no-prune")) {
    const prunableMonths = new Set(
      targetMonths.filter((monthKey) => {
        const archive = state.archivedMonths[monthKey];
        return archive?.pdfPath && fs.existsSync(archive.pdfPath);
      }),
    );
    const nextRecords = records.filter((record) => {
      if (!record.date || record.date >= cutoffDateKey) return true;
      return !prunableMonths.has(getMonthKey(record.date));
    });
    prunedCount = records.length - nextRecords.length;

    if (prunedCount > 0) {
      remoteData.operations = {
        ...(remoteData.operations || {}),
        attendanceRecords: nextRecords,
      };
      remoteData.meta = {
        ...(remoteData.meta || {}),
        updatedAt: nowIsoText,
      };
      await updateRemoteState(remoteData, nowIsoText);
    }
  }

  state.lastRunAt = nowIsoText;
  state.lastCutoffDate = cutoffDateKey;
  state.lastArchivedMonths = archivedThisRun;
  state.lastPrunedCount = prunedCount;
  await writeJsonFile(statePath, state);

  if (!targetMonths.length) {
    console.log(`[attendance-backup] no attendance records older than ${cutoffDateKey}`);
    return;
  }
  console.log(`[attendance-backup] archived months: ${targetMonths.join(", ")}`);
  console.log(`[attendance-backup] pruned ${prunedCount} detailed records older than ${cutoffDateKey}`);
  console.log(`[attendance-backup] backup folder: ${config.backupFolder}`);
}

async function fetchRemoteStateRow() {
  if (config.backend === "cloudflare") {
    const response = await fetch(`${config.apiBaseUrl}/state/${encodeURIComponent(config.stateId)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`remote state fetch failed: ${response.status} ${body}`);
    }
    const row = await response.json();
    if (!row?.data) {
      throw new Error("remote app state not found. Open the app once first, then run backup again.");
    }
    return row;
  }

  const url = `${config.supabaseUrl}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.stateId)}&select=data,updated_at`;
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
  return row;
}

async function updateRemoteState(data, updatedAt) {
  if (config.backend === "cloudflare") {
    const response = await fetch(`${config.apiBaseUrl}/state/${encodeURIComponent(config.stateId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, updated_at: updatedAt }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`remote state update failed: ${response.status} ${body}`);
    }
    return;
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.stateId)}`, {
    method: "PATCH",
    headers: makeApiHeaders(config.accessKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({ data, updated_at: updatedAt }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`remote state update failed: ${response.status} ${body}`);
  }
}

function resolveTargetMonths(records, { args, cutoffDateKey, now }) {
  if (args.has("--current")) return [formatMonthKey(now)];
  const dueMonths = records
    .filter((record) => record.date && record.date < cutoffDateKey)
    .map((record) => getMonthKey(record.date))
    .filter(Boolean);
  return [...new Set(dueMonths)].sort((a, b) => a.localeCompare(b));
}

function normalizeAttendanceRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({
      id: record?.id || `attendance-${index}`,
      date: normalizeDateKey(record?.date),
      staffId: record?.staffId || "",
      staffName: record?.staffName || "",
      status: normalizeAttendanceStatus(record?.status),
      absenceType: normalizeAbsenceType(record?.absenceType),
      scheduledStart: normalizeTimeValue(record?.scheduledStart),
      scheduledEnd: normalizeTimeValue(record?.scheduledEnd),
      actualStart: normalizeTimeValue(record?.actualStart),
      actualEnd: normalizeTimeValue(record?.actualEnd),
      breakMinutes: normalizeBreakMinutes(record?.breakMinutes),
      employeeSignature: record?.employeeSignature || "",
      managerSignature: record?.managerSignature || "",
      employeeSignatureStrokes: normalizeSignatureStrokes(record?.employeeSignatureStrokes),
      managerSignatureStrokes: normalizeSignatureStrokes(record?.managerSignatureStrokes),
      adjustmentReason: record?.adjustmentReason || "",
      recordedAt: record?.recordedAt || "",
      updatedAt: record?.updatedAt || "",
    }))
    .filter((record) => record.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName, "ko-KR"));
}

function renderAttendanceBackupHtml({ monthKey, createdAt, records }) {
  const byStaff = new Map();
  records.forEach((record) => {
    const staffName = record.staffName || "이름 없음";
    if (!byStaff.has(staffName)) byStaff.set(staffName, []);
    byStaff.get(staffName).push(record);
  });
  const totalWorkMinutes = records.reduce((sum, record) => sum + getRecordWorkMinutes(record), 0);
  const staffSections = [...byStaff.entries()]
    .map(
      ([staffName, staffRecords]) => `
        <section class="staff-section">
          <h2>${escapeHtml(staffName)}</h2>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>구분</th>
                <th>예정</th>
                <th>실제</th>
                <th>휴게</th>
                <th>근무시간</th>
                <th>근무자 서명</th>
                <th>매니저 확인</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              ${staffRecords.map(renderAttendanceTableRow).join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Milk Village 근퇴기록 ${escapeHtml(monthKey)}</title>
    <style>
      @page { size: A4 landscape; margin: 9mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111827;
        font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif;
        font-size: 10px;
        line-height: 1.35;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 10px;
        border-bottom: 2px solid #0f766e;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 22px;
      }
      .meta {
        color: #596572;
        font-weight: 700;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(92px, 1fr));
        gap: 6px;
        min-width: 340px;
      }
      .summary div {
        padding: 8px;
        border: 1px solid #d9e1e6;
        border-radius: 8px;
        background: #f8fafb;
      }
      .summary span {
        display: block;
        color: #596572;
        font-weight: 800;
      }
      .summary strong {
        display: block;
        margin-top: 2px;
        color: #0f766e;
        font-size: 16px;
      }
      .empty {
        margin-top: 18px;
        padding: 18px;
        border: 1px solid #d9e1e6;
        border-radius: 8px;
        color: #596572;
        font-weight: 800;
      }
      .staff-section {
        break-inside: avoid;
        margin-top: 12px;
      }
      h2 {
        margin: 0 0 6px;
        padding: 6px 8px;
        border-radius: 8px;
        background: #eef7f5;
        color: #0f766e;
        font-size: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 5px 6px;
        border: 1px solid #d9e1e6;
        text-align: left;
        vertical-align: middle;
      }
      th {
        background: #f5f7f8;
        color: #596572;
        font-weight: 900;
      }
      td {
        height: 34px;
      }
      .status {
        display: inline-block;
        padding: 3px 6px;
        border-radius: 999px;
        background: #eef1f3;
        font-weight: 900;
        white-space: nowrap;
      }
      .status.present { background: #e2f3ef; color: #0f766e; }
      .status.late { background: #fff0bf; color: #8a5a00; }
      .status.absent { background: #fde2e2; color: #c92a22; }
      .signature-cell {
        width: 110px;
        height: 34px;
      }
      .signature-cell img,
      .signature-cell svg {
        display: block;
        width: 96px;
        height: 30px;
        object-fit: contain;
      }
      .signature-empty {
        color: #9aa4ad;
        font-weight: 800;
      }
      .note {
        max-width: 180px;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Milk Village 근퇴기록 백업</h1>
        <div class="meta">${escapeHtml(formatMonthLabel(monthKey))}</div>
        <div class="meta">생성일 ${escapeHtml(formatDateTime(createdAt))}</div>
        <div class="meta">백업 위치 ${escapeHtml(config.backupFolder)}</div>
      </div>
      <div class="summary">
        <div><span>기록</span><strong>${records.length}건</strong></div>
        <div><span>직원</span><strong>${byStaff.size}명</strong></div>
        <div><span>근무시간</span><strong>${formatDurationText(totalWorkMinutes)}</strong></div>
      </div>
    </header>
    ${records.length ? staffSections : `<div class="empty">해당 월에 저장된 근퇴기록이 없습니다.</div>`}
  </body>
</html>`;
}

function renderAttendanceTableRow(record) {
  const isWork = record.status === "present" || record.status === "late";
  return `
    <tr>
      <td>${escapeHtml(formatDateLabel(record.date))}</td>
      <td><span class="status ${escapeAttr(record.status)}">${escapeHtml(attendanceStatusLabel(record))}</span></td>
      <td>${escapeHtml(formatTimeRange(record.scheduledStart, record.scheduledEnd))}</td>
      <td>${escapeHtml(isWork ? formatTimeRange(record.actualStart, record.actualEnd) : "-")}</td>
      <td>${escapeHtml(isWork ? formatDurationText(record.breakMinutes) : "-")}</td>
      <td>${escapeHtml(isWork ? formatDurationText(getRecordWorkMinutes(record)) : "-")}</td>
      <td class="signature-cell">${renderSignatureMarkup(record.employeeSignature, record.employeeSignatureStrokes)}</td>
      <td class="signature-cell">${renderSignatureMarkup(record.managerSignature, record.managerSignatureStrokes)}</td>
      <td class="note">${escapeHtml(record.adjustmentReason || "")}</td>
    </tr>
  `;
}

function renderSignatureMarkup(imageData, strokes) {
  if (isSignatureImage(imageData)) return `<img src="${imageData}" alt="signature" />`;
  const normalizedStrokes = normalizeSignatureStrokes(strokes);
  if (!normalizedStrokes.length) return `<span class="signature-empty">-</span>`;
  const paths = normalizedStrokes
    .map((stroke) => {
      const points = stroke.map(([x, y]) => [Math.round(x * 300), Math.round(y * 90)]);
      if (!points.length) return "";
      const [first, ...rest] = points;
      const d = [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`)].join(" ");
      return `<path d="${d}" />`;
    })
    .join("");
  return `<svg viewBox="0 0 300 90" aria-label="signature" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#111827" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

async function printHtmlToPdf(htmlPath, pdfPath) {
  const browserPath = findPdfBrowserPath();
  const userDataDir = path.join(os.tmpdir(), `milk-village-pdf-${process.pid}-${Date.now()}`);
  await fsp.rm(pdfPath, { force: true });
  await fsp.mkdir(userDataDir, { recursive: true });

  const result = spawnSync(
    browserPath,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

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

function getMonthPdfPath(monthKey) {
  const year = String(monthKey || "").slice(0, 4) || "unknown";
  return path.join(config.backupFolder, year, `milk-village-attendance-${monthKey}.pdf`);
}

function attendanceStatusLabel(record) {
  if (record.status === "absent") {
    return record.absenceType === "unexcused" ? "결근(무단)" : "결근(협의)";
  }
  if (record.status === "late") return "지각";
  return "출근";
}

function getRecordWorkMinutes(record) {
  if (record.status !== "present" && record.status !== "late") return 0;
  const minutes = minutesBetween(record.actualStart, record.actualEnd);
  if (minutes === null) return 0;
  return Math.max(0, minutes - normalizeBreakMinutes(record.breakMinutes));
}

function normalizeSignatureStrokes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((stroke) =>
      (Array.isArray(stroke) ? stroke : [])
        .map((point) => {
          const x = Number(point?.[0]);
          const y = Number(point?.[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return [Math.min(1, Math.max(0, Number(x.toFixed(4)))), Math.min(1, Math.max(0, Number(y.toFixed(4))))];
        })
        .filter(Boolean),
    )
    .filter((stroke) => stroke.length);
}

function normalizeAttendanceStatus(status) {
  return status === "absent" || status === "late" ? status : "present";
}

function normalizeAbsenceType(type) {
  return type === "unexcused" ? "unexcused" : "approved";
}

function normalizeBreakMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const rounded = Math.round(minutes / 30) * 30;
  return Math.min(180, Math.max(0, rounded));
}

function normalizeTimeValue(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return "";
  if (hour === 24 && minute !== 0) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDateKey(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isSignatureImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function formatTimeRange(startTime, endTime) {
  return startTime && endTime ? `${startTime}-${endTime}` : "-";
}

function minutesBetween(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return null;
  return end >= start ? end - start : end + 24 * 60 - start;
}

function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function subtractMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth() - months;
  const day = date.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function getMonthKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey || "";
  return `${year}년 ${String(month).padStart(2, "0")}월`;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return dateKey || "-";
  return new Intl.DateTimeFormat("ko-KR", {
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

function formatDurationText(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (hours && remainingMinutes) return `${hours}시간 ${remainingMinutes}분`;
  if (hours) return `${hours}시간`;
  return `${remainingMinutes}분`;
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

function normalizeRemoteApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
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
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
