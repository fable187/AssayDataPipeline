/**
 * The spreadsheet itself: tabs, menu, folders, triggers, API keys.
 */

var SHEETS = { tickets: 'Tickets', config: 'Config', transcripts: 'Transcripts', log: 'Log' };

var TICKET_HEADERS = [
  'Ticket', 'Received', 'Status', 'Urgency', 'Owner', 'Matter type', 'Caller', 'Phone', 'Email',
  'About', 'Relationship', 'What they want', 'Summary', 'Next action', 'Urgency reason',
  'Key facts', 'Dates', 'Documents', 'Heard from', 'Consent', 'Email draft', 'Confirmed',
  'Last activity', 'Last reminded', 'Audio file', 'File ID', 'Transcript ID'
];

var STATUSES = ['Transcribing', 'New', 'Needs review', 'In progress', 'Waiting on client',
  'Closed', 'Blocked', 'Error'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Intake Demo')
    .addItem('Process inbox now', 'processInbox')
    .addItem('Send stall reminders now', 'sendStallReminders')
    .addSeparator()
    .addItem('Open the Inbox folder', 'showInboxLink')
    .addItem('Phone line setup', 'showPhoneLineSetup')
    .addItem('Set up (run once)', 'setup')
    .addItem('Set API keys', 'setApiKeys')
    .addItem('Reset demo data', 'resetDemo')
    .addToUi();
}

/** Staff edits count as activity, which is what the stall reminder (A6) measures. */
function onEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEETS.tickets || e.range.getRow() < 2) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var activityCol = headers.indexOf('Last activity') + 1;
  var remindedCol = headers.indexOf('Last reminded') + 1;
  var first = e.range.getColumn();
  var last = e.range.getLastColumn();
  // Editing the timestamps themselves (as QA does for S8) must not reset them.
  if ((first <= activityCol && last >= activityCol) || (first === remindedCol && last === remindedCol)) {
    return;
  }
  sheet.getRange(e.range.getRow(), activityCol, e.range.getNumRows(), 1).setValue(new Date());
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  var tickets = ensureSheet_(ss, SHEETS.tickets, TICKET_HEADERS);
  ensureSheet_(ss, SHEETS.transcripts, ['Ticket', 'Transcript']);
  ensureSheet_(ss, SHEETS.log, ['Time', 'Ticket', 'Audio file', 'Step', 'Detail']);
  ensureConfig_(ss);
  formatTickets_(tickets);
  var stray = ss.getSheetByName('Sheet1');
  if (stray && stray.getLastRow() === 0) ss.deleteSheet(stray);
  ss.setActiveSheet(tickets);

  var inbox = ensureFolders_();
  ensureTriggers_();

  var props = PropertiesService.getScriptProperties();
  var missing = ['ANTHROPIC_API_KEY', 'ASSEMBLYAI_API_KEY'].filter(function (k) {
    return !props.getProperty(k);
  });
  SpreadsheetApp.getUi().alert('Setup done.\n\n' +
    'Drop call recordings into the Drive folder "Intake Demo / Inbox":\n' + inbox.getUrl() + '\n\n' +
    'The inbox is checked every 5 minutes, or use Intake Demo > Process inbox now.' +
    (missing.length ? '\n\nStill needed: Intake Demo > Set API keys (' + missing.join(', ') + ').' : ''));
}

function setApiKeys() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  [['ANTHROPIC_API_KEY', 'Anthropic API key (starts sk-ant-)'],
    ['ASSEMBLYAI_API_KEY', 'AssemblyAI API key'],
    ['TWILIO_ACCOUNT_SID', 'Twilio Account SID (starts AC). Phone line only; blank to skip'],
    ['TWILIO_AUTH_TOKEN', 'Twilio Auth Token. Phone line only; blank to skip']].forEach(function (k) {
    var has = props.getProperty(k[0]) ? ' A key is already saved; leave blank to keep it.' : '';
    var res = ui.prompt(k[1], 'Paste the key.' + has, ui.ButtonSet.OK_CANCEL);
    var value = res.getResponseText().trim();
    if (res.getSelectedButton() === ui.Button.OK && value) props.setProperty(k[0], value);
  });
  ui.alert('Keys saved in this script\'s properties. They are not stored in the sheet.');
}

function showInboxLink() {
  var url = ensureFolders_().getUrl();
  var html = HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Drop recordings here:<br>' +
    '<a href="' + url + '" target="_blank">Intake Demo / Inbox</a></p>').setWidth(320).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'Inbox folder');
}

/** Clears tickets, transcripts and log, and puts processed recordings back in the Inbox. */
function resetDemo() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset demo data?', 'Deletes all tickets, transcripts and log rows, and moves processed ' +
      'recordings back to the Inbox. Blocked recordings were deleted and must be re-uploaded.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var ss = SpreadsheetApp.getActive();
  [SHEETS.tickets, SHEETS.transcripts, SHEETS.log].forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (s && s.getLastRow() > 1) s.deleteRows(2, s.getLastRow() - 1);
  });
  var inbox = folder_('FOLDER_INBOX');
  var files = folder_('FOLDER_PROCESSED').getFiles();
  while (files.hasNext()) files.next().moveTo(inbox);
}

// ---------- helpers ----------

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureConfig_(ss) {
  var sheet = ensureSheet_(ss, SHEETS.config, ['Setting', 'Value', 'What it means']);
  var existing = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues()
    .map(function (r) { return r[0]; });
  var rows = CONFIG_SPEC.filter(function (s) { return existing.indexOf(s.key) === -1; })
    .map(function (s) { return [s.key, s.value, s.meaning]; });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }
  sheet.getRange('B:B').setNumberFormat('@').setWrap(true);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 420);
  sheet.setColumnWidth(3, 420);
  sheet.getRange('C:C').setWrap(true);
}

function formatTickets_(sheet) {
  var col = function (name) { return TICKET_HEADERS.indexOf(name) + 1; };
  var rows = sheet.getMaxRows() - 1;
  sheet.getRange(2, col('Status'), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  sheet.getRange(2, col('Confirmed'), rows, 1).insertCheckboxes();
  ['Received', 'Last activity', 'Last reminded'].forEach(function (n) {
    sheet.getRange(2, col(n), rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });
  sheet.getRange(2, col('Phone'), rows, 1).setNumberFormat('@');
  sheet.hideColumns(col('File ID'), 2);

  var urgency = sheet.getRange(2, col('Urgency'), rows, 1);
  var status = sheet.getRange(2, col('Status'), rows, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Urgent')
      .setBackground('#f4c7c3').setFontColor('#a50e0e').setBold(true).setRanges([urgency]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('High')
      .setBackground('#fce8b2').setRanges([urgency]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Blocked')
      .setBackground('#e8eaed').setFontColor('#5f6368').setRanges([status]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Error')
      .setBackground('#f4c7c3').setRanges([status]).build()
  ]);
  ['Caller', 'What they want', 'Summary', 'Next action', 'Urgency reason', 'Key facts'].forEach(
    function (n) { sheet.setColumnWidth(col(n), n === 'Caller' ? 150 : 260); });
  sheet.setFrozenColumns(1);
}

function ensureFolders_() {
  var props = PropertiesService.getScriptProperties();
  var get = function (key) {
    var id = props.getProperty(key);
    if (!id) return null;
    try {
      var f = DriveApp.getFolderById(id);
      return f.isTrashed() ? null : f;
    } catch (e) {
      return null;
    }
  };
  var root = get('FOLDER_ROOT');
  if (!root) {
    root = DriveApp.createFolder('Intake Demo');
    props.setProperty('FOLDER_ROOT', root.getId());
  }
  var inbox = get('FOLDER_INBOX');
  if (!inbox) {
    inbox = root.createFolder('Inbox');
    props.setProperty('FOLDER_INBOX', inbox.getId());
  }
  if (!get('FOLDER_PROCESSED')) {
    props.setProperty('FOLDER_PROCESSED', root.createFolder('Processed').getId());
  }
  return inbox;
}

function folder_(key) {
  var id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) throw new Error('Folders are not set up. Run Intake Demo > Set up.');
  return DriveApp.getFolderById(id);
}

function ensureTriggers_() {
  var handlers = ['processInbox', 'sendStallReminders'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sendStallReminders').timeBased().atHour(8).everyDays(1).create();
}
