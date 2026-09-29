/**
 * The demo phone line. Twilio answers the call, starts recording, plays the greeting with the
 * recording notice, and when the recording is ready it calls doPost below. We save the audio to
 * the Inbox, delete it from Twilio, and start the normal pipeline straight away.
 *
 * Apps Script can't read request headers, so Twilio's signature can't be checked here. Instead:
 * a secret key in the callback URL, the account id must be ours, and we only ever download from
 * a URL we build ourselves from a well-formed recording id.
 */

var TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts/';

function doPost(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('TWILIO_WEBHOOK_KEY');
  if (!key || p.key !== key || p.AccountSid !== props.getProperty('TWILIO_ACCOUNT_SID')) {
    return ContentService.createTextOutput('forbidden');
  }
  if (p.RecordingStatus !== 'completed') return ContentService.createTextOutput('ignored');
  try {
    savePhoneRecording_(p);
  } catch (err) {
    log_('', '', 'Phone line error', err.message);
  }
  return ContentService.createTextOutput('ok');
}

/** Opening the web app URL in a browser just confirms it's deployed. */
function doGet() {
  return ContentService.createTextOutput('Intake demo phone line webhook is running.');
}

function twilioHeaders_() {
  var auth = secret_('TWILIO_ACCOUNT_SID') + ':' + secret_('TWILIO_AUTH_TOKEN');
  return { Authorization: 'Basic ' + Utilities.base64Encode(auth) };
}

function savePhoneRecording_(p) {
  if (!isTwilioSid(p.RecordingSid, 'RE') || !isTwilioSid(p.CallSid, 'CA')) {
    throw new Error('Callback had malformed ids');
  }
  var account = TWILIO_API + secret_('TWILIO_ACCOUNT_SID');
  var headers = twilioHeaders_();

  var audio = UrlFetchApp.fetch(account + '/Recordings/' + p.RecordingSid + '.mp3',
    { headers: headers, muteHttpExceptions: true });
  if (audio.getResponseCode() !== 200) {
    throw new Error('Recording download returned ' + audio.getResponseCode());
  }
  var call = fetchJson_(account + '/Calls/' + p.CallSid + '.json', { method: 'get', headers: headers });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm-ss');
  var file = folder_('FOLDER_INBOX').createFile(audio.getBlob().setName('Phone call ' + stamp + '.mp3'));
  file.setDescription(JSON.stringify({ source: 'twilio', from: call.from || '' }));

  // The firm's copy now lives in its own Drive; don't leave one at Twilio.
  fetchJson_(account + '/Recordings/' + p.RecordingSid + '.json', { method: 'delete', headers: headers });

  ScriptApp.newTrigger('processInboxSoon').timeBased().after(5 * 1000).create();
}

/** One-off run right after a call, so the ticket appears in about a minute, not up to five. */
function processInboxSoon() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processInboxSoon') ScriptApp.deleteTrigger(t);
  });
  processInbox();
}

/** Menu: shows the callback URL and the TwiML to paste into Twilio. */
function showPhoneLineSetup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TWILIO_WEBHOOK_KEY')) props.setProperty('TWILIO_WEBHOOK_KEY', Utilities.getUuid());
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('The phone line web app is not deployed yet. Ask for it to be deployed, then try again.');
    return;
  }
  var callback = url + '?key=' + props.getProperty('TWILIO_WEBHOOK_KEY');
  var twiml = phoneLineTwiml(callback, loadConfig_());
  var missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter(function (k) {
    return !props.getProperty(k);
  });
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:13px">' +
    (missing.length ? '<p style="color:#a50e0e"><b>First:</b> Intake Demo &gt; Set API keys, and ' +
      'add the Twilio Account SID and Auth Token.</p>' : '') +
    '<p>In Twilio: <b>TwiML Bins</b> &gt; Create new &gt; paste this &gt; Save. Then attach the ' +
    'bin to your number under <b>A call comes in</b>.</p>' +
    '<textarea style="width:100%;height:230px;font-family:monospace;font-size:11px" readonly ' +
    'onclick="this.select()">' + escapeXml(twiml) + '</textarea>' +
    '<p>Click the box to select it all, then Ctrl+C.</p></div>'
  ).setWidth(640).setHeight(400);
  ui.showModalDialog(html, 'Phone line setup');
}
