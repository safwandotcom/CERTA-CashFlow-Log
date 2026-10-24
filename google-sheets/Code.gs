/**
 * CERTA& Advisory CashFlow Log → Google Sheet sync.
 *
 * Paste into the spreadsheet's Extensions → Apps Script, then use the
 * "CashFlow Log" menu: Set up sync → Turn on auto-sync. See README.
 *
 * Pulls everything from Supabase (ledger_export) and rewrites ONLY the three
 * tabs named below. Other tabs in the spreadsheet are never touched.
 */

const TABS = {
  receipts: "Ledger – Money received",
  expenses: "Ledger – Expenses",
  summary: "Ledger – Summary",
};
const SYNC_EVERY_MINUTES = 5; // Apps Script allows 1, 5, 10, 15 or 30
const TZ = "Asia/Dhaka";

// ৳ with Indian digit grouping: ৳1,23,456 / ৳1,23,45,678
const BDT = '[>=10000000]"৳"##\\,##\\,##\\,##0;[>=100000]"৳"##\\,##\\,##0;"৳"#,##0';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CashFlow Log")
    .addItem("Sync now", "syncNow")
    .addSeparator()
    .addItem("Set up sync…", "setUp")
    .addItem(`Turn on auto-sync (every ${SYNC_EVERY_MINUTES} min)`, "turnOnAutoSync")
    .addItem("Turn off auto-sync", "turnOffAutoSync")
    .addToUi();
}

function setUp() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ask = (title, prompt, key) => {
    const r = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error("Set-up cancelled.");
    const v = r.getResponseText().trim();
    if (v) props.setProperty(key, v);
    return v;
  };
  ask("1 of 3 · Supabase URL", "Supabase → Project Settings → API → Project URL\n(e.g. https://abcd.supabase.co)", "SUPABASE_URL");
  ask("2 of 3 · Supabase publishable key", "Supabase → Project Settings → API Keys → Publishable key (starts with sb_publishable_)", "SUPABASE_ANON_KEY");
  ask("3 of 3 · Export key", "Run  select create_export_key();  in the Supabase SQL editor and paste the result.", "EXPORT_KEY");
  syncNow();
  ui.alert("Sync is set up. Now choose CashFlow Log → Turn on auto-sync.");
}

function turnOnAutoSync() {
  turnOffAutoSync();
  ScriptApp.newTrigger("syncLedger").timeBased().everyMinutes(SYNC_EVERY_MINUTES).create();
  syncLedger();
  SpreadsheetApp.getUi().alert(`Auto-sync is on. The Ledger tabs refresh every ${SYNC_EVERY_MINUTES} minutes, even when the sheet is closed.`);
}

function turnOffAutoSync() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "syncLedger")
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

function syncNow() {
  syncLedger();
  SpreadsheetApp.getActive().toast("Ledger tabs updated.", "CashFlow Log", 4);
}

/** Entry point for the timer. Safe to run any time; overlapping runs are skipped. */
function syncLedger() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    const data = fetchLedger_();
    writeReceipts_(data.receipts);
    writeExpenses_(data.expenses);
    writeSummary_(data, null);
  } catch (err) {
    writeSummary_(null, err);
    throw err; // also shows in Apps Script → Executions, and Google emails the owner on repeated failures
  } finally {
    lock.releaseLock();
  }
}

function fetchLedger_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty("SUPABASE_URL");
  const anon = p.getProperty("SUPABASE_ANON_KEY");
  const key = p.getProperty("EXPORT_KEY");
  if (!url || !anon || !key) throw new Error("Sync isn't set up. Choose CashFlow Log → Set up sync.");

  const res = UrlFetchApp.fetch(url.replace(/\/+$/, "") + "/rest/v1/rpc/ledger_export", {
    method: "post",
    contentType: "application/json",
    // Publishable keys (sb_publishable_…) go in the apikey header only. Legacy anon JWTs also need Authorization.
    headers: /^eyJ/.test(anon) ? { apikey: anon, Authorization: "Bearer " + anon } : { apikey: anon },
    payload: JSON.stringify({ key: key }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    const body = res.getContentText();
    if (/Invalid export key/.test(body)) throw new Error("The export key was rejected. Create a new one and run Set up sync again.");
    throw new Error(`Supabase returned ${code}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(res.getContentText());
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// Plain dates are set at local noon so a time-zone difference between the script and the sheet can't shift the day.
const toDate_ = (s) => {
  if (!s) return "";
  if (s.length === 10) return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  return new Date(s);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel_ = (ym) => MONTHS[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);

/** Rewrites a tab: bold frozen header, data, BDT columns formatted. */
function writeTable_(name, header, rows, moneyCols, dateCols, stampCols) {
  const sh = sheet_(name);
  sh.clear();
  const values = [header].concat(rows);
  sh.getRange(1, 1, values.length, header.length).setValues(values);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#f6f4ef");
  sh.setFrozenRows(1);
  if (rows.length) {
    moneyCols.forEach((c) => sh.getRange(2, c, rows.length, 1).setNumberFormat(BDT));
    dateCols.forEach((c) => sh.getRange(2, c, rows.length, 1).setNumberFormat("d mmm yyyy"));
    stampCols.forEach((c) => sh.getRange(2, c, rows.length, 1).setNumberFormat("d mmm yyyy h:mm am/pm"));
  }
  sh.autoResizeColumns(1, header.length);
  return sh;
}

function writeReceipts_(rows) {
  writeTable_(
    TABS.receipts,
    ["Date received", "Sent by", "Received by", "Amount", "Spent", "Left", "Note", "Entered by", "Entered at", "ID"],
    rows.map((r) => [toDate_(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7] || "", toDate_(r[8]), r[9]]),
    [4, 5, 6],
    [1],
    [9],
  );
}

function writeExpenses_(rows) {
  writeTable_(
    TABS.expenses,
    ["Date paid", "Type", "Paid by", "Category", "Amount", "Paid from", "Note", "Entered by", "Entered at", "ID"],
    rows.map((r) => [toDate_(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7] || "", toDate_(r[8]), r[9]]),
    [5],
    [1],
    [9],
  );
}

/** Summary tab: last-synced line, totals, partners, categories, months. */
function writeSummary_(data, err) {
  const sh = sheet_(TABS.summary);
  const stamp = Utilities.formatDate(new Date(), TZ, "d MMM yyyy, h:mm a");

  if (err) {
    // Keep the last good numbers; just flag the failure at the top.
    sh.getRange("A1").setValue(`Last sync FAILED at ${stamp} (Dhaka): ${err.message}`).setFontColor("#a3312b").setFontWeight("bold");
    return;
  }

  sh.clear();
  const blocks = [];
  const put = (rows, money) => blocks.push({ rows, money });

  put([[`Last synced ${stamp} (Dhaka) · refreshes every ${SYNC_EVERY_MINUTES} min · edits here are overwritten`]], []);
  put([["Totals", ""], ["Money received", data.totals.received], ["Spent from it", data.totals.spent], ["Left in hand", data.totals.left], ["Paid by partners", data.totals.direct]], [2]);
  put(
    [["Partner", "Money sent", "Paid directly", "Total contributed", "Spent from money received", "Still holding"]].concat(
      data.partners.map((p) => [p[0], p[1], p[2], p[3], p[4] === null ? "" : p[4], p[5] === null ? "" : p[5]]),
    ),
    [2, 3, 4, 5, 6],
  );
  put([["Category", "Amount"]].concat(data.categories.length ? data.categories : [["No expenses yet", ""]]), [2]);
  put(
    [["Month", "Received", "Spent", "Paid by partners"]].concat(
      data.months.map((m) => [monthLabel_(m[0]), m[1], m[2], m[3]]),
    ),
    [2, 3, 4],
  );

  let row = 1;
  blocks.forEach((b, i) => {
    const width = Math.max.apply(null, b.rows.map((r) => r.length));
    const rows = b.rows.map((r) => r.concat(Array(width - r.length).fill("")));
    sh.getRange(row, 1, rows.length, width).setValues(rows);
    if (i === 0) sh.getRange(row, 1).setFontColor("#66706b");
    else sh.getRange(row, 1, 1, width).setFontWeight("bold").setBackground("#f6f4ef");
    if (rows.length > 1) b.money.forEach((c) => sh.getRange(row + 1, c, rows.length - 1, 1).setNumberFormat(BDT));
    row += rows.length + 1;
  });
  sh.autoResizeColumns(1, 6);
}
