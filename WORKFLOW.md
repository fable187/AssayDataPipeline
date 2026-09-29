# How the intake demo works

This page shows how a phone call becomes a ticket, what each piece does, and where each piece
lives. The *why* is in [PROBLEM.md](PROBLEM.md). The exact rules and expected results are in
[ACCEPTANCE.md](ACCEPTANCE.md).

> The diagrams are written in Mermaid. GitHub shows them as pictures. In VS Code, install the
> "Markdown Preview Mermaid Support" extension, then open this file and press `Ctrl+Shift+V`.

---

## 1. The big picture

```mermaid
flowchart TD
    A["Client calls the firm<br/>Staff says: this call is being recorded"] --> B["Recording saved<br/>to Drive: Intake Demo / Inbox"]
    B --> C["Apps Script wakes up<br/>every 5 minutes"]
    C --> D["AssemblyAI<br/>turns audio into text,<br/>labels who spoke when"]
    D --> E{"Consent check<br/>Notice in first 30 sec?<br/>Caller objected?"}

    E -- "Failed" --> F["BLOCKED<br/>Delete transcript at AssemblyAI<br/>Delete audio<br/>AI never sees it"]
    F --> G["Email paralegal:<br/>call this person back"]

    E -- "Passed" --> H["Claude reads the transcript<br/>and fills in the intake record:<br/>who, what, dates, documents,<br/>matter type, urgency"]
    H --> I{"Urgent-word rule<br/>Did the CALLER say<br/>hospice, hearing, surgery...?"}
    I -- "Yes" --> J["Urgent<br/>(rule wins over AI)"]
    I -- "No" --> K["Use Claude's urgency<br/>Urgent / High / Normal"]
    J --> L["Route it"]
    K --> L
    L --> M["New row in the Tickets tab"]
    M --> N["Alert email to staff<br/>Urgent: attorney + paralegal<br/>Other: paralegal"]
    M --> O["Gmail DRAFT to the caller<br/>welcome or polite decline<br/>never sent automatically"]
    M --> P["Staff work the ticket"]
    P --> Q{"Daily at 8am:<br/>untouched too long?"}
    Q -- "Yes" --> R["Stalled: reminder email<br/>to the ticket's owner"]
    R --> P
    Q -- "No, or Closed" --> S["Nothing sent"]
```

**One sentence:** a recording goes in, and out comes a ticket that's sorted, routed and has an
email ready, and nobody retypes anything.

---

## 2. The pieces and where they live

```mermaid
flowchart LR
    subgraph Google["Google account (the firm's own)"]
        direction TB
        Drive["Drive<br/>Inbox / Processed folders"]
        Script["Apps Script<br/>the code that runs everything"]
        Sheet["Google Sheet<br/>Tickets · Config · Transcripts · Log"]
        Gmail["Gmail<br/>alerts + drafts"]
    end
    subgraph Outside["Outside services (pay per use)"]
        direction TB
        AAI["AssemblyAI<br/>speech to text"]
        Claude["Claude API<br/>reads the call"]
    end
    Drive <--> Script
    Script <--> Sheet
    Script --> Gmail
    Script <--> AAI
    Script <--> Claude
```

| Piece | What it does | Where you see it |
|---|---|---|
| **Drive: Inbox** | Where recordings are dropped | Intake Demo → Open the Inbox folder |
| **Drive: Processed** | Where recordings go after they're read | Next to Inbox |
| **Apps Script** | Runs the pipeline every 5 minutes, and whenever you pick it from the menu | Sheet → Extensions → Apps Script |
| **Tickets tab** | One row per call. This is the paralegal's work list | The Sheet |
| **Config tab** | Every business rule, editable without code | The Sheet |
| **Transcripts tab** | The labeled transcript for each ticket, for checking the AI | The Sheet |
| **Log tab** | What happened at each step, including whether the AI was called | The Sheet |
| **AssemblyAI** | Turns audio into text and tells the speakers apart | Outside; we delete each transcript once read |
| **Claude** | Turns the transcript into a structured intake record | Outside; gets the transcript only, never the audio |
| **Gmail** | Staff alerts are sent. Client emails are **drafts only** | The demo account's inbox and Drafts folder |

---

## 3. One call, step by step

This shows who talks to whom, in order, for a call that passes the consent check.

```mermaid
sequenceDiagram
    autonumber
    participant Drive as Drive Inbox
    participant AS as Apps Script
    participant AAI as AssemblyAI
    participant C as Claude
    participant Sheet as Sheet
    participant Gmail as Gmail

    AS->>Drive: Any new recordings?
    Drive-->>AS: S2-hospice.wav
    AS->>Sheet: New row, Status = Transcribing
    AS->>AAI: Upload audio, start transcript (with speaker labels)
    loop every 5 seconds, up to 4.5 minutes
        AS->>AAI: Done yet?
    end
    AAI-->>AS: Transcript, split by speaker with timestamps
    AS->>AS: Consent check (Logic.js)
    AS->>C: Labeled transcript + rules + the form to fill in
    C-->>AS: Intake record as JSON
    AS->>AS: Urgent-word rule, final urgency, routing (Logic.js)
    AS->>Sheet: Fill in the ticket, save the transcript, write the Log
    AS->>AAI: Delete the transcript
    AS->>Drive: Move audio to Processed
    AS->>Gmail: Alert email to staff
    AS->>Gmail: Create a draft for the caller (not sent)
```

For a **blocked** call, the flow stops after step 6. The transcript and audio are deleted, only
the time, file name and reason stay on the ticket, and the paralegal gets a "call back" email.
Claude is never contacted.

---

## 4. The life of a ticket

The **Status** column in the Tickets tab moves like this. The pipeline sets the first status, and
staff change it after that.

```mermaid
stateDiagram-v2
    [*] --> Transcribing: recording found in Inbox
    Transcribing --> New: passed, Normal urgency
    Transcribing --> NeedsReview: passed, Urgent/High, or AI couldn't read it
    Transcribing --> Blocked: no notice, or caller objected
    Transcribing --> Error: a service failed
    NeedsReview --> InProgress: staff confirm and start
    New --> InProgress: staff start
    InProgress --> WaitingOnClient: waiting on documents / signature
    WaitingOnClient --> InProgress: client responds
    InProgress --> Closed
    WaitingOnClient --> Closed
    Blocked --> Closed: called back
    Closed --> [*]

    note right of WaitingOnClient
        Any status except Closed gets a
        "Stalled" reminder when nobody
        touches it for 3 days (1 day if Urgent).
        Any edit to the row counts as activity.
    end note
```

---

## 5. How urgency is decided

Two opinions go in, and a fixed rule decides which one wins.

```mermaid
flowchart TD
    T["Transcript"] --> R["Rule check<br/>only the CALLER's words<br/>against the trigger list in Config"]
    T --> AI["Claude's opinion<br/>Urgent / High / Normal + reason"]
    R --> D{"Did a trigger word match?"}
    AI --> D
    D -- "Yes" --> U["Urgent<br/>Reason: Rule: hospice (AI said Normal)"]
    D -- "No" --> A["Claude's level stands<br/>Reason: AI: ..."]
    U --> V["Urgent or High means Status = Needs review:<br/>a person confirms it"]
    A --> V
```

**Why only the caller's words:** staff often ask "is there any court date?". If staff speech
counted, every call would come out Urgent. Test S3b checks this.

**Why the rule wins:** a keyword rule is predictable and easy to explain to a lawyer. The AI
catches the cases the rule misses, like "surgery next Tuesday", and a person confirms anything
Urgent or High.

---

## 6. Where the client's data goes, and when it's deleted

| Data | Goes to | Kept? |
|---|---|---|
| Audio | Drive (firm's account) → AssemblyAI | AssemblyAI copy deleted after reading. Drive copy moves to Processed. **Blocked calls: deleted everywhere.** |
| Transcript | AssemblyAI → Apps Script → Claude → Transcripts tab | Deleted at AssemblyAI. Claude gets the text only; kept in the firm's own Sheet |
| Intake record | Tickets tab, alert emails, the Gmail draft | Stays in the firm's Google account |
| API keys | Apps Script's Script Properties | Never in the Sheet, never in this repo |

Everything the firm keeps lives in **their own** Google account. That's the confidentiality
answer in one line.

---

## 7. Where the rules live

```mermaid
flowchart LR
    A["ACCEPTANCE.md Part A<br/>you decide the rules"] --> B["Config tab in the Sheet<br/>the rules as editable values"]
    B --> C["Logic.js<br/>applies them, never hard-codes them"]
    C --> D["tests/logic.test.js<br/>proves each rule does what Part A says"]
```

To change a rule, such as making stalls 5 days or adding a trigger word, **edit the Config tab**.
No code change and no push are needed.

---

## 8. How changes get made (the build loop)

```mermaid
flowchart LR
    A["Edit code in<br/>apps-script/"] --> B["npm test<br/>24 rule checks"]
    B --> C["npm run push<br/>clasp copies code to Google"]
    C --> D["Reload the Sheet<br/>run from the Intake Demo menu"]
    D --> E["QA against<br/>ACCEPTANCE.md Part B"]
    E -->|"something's off"| A
```

| Command | What it does |
|---|---|
| `npm test` | Runs the rule checks locally in about 1 second. No Google, no API cost |
| `npm run calls` | Rebuilds the fake call recordings from `calls/scripts/*.txt` |
| `npm run smoke -- S2` | Sends a fake call through the real AssemblyAI and Claude from your PC and prints the result. Add `--no-ai` to skip Claude |
| `npm run push` | Sends the code in `apps-script/` to the LawDemo Apps Script project |

---

## 9. Files in this repo

| File | What's in it |
|---|---|
| [PROBLEM.md](PROBLEM.md) | What's broken at the firm and who it hurts |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Business rules (Part A) and the scenarios QA checks (Part B) |
| [apps-script/Logic.js](apps-script/Logic.js) | Every business rule, as plain functions |
| [apps-script/Pipeline.js](apps-script/Pipeline.js) | Recording → transcript → consent → AI → ticket |
| [apps-script/Services.js](apps-script/Services.js) | Talking to AssemblyAI and Claude |
| [apps-script/Notify.js](apps-script/Notify.js) | Alerts, Gmail drafts, stall reminders |
| [apps-script/Setup.js](apps-script/Setup.js) | Menu, tabs, folders, schedules, API keys |
| [tests/logic.test.js](tests/logic.test.js) | Automated checks, one per rule |
| [calls/](calls/) | Fake call scripts and the voice generator |
| [tools/smoke.js](tools/smoke.js) | Local end-to-end check against the real services |
