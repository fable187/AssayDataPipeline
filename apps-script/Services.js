/**
 * Calls to outside services: AssemblyAI (transcription) and Claude (reading the call).
 * Keys live in Script Properties (Intake Demo > Set API keys), never in the sheet or the code.
 */

var ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

function secret_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing ' + name + '. Use Intake Demo > Set API keys.');
  return value;
}

/** JSON request with retries on rate limits and server errors. */
function fetchJson_(url, options) {
  options.muteHttpExceptions = true;
  for (var attempt = 0; ; attempt++) {
    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    if ((code === 429 || code >= 500) && attempt < 3) {
      Utilities.sleep(2000 * Math.pow(2, attempt));
      continue;
    }
    var text = res.getContentText();
    if (code >= 300) throw new Error(url.split('?')[0] + ' returned ' + code + ': ' + text.slice(0, 300));
    return text ? JSON.parse(text) : {};
  }
}

function assemblyHeaders_() {
  return { authorization: secret_('ASSEMBLYAI_API_KEY') };
}

/** Uploads the recording and starts transcription. Returns the transcript id. */
function assemblyStart_(blob) {
  var upload = fetchJson_(ASSEMBLY_BASE + '/upload', {
    method: 'post', contentType: 'application/octet-stream', payload: blob.getBytes(),
    headers: assemblyHeaders_()
  });
  var job = fetchJson_(ASSEMBLY_BASE + '/transcript', {
    method: 'post', contentType: 'application/json', headers: assemblyHeaders_(),
    payload: JSON.stringify({ audio_url: upload.upload_url, speaker_labels: true })
  });
  return job.id;
}

function assemblyGet_(id) {
  return fetchJson_(ASSEMBLY_BASE + '/transcript/' + id, { method: 'get', headers: assemblyHeaders_() });
}

/** Removes the transcript and audio from AssemblyAI once we have what we need. */
function assemblyDelete_(id) {
  if (id) fetchJson_(ASSEMBLY_BASE + '/transcript/' + id, { method: 'delete', headers: assemblyHeaders_() });
}

/** Sends the labeled transcript to Claude; returns parseExtractionResponse's {ok, data, reason}. */
function claudeExtract_(labeledTranscript, cfg) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var headers = Object.assign({ 'x-api-key': secret_('ANTHROPIC_API_KEY') }, CLAUDE_HEADERS);
  var json = fetchJson_(CLAUDE_URL, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(buildExtractionRequest(labeledTranscript, cfg, today))
  });
  return parseExtractionResponse(json);
}
