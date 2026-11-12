// Alerts at the top of the app (no browser code, so tests run them in Node).
//   Bills that didn't reach the customer on WhatsApp: everyone at the counter sees them (to send the other way).
//   Backups to download before GitHub deletes them: the owner only (backup_status() in the database decides,
//   the same as the Telegram morning message).

const DAY = 86400000;

// The bills whose newest WhatsApp send failed, in the last 24 hours, not already dismissed on this device.
//   rows: wa_messages of kind 'bill'. Returns [{ bill_id, phone, error, at }], newest first.
export function failedBills(rows, { now = Date.now(), dismissed = [] } = {}) {
  const last = new Map();
  for (const r of rows || []) {
    if (!r.bill_id || (r.kind && r.kind !== 'bill')) continue;
    const prev = last.get(r.bill_id);
    if (!prev || String(r.created_at) > String(prev.created_at)) last.set(r.bill_id, r);
  }
  return [...last.values()]
    .filter((r) => r.status === 'failed' && now - new Date(r.updated_at || r.created_at).getTime() < DAY && !dismissed.includes(r.id))
    .sort((a, b) => (String(b.updated_at || b.created_at) > String(a.updated_at || a.created_at) ? 1 : -1))
    .map((r) => ({ id: r.id, bill_id: r.bill_id, phone: r.phone, error: r.error, at: r.updated_at || r.created_at }));
}

// New from the website (booking requests and questions) that this device hasn't shown yet: the popup.
//   bookings / enquiries: rows of the last day; seen: ids already shown. Returns [{ kind, id, row }], oldest first.
//   First time on a device (seen = null): nothing pops up; what is there now counts as seen.
export function newWebsiteItems({ bookings = [], enquiries = [] }, seen) {
  const all = [
    ...bookings.filter((b) => b.source === 'website' && b.status === 'requested').map((row) => ({ kind: 'booking', id: row.id, row })),
    ...enquiries.filter((e) => e.source === 'website' && e.status === 'new').map((row) => ({ kind: 'enquiry', id: row.id, row })),
  ].sort((a, b) => (String(a.row.created_at) < String(b.row.created_at) ? -1 : 1));
  if (!seen) return [];
  const s = new Set(seen);
  return all.filter((x) => !s.has(x.id));
}

const dayText = (ts) => new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });

// What the backup bar says, or null (nothing to do). b: backup_status() from the database.
//   { level: 'bad' | 'warn', text }
export function backupAlert(b) {
  if (!b || !b.latest) return null;
  if (b.stale) return { level: 'bad', text: `The nightly backup hasn't run since ${dayText(b.latest.made_at)}. Check GitHub → Actions → Daily database backup.` };
  if (b.urgent) return { level: 'bad', text: `Download a backup now: GitHub deletes the one of ${dayText(b.urgent.made_at)} on ${dayText(b.urgent.expires_at)}, and none was downloaded in 25 days.` };
  if (b.due) return { level: 'warn', text: b.last_download ? `Backup: last downloaded ${dayText(b.last_download)}. Download this week's copy and keep it on Google Drive.` : 'Backup: download a copy of the nightly backup and keep it on Google Drive.' };
  return null;
}
