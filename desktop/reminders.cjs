'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_REMINDERS = 2000;
const DAY = 86_400_000;
const MAX_SNOOZED = 50;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateNotification(value) {
  if (!plainObject(value) || typeof value.title !== 'string' || !value.title.trim()) {
    throw new Error('提醒标题不能为空。');
  }
  if (value.title.length > 160 || (value.body != null && typeof value.body !== 'string') || (value.body || '').length > 1000) {
    throw new Error('提醒内容过长。');
  }
  return { title: value.title.trim(), body: value.body || '' };
}

function normalizeReminders(items, now = Date.now()) {
  if (!Array.isArray(items) || items.length > MAX_REMINDERS) {
    throw new Error(`最多可同步 ${MAX_REMINDERS} 条提醒。`);
  }
  const result = [];
  const keys = new Set();
  for (const value of items) {
    const notification = validateNotification(value);
    if (typeof value.id !== 'string' || !value.id || value.id.length > 200) throw new Error('提醒标识无效。');
    const at = typeof value.at === 'string' ? Date.parse(value.at) : value.at;
    if (!Number.isSafeInteger(at) || at < 0 || at > now + 5 * 366 * DAY) throw new Error('提醒时间无效。');
    const key = JSON.stringify([value.id, at]);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push({ id: value.id, ...notification, at });
  }
  return result.sort((a, b) => a.at - b.at);
}

function readJson(file, fallback, maxBytes = 4 * 1024 * 1024) {
  try {
    if (fs.statSync(file).size > maxBytes) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

class ReminderStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.notified = {};
    // One-off "remind me again" entries survive schedule syncs and restarts.
    this.snoozed = [];
    const saved = readJson(file, null);
    if (plainObject(saved)) {
      try { this.items = normalizeReminders(saved.items || []); } catch { /* Damaged schedule does not prevent launching. */ }
      try { this.snoozed = normalizeReminders(saved.snoozed || []).slice(-MAX_SNOOZED); } catch { /* ignore damaged snoozes */ }
      if (plainObject(saved.notified)) {
        this.notified = Object.fromEntries(Object.entries(saved.notified).filter(([key, at]) =>
          key.length < 450 && Number.isSafeInteger(at) && at > Date.now() - 90 * DAY));
      }
    }
  }

  persist() {
    writeJson(this.file, { version: 1, items: this.items, notified: this.notified, snoozed: this.snoozed });
  }

  sync(values, now = Date.now()) {
    const next = normalizeReminders(values, now);
    const previousItems = this.items;
    const previousNotified = this.notified;
    this.items = next;
    // Retain delivery history even when the renderer temporarily sends a smaller list.
    this.notified = Object.fromEntries(Object.entries(this.notified).filter(([, at]) => at > now - 90 * DAY));
    try { this.persist(); } catch (error) {
      this.items = previousItems;
      this.notified = previousNotified;
      throw error;
    }
    return this.items.length;
  }

  snooze(item, at, now = Date.now()) {
    const [entry] = normalizeReminders([{ id: `${String(item?.id ?? '').slice(0, 180)}#snooze`, title: item?.title, body: item?.body || '', at }], now);
    if (entry.at <= now) throw new Error('稍后提醒的时间必须晚于现在。');
    const previous = this.snoozed;
    this.snoozed = [...previous.filter(value => value.id !== entry.id), entry].slice(-MAX_SNOOZED);
    try { this.persist(); } catch (error) { this.snoozed = previous; throw error; }
    return entry;
  }

  takeDue(now = Date.now(), limit = 5) {
    const due = [];
    const previous = { ...this.notified };
    const previousSnoozed = this.snoozed;
    let changed = false;
    for (const item of [...this.items, ...this.snoozed]) {
      const key = JSON.stringify([item.id, item.at]);
      if (item.at > now || this.notified[key] !== undefined) continue;
      // Do not flood the desktop with weeks-old notifications after a long shutdown.
      if (now - item.at > DAY) {
        this.notified[key] = now;
        changed = true;
        continue;
      }
      if (due.length >= limit) continue;
      this.notified[key] = now;
      changed = true;
      due.push({ ...item, late: now - item.at > 60_000 });
    }
    const pendingSnoozed = this.snoozed.filter(item => this.notified[JSON.stringify([item.id, item.at])] === undefined);
    if (pendingSnoozed.length !== this.snoozed.length) { this.snoozed = pendingSnoozed; changed = true; }
    // Save before showing notifications: a restarted renderer must not replay them.
    if (changed) {
      try { this.persist(); } catch (error) { this.notified = previous; this.snoozed = previousSnoozed; throw error; }
    }
    return due;
  }
}

module.exports = { ReminderStore, normalizeReminders, validateNotification, readJson, writeJson };
