const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultEnvPath = path.join(repoRoot, ".env.local");
const statePath = path.join(__dirname, ".alarm-sound-sync-state.json");

loadEnvFile(defaultEnvPath);
loadEnvFile(path.join(process.env.APPDATA || "", "MilkVillage", "alarm-sound-sync.env"));

const config = {
  supabaseUrl: readRequiredEnv("SUPABASE_URL"),
  serviceRoleKey: readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  bucket: process.env.SUPABASE_STORAGE_BUCKET || "alarm-sounds",
  table: process.env.SUPABASE_STATE_TABLE || "milk_village_state",
  stateId: process.env.SUPABASE_STATE_ID || "main",
  soundFolder: process.env.SOUND_FOLDER || "C:\\milk village\\02_sound",
};

const publicBaseUrl = `${config.supabaseUrl}/storage/v1/object/public/${config.bucket}`;

main().catch((error) => {
  console.error(`[alarm-sync] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!fs.existsSync(config.soundFolder)) {
    throw new Error(`sound folder not found: ${config.soundFolder}`);
  }

  const files = (await fsp.readdir(config.soundFolder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "ko-KR"));

  if (!files.length) {
    console.log("[alarm-sync] mp3 file not found");
    return;
  }

  const state = await readJsonFile(statePath, {});
  const remote = await fetchRemoteState();
  const remoteData = remote.data;
  const alarmSounds = Array.isArray(remoteData.alarmSounds) ? remoteData.alarmSounds : [];
  const byFileName = new Map(alarmSounds.map((sound) => [String(sound.fileName || "").toLowerCase(), sound]));
  const now = new Date().toISOString();
  let changed = false;
  let uploaded = 0;

  for (const fileName of files) {
    const fullPath = path.join(config.soundFolder, fileName);
    const stat = await fsp.stat(fullPath);
    const fingerprint = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    const existing = byFileName.get(fileName.toLowerCase());
    const objectName = fileName;
    const publicUrl = `${publicBaseUrl}/${encodePathSegment(objectName)}?v=${Math.trunc(stat.mtimeMs)}`;

    if (state[fileName] !== fingerprint || !existing) {
      await uploadMp3(fullPath, objectName);
      state[fileName] = fingerprint;
      uploaded += 1;
    }

    const nextSound = {
      ...(existing || {}),
      id: existing?.id || makeSoundId(fileName),
      name: existing?.name || makeSoundName(fileName),
      fileName,
      url: publicUrl,
      voiceURI: "",
      lang: "ko-KR",
      rate: Number(existing?.rate || 0.92),
      pitch: Number(existing?.pitch || 1),
      volume: Number(existing?.volume || 1),
      isDefault: Boolean(existing?.isDefault),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (!existing) {
      alarmSounds.push(nextSound);
      byFileName.set(fileName.toLowerCase(), nextSound);
      changed = true;
      continue;
    }

    const previous = JSON.stringify({
      id: existing.id,
      name: existing.name,
      fileName: existing.fileName,
      url: existing.url,
      voiceURI: existing.voiceURI || "",
      lang: existing.lang || "ko-KR",
      rate: Number(existing.rate || 0.92),
      pitch: Number(existing.pitch || 1),
      volume: Number(existing.volume || 1),
      isDefault: Boolean(existing.isDefault),
    });
    const next = JSON.stringify({
      id: nextSound.id,
      name: nextSound.name,
      fileName: nextSound.fileName,
      url: nextSound.url,
      voiceURI: nextSound.voiceURI,
      lang: nextSound.lang,
      rate: nextSound.rate,
      pitch: nextSound.pitch,
      volume: nextSound.volume,
      isDefault: nextSound.isDefault,
    });

    if (previous !== next) {
      Object.assign(existing, nextSound);
      changed = true;
    }
  }

  if (changed) {
    remoteData.alarmSounds = alarmSounds.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko-KR"));
    remoteData.meta = { ...(remoteData.meta || {}), updatedAt: now };
    await updateRemoteState(remoteData, now);
  }

  await writeJsonFile(statePath, state);
  console.log(`[alarm-sync] checked ${files.length} mp3, uploaded ${uploaded}, app list ${changed ? "updated" : "unchanged"}`);
}

async function uploadMp3(fullPath, objectName) {
  const bytes = await fsp.readFile(fullPath);
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.bucket}/${encodePathSegment(objectName)}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`upload failed for ${objectName}: ${response.status} ${body}`);
  }
}

async function fetchRemoteState() {
  const url = `${config.supabaseUrl}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.stateId)}&select=data,updated_at`;
  const response = await fetch(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`remote state fetch failed: ${response.status} ${body}`);
  }
  const rows = await response.json();
  const row = rows[0];
  if (!row?.data) {
    throw new Error("remote app state not found. Open the app once first, then run sync again.");
  }
  return row;
}

async function updateRemoteState(data, updatedAt) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.stateId)}`, {
    method: "PATCH",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data,
      updated_at: updatedAt,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`remote state update failed: ${response.status} ${body}`);
  }
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

function makeSoundId(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const slug = baseName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `sound_${slug || hashString(baseName)}`;
}

function makeSoundName(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ").trim();
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}
