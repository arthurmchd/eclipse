// Persistent storage. Passwords and API keys are encrypted with Electron's
// safeStorage, which on Windows uses DPAPI: only this Windows user can decrypt them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const DEFAULT_SETTINGS = {
  riotApiKey: null,        // encrypted
  riotTftApiKey: null,     // encrypted, optional (TFT personal keys are separate)
  henrikApiKey: null,      // encrypted
  refreshMinutes: 30,
  minimizeOnLaunch: true,
  hideRiotClient: true,
  closeRiotClient: true,
  streamerMode: false,
  riotClientPath: '',      // empty = auto-detect
};

// Back up user edits, without creating another backup for every rank refresh
// or launch timestamp. Passwords and API keys remain encrypted in the snapshot.
const BACKUP_ACCOUNT_FIELDS = [
  'id', 'createdAt', 'gameName', 'tagLine', 'region', 'valRegion',
  'username', 'password', 'note', 'lastSeason', 'ban', 'pinned',
];

function encrypt(text) {
  if (!text) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available');
  return safeStorage.encryptString(text).toString('base64');
}

// Names copied from the Riot Client carry invisible direction marks (U+2066…2069)
// and similar characters that make every API lookup fail.
const cleanName = (s) => (s || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();

function decrypt(blob) {
  if (!blob) return '';
  return safeStorage.decryptString(Buffer.from(blob, 'base64'));
}

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'data.json');
    this.sessionsDir = path.join(this.dir, 'sessions');
    this.backupsDir = path.join(this.dir, 'backups');
    this.data = this.load();
    this.savedSnapshot = this.backupSnapshot();
    this.log(`opened with ${this.data.accounts.length} accounts`);
    if (this.data.accounts.length && !this.listBackups().length) this.backup(JSON.stringify(this.data, null, 2));
  }

  // Data events (never credentials) go to data.log, to explain any lost account.
  log(line) {
    try {
      const file = path.join(this.dir, 'data.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {}
  }

  backupSnapshot() {
    return JSON.stringify({
      accounts: this.data.accounts.map((acc) => Object.fromEntries(BACKUP_ACCOUNT_FIELDS.map((key) => [key, acc[key]]))),
      settings: this.data.settings,
    });
  }

  parse(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of raw.accounts || []) {
      a.gameName = cleanName(a.gameName);
      a.tagLine = cleanName(a.tagLine);
    }
    return {
      accounts: raw.accounts || [],
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      lastRefresh: raw.lastRefresh || null,
      currentAccountId: raw.currentAccountId || null,
    };
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupsDir).filter((f) => /^data-.*\.json$/.test(f)).sort().reverse();
    } catch {
      return [];
    }
  }

  load() {
    try {
      return this.parse(this.file);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep the unreadable file instead of silently overwriting it.
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.log(`data.json unreadable (${err.message}), kept a copy`);
      }
      for (const name of this.listBackups()) {
        try {
          const data = this.parse(path.join(this.backupsDir, name));
          this.log(`restored ${data.accounts.length} accounts from backup ${name}`);
          return data;
        } catch {}
      }
      return { accounts: [], settings: { ...DEFAULT_SETTINGS }, lastRefresh: null, currentAccountId: null };
    }
  }

  // A copy of the data each time an account or setting changes; keep the newest 30.
  backup(json) {
    try {
      fs.mkdirSync(this.backupsDir, { recursive: true });
      this.lastBackupTime = Math.max(Date.now(), (this.lastBackupTime || 0) + 1);
      const stamp = new Date(this.lastBackupTime).toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(this.backupsDir, `data-${stamp}-${crypto.randomUUID()}.json`), json);
      for (const old of this.listBackups().slice(30)) fs.rmSync(path.join(this.backupsDir, old), { force: true });
    } catch (err) {
      this.log(`backup failed: ${err.message}`);
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const json = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log(`save FAILED: ${err.message}`);
      throw err;
    }
    const snapshot = this.backupSnapshot();
    if (snapshot !== this.savedSnapshot) {
      this.log(`saved ${this.data.accounts.length} accounts`);
      this.backup(json);
      this.savedSnapshot = snapshot;
    }
  }

  // ---- accounts -------------------------------------------------------

  // What the renderer sees: never the password itself.
  publicAccount(acc) {
    const { password, ...rest } = acc;
    return { ...rest, hasPassword: Boolean(password), hasSession: this.hasSession(acc.id) };
  }

  listAccounts() {
    return this.data.accounts.map((a) => this.publicAccount(a));
  }

  getAccount(id) {
    return this.data.accounts.find((a) => a.id === id);
  }

  upsertAccount(input) {
    const existing = input.id ? this.getAccount(input.id) : null;
    const acc = existing || {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      stats: {},
      lastPlayed: null,
    };
    acc.gameName = cleanName(input.gameName);
    acc.tagLine = cleanName(input.tagLine).replace(/^#/, '');
    acc.region = input.region || 'br1';
    acc.valRegion = input.valRegion || '';
    const oldUsername = acc.username;
    acc.username = (input.username || '').trim();
    acc.note = input.note || '';
    acc.lastSeason = { lol: '', tft: '', ...(input.lastSeason || {}) };
    acc.ban = input.ban || null;
    // Empty password field on edit means "keep the current one".
    if (input.password) acc.password = encrypt(input.password);
    // A saved session belongs to one login; a new username or password means a new login.
    if (existing && (input.password || oldUsername !== acc.username)) this.forgetSession(acc.id);
    if (!existing) this.data.accounts.push(acc);
    this.save();
    return this.publicAccount(acc);
  }

  deleteAccount(id) {
    this.forgetSession(id);
    if (this.data.currentAccountId === id) this.data.currentAccountId = null;
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    this.save();
  }

  updateAccountFields(id, fields) {
    const acc = this.getAccount(id);
    if (!acc) return null;
    Object.assign(acc, fields);
    this.save();
    return this.publicAccount(acc);
  }

  getPassword(id) {
    const acc = this.getAccount(id);
    return acc ? decrypt(acc.password) : '';
  }

  // ---- saved Riot Client sessions --------------------------------------
  // A copy of the Riot Client's RiotGamesPrivateSettings.yaml taken while the
  // account was signed in with "Stay signed in", encrypted like the passwords.

  sessionFile(id) {
    // IDs are UUIDs today; keep older simple identifiers compatible. Reject
    // separators, dots and Windows path/stream syntax before touching the disk.
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
      throw new Error('Invalid account ID');
    }
    return path.join(this.sessionsDir, `${id}.bin`);
  }

  hasSession(id) {
    return fs.existsSync(this.sessionFile(id));
  }

  saveSession(id, yaml) {
    const file = this.sessionFile(id);
    if (!this.getAccount(id)) throw new Error('Account not found');
    if (typeof yaml !== 'string' || !yaml) throw new Error('Cannot save an empty session');
    const encrypted = Buffer.from(encrypt(yaml), 'base64');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
    } finally {
      // A failed replacement must leave the previous session usable.
      try { fs.rmSync(tmp, { force: true }); } catch {}
    }
  }

  loadSession(id) {
    try {
      return safeStorage.decryptString(fs.readFileSync(this.sessionFile(id)));
    } catch {
      return null;
    }
  }

  forgetSession(id) {
    const file = this.sessionFile(id);
    if (!this.getAccount(id)) throw new Error('Account not found');
    fs.rmSync(file, { force: true });
  }

  setCurrentAccount(id) {
    this.data.currentAccountId = id;
    this.save();
  }

  // ---- settings -------------------------------------------------------

  publicSettings() {
    const s = this.data.settings;
    const mask = (blob) => {
      let v = '';
      try {
        v = decrypt(blob);
      } catch (err) {
        // A key that cannot be decrypted must not stop the accounts from loading.
        this.log(`could not decrypt a saved API key: ${err.message}`);
        return blob ? '(unreadable, paste it again)' : '';
      }
      return v ? `${v.slice(0, 8)}…${v.slice(-4)}` : '';
    };
    return {
      refreshMinutes: s.refreshMinutes,
      minimizeOnLaunch: s.minimizeOnLaunch,
      hideRiotClient: s.hideRiotClient,
      closeRiotClient: s.closeRiotClient,
      streamerMode: s.streamerMode,
      riotClientPath: s.riotClientPath,
      riotApiKeyMasked: mask(s.riotApiKey),
      riotTftApiKeyMasked: mask(s.riotTftApiKey),
      henrikApiKeyMasked: mask(s.henrikApiKey),
    };
  }

  updateSettings(input) {
    const s = this.data.settings;
    for (const k of ['refreshMinutes', 'minimizeOnLaunch', 'hideRiotClient', 'closeRiotClient', 'streamerMode', 'riotClientPath']) {
      if (input[k] !== undefined) s[k] = input[k];
    }
    // Keys: undefined = untouched, '' = remove, anything else = replace.
    if (input.riotApiKey !== undefined) s.riotApiKey = encrypt(input.riotApiKey.trim());
    if (input.riotTftApiKey !== undefined) s.riotTftApiKey = encrypt(input.riotTftApiKey.trim());
    if (input.henrikApiKey !== undefined) s.henrikApiKey = encrypt(input.henrikApiKey.trim());
    this.save();
    return this.publicSettings();
  }

  getKeys() {
    return {
      riot: decrypt(this.data.settings.riotApiKey),
      tft: decrypt(this.data.settings.riotTftApiKey),
      henrik: decrypt(this.data.settings.henrikApiKey),
    };
  }
}

module.exports = { Store };
