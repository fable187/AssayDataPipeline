// Runs fake calls through the real services from this PC, using the same Logic.js the Apps
// Script uses. It's for checking the pipeline before it goes to Google, and for QA.
//
//   npm run smoke                 all calls in calls/audio
//   npm run smoke -- S2 S3b       only calls whose file name starts with these
//   npm run smoke -- --no-ai S4   transcription + rules only, skip Claude
//
// Keys come from the ASSEMBLYAI and FREELANCE (Anthropic) environment variables.
// Transcripts are deleted from AssemblyAI after each call, as in the real pipeline.

const fs = require('node:fs');
const path = require('node:path');
const L = require('../apps-script/Logic.js');

const ASSEMBLY = 'https://api.assemblyai.com/v2';
const args = process.argv.slice(2);
const useAi = !args.includes('--no-ai');
const only = args.filter((a) => !a.startsWith('--'));
const cfg = L.parseConfig([]);

function need(name) {
  if (!process.env[name]) throw new Error(`Environment variable ${name} is not set`);
  return process.env[name];
}

async function assembly(method, url, body, contentType = 'application/json') {
  const res = await fetch(url.startsWith('http') ? url : ASSEMBLY + url, {
    method,
    headers: { authorization: need('ASSEMBLYAI'), 'content-type': contentType },
    body: body && contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AssemblyAI ${method} ${url}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function transcribe(file) {
  const { upload_url } = await assembly('POST', '/upload', fs.readFileSync(file), 'application/octet-stream');
  const { id } = await assembly('POST', '/transcript', { audio_url: upload_url, speaker_labels: true });
  for (;;) {
    const t = await assembly('GET', `/transcript/${id}`);
    if (t.status === 'completed') {
      await assembly('DELETE', `/transcript/${id}`);
      return t.utterances.map((u) => ({ speaker: u.speaker, text: u.text, start: u.start }));
    }
    if (t.status === 'error') throw new Error(`Transcription failed: ${t.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function extract(labeled) {
  const started = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': need('FREELANCE'), 'content-type': 'application/json', ...L.CLAUDE_HEADERS },
    body: JSON.stringify(L.buildExtractionRequest(labeled, cfg, new Date().toISOString().slice(0, 10))),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Claude: ${res.status} ${JSON.stringify(json.error || json)}`);
  return { ...L.parseExtractionResponse(json), seconds: (Date.now() - started) / 1000 };
}

async function run(file) {
  const name = path.basename(file);
  const utts = await transcribe(file);
  const consent = L.checkConsent(utts, cfg);
  console.log(`\n=== ${name}`);
  console.log(`Speakers: ${[...new Set(utts.map((u) => u.speaker))].join(', ')}   Consent: ${consent.reason}`);
  if (!consent.ok) {
    console.log('AI called: no');
    return;
  }
  const labeled = L.labelTranscript(utts, consent.firmSpeaker);
  console.log(labeled);
  const rule = L.ruleTrigger(L.callerText(utts, consent.firmSpeaker, consent.singleSpeaker), cfg);
  console.log(`Rule trigger: ${rule || 'none'}`);
  if (!useAi) return;
  const ai = await extract(labeled);
  if (!ai.ok) {
    console.log(`AI: ${ai.reason}`);
    return;
  }
  const d = L.decideUrgency(rule, ai.data.urgency, ai.data.urgency_reason);
  const r = L.route(d.urgency, false, { attorney_email: 'attorney', paralegal_email: 'paralegal' });
  const plan = L.emailPlan(ai.data.matter_type, ai.data.email, false);
  console.log(`AI (${ai.model}, ${ai.seconds.toFixed(1)}s):`);
  console.log(JSON.stringify(ai.data, null, 2));
  console.log(`FINAL -> Type: ${ai.data.matter_type} | Urgency: ${d.urgency} (${d.reason}) | ` +
    `Owner: ${r.owner} | Status: ${L.initialStatus(d.urgency, false, consent.singleSpeaker)} | ` +
    `Draft: ${plan.kind}${plan.note ? ' - ' + plan.note : ''}`);
}

(async () => {
  const dir = path.join(__dirname, '..', 'calls', 'audio');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wav'))
    .filter((f) => !only.length || only.some((o) => f.startsWith(o)))
    .map((f) => path.join(dir, f));
  for (const f of files) {
    try {
      await run(f);
    } catch (e) {
      console.log(`\n=== ${path.basename(f)}\nERROR: ${e.message}`);
    }
  }
})();
