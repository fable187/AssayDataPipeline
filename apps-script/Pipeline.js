/**
 * Recording in the Inbox -> transcript -> consent check -> AI intake record -> triaged ticket.
 * Each ticket moves: Transcribing -> New / Needs review / Blocked / Error.
 */

var AUDIO_FILE = /\.(wav|mp3|m4a|mp4|ogg|webm|flac|aac)$/i;

/** Runs every 5 minutes, and from the menu. Safe to run twice at once: the lock stops overlap. */
function processInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var cfg = loadConfig_();
    submitNewFiles_();
    // Apps Script stops a run at 6 minutes; anything still transcribing is picked up next run.
    var deadline = Date.now() + 4.5 * 60 * 1000;
    while (finishTranscripts_(cfg) > 0 && Date.now() < deadline) Utilities.sleep(5000);
  } finally {
    lock.releaseLock();
  }
}

function submitNewFiles_() {
  var known = {};
  readTickets_().forEach(function (t) { known[t['File ID']] = true; });
  var files = folder_('FOLDER_INBOX').getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (known[file.getId()] || !AUDIO_FILE.test(file.getName())) continue;
    var now = new Date();
    var ticket = nextTicketId_();
    var row = appendTicket_({
      Ticket: ticket, Received: now, Status: 'Transcribing', 'Audio file': file.getName(),
      'File ID': file.getId(), 'Last activity': now
    });
    try {
      writeTicket_(row, { 'Transcript ID': assemblyStart_(file.getBlob()) });
      log_(ticket, file.getName(), 'Transcription', 'Started');
    } catch (e) {
      fail_(row, ticket, file.getName(), e);
    }
  }
}

/** Returns how many transcripts are still in progress. */
function finishTranscripts_(cfg) {
  var pending = 0;
  readTickets_().forEach(function (t) {
    if (t.Status !== 'Transcribing' || !t['Transcript ID']) return;
    try {
      var tr = assemblyGet_(t['Transcript ID']);
      if (tr.status === 'error') throw new Error('Transcription failed: ' + tr.error);
      if (tr.status !== 'completed') {
        pending++;
        return;
      }
      handleTranscript_(t, tr, cfg);
    } catch (e) {
      fail_(t._row, t.Ticket, t['Audio file'], e);
      try { assemblyDelete_(t['Transcript ID']); } catch (ignored) { /* best effort */ }
    }
  });
  return pending;
}

function handleTranscript_(t, tr, cfg) {
  var utterances = (tr.utterances || []).map(function (u) {
    return { speaker: u.speaker, text: u.text, start: u.start };
  });
  var consent = checkConsent(utterances, cfg);
  var now = new Date();

  if (!consent.ok) {
    // A7: no AI, nothing kept. Only the time, file name and reason stay on the ticket.
    assemblyDelete_(t['Transcript ID']);
    Drive.Files.remove(t['File ID']);
    var blocked = route('Normal', true, cfg);
    writeTicket_(t._row, {
      Status: 'Blocked', Consent: consent.reason, Owner: blocked.owner, 'Email draft': 'None',
      'Next action': 'Call the person back. Do not record the call.', 'Last activity': now,
      'Transcript ID': ''
    });
    log_(t.Ticket, t['Audio file'], 'Consent',
      consent.reason + '. AI called: no. Transcript deleted from AssemblyAI. Audio deleted.');
    sendAlert_(blocked, t.Ticket + ' call was not processed (' + consent.reason + ')', [
      'A call received ' + formatDate_(t.Received) + ' was not processed: ' + consent.reason + '.',
      'The recording and transcript have been deleted.',
      'The caller\'s number is not known from this system. Check the phone log and call back ' +
        'without recording.'
    ], cfg);
    return;
  }

  var labeled = labelTranscript(utterances, consent.firmSpeaker);
  var ai = claudeExtract_(labeled, cfg);
  appendTranscript_(t.Ticket, labeled);
  assemblyDelete_(t['Transcript ID']);
  DriveApp.getFileById(t['File ID']).moveTo(folder_('FOLDER_PROCESSED'));
  var consentNote = consent.singleSpeaker ? 'Passed (only one speaker detected - check)' : 'Passed';

  if (!ai.ok) {
    log_(t.Ticket, t['Audio file'], 'AI', 'AI called: yes. ' + ai.reason);
    var fallback = route('Normal', false, cfg);
    writeTicket_(t._row, {
      Status: 'Needs review', Consent: consentNote, Owner: fallback.owner, 'Email draft': 'None',
      'Next action': ai.reason + '. Read the transcript.', 'Last activity': now, 'Transcript ID': ''
    });
    sendAlert_(fallback, t.Ticket + ' needs a person to read it', [ai.reason + '.'], cfg);
    return;
  }

  var x = ai.data;
  log_(t.Ticket, t['Audio file'], 'AI',
    'AI called: yes. AI urgency: ' + x.urgency + ' - ' + x.urgency_reason);
  var rule = ruleTrigger(callerText(utterances, consent.firmSpeaker, consent.singleSpeaker), cfg);
  var decision = decideUrgency(rule, x.urgency, x.urgency_reason);
  var r = route(decision.urgency, false, cfg);
  var draft = createClientDraft_(emailPlan(x.matter_type, x.email, false), x, cfg);
  var status = initialStatus(decision.urgency, false, consent.singleSpeaker);

  writeTicket_(t._row, {
    Status: status, Urgency: decision.urgency, 'Urgency reason': decision.reason, Owner: r.owner,
    'Matter type': x.matter_type, Caller: x.caller_name, Phone: x.phone, Email: x.email,
    About: x.about_person, Relationship: x.relationship, 'What they want': x.what_they_want,
    Summary: x.summary, 'Next action': x.next_action, 'Key facts': bullets_(x.key_facts),
    Dates: bullets_(x.dates), Documents: bullets_(x.documents), 'Heard from': x.heard_from,
    Consent: consentNote, 'Email draft': draft, 'Last activity': now, 'Transcript ID': ''
  });
  log_(t.Ticket, t['Audio file'], 'Triage',
    decision.reason + ' -> ' + decision.urgency + ', owner ' + r.owner + ', status ' + status);

  sendAlert_(r, t.Ticket + ' ' + x.matter_type + ' - ' + (x.caller_name || 'unknown caller'), [
    'Urgency: ' + decision.urgency + ' (' + decision.reason + ')',
    'Caller: ' + (x.caller_name || '-') + '   Phone: ' + (x.phone || '-') + '   Email: ' + (x.email || '-'),
    'Wants: ' + (x.what_they_want || '-'),
    '',
    x.summary,
    '',
    'Next action: ' + (x.next_action || '-'),
    'Email to caller: ' + draft
  ], cfg);
}

function fail_(row, ticket, fileName, e) {
  writeTicket_(row, { Status: 'Error', 'Next action': 'Error: ' + e.message, 'Last activity': new Date() });
  log_(ticket, fileName, 'Error', e.message);
}

// ---------- sheet access ----------

function ticketsSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEETS.tickets);
}

function ticketColumns_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cols = {};
  headers.forEach(function (h, i) { cols[h] = i + 1; });
  return cols;
}

/** Every ticket as {header: value, _row}. */
function readTickets_() {
  var sheet = ticketsSheet_();
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0];
  return values.slice(1).map(function (r, i) {
    var t = { _row: i + 2 };
    headers.forEach(function (h, j) { t[h] = r[j]; });
    return t;
  }).filter(function (t) { return t.Ticket; });
}

/** Writes only the given fields. Text that Sheets would read as a formula is kept as text. */
function writeTicket_(row, fields) {
  var sheet = ticketsSheet_();
  var cols = ticketColumns_(sheet);
  Object.keys(fields).forEach(function (name) {
    if (!cols[name]) throw new Error('No column "' + name + '" in Tickets');
    sheet.getRange(row, cols[name]).setValue(safeCell_(fields[name]));
  });
}

function appendTicket_(fields) {
  var row = Math.max(ticketsSheet_().getLastRow(), 1) + 1;
  // Checkbox cells count as data, so find the first row without a ticket id instead.
  var ids = ticketsSheet_().getRange('A:A').getValues();
  for (var i = 1; i < ids.length; i++) {
    if (!ids[i][0]) { row = i + 1; break; }
  }
  writeTicket_(row, fields);
  return row;
}

function nextTicketId_() {
  var n = readTickets_().length + 1;
  return 'T-' + ('000' + n).slice(-4);
}

function appendTranscript_(ticket, text) {
  SpreadsheetApp.getActive().getSheetByName(SHEETS.transcripts).appendRow([ticket, safeCell_(text)]);
}

function log_(ticket, fileName, step, detail) {
  SpreadsheetApp.getActive().getSheetByName(SHEETS.log)
    .appendRow([new Date(), ticket, fileName, step, safeCell_(detail)]);
}

function safeCell_(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function bullets_(list) {
  return (list || []).map(function (s) { return '• ' + s; }).join('\n');
}

function formatDate_(d) {
  return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(d);
}
