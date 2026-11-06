# Why a solo agent picks Veyrn: the 10 things that matter

Distilled from [report.md](./report.md) on 28 October 2026. The buyer is a **solo real-estate agent or broker in India**: one person, an Android phone, leads from portals, Facebook ads and WhatsApp, often out on site visits, and no assistant. Their problem isn't a lack of features. It's that **leads go cold while they're busy**, and every rupee and every minute of setup counts.

Each point gives the pain, our promise, where we stand today and what's left to build.

Status key:
- ✅ shipped
- 🟡 partly there
- ❌ not built

---

### 1. "I lose leads because I reply late"

**Pain:** enquiries arrive at 11 pm or while the agent is driving to a site. The first broker to reply usually wins the client.

**Promise:** every WhatsApp enquiry gets an answer within a minute, around the clock, in the customer's own language (Hinglish included). The answer comes from the agent's own knowledge: projects, prices, locations.

**Status:** 🟡 AI auto-replies are built behind a flag, along with human takeover.

**Build:**
- Turn auto-replies on by default in the AI add-on.
- Show a "replied in 40 s" stat on the overview, so the agent sees what we saved them.

**Versus rivals:**
- Most Indian CRMs at this price offer templates or manual WhatsApp only.
- Realatic keeps AI on its Business tier.
- WhatsApp bot tools charge ₹999 and up for this alone.

### 2. "My leads are scattered across five apps"

**Pain:** leads come from 99acres, MagicBricks, Housing.com, Facebook/Instagram ads and WhatsApp. The agent copies them into a notebook or Excel and loses some.

**Promise:** every lead lands in one list automatically, with its source tagged.

**Status:** ❌ This is our biggest gap. Today we only have manual entry and CSV import.

**Build:**
- Meta Lead Ads webhook (P0).
- Portal capture by parsing the portals' lead emails (P0). Start with 99acres and MagicBricks.

**Versus rivals:** ClosingFox, Privyr, TeleCRM and Realatic all have this. **Buyers reject us without it.**

### 3. "Fixing a site-visit time takes ten messages"

**Pain:** "Saturday? Morning or evening? 11 works? Oh, I have another visit…" A solo agent can't afford double bookings or missed visits.

**Promise:** the AI offers free slots from the agent's real Google Calendar and books the visit, with no double booking.

**Status:** ✅ Shipped, but **only on Pro Plus**, the 3-user team plan. That locks our best feature away from the buyer who needs it most.

**Build:** move AI booking into the AI Assistant add-on, so a solo agent gets it at **₹499 + ₹399 = ₹898**.

**Versus rivals:** we found **no rival at our price that does this**. It's our headline.

### 4. "I forget to follow up, and the deal goes to someone else"

**Pain:** most deals close after the 3rd to 5th follow-up, and a solo agent's memory is the CRM.

**Promise:** the agent never has to remember. Overdue leads get a polite nudge, drafted by AI and sent automatically or after one tap.

**Status:** 🟡
- Follow-up reminders and AI-drafted *email* follow-ups are shipped.
- Indian clients answer WhatsApp, not email.

**Build:**
- WhatsApp follow-ups using approved utility templates (₹0.115 each, billed by Meta).
- A simple two- or three-step sequence later (P1).

### 5. "I run my business from my phone"

**Pain:** the agent is on site all day. A desktop-first CRM goes unused.

**Promise:** everything they need in two taps on an Android phone:
- call or WhatsApp the lead
- log what happened
- see today's visits

**Status:** 🟡 The interface is responsive, but there are **no click-to-call or click-to-WhatsApp links** anywhere.

**Build:**
- `tel:` and `wa.me` buttons on every lead (quick win, days of work).
- A one-tap call-outcome log.
- An installable PWA.
- A native app with call detection can come later.

**Versus rivals:** TeleCRM, Privyr and ClosingFox all sell themselves on being mobile-first.

### 6. "Every morning I don't know where to start"

**Pain:** 80 open leads, and no idea which 5 matter today.

**Promise:** one "Today" screen showing:
- visits
- overdue follow-ups
- the hottest new leads, ranked by AI on budget, timeline and how recently they replied

**Status:**
- 🟡 Overview and follow-ups views exist.
- ❌ No ranking. Lead scoring is the cheap P1 item (it reuses the existing AI pipeline).

**Build:** a "Today" list at the top of the overview, plus AI lead scoring in the add-on.

### 7. "I'm not paying team prices for just me"

**Pain:** the old card charged ₹4,000 for one user. Rivals charge ₹374–₹1,100. Seat-based pricing punishes the person who's trying to grow.

**Promise:** **₹499 a month, or ₹399 billed annually, GST extra.** Extra users cost ₹199. AI is an optional ₹399 add-on, not a forced tier jump.

**Status:** ✅ Done on this branch:
- price table, database payment checks and ₹199 seats
- "+ GST" shown on prices
- old subscribers protected at their original price

**Still open:** create the new Razorpay Plans. The AI add-on needs building.

### 8. "No surprise bills"

**Pain:** solo agents have been burned by usage bills: SMS packs, WhatsApp credits, AI tokens.

**Promise:** hard monthly caps, never automatic overage. When the AI allowance runs out, it pauses and asks; it never charges. WhatsApp message charges go straight from Meta to the agent's own account at Meta's price, with no markup from us.

**Status:**
- ✅ Caps and the 70% cost ceiling are built.
- 🟡 Who pays Meta still has to be confirmed (report §7.3) before we promise it.

### 9. "My clients are mine"

**Pain:** portal CRMs (such as MagicBricks READPRO) keep the agent inside the portal's ecosystem. Agents worry about who sees their client list.

**Promise:**
- Your WhatsApp number, your data.
- Export everything to CSV at any time.
- Data is isolated per workspace and tokens are encrypted.
- No portal owns your relationships.

**Status:** ✅ Built. It's missing from the marketing site.

**Build:** a trust section on the pricing page. This is copy, not code.

### 10. "I don't have time to learn software"

**Pain:** setup calls, demos and training sessions. A solo agent gives up before seeing any value.

**Promise:** working in 10 minutes, no sales call, in five steps:
1. Sign up free.
2. Import your Excel.
3. Connect WhatsApp with Meta's sign-up flow.
4. Paste your project details into AI knowledge.
5. Done.

**Status:**
- 🟡 Each step exists.
- ❌ There's no guided first-run checklist.
- The pricing page promised human onboarding, which ₹499 can't fund. That promise is now replaced with self-serve setup on this branch.

**Build:**
- A first-run checklist in the workspace.
- A 2-minute video.
- A "send yourself a test enquiry" button that shows the AI replying.

---

## The pitch in one line

> **Your 24×7 assistant on WhatsApp: it replies to every enquiry in a minute, books site visits on your calendar and reminds you who to follow up. ₹499 a month, set up in 10 minutes.**

## Build order for the solo-agent launch

| # | Item | Points | Size |
|---|---|---|---|
| 1 | Click-to-call and click-to-WhatsApp on every lead | 5 | Days |
| 2 | AI Assistant add-on: auto-replies and booking move out of Pro Plus | 1, 3, 7 | 1–2 weeks |
| 3 | Meta Lead Ads webhook | 2 | 1–2 weeks |
| 4 | Portal email parsing (99acres, MagicBricks first) | 2 | 2 weeks |
| 5 | WhatsApp template follow-ups | 4 | 1 week |
| 6 | "Today" screen and AI lead scoring | 6 | 1 week |
| 7 | First-run checklist and test-enquiry demo | 10 | Days |
| 8 | Trust and no-surprise-bills copy (after the Meta billing check) | 8, 9 | Days |

Items 1, 2 and 3 move the most buyers. Without lead capture (2–4), the AI has no leads to answer.
