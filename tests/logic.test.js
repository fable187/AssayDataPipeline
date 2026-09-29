// Checks the rules in ACCEPTANCE.md Part A. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../apps-script/Logic.js');

const cfg = L.parseConfig([]);
cfg.attorney_email = 'attorney@example.com';
cfg.paralegal_email = 'paralegal@example.com';

const u = (speaker, sec, text) => ({ speaker, start: sec * 1000, text });

// ---------- Config ----------

test('config: defaults match ACCEPTANCE.md Part A', () => {
  assert.equal(cfg.stall_days, 3);
  assert.equal(cfg.urgent_stall_days, 1);
  assert.equal(cfg.notice_window_seconds, 30);
  assert.ok(cfg.matter_types.includes(L.TYPE_EXISTING));
  assert.ok(cfg.matter_types.includes(L.TYPE_NOT_OURS));
  assert.ok(cfg.urgent_triggers.includes('hospice'));
});

test('config: a value in the Config tab overrides the default; blanks keep the default', () => {
  const c = L.parseConfig([['stall_days', 5, ''], ['urgent_triggers', 'hospice, fire', ''],
    ['firm_name', '', '']]);
  assert.equal(c.stall_days, 5);
  assert.deepEqual(c.urgent_triggers, ['hospice', 'fire']);
  assert.equal(c.firm_name, 'Demo Estate Law');
});

// ---------- A7: consent ----------

test('A7/S1: notice given, staff offers opt-out, caller agrees -> passes', () => {
  const r = L.checkConsent([
    u('A', 0, "Thanks for calling. This call is being recorded. If you'd rather not be recorded, just let me know."),
    u('B', 6, "Sure, that's fine."),
  ], cfg);
  assert.equal(r.ok, true);
  assert.equal(r.firmSpeaker, 'A');
});

test('A7/S4: no notice anywhere -> blocked, no notice', () => {
  const r = L.checkConsent([
    u('A', 0, 'Demo Estate Law, how can I help you?'),
    u('B', 3, 'My aunt passed away and left me as trustee.'),
  ], cfg);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Blocked: no notice');
});

test('A7: notice only after the 30-second window -> blocked', () => {
  const r = L.checkConsent([
    u('A', 0, 'Demo Estate Law, how can I help you?'),
    u('B', 4, 'I need a will.'),
    u('A', 45, 'Oh, I should mention this call is being recorded.'),
  ], cfg);
  assert.equal(r.reason, 'Blocked: no notice');
});

test('A7/S5: caller objects -> blocked, caller declined', () => {
  const r = L.checkConsent([
    u('A', 0, 'This call is being recorded. How can I help?'),
    u('B', 4, "Actually, I'd rather this not be recorded."),
    u('A', 8, 'Understood.'),
    u('B', 10, 'We want a trust for our grandchildren.'),
  ], cfg);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Blocked: caller declined');
});

test('A7: curly apostrophes from transcription still match', () => {
  const r = L.checkConsent([
    u('A', 0, 'This call is being recorded.'),
    u('B', 3, 'I don’t want to be recorded.'),
  ], cfg);
  assert.equal(r.reason, 'Blocked: caller declined');
});

test('A7: only one speaker detected -> passes but flagged for a person to check', () => {
  const r = L.checkConsent([u('A', 0, 'This call is being recorded. I need a will.')], cfg);
  assert.equal(r.ok, true);
  assert.equal(r.singleSpeaker, true);
  assert.equal(L.initialStatus('Normal', false, true), 'Needs review');
});

// ---------- A3: urgent triggers ----------

test('A3: triggers match whole words only', () => {
  assert.equal(L.ruleTrigger('My mother is in the ICU', cfg), 'ICU');
  assert.equal(L.ruleTrigger('I brought biscuits', cfg), null);
  assert.equal(L.ruleTrigger('I reserved a table', cfg), null);
});

test('A3: staff asking "any court date?" does not make the call urgent', () => {
  const utts = [
    u('A', 0, 'This call is being recorded. Is there any court date or deadline?'),
    u('B', 5, 'No, my father passed away three months ago and nothing is filed.'),
  ];
  const c = L.checkConsent(utts, cfg);
  assert.equal(L.ruleTrigger(L.callerText(utts, c.firmSpeaker, c.singleSpeaker), cfg), null);
});

test('A3/S3 vs S3b: a hearing makes probate urgent; "passed away" alone does not', () => {
  assert.equal(L.ruleTrigger('My father passed away. My sister got a letter about a court hearing.', cfg), 'hearing');
  assert.equal(L.ruleTrigger('My father passed away about three months ago.', cfg), null);
});

// ---------- A2 / S9: rule beats AI ----------

test('A2/S9: rule hit + AI says Normal -> Urgent, reason names the rule', () => {
  const d = L.decideUrgency('hospice', 'Normal', 'routine');
  assert.equal(d.urgency, 'Urgent');
  assert.match(d.reason, /Rule: "hospice"/);
  assert.match(d.reason, /AI said Normal/);
});

test('A2: no rule hit -> the AI decides, including raising to High', () => {
  assert.equal(L.decideUrgency(null, 'High', 'closing in 2 weeks').urgency, 'High');
  assert.equal(L.decideUrgency(null, 'Normal', '').urgency, 'Normal');
  assert.equal(L.decideUrgency(null, 'garbage', '').urgency, 'Normal');
});

// ---------- A4: routing ----------

test('A4: Urgent -> attorney owns, both alerted, subject URGENT', () => {
  const r = L.route('Urgent', false, cfg);
  assert.equal(r.owner, 'Attorney');
  assert.deepEqual(r.recipients, ['attorney@example.com', 'paralegal@example.com']);
  assert.equal(r.subjectPrefix, 'URGENT');
});

test('A4: High and Normal -> paralegal only', () => {
  for (const level of ['High', 'Normal']) {
    const r = L.route(level, false, cfg);
    assert.equal(r.owner, 'Paralegal');
    assert.deepEqual(r.recipients, ['paralegal@example.com']);
  }
});

test('A4: Blocked -> paralegal, "Call back"', () => {
  const r = L.route('Urgent', true, cfg);
  assert.equal(r.owner, 'Paralegal');
  assert.equal(r.subjectPrefix, 'Call back');
});

test('A2: statuses - Urgent/High need review, Normal is New, blocked is Blocked', () => {
  assert.equal(L.initialStatus('Urgent', false, false), 'Needs review');
  assert.equal(L.initialStatus('High', false, false), 'Needs review');
  assert.equal(L.initialStatus('Normal', false, false), 'New');
  assert.equal(L.initialStatus('Normal', true, false), 'Blocked');
});

// ---------- A5: emails ----------

test('A5: which draft each ticket gets', () => {
  assert.equal(L.emailPlan('Plan update', 'a@example.com', false).kind, 'welcome');
  assert.equal(L.emailPlan('Unclear', 'a@example.com', false).kind, 'welcome');
  assert.equal(L.emailPlan('Not our practice', 'a@example.com', false).kind, 'decline');
  assert.equal(L.emailPlan('Existing matter', 'a@example.com', false).kind, 'none');
  assert.equal(L.emailPlan('Probate', 'a@example.com', true).kind, 'none');
});

test('A5: no email given -> no draft, note says call back', () => {
  const p = L.emailPlan('Probate', '', false);
  assert.equal(p.kind, 'none');
  assert.match(p.note, /call back/);
});

test('A5: templates fill placeholders and leave unknown ones visible', () => {
  const v = L.templateValues({ caller_name: 'Robert Hale', what_they_want: 'Florida wills for us' }, cfg);
  assert.equal(L.fillTemplate('Dear {first_name}, re {what_they_want_lower} {oops}', v),
    'Dear Robert, re florida wills for us. {oops}');
});

// ---------- A6 / S8: stalled tickets ----------

test('A6/S8: 4 days idle -> remind; same day again -> no; closed -> no', () => {
  const now = new Date('2026-10-02T09:00:00');
  const t = { status: 'New', urgency: 'Normal', lastActivity: new Date(now - 4 * L.DAY_MS), lastReminded: null };
  assert.equal(L.isReminderDue(t, now, cfg), true);
  t.lastReminded = now;
  assert.equal(L.isReminderDue(t, new Date(+now + 60 * 60 * 1000), cfg), false);
  t.lastReminded = new Date(now - 3 * L.DAY_MS);
  assert.equal(L.isReminderDue(t, now, cfg), true, 'reminds again after 3 more days');
  t.status = 'Closed';
  assert.equal(L.isReminderDue(t, now, cfg), false);
});

test('A6: 2 days idle -> Normal not stalled, Urgent stalled', () => {
  const now = new Date('2026-10-02T09:00:00');
  const idle = new Date(now - 2 * L.DAY_MS);
  assert.equal(L.isReminderDue({ status: 'New', urgency: 'Normal', lastActivity: idle }, now, cfg), false);
  assert.equal(L.isReminderDue({ status: 'Needs review', urgency: 'Urgent', lastActivity: idle }, now, cfg), true);
});

// ---------- A8: the AI request and answer ----------

test('A8: the schema asks for every field and limits matter types to the Config list', () => {
  const s = L.extractionSchema(cfg);
  for (const f of ['caller_name', 'phone', 'email', 'relationship', 'about_person', 'matter_type',
    'what_they_want', 'key_facts', 'dates', 'documents', 'heard_from', 'urgency',
    'urgency_reason', 'summary', 'next_action']) {
    assert.ok(s.required.includes(f), f);
  }
  assert.deepEqual(s.properties.matter_type.enum, cfg.matter_types);
});

test('A8: refusal and cut-off answers are not accepted', () => {
  assert.equal(L.parseExtractionResponse({ stop_reason: 'refusal', content: [] }).ok, false);
  assert.equal(L.parseExtractionResponse({ stop_reason: 'max_tokens', content: [] }).ok, false);
  const good = L.parseExtractionResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] });
  assert.deepEqual(good.data, { a: 1 });
});

// ---------- Phone line (Twilio) ----------

test('phone: the default greeting passes consent; its own opt-out line does not block', () => {
  const greeting = L.fillTemplate(cfg.phone_greeting, { firm_name: cfg.firm_name });
  const r = L.checkConsent([
    u('A', 0, greeting),
    u('B', 25, 'Hi, this is Dana. My mom needs a will before her surgery.'),
  ], cfg);
  assert.equal(r.ok, true);
  assert.equal(r.firmSpeaker, 'A');
});

test('phone: caller objects on the phone line -> blocked, caller declined', () => {
  const greeting = L.fillTemplate(cfg.phone_greeting, { firm_name: cfg.firm_name });
  const r = L.checkConsent([u('A', 0, greeting), u('B', 25, "I don't want to be recorded.")], cfg);
  assert.equal(r.reason, 'Blocked: caller declined');
});

test('phone: TwiML starts recording BEFORE the greeting, and escapes the callback URL', () => {
  const xml = L.phoneLineTwiml('https://example.com/exec?key=a&b=c', cfg);
  assert.ok(xml.indexOf('<Recording') < xml.indexOf('<Say'), 'recording must start first');
  assert.match(xml, /key=a&amp;b=c/);
  assert.match(xml, /This call is being recorded/);
  assert.match(xml, /Demo Estate Law/);
});

test('phone: caller ID fills the phone only when the caller gave none', () => {
  assert.equal(L.phoneForTicket('813-555-0123', '+19415550142'), '813-555-0123');
  assert.equal(L.phoneForTicket('', '+19415550142'), '941-555-0142 (caller ID)');
  assert.equal(L.phoneForTicket('', ''), '');
  assert.equal(L.formatUsPhone('+442071234567'), '+442071234567');
});

test('phone: recording descriptions that are missing or broken read as no info', () => {
  assert.deepEqual(L.parseSourceInfo(''), {});
  assert.deepEqual(L.parseSourceInfo('not json'), {});
  assert.equal(L.parseSourceInfo('{"source":"twilio","from":"+19415550142"}').from, '+19415550142');
});

test('phone: only real-looking Twilio ids are accepted from the callback', () => {
  assert.equal(L.isTwilioSid('RE' + 'a'.repeat(32), 'RE'), true);
  assert.equal(L.isTwilioSid('RE123/../../evil', 'RE'), false);
  assert.equal(L.isTwilioSid('CA' + 'a'.repeat(32), 'RE'), false);
});

test('A7 proposed: keep_caller_id_on_blocked reads yes/no from Config', () => {
  assert.equal(cfg.keep_caller_id_on_blocked, true);
  assert.equal(L.parseConfig([['keep_caller_id_on_blocked', 'no', '']]).keep_caller_id_on_blocked, false);
});
