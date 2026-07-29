const REMOTE_API_BASE_URL = window.MILK_VILLAGE_API_BASE_URL || "";
const REMOTE_STATE_ID = "main";
const SETTINGS_KEY = "milk-village-owner-payroll-settings-v1";
const UNLOCK_DURATION_MS = 10 * 60 * 1000;
const WITHHOLDING_RATE = 0.033;
const MINIMUM_HOURLY_WAGE_2026 = 10320;

const els = {
  setupPanel: document.querySelector("#setupPanel"),
  loginPanel: document.querySelector("#loginPanel"),
  appPanel: document.querySelector("#appPanel"),
  setupPin: document.querySelector("#setupPin"),
  setupPinConfirm: document.querySelector("#setupPinConfirm"),
  setupButton: document.querySelector("#setupButton"),
  loginPin: document.querySelector("#loginPin"),
  loginButton: document.querySelector("#loginButton"),
  lockButton: document.querySelector("#lockButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  samplePrintButton: document.querySelector("#samplePrintButton"),
  sampleAttendancePrintButton: document.querySelector("#sampleAttendancePrintButton"),
  payrollMonth: document.querySelector("#payrollMonth"),
  refreshButton: document.querySelector("#refreshButton"),
  printAllButton: document.querySelector("#printAllButton"),
  printAllAttendanceButton: document.querySelector("#printAllAttendanceButton"),
  remoteUpdatedText: document.querySelector("#remoteUpdatedText"),
  staffRateList: document.querySelector("#staffRateList"),
  summaryGrid: document.querySelector("#summaryGrid"),
  payrollList: document.querySelector("#payrollList"),
  printArea: document.querySelector("#printArea"),
};

const state = {
  settings: loadSettings(),
  unlockedUntil: 0,
  staffMembers: [],
  attendanceRecords: [],
  remoteUpdatedAt: "",
  selectedMonth: currentMonthKey(),
};

const remoteApiBaseUrl = normalizeRemoteApiBaseUrl(REMOTE_API_BASE_URL);

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      ownerPinHash: parsed.ownerPinHash || "",
      staffSettings: parsed.staffSettings && typeof parsed.staffSettings === "object" ? parsed.staffSettings : {},
    };
  } catch {
    return { ownerPinHash: "", staffSettings: {} };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

async function hashValue(value) {
  if (!globalThis.crypto?.subtle) return fallbackHashValue(value);
  const encoded = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHashValue(value) {
  let hash = 0x811c9dc5;
  String(value)
    .split("")
    .forEach((char) => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    });
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function setStatus(text, status = "") {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `status-pill${status ? ` is-${status}` : ""}`;
}

function normalizeRemoteApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function fetchRemoteJson(path, options = {}) {
  if (!remoteApiBaseUrl) return null;
  const response = await fetch(`${remoteApiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `remote request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showMode(mode) {
  els.setupPanel.hidden = mode !== "setup";
  els.loginPanel.hidden = mode !== "login";
  els.appPanel.hidden = mode !== "app";
  els.lockButton.hidden = mode !== "app";
}

function bootstrap() {
  els.payrollMonth.value = state.selectedMonth;
  if (!state.settings.ownerPinHash) {
    showMode("setup");
    setStatus("PIN 설정", "");
    return;
  }
  showMode("login");
  setStatus("잠김", "");
}

async function setupOwnerPin() {
  const pin = els.setupPin.value.trim();
  const confirmPin = els.setupPinConfirm.value.trim();
  if (pin.length < 4) {
    alert("대표 PIN은 4자리 이상으로 설정해주세요.");
    els.setupPin.focus();
    return;
  }
  if (pin !== confirmPin) {
    alert("PIN 확인이 일치하지 않습니다.");
    els.setupPinConfirm.focus();
    return;
  }
  state.settings.ownerPinHash = await hashValue(pin);
  saveSettings();
  els.setupPin.value = "";
  els.setupPinConfirm.value = "";
  unlock();
}

async function login() {
  const pin = els.loginPin.value.trim();
  if (!pin) return;
  const hash = await hashValue(pin);
  if (hash !== state.settings.ownerPinHash) {
    alert("대표 PIN이 맞지 않습니다.");
    els.loginPin.value = "";
    els.loginPin.focus();
    return;
  }
  els.loginPin.value = "";
  unlock();
}

function unlock() {
  state.unlockedUntil = Date.now() + UNLOCK_DURATION_MS;
  showMode("app");
  setStatus("대표 모드", "online");
  render();
  fetchRemoteState();
}

function lock() {
  state.unlockedUntil = 0;
  showMode(state.settings.ownerPinHash ? "login" : "setup");
  setStatus("잠김", "");
}

function keepUnlocked() {
  if (!els.appPanel.hidden) state.unlockedUntil = Date.now() + UNLOCK_DURATION_MS;
}

function expireIfNeeded() {
  if (!els.appPanel.hidden && Date.now() > state.unlockedUntil) lock();
}

async function fetchRemoteState() {
  if (!remoteApiBaseUrl) {
    setStatus("Cloudflare 설정 없음", "error");
    return;
  }
  setStatus("Cloudflare 불러오는 중", "");
  try {
    const row = await fetchRemoteJson(`/state/${encodeURIComponent(REMOTE_STATE_ID)}`);
    const remoteData = row?.data || {};
    const operations = remoteData.operations || {};
    state.staffMembers = normalizeStaffMembers(operations.staffMembers);
    state.attendanceRecords = normalizeAttendanceRecords(operations.attendanceRecords);
    state.remoteUpdatedAt = row?.updated_at || "";
    ensureStaffSettings();
    saveSettings();
    setStatus("Cloudflare 연결됨", "online");
    render();
  } catch (error) {
    console.error(error);
    if (error.status === 404) {
      setStatus("서버 데이터 없음", "error");
      els.remoteUpdatedText.textContent =
        "Cloudflare에 아직 근퇴 데이터가 없습니다. 태블릿 메인 앱에서 Cloudflare 첫 저장 완료가 뜬 뒤 다시 불러오세요.";
      render();
      return;
    }
    setStatus("Cloudflare 실패", "error");
    els.remoteUpdatedText.textContent = "Cloudflare 설정 또는 네트워크 문제로 근퇴기록을 불러오지 못했습니다.";
  }
}

function normalizeStaffMembers(staffMembers) {
  return (Array.isArray(staffMembers) ? staffMembers : [])
    .map((staff, index) => ({
      id: staff?.id || `staff-${index}`,
      name: staff?.name || "이름 없음",
      isActive: staff?.isActive !== false,
      sortOrder: Number(staff?.sortOrder || index + 1),
    }))
    .filter((staff) => staff.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko-KR"));
}

function normalizeAttendanceStatus(status) {
  return status === "absent" || status === "late" ? status : "present";
}

function isAttendanceWorkStatus(status) {
  return status === "present" || status === "late";
}

function normalizeAbsenceType(type) {
  return type === "unexcused" ? "unexcused" : "approved";
}

function attendanceStatusLabel(status) {
  const normalizedStatus = normalizeAttendanceStatus(status);
  if (normalizedStatus === "absent") return "결근";
  if (normalizedStatus === "late") return "지각";
  return "출근";
}

function attendanceAbsenceTypeLabel(type) {
  return normalizeAbsenceType(type) === "unexcused" ? "무단 결근" : "협의 결근";
}

function normalizeAttendanceRecords(records) {
  return (Array.isArray(records) ? records : []).map((record) => ({
    id: record?.id || "",
    date: record?.date || "",
    staffId: record?.staffId || "",
    staffName: record?.staffName || "",
    status: normalizeAttendanceStatus(record?.status),
    absenceType: normalizeAttendanceStatus(record?.status) === "absent" ? normalizeAbsenceType(record?.absenceType) : "",
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
  }));
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

function hasSignatureStrokes(value) {
  return normalizeSignatureStrokes(value).length > 0;
}

function hasEmployeeSignature(record) {
  return Boolean(record?.employeeSignature) || hasSignatureStrokes(record?.employeeSignatureStrokes);
}

function hasManagerSignature(record) {
  return Boolean(record?.managerSignature) || hasSignatureStrokes(record?.managerSignatureStrokes);
}

function ensureStaffSettings() {
  state.staffMembers.forEach((staff) => {
    if (!state.settings.staffSettings[staff.id]) {
      state.settings.staffSettings[staff.id] = {
        hourlyRate: "",
        weeklyAllowance: true,
        withholding: true,
      };
    }
  });
}

function render() {
  if (els.appPanel.hidden) return;
  state.selectedMonth = els.payrollMonth.value || currentMonthKey();
  ensureStaffSettings();
  renderStaffRates();
  const payrolls = calculatePayrolls();
  renderSummary(payrolls);
  renderPayrollList(payrolls);
  els.remoteUpdatedText.textContent = state.remoteUpdatedAt
    ? `근퇴기록 기준: ${formatDateTime(state.remoteUpdatedAt)}`
    : "근퇴기록을 불러오면 계산됩니다.";
}

function renderStaffRates() {
  if (!state.staffMembers.length) {
    els.staffRateList.innerHTML = `<div class="empty-state">등록된 근무자가 없습니다.</div>`;
    return;
  }
  els.staffRateList.innerHTML = state.staffMembers
    .map((staff) => {
      const setting = getStaffSetting(staff.id);
      return `
        <div class="rate-card">
          <strong>${escapeHtml(staff.name)}</strong>
          <label class="field">
            <span>시급</span>
            <input data-hourly-rate="${escapeAttr(staff.id)}" type="number" min="0" step="10" value="${escapeAttr(setting.hourlyRate)}" placeholder="예: 11000" />
          </label>
          <div class="check-row">
            <label><input data-weekly-allowance="${escapeAttr(staff.id)}" type="checkbox" ${setting.weeklyAllowance ? "checked" : ""} /> 주휴수당</label>
            <label><input data-withholding="${escapeAttr(staff.id)}" type="checkbox" ${setting.withholding ? "checked" : ""} /> 3.3% 공제</label>
          </div>
        </div>
      `;
    })
    .join("");

  els.staffRateList.querySelectorAll("[data-hourly-rate]").forEach((input) => {
    input.addEventListener("change", () => {
      const setting = getStaffSetting(input.dataset.hourlyRate);
      setting.hourlyRate = input.value;
      saveSettings();
      render();
    });
  });
  els.staffRateList.querySelectorAll("[data-weekly-allowance]").forEach((input) => {
    input.addEventListener("change", () => {
      getStaffSetting(input.dataset.weeklyAllowance).weeklyAllowance = input.checked;
      saveSettings();
      render();
    });
  });
  els.staffRateList.querySelectorAll("[data-withholding]").forEach((input) => {
    input.addEventListener("change", () => {
      getStaffSetting(input.dataset.withholding).withholding = input.checked;
      saveSettings();
      render();
    });
  });
}

function renderSummary(payrolls) {
  const totals = payrolls.reduce(
    (result, payroll) => {
      result.workMinutes += payroll.workMinutes;
      result.grossPay += payroll.grossPay;
      result.weeklyAllowancePay += payroll.weeklyAllowancePay;
      result.netPay += payroll.netPay;
      return result;
    },
    { workMinutes: 0, grossPay: 0, weeklyAllowancePay: 0, netPay: 0 },
  );
  els.summaryGrid.innerHTML = `
    <div class="summary-card"><span>총 근무시간</span><strong>${formatDurationText(totals.workMinutes)}</strong></div>
    <div class="summary-card"><span>총 지급액</span><strong>${formatWon(totals.grossPay)}</strong></div>
    <div class="summary-card"><span>주휴수당</span><strong>${formatWon(totals.weeklyAllowancePay)}</strong></div>
    <div class="summary-card"><span>실지급액</span><strong>${formatWon(totals.netPay)}</strong></div>
  `;
}

function renderPayrollList(payrolls) {
  if (!payrolls.length) {
    els.payrollList.innerHTML = `<div class="empty-state">정산할 직원이 없습니다.</div>`;
    return;
  }
  els.payrollList.innerHTML = payrolls
    .map(
      (payroll) => `
        <article class="payroll-card">
          <div class="payroll-card-header">
            <div>
              <h3>${escapeHtml(payroll.staff.name)}</h3>
              <p class="muted">${formatMonthLabel(state.selectedMonth)} 급여명세서</p>
            </div>
            <div class="amount">${formatWon(payroll.netPay)}</div>
          </div>
          <div class="payroll-metrics">
            <div class="metric"><span>근무시간</span><strong>${formatDurationText(payroll.workMinutes)}</strong></div>
            <div class="metric"><span>기본급</span><strong>${formatWon(payroll.basePay)}</strong></div>
            <div class="metric"><span>주휴수당</span><strong>${formatWon(payroll.weeklyAllowancePay)}</strong></div>
            <div class="metric"><span>3.3% 공제</span><strong>${formatWon(payroll.withholdingAmount)}</strong></div>
            <div class="metric"><span>지각</span><strong>${payroll.lateRecords.length}건</strong></div>
            <div class="metric"><span>무단결근</span><strong>${payroll.unexcusedAbsenceRecords.length}건</strong></div>
            <div class="metric"><span>확인 대기</span><strong>${payroll.unconfirmedCount}건</strong></div>
          </div>
          ${payroll.hourlyRate && payroll.hourlyRate < MINIMUM_HOURLY_WAGE_2026 ? `<p class="notice">시급이 2026년 최저임금 ${formatWon(MINIMUM_HOURLY_WAGE_2026)}보다 낮습니다.</p>` : ""}
          ${payroll.unconfirmedCount ? `<p class="notice">매니저 서명이 없는 근퇴기록이 포함되어 있습니다.</p>` : ""}
          ${payroll.weeklyAllowanceReviewFlags.length ? `<p class="notice">주휴수당 제외 검토: ${payroll.weeklyAllowanceReviewFlags.map(escapeHtml).join(" / ")}</p>` : ""}
          ${renderWeeklyPayrollTable(payroll, { compact: true })}
          <div class="button-row">
            <button class="button button--primary button--small" type="button" data-print-staff="${escapeAttr(payroll.staff.id)}">급여 PDF</button>
            <button class="button button--ghost button--small" type="button" data-print-attendance="${escapeAttr(payroll.staff.id)}">근퇴 PDF</button>
          </div>
        </article>
      `,
    )
    .join("");

  els.payrollList.querySelectorAll("[data-print-staff]").forEach((button) => {
    button.addEventListener("click", () => printPayslips([button.dataset.printStaff]));
  });
  els.payrollList.querySelectorAll("[data-print-attendance]").forEach((button) => {
    button.addEventListener("click", () => printAttendanceSheets([button.dataset.printAttendance]));
  });
}

function calculatePayrolls() {
  return state.staffMembers.map((staff) => calculatePayroll(staff));
}

function calculatePayroll(staff) {
  const setting = getStaffSetting(staff.id);
  const hourlyRate = Number(setting.hourlyRate || 0);
  const records = state.attendanceRecords
    .filter((record) => record.staffId === staff.id && String(record.date || "").startsWith(state.selectedMonth))
    .sort((a, b) => a.date.localeCompare(b.date));
  const presentRecords = records.filter((record) => isAttendanceWorkStatus(record.status) && record.actualStart && record.actualEnd);
  const lateRecords = records.filter((record) => record.status === "late");
  const absentRecords = records.filter((record) => record.status === "absent");
  const unexcusedAbsenceRecords = absentRecords.filter((record) => normalizeAbsenceType(record.absenceType) === "unexcused");
  const weeklyAllowanceReviewFlags = getWeeklyAllowanceReviewFlags(records);
  const workMinutes = presentRecords.reduce((sum, record) => sum + getRecordWorkMinutes(record), 0);
  const breakMinutes = presentRecords.reduce((sum, record) => sum + normalizeBreakMinutes(record.breakMinutes), 0);
  const weeklyPayrollSections = buildWeeklyPayrollSections(records, setting, hourlyRate);
  const weeklyAllowanceMinutes = weeklyPayrollSections.reduce((sum, section) => sum + section.weeklyAllowanceMinutes, 0);
  const basePay = Math.round((workMinutes / 60) * hourlyRate);
  const weeklyAllowancePay = weeklyPayrollSections.reduce((sum, section) => sum + section.weeklyAllowancePay, 0);
  const grossPay = basePay + weeklyAllowancePay;
  const withholdingAmount = setting.withholding ? Math.floor(grossPay * WITHHOLDING_RATE) : 0;
  const netPay = grossPay - withholdingAmount;
  const unconfirmedCount = presentRecords.filter((record) => !(hasEmployeeSignature(record) && hasManagerSignature(record))).length;
  return {
    staff,
    setting,
    hourlyRate,
    records,
    presentRecords,
    lateRecords,
    absentRecords,
    unexcusedAbsenceRecords,
    weeklyAllowanceReviewFlags,
    weeklyPayrollSections,
    workMinutes,
    breakMinutes,
    weeklyAllowanceMinutes,
    basePay,
    weeklyAllowancePay,
    grossPay,
    withholdingAmount,
    netPay,
    unconfirmedCount,
  };
}

function buildWeeklyPayrollSections(records, setting, hourlyRate) {
  const weekly = new Map();
  records.forEach((record) => {
    const key = getWeekKey(record.date);
    if (!weekly.has(key)) weekly.set(key, []);
    weekly.get(key).push(record);
  });

  return Array.from(weekly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, weekRecords], index) => {
      const recordsByDate = new Map(weekRecords.map((record) => [record.date, record]));
      const dayItems = getWeekDateKeys(weekKey).map((dateKey) => {
        const record = recordsByDate.get(dateKey) || null;
        const isWorkRecord = isAttendanceWorkStatus(record?.status) && record?.actualStart && record?.actualEnd;
        const workMinutes = isWorkRecord ? getRecordWorkMinutes(record) : 0;
        const basePay = Math.round((workMinutes / 60) * hourlyRate);
        return {
          dateKey,
          record,
          statusText: record ? formatPayrollAttendanceStatus(record) : "",
          statusClass: record ? getPayrollStatusClass(record) : "",
          workMinutes,
          hourlyRate: record ? hourlyRate : 0,
          basePay,
          netBasePay: getNetAmount(basePay, setting),
        };
      });
      const weeklyWorkMinutes = dayItems.reduce((sum, item) => sum + item.workMinutes, 0);
      const weeklyBasePay = dayItems.reduce((sum, item) => sum + item.basePay, 0);
      const weeklyBaseNetPay = dayItems.reduce((sum, item) => sum + item.netBasePay, 0);
      const weeklyAllowanceMinutes =
        setting.weeklyAllowance && weeklyWorkMinutes >= 15 * 60 ? Math.min(8 * 60, Math.round(weeklyWorkMinutes / 5)) : 0;
      const weeklyAllowancePay = Math.round((weeklyAllowanceMinutes / 60) * hourlyRate);
      const weeklyGrossPay = weeklyBasePay + weeklyAllowancePay;
      const weeklyWithholdingAmount = setting.withholding ? Math.floor(weeklyGrossPay * WITHHOLDING_RATE) : 0;
      const weeklyNetPay = weeklyGrossPay - weeklyWithholdingAmount;

      return {
        weekKey,
        label: formatPayrollWeekTitle(index),
        dateRange: formatWeekLabel(weekKey),
        dayItems,
        statusSummary: summarizeWeekStatuses(weekRecords),
        weeklyWorkMinutes,
        weeklyBasePay,
        weeklyBaseNetPay,
        weeklyAllowanceMinutes,
        weeklyAllowancePay,
        weeklyGrossPay,
        weeklyWithholdingAmount,
        weeklyNetPay,
      };
    });
}

function renderWeeklyPayrollTable(payroll, options = {}) {
  const sections = payroll.weeklyPayrollSections || [];
  if (!sections.length) {
    return `<section class="weekly-payroll${options.compact ? " is-compact" : ""}"><div class="weekly-payroll-empty">해당 월 근퇴기록이 없습니다.</div></section>`;
  }

  return `
    <section class="weekly-payroll${options.compact ? " is-compact" : ""}">
      <div class="weekly-payroll-title">주차별 급여 계산</div>
      ${sections.map((section) => renderWeeklyPayrollSection(section, payroll.setting)).join("")}
    </section>
  `;
}

function renderWeeklyPayrollSection(section, setting) {
  return `
    <article class="weekly-payroll-section">
      <div class="weekly-payroll-heading">
        <strong>${escapeHtml(section.label)}</strong>
        <span>${escapeHtml(section.dateRange)}</span>
      </div>
      <div class="weekly-payroll-table-wrap">
        <table class="weekly-payroll-table">
          <thead>
            <tr>
              <th>구분</th>
              ${section.dayItems.map((item) => `<th>${escapeHtml(formatPayrollDateHeader(item.dateKey))}</th>`).join("")}
              <th>합산</th>
            </tr>
          </thead>
          <tbody>
            ${renderWeeklyPayrollRow(
              "출근",
              section.dayItems.map((item) =>
                item.statusText ? `<span class="payroll-status ${escapeAttr(item.statusClass)}">${escapeHtml(item.statusText)}</span>` : "",
              ),
              escapeHtml(section.statusSummary),
            )}
            ${renderWeeklyPayrollRow(
              "근무시간",
              section.dayItems.map((item) => formatPayrollDurationCell(item.workMinutes)),
              formatDurationText(section.weeklyWorkMinutes),
            )}
            ${renderWeeklyPayrollRow(
              "시급",
              section.dayItems.map((item) => (item.record ? formatPayrollRateCell(item.hourlyRate) : "")),
              formatPayrollRateCell(section.dayItems.find((item) => item.hourlyRate)?.hourlyRate || 0),
            )}
            ${renderWeeklyPayrollRow(
              "합산급",
              section.dayItems.map((item) => formatPayrollWonCell(item.basePay)),
              formatPayrollWonCell(section.weeklyBasePay, true),
            )}
            ${renderWeeklyPayrollRow(
              "3.3% 반영",
              section.dayItems.map((item) => formatPayrollWonCell(item.netBasePay)),
              setting.withholding ? formatPayrollWonCell(section.weeklyBaseNetPay, true) : "미적용",
            )}
            ${renderWeeklyPayrollRow(
              "주휴수당",
              section.dayItems.map(() => ""),
              section.weeklyAllowancePay ? `${formatPayrollWonCell(section.weeklyAllowancePay, true)}<small>${formatDurationText(section.weeklyAllowanceMinutes)} 기준</small>` : "0원",
            )}
            ${renderWeeklyPayrollRow(
              "주 합계",
              section.dayItems.map(() => ""),
              formatPayrollGrossNetCell(section.weeklyGrossPay, section.weeklyNetPay, setting),
              "is-week-total",
            )}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderWeeklyPayrollRow(label, dayCells, totalCell, className = "") {
  return `
    <tr class="${className}">
      <th>${escapeHtml(label)}</th>
      ${dayCells.map((cell) => `<td>${cell || ""}</td>`).join("")}
      <td class="weekly-total-cell">${totalCell || ""}</td>
    </tr>
  `;
}

function getNetAmount(amount, setting) {
  const safeAmount = Math.round(Number(amount) || 0);
  if (!setting?.withholding) return safeAmount;
  return safeAmount - Math.floor(safeAmount * WITHHOLDING_RATE);
}

function formatPayrollAttendanceStatus(record) {
  if (!record) return "";
  if (record.status === "absent") return normalizeAbsenceType(record.absenceType) === "unexcused" ? "결근(무단)" : "결근(협의)";
  if (record.status === "late") return "지각";
  return "출근";
}

function getPayrollStatusClass(record) {
  if (!record) return "";
  if (record.status === "late") return "payroll-status--late";
  if (record.status === "absent") {
    return normalizeAbsenceType(record.absenceType) === "unexcused" ? "payroll-status--absent-unexcused" : "payroll-status--absent-approved";
  }
  return "payroll-status--present";
}

function summarizeWeekStatuses(records) {
  const counts = records.reduce(
    (result, record) => {
      if (record.status === "late") result.late += 1;
      else if (record.status === "absent" && normalizeAbsenceType(record.absenceType) === "unexcused") result.absentUnexcused += 1;
      else if (record.status === "absent") result.absentApproved += 1;
      else result.present += 1;
      return result;
    },
    { present: 0, late: 0, absentUnexcused: 0, absentApproved: 0 },
  );
  return [
    counts.present ? `출근 ${counts.present}` : "",
    counts.late ? `지각 ${counts.late}` : "",
    counts.absentUnexcused ? `결근(무단) ${counts.absentUnexcused}` : "",
    counts.absentApproved ? `결근(협의) ${counts.absentApproved}` : "",
  ]
    .filter(Boolean)
    .join(" / ") || "-";
}

function formatPayrollDateHeader(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey || "";
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} (${weekdays[date.getDay()]})`;
}

function formatPayrollWeekTitle(index) {
  const [, month] = String(state.selectedMonth || "").split("-").map(Number);
  return month ? `${month}월 ${index + 1}주차` : `${index + 1}주차`;
}

function formatPayrollDurationCell(minutes) {
  return minutes ? formatDurationText(minutes) : "";
}

function formatPayrollRateCell(rate) {
  return Number(rate) > 0 ? formatWon(rate) : "-";
}

function formatPayrollWonCell(value, showZero = false) {
  const amount = Math.round(Number(value) || 0);
  if (!showZero && amount === 0) return "";
  return formatWon(amount);
}

function formatPayrollGrossNetCell(grossPay, netPay, setting) {
  if (!setting?.withholding) return `<strong>${formatWon(grossPay)}</strong>`;
  return `<span class="payroll-money-stack"><strong>세전 ${formatWon(grossPay)}</strong><small>3.3% 후 ${formatWon(netPay)}</small></span>`;
}

function calculateWeeklyAllowanceMinutes(records) {
  const weekly = new Map();
  records.forEach((record) => {
    const key = getWeekKey(record.date);
    weekly.set(key, (weekly.get(key) || 0) + getRecordWorkMinutes(record));
  });
  let allowanceMinutes = 0;
  weekly.forEach((minutes) => {
    if (minutes >= 15 * 60) allowanceMinutes += Math.min(8 * 60, Math.round(minutes / 5));
  });
  return allowanceMinutes;
}

function getWeeklyAllowanceReviewFlags(records) {
  const weekly = new Map();
  records.forEach((record) => {
    const key = getWeekKey(record.date);
    if (!weekly.has(key)) weekly.set(key, { late: 0, unexcusedAbsence: 0 });
    const summary = weekly.get(key);
    if (record.status === "late") summary.late += 1;
    if (record.status === "absent" && normalizeAbsenceType(record.absenceType) === "unexcused") {
      summary.unexcusedAbsence += 1;
    }
  });

  return Array.from(weekly.entries())
    .filter(([, summary]) => summary.late >= 2 || summary.unexcusedAbsence > 0)
    .map(([weekKey, summary]) => {
      const reasons = [];
      if (summary.late >= 2) reasons.push(`지각 ${summary.late}회`);
      if (summary.unexcusedAbsence > 0) reasons.push(`무단 결근 ${summary.unexcusedAbsence}건`);
      return `${formatWeekLabel(weekKey)} ${reasons.join(", ")}`;
    });
}

function getRecordWorkMinutes(record) {
  const minutes = minutesBetween(record.actualStart, record.actualEnd);
  if (minutes === null) return 0;
  return Math.max(0, minutes - normalizeBreakMinutes(record.breakMinutes));
}

function formatAttendanceRecordStatus(record) {
  return formatPayrollAttendanceStatus(record);
}

function isAttendanceRecordConfirmed(record) {
  if (!record) return false;
  if (isAttendanceWorkStatus(record.status)) return hasEmployeeSignature(record) && hasManagerSignature(record);
  return hasEmployeeSignature(record);
}

function formatAttendanceRecordNote(record, confirmText = "") {
  const notes = [];
  if (record?.adjustmentReason) notes.push(record.adjustmentReason);
  if (record?.status === "absent") notes.push(attendanceAbsenceTypeLabel(record.absenceType));
  if (record?.status !== "absent" && confirmText === "대기") notes.push("매니저 확인 필요");
  return notes.join(" / ");
}

function printPayslips(staffIds) {
  const payrolls = calculatePayrolls().filter((payroll) => staffIds.includes(payroll.staff.id));
  if (!payrolls.length) {
    alert("출력할 급여명세서가 없습니다.");
    return;
  }
  els.printArea.innerHTML = payrolls.map(renderPayslip).join("");
  requestAnimationFrame(() => window.print());
}

function printAttendanceSheets(staffIds) {
  const payrolls = calculatePayrolls().filter((payroll) => staffIds.includes(payroll.staff.id));
  if (!payrolls.length) {
    alert("출력할 근퇴기록 확인서가 없습니다.");
    return;
  }
  els.printArea.innerHTML = payrolls.map(renderAttendanceSheet).join("");
  requestAnimationFrame(() => window.print());
}

function printSamplePayslip() {
  const samplePayroll = makeSamplePayroll();
  els.printArea.innerHTML = renderPayslip(samplePayroll);
  requestAnimationFrame(() => window.print());
}

function printSampleAttendanceSheet() {
  els.printArea.innerHTML = renderAttendanceSheet(makeSamplePayroll());
  requestAnimationFrame(() => window.print());
}

function makeSamplePayroll() {
  const samplePayroll = {
    staff: { id: "sample-staff", name: "김대완" },
    setting: { withholding: true, weeklyAllowance: true },
    hourlyRate: 12000,
    records: [
      {
        date: `${state.selectedMonth}-03`,
        status: "present",
        absenceType: "",
        scheduledStart: "10:00",
        scheduledEnd: "18:30",
        actualStart: "10:00",
        actualEnd: "18:30",
        breakMinutes: 60,
        employeeSignature: "sample",
        managerSignature: "sample",
        adjustmentReason: "",
      },
      {
        date: `${state.selectedMonth}-04`,
        status: "late",
        absenceType: "",
        scheduledStart: "11:30",
        scheduledEnd: "20:30",
        actualStart: "12:00",
        actualEnd: "21:00",
        breakMinutes: 60,
        employeeSignature: "sample",
        managerSignature: "sample",
        adjustmentReason: "피크타임 연장",
      },
      {
        date: `${state.selectedMonth}-05`,
        status: "late",
        absenceType: "",
        scheduledStart: "10:00",
        scheduledEnd: "18:30",
        actualStart: "10:30",
        actualEnd: "18:30",
        breakMinutes: 60,
        employeeSignature: "sample",
        managerSignature: "sample",
        adjustmentReason: "",
      },
      {
        date: `${state.selectedMonth}-10`,
        status: "absent",
        absenceType: "unexcused",
        actualStart: "",
        actualEnd: "",
        breakMinutes: 0,
        employeeSignature: "sample",
        managerSignature: "",
        adjustmentReason: "개인 사정",
      },
    ],
    presentRecords: [],
    lateRecords: [],
    absentRecords: [],
    unexcusedAbsenceRecords: [],
    weeklyAllowanceReviewFlags: [],
    weeklyPayrollSections: [],
    workMinutes: 0,
    breakMinutes: 0,
    weeklyAllowanceMinutes: 0,
    basePay: 0,
    weeklyAllowancePay: 0,
    grossPay: 0,
    withholdingAmount: 0,
    netPay: 0,
    unconfirmedCount: 0,
  };
  samplePayroll.presentRecords = samplePayroll.records.filter((record) => isAttendanceWorkStatus(record.status));
  samplePayroll.lateRecords = samplePayroll.records.filter((record) => record.status === "late");
  samplePayroll.absentRecords = samplePayroll.records.filter((record) => record.status === "absent");
  samplePayroll.unexcusedAbsenceRecords = samplePayroll.absentRecords.filter((record) => normalizeAbsenceType(record.absenceType) === "unexcused");
  samplePayroll.weeklyAllowanceReviewFlags = getWeeklyAllowanceReviewFlags(samplePayroll.records);
  samplePayroll.workMinutes = samplePayroll.presentRecords.reduce((sum, record) => sum + getRecordWorkMinutes(record), 0);
  samplePayroll.breakMinutes = samplePayroll.presentRecords.reduce((sum, record) => sum + normalizeBreakMinutes(record.breakMinutes), 0);
  samplePayroll.weeklyPayrollSections = buildWeeklyPayrollSections(samplePayroll.records, samplePayroll.setting, samplePayroll.hourlyRate);
  samplePayroll.weeklyAllowanceMinutes = samplePayroll.weeklyPayrollSections.reduce((sum, section) => sum + section.weeklyAllowanceMinutes, 0);
  samplePayroll.basePay = Math.round((samplePayroll.workMinutes / 60) * samplePayroll.hourlyRate);
  samplePayroll.weeklyAllowancePay = samplePayroll.weeklyPayrollSections.reduce((sum, section) => sum + section.weeklyAllowancePay, 0);
  samplePayroll.grossPay = samplePayroll.basePay + samplePayroll.weeklyAllowancePay;
  samplePayroll.withholdingAmount = Math.floor(samplePayroll.grossPay * WITHHOLDING_RATE);
  samplePayroll.netPay = samplePayroll.grossPay - samplePayroll.withholdingAmount;
  return samplePayroll;
}

function renderPayslip(payroll) {
  return `
    <article class="payslip">
      <header class="payslip-header">
        <div>
          <div class="payslip-title">급여명세서</div>
          <p>Milk Village</p>
        </div>
        <div>
          <p><strong>정산월</strong> ${formatMonthLabel(state.selectedMonth)}</p>
          <p><strong>발행일</strong> ${formatDateKey(new Date())}</p>
        </div>
      </header>
      <table class="payslip-table">
        <tbody>
          <tr><th>근무자</th><td>${escapeHtml(payroll.staff.name)}</td><th>시급</th><td>${formatWon(payroll.hourlyRate)}</td></tr>
          <tr><th>총 근무시간</th><td>${formatDurationText(payroll.workMinutes)}</td><th>총 휴게시간</th><td>${formatDurationText(payroll.breakMinutes)}</td></tr>
          <tr><th>근무일수</th><td>${payroll.presentRecords.length}일</td><th>지각/결근</th><td>${payroll.lateRecords.length}건 / ${payroll.absentRecords.length}건</td></tr>
        </tbody>
      </table>
      <table class="payslip-table">
        <thead>
          <tr><th>항목</th><th>금액</th><th>비고</th></tr>
        </thead>
        <tbody>
          <tr><td>기본급</td><td>${formatWon(payroll.basePay)}</td><td>${formatDurationText(payroll.workMinutes)} x ${formatWon(payroll.hourlyRate)}</td></tr>
          <tr><td>주휴수당</td><td>${formatWon(payroll.weeklyAllowancePay)}</td><td>${formatDurationText(payroll.weeklyAllowanceMinutes)} 기준</td></tr>
          <tr><td>총 지급액</td><td>${formatWon(payroll.grossPay)}</td><td>기본급 + 주휴수당</td></tr>
          <tr><td>3.3% 공제</td><td>-${formatWon(payroll.withholdingAmount)}</td><td>${payroll.setting.withholding ? "적용" : "미적용"}</td></tr>
        </tbody>
      </table>
      <div class="payslip-total">실지급액 ${formatWon(payroll.netPay)}</div>
      ${payroll.weeklyAllowanceReviewFlags.length ? `<p class="notice">주휴수당 제외 검토: ${payroll.weeklyAllowanceReviewFlags.map(escapeHtml).join(" / ")}</p>` : ""}
      ${renderWeeklyPayrollTable(payroll)}
      <h3>근퇴기록 상세</h3>
      <table class="payslip-table">
        <thead>
          <tr><th>날짜</th><th>구분</th><th>시간</th><th>휴게</th><th>근무시간</th><th>확인</th></tr>
        </thead>
        <tbody>
          ${
            payroll.records.length
              ? payroll.records
                  .map(
                    (record) => `
                      <tr>
                        <td>${escapeHtml(record.date)}</td>
                        <td>${escapeHtml(formatAttendanceRecordStatus(record))}</td>
                        <td>${isAttendanceWorkStatus(record.status) ? `${record.actualStart || "--:--"}~${record.actualEnd || "--:--"}` : "-"}</td>
                        <td>${formatBreakDuration(record.breakMinutes)}</td>
                        <td>${isAttendanceWorkStatus(record.status) ? formatDurationText(getRecordWorkMinutes(record)) : "0분"}</td>
                        <td>${isAttendanceRecordConfirmed(record) ? "완료" : "대기"}</td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="6">해당 월 근퇴기록 없음</td></tr>`
          }
        </tbody>
      </table>
      <p>주휴수당은 월 내 근퇴기록 기준의 예상 계산이며, 지각/무단 결근 등 제외 검토 사유는 대표가 지급 전 최종 확인해주세요.</p>
    </article>
  `;
}

function renderAttendanceSheet(payroll) {
  return `
    <article class="payslip attendance-sheet">
      <header class="payslip-header">
        <div>
          <div class="payslip-title">근퇴기록 확인서</div>
          <p>Milk Village</p>
        </div>
        <div>
          <p><strong>확인월</strong> ${formatMonthLabel(state.selectedMonth)}</p>
          <p><strong>발행일</strong> ${formatDateKey(new Date())}</p>
        </div>
      </header>

      <section class="attendance-print-summary">
        <div><span>근무자</span><strong>${escapeHtml(payroll.staff.name)}</strong></div>
        <div><span>근무일</span><strong>${payroll.presentRecords.length}일</strong></div>
        <div><span>지각</span><strong>${payroll.lateRecords.length}건</strong></div>
        <div><span>결근</span><strong>${payroll.absentRecords.length}건</strong></div>
        <div><span>무단결근</span><strong>${payroll.unexcusedAbsenceRecords.length}건</strong></div>
        <div><span>총 근무시간</span><strong>${formatDurationText(payroll.workMinutes)}</strong></div>
        <div><span>총 휴게시간</span><strong>${formatDurationText(payroll.breakMinutes)}</strong></div>
        <div><span>확인 대기</span><strong>${payroll.unconfirmedCount}건</strong></div>
        <div><span>주휴 검토</span><strong>${payroll.weeklyAllowanceReviewFlags.length}건</strong></div>
      </section>

      <div class="attendance-confirm-note">
        <strong>직원 확인용</strong>
        <span>아래 출퇴근 기록이 실제 근무와 다르면 대표에게 수정사항을 알려주세요.</span>
      </div>

      <table class="payslip-table attendance-print-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>구분</th>
            <th>출근</th>
            <th>퇴근</th>
            <th>휴게</th>
            <th>인정 근무</th>
            <th>확인</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          ${
            payroll.records.length
              ? payroll.records.map(renderAttendanceSheetRow).join("")
              : `<tr><td colspan="8">해당 월 근퇴기록 없음</td></tr>`
          }
        </tbody>
      </table>

      <section class="attendance-reply-box">
        <div>□ 위 기록이 맞습니다.</div>
        <div>□ 수정이 필요합니다. 수정 날짜/내용: ________________________________</div>
      </section>
    </article>
  `;
}

function renderAttendanceSheetRow(record) {
  const isWorkRecord = isAttendanceWorkStatus(record.status);
  const confirmText = isAttendanceRecordConfirmed(record) ? "완료" : "대기";
  const note = formatAttendanceRecordNote(record, confirmText);
  return `
    <tr class="${isWorkRecord ? "" : "is-absent-row"}">
      <td>${escapeHtml(formatAttendanceDateLabel(record.date))}</td>
      <td>${escapeHtml(formatAttendanceRecordStatus(record))}</td>
      <td>${isWorkRecord ? escapeHtml(record.actualStart || "--:--") : "-"}</td>
      <td>${isWorkRecord ? escapeHtml(record.actualEnd || "--:--") : "-"}</td>
      <td>${formatBreakDuration(record.breakMinutes)}</td>
      <td>${isWorkRecord ? formatDurationText(getRecordWorkMinutes(record)) : "0분"}</td>
      <td>${confirmText}</td>
      <td>${escapeHtml(note)}</td>
    </tr>
  `;
}

function getStaffSetting(staffId) {
  if (!state.settings.staffSettings[staffId]) {
    state.settings.staffSettings[staffId] = { hourlyRate: "", weeklyAllowance: true, withholding: true };
  }
  return state.settings.staffSettings[staffId];
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

function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesBetween(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return null;
  return end >= start ? end - start : end + 24 * 60 - start;
}

function normalizeBreakMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const rounded = Math.round(minutes / 30) * 30;
  return Math.min(180, Math.max(0, rounded));
}

function getWeekKey(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey || "";
  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);
  return formatDateKey(date);
}

function getWeekDateKeys(weekKey) {
  const startDate = parseDateKey(weekKey);
  if (!startDate) return [];
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return formatDateKey(date);
  });
}

function formatWeekLabel(weekKey) {
  const startDate = parseDateKey(weekKey);
  if (!startDate) return weekKey || "";
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  return `${formatAttendanceDateLabel(formatDateKey(startDate))}~${formatAttendanceDateLabel(formatDateKey(endDate))}`;
}

function parseDateKey(dateKey) {
  const [year, month, date] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !date) return null;
  return new Date(year, month - 1, date);
}

function currentMonthKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso || "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey || "";
  return `${year}년 ${month}월`;
}

function formatAttendanceDateLabel(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey || "";
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} (${weekdays[date.getDay()]})`;
}

function formatDurationText(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (hours && remainingMinutes) return `${hours}시간 ${remainingMinutes}분`;
  if (hours) return `${hours}시간`;
  return `${remainingMinutes}분`;
}

function formatBreakDuration(minutes) {
  return formatDurationText(normalizeBreakMinutes(minutes));
}

function formatWon(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

els.setupButton.addEventListener("click", setupOwnerPin);
els.loginButton.addEventListener("click", login);
els.loginPin.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
els.lockButton.addEventListener("click", lock);
els.samplePrintButton.addEventListener("click", printSamplePayslip);
els.sampleAttendancePrintButton.addEventListener("click", printSampleAttendanceSheet);
els.refreshButton.addEventListener("click", fetchRemoteState);
els.printAllButton.addEventListener("click", () => printPayslips(state.staffMembers.map((staff) => staff.id)));
els.printAllAttendanceButton.addEventListener("click", () => printAttendanceSheets(state.staffMembers.map((staff) => staff.id)));
els.payrollMonth.addEventListener("change", render);
["pointerdown", "keydown", "touchstart"].forEach((eventName) => document.addEventListener(eventName, keepUnlocked, { capture: true }));
setInterval(expireIfNeeded, 30 * 1000);

bootstrap();
