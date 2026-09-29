/**
 * Everything that reaches a person: staff alerts, client email drafts, stall reminders.
 */

/** Reads the Config tab. Blank staff addresses default to your own address with +attorney / +paralegal. */
function loadConfig_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.config);
  var rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
  var cfg = parseConfig(rows);
  var me = Session.getEffectiveUser().getEmail();
  if (!cfg.attorney_email) cfg.attorney_email = plusAddress_(me, 'attorney');
  if (!cfg.paralegal_email) cfg.paralegal_email = plusAddress_(me, 'paralegal');
  return cfg;
}

function plusAddress_(email, tag) {
  var parts = email.split('@');
  return parts[0] + '+' + tag + '@' + parts[1];
}

/** Staff alert (A4). Internal only. */
function sendAlert_(r, subject, lines, cfg) {
  var fullSubject = r.subjectPrefix + ': ' + subject;
  var body = lines.join('\n') + '\n\nOpen the tracker: ' + SpreadsheetApp.getActive().getUrl();
  MailApp.sendEmail({ to: r.recipients.join(','), subject: fullSubject, body: body });
  if (cfg.chat_webhook_url) {
    UrlFetchApp.fetch(cfg.chat_webhook_url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ text: '*' + fullSubject + '*\n' + lines.join('\n') })
    });
  }
}

var EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A5: creates a Gmail draft for the paralegal to review. Never sends. Returns the ticket note. */
function createClientDraft_(plan, extract, cfg) {
  if (plan.kind === 'none') return plan.note || 'None';
  if (!EMAIL_SHAPE.test(extract.email)) return 'Email "' + extract.email + '" looks wrong - check, no draft made';
  var values = templateValues(extract, cfg);
  GmailApp.createDraft(extract.email,
    fillTemplate(cfg[plan.kind + '_subject'], values),
    fillTemplate(cfg[plan.kind + '_body'], values));
  return (plan.kind === 'welcome' ? 'Welcome' : 'Decline') + ' draft in Gmail (not sent)';
}

/** A6: runs daily at 8am, and from the menu. Reminders go to staff only. */
function sendStallReminders() {
  var cfg = loadConfig_();
  var now = new Date();
  var sent = 0;
  readTickets_().forEach(function (t) {
    var ticket = {
      status: t.Status, urgency: t.Urgency,
      lastActivity: asDate_(t['Last activity']), lastReminded: asDate_(t['Last reminded'])
    };
    if (!isReminderDue(ticket, now, cfg)) return;
    var to = t.Owner === 'Attorney' ? cfg.attorney_email : cfg.paralegal_email;
    var days = Math.floor((now - ticket.lastActivity) / DAY_MS);
    var who = t.Caller || t['Audio file'];
    MailApp.sendEmail(to, 'Stalled: ' + t.Ticket + ' ' + (t['Matter type'] || '') + ' - ' + who,
      t.Ticket + ' has had no activity for ' + days + ' days.\n\n' +
      'Status: ' + t.Status + '   Urgency: ' + (t.Urgency || '-') + '\n' +
      'Next action: ' + (t['Next action'] || '-') + '\n\n' +
      'Update the ticket (any edit counts as activity) or mark it Closed.\n' +
      SpreadsheetApp.getActive().getUrl());
    writeTicket_(t._row, { 'Last reminded': now });
    log_(t.Ticket, t['Audio file'], 'Reminder', 'Stalled ' + days + ' days, reminded ' + to);
    sent++;
  });
  return sent;
}

function asDate_(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}
