# The problem

**What this page is for:** stating what's broken and who it hurts. Every piece of the demo has to
point back to something on this page. If it can't, we don't build it.

Source: a job posting from a small estate-planning and probate law firm in Florida (an attorney, a
paralegal and a couple of staff), paraphrased. The firm is not named here, and nothing in this repo
is real client data.

---

## 1. What goes wrong

1. **Intake gets typed twice.** A new client's details arrive by form, phone or email. Someone then
   retypes them into the case management system and again into a spreadsheet.
2. **Follow-ups fall through.** A matter stalls while it waits on the client's documents or a
   signature, and nobody notices until the client complains or goes elsewhere.
3. **Nobody sorts the inbox.** Everything lands in one place, and someone has to read each message to
   decide who should handle it.
4. **Calls leave no record.** What was said on the intake call lives in someone's memory or scribbled
   notes. *(We added this one. It's the front door to problem 1.)*

Also in the posting but **out of scope for this demo:** generating first-draft wills, trusts and
POAs from intake answers. It carries the most liability and should come after the plumbing works.

## 2. Who gets hurt

- **The prospective client** waits, answers the same questions twice, and may call another firm.
- **The paralegal** spends the day retyping, chasing and sorting instead of doing legal work.
- **The attorney** can have an urgent matter sitting in the queue behind routine ones, e.g. a client
  in hospice who needs a power of attorney this week.

## 3. Constraints any fix must respect

- **Recording consent.** Florida requires every party's consent to record a call (Fla. Stat.
  § 934.03). Recording without it is a felony.
- **Confidentiality.** Rule 4-1.6, and Florida Bar Ethics Opinion 24-1 on generative AI: know where
  client data goes, whether vendors keep or train on it, and get informed consent where needed.
- **The staff aren't developers.** The staff have to be able to run it without the person who built it.
- **It stays in tools they already pay for.** Google Workspace, with nothing new to learn.

## 4. The demo in one sentence

A call comes in and becomes a ticket: sorted, routed to the right person, with a welcome email
drafted and a reminder if it stalls, and nobody retypes anything.
