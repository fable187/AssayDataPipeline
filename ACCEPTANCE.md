# Acceptance checks

**What this page is for:** the contract between the build and QA. Part A is the business logic,
which the owner decides. Part B is the scenarios the build must pass. Nothing gets coded until
both are approved, and QA tests against this page, not against the code.

How to use it: every rule marked **PROPOSED** is a starting suggestion. Change it, or mark it
**APPROVED**. Once a rule is approved, the build follows it exactly.

---

## Part A. Business rules (owner decides)

### A1. Matter types. PROPOSED

| Type | Meaning |
|---|---|
| New estate plan | Wills, revocable trust, POA, health care surrogate, for someone without a plan |
| Plan update | Changing an existing will or trust (marriage, divorce, new child, moved to Florida) |
| Incapacity documents | Durable POA / health care surrogate needed on their own, often urgently |
| Probate | Someone has died; estate needs to go through court |
| Trust administration | Someone has died; assets are in a trust, not probate |
| Existing matter | A current client calling about their open matter |
| Not our practice | Divorce, criminal, injury, etc. |
| Unclear | The call doesn't say enough to tell |

### A2. Urgency levels. PROPOSED

| Level | When | Set by |
|---|---|---|
| **Urgent** | Any of the trigger phrases in A3, **or** Claude judges life/health/court timing is at stake | Rule wins over Claude; Claude can raise but never lower a rule result |
| **High** | A deadline within 30 days is mentioned (hearing, surgery, closing, move) | Claude, with the reason quoted from the call |
| **Normal** | Everything else | Default |

A person has to confirm any Urgent or High ticket. Claude can suggest an urgency, but only a person makes it final.

### A3. Urgent trigger phrases. PROPOSED

`hospice`, `end of life`, `ICU`, `intensive care`, `on a ventilator`, `days to live`,
`hearing`, `court date`, `served`, `deadline`, `surgery`

> Owner to decide: does "passed away" alone make a probate call urgent? PROPOSED: **no**, only if
> a deadline or hearing is also mentioned.

### A4. Routing. PROPOSED

| Ticket | Owner | Alerted |
|---|---|---|
| Urgent | Attorney | Attorney **and** paralegal, immediately |
| High / Normal | Paralegal | Paralegal (one email per new ticket) |
| Not our practice | Paralegal | Paralegal |
| Blocked (no consent) | Paralegal | Paralegal: "call this person back" |

### A5. Emails to the caller. PROPOSED

- The system **drafts** emails. It never sends one. The paralegal reviews each draft in Gmail and clicks send.
- New intake (any type except Existing matter / Not our practice / Blocked): welcome email draft.
- Not our practice: polite decline draft suggesting the Florida Bar Lawyer Referral Service.
- Existing matter: no email draft; ticket only.
- Caller gave no email address: no draft; ticket says "no email, call back".

### A6. Stalled-matter reminders. PROPOSED

- A ticket is stalled when its status isn't Closed and **Last activity** is more than **3 days** old.
- The reminder goes to the ticket's owner. Urgent tickets stall after **1 day**.
- Remind once, then again every 3 days while it stays stalled. Never remind about a Closed ticket.
- Reminders go to staff only, never to the caller.

### A7. Recording consent. PROPOSED

- The recording notice must be spoken within the first **30 seconds**: some form of "this call is
  being recorded".
- If the caller objects anywhere in the call ("I don't want to be recorded", "please don't record
  this"), the call is blocked.
- **Blocked call:** Claude never sees it. The transcript is deleted from the transcription
  service. The audio file is **deleted**. The ticket row holds only the time, the file name and
  the block reason.

> Owner to decide: delete blocked audio, or move it to a locked folder? Keeping an unconsented
> recording is the legal risk, so PROPOSED is delete.

### A8. What gets pulled from each call. PROPOSED

Caller name, callback phone, email, caller's relationship to the person the matter is about, that
person's name, matter type, what they want (one sentence, in their words), key facts (bullets), dates
and deadlines mentioned, documents mentioned (existing will, trust, death certificate), how they heard
about the firm, urgency + reason, 3-sentence summary, suggested next action.

**Rule:** if the call didn't say it, the field stays blank. Claude does not guess or fill in gaps.

---

## Part B. Scenarios

Each scenario is a fake call. I generate the audio with two text-to-speech voices; you can
re-record them with real voices for the video. "Expected" is what QA checks in the Sheet and in Gmail.

### S1. New estate plan, routine
**Call:** Recording notice given; caller says "sure". Married couple, two adult children, a house in
Sarasota, recently moved from Ohio, old Ohio wills. They want "whatever we need to be covered in
Florida." Email given. Heard about the firm from their financial advisor.
**Expected:** Consent passed · Type **Plan update** · Urgency **Normal** · Owner **Paralegal** ·
one alert to the paralegal · welcome draft in Gmail · Documents: "Ohio wills" · Heard from: "financial
advisor" · Status **New**.

### S2. Parent in hospice
**Call:** Notice given. Daughter calls: her mother is in hospice, still lucid, and wants the daughter
to hold her power of attorney and be her health care surrogate. She asks if someone can come to the
facility this week.
**Expected:** Type **Incapacity documents** · Urgency **Urgent** (reason: rule "hospice") · Owner
**Attorney** · alerts to attorney **and** paralegal, subject starting `URGENT` · welcome draft ·
Status **Needs review**.

### S3. Probate with a hearing date
**Call:** Notice given. Son says his father passed away last month. There's a will naming his sister
as "executor". The sister got a letter about a court hearing on a date about 2 weeks out.
**Expected:** Type **Probate** · Urgency **Urgent** (rule: "hearing") · the hearing date appears in
Dates · Documents: "will", "letter about hearing" · the ticket keeps the caller's own word "executor"
and doesn't change it.

### S3b. Probate, no deadline. This is the case that tells the rules apart
**Call:** Same as S3, but no hearing and no letter. Father passed away three months ago.
**Expected:** Type **Probate** · Urgency **Normal** (per A3, "passed away" alone isn't urgent) ·
Owner **Paralegal**.

### S4. No recording notice
**Call:** The call starts straight into the caller's story. No notice is ever spoken.
**Expected:** Consent **Blocked: no notice** · Claude **never called** (the Log sheet shows no Claude
request for this file) · transcript deleted from the transcription service · audio deleted · row has
only time, file name and reason · paralegal alerted "call back" · no email draft.

### S5. Caller objects to recording
**Call:** Notice given, but the caller answers: "Actually, I'd rather this not be recorded." Then the
call continues.
**Expected:** Same as S4, with reason **Blocked: caller declined**. Even though the call continues
and has useful details, **none of it is kept**.

### S6. Existing client, status check
**Call:** Notice given. Caller says the firm is already doing their trust. They're asking whether the
deed transfer is done yet.
**Expected:** Type **Existing matter** · Urgency **Normal** · Owner **Paralegal** · **no** welcome draft ·
Next action mentions "deed transfer status".

### S7. Not our practice
**Call:** Notice given. Caller wants help with a divorce and custody.
**Expected:** Type **Not our practice** · decline draft that mentions the Florida Bar Lawyer Referral
Service · no welcome draft.

### S8. Stalled ticket reminder
**Setup:** After S1 runs, set its Last activity to 4 days ago in the Sheet.
**Expected:** The next reminder run emails the paralegal once, subject starting `Stalled:`. Running it
again the same day sends **nothing**. Mark the ticket Closed, set Last activity back again, run
again: **nothing**.

### S9. Rule overrides Claude
**Setup:** Covered by S2 and S3. Check the Log sheet: if Claude rated either one lower than Urgent, the
final urgency is still Urgent, and the reason names the rule.

---

## Part C. Who checks what

| Checked by | What |
|---|---|
| Automated tests (run with one command) | Consent check (S4, S5), rule triggers (S3 vs S3b), rule-overrides-Claude (S9), stall math (S8), routing table (A4) |
| **QA (owner)** | Every scenario end to end in the real Sheet and Gmail; the wording of the drafts; whether the extracted facts match the call |
