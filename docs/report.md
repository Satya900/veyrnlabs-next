# Veyrn CRM: pricing, feature-gap and AI monetisation report

Prepared 28 October 2026 for the planned move from INR 4,000 / 6,000 to INR 499 / 699 per month (India) and USD 9 / 15 per month (international).

**How to read this report.** Section 1 gives the answers. Sections 2–8 hold the evidence and arithmetic behind them. Competitor prices come from vendor pages where they were reachable and from pricing aggregators otherwise. Each table marks which is which, because aggregators disagree and vendors change prices often. Re-check any figure you quote publicly against the vendor's own page on the day. Currency conversions use **₹95 = $1** (approximate, October 2026; confirm before relying on it).

---

## 1. Executive summary

### The verdict on price

| Question | Answer |
|---|---|
| Were we overcharging at ₹4,000 / ₹6,000? | **Yes, heavily, for our target buyer.** A solo agent paid ₹4,000 for one user. The Indian market charges ₹374–₹1,100 per user for comparable or broader feature sets (Bigin ₹400, Realatic ₹399, ClosingFox ₹374–₹499, TeleCRM ₹799, Zoho ₹800, Freshsales ₹1,099). We were 4–10× the market for one seat. |
| Is ₹499 / ₹699 right for India? | **₹499 is right. ₹699 is right only if the seat count and AI usage are bounded.** ₹499 sits in the middle of the real-estate CRM band. ₹699 with 3 included users works out to ₹233 per user, the cheapest per-seat price of any vendor we found, while including AI site-visit booking that rivals keep for custom-priced tiers. |
| Is $9 / $15 right internationally? | **$9 is right as an entry point. $15 under-prices Pro Plus.** In WhatsApp-first markets the comparison set is horizontal CRMs: Bigin $7–18, Freshsales $9, HubSpot $15–20, Pipedrive €14–24. Against US real-estate CRMs ($30–$69 per user before AI) we are far cheaper, but we lack the US table stakes (Section 5.2), so US buyers won't compare like for like. |
| What should AI cost extra? | **₹399 / $9 per workspace per month** for an *AI Assistant* add-on: 24×7 WhatsApp auto-replies, AI site-visit booking and 1,000 AI actions a month, with top-ups at ₹149 / $3 per extra 500. Basic AI drafting stays inside the plans. |
| Is it profitable? | **Yes, at about 45–60% gross margin in India and 70%+ internationally.** That holds once WhatsApp billing goes directly to each customer's Meta account (Section 7). |

### Recommended price card

**India (per workspace, prices exclusive of 18% GST)**

| Plan | Monthly | Quarterly (10% off) | Annual (20% off) | Users included | Extra user |
|---|---|---|---|---|---|
| Free | ₹0 | – | – | 1 | – |
| Pro | **₹499** | ₹449/mo (₹1,347 billed) | ₹399/mo (₹4,788 billed) | 1 | ₹199/mo |
| Pro Plus | **₹699** | ₹629/mo (₹1,887 billed) | ₹559/mo (₹6,708 billed) | 2 *(see 6.3)* | ₹199/mo |
| AI Assistant add-on | **₹399** | ₹359/mo (₹1,077 billed) | ₹319/mo (₹3,828 billed) | per workspace | – |

**International (per workspace, USD)**

| Plan | Monthly | Quarterly | Annual | Users included | Extra user |
|---|---|---|---|---|---|
| Free | $0 | – | – | 1 | – |
| Pro | **$9** | $24 ($8/mo) | $86 ($7.17/mo) | 1 | $4/mo |
| Pro Plus | **$15** *(or $19, see 6.4)* | $40 ($13.33/mo) | $144 ($12/mo) | 2 | $4/mo |
| AI Assistant add-on | **$9** | $24 | $86 | per workspace | – |

The ₹399 annual Pro price matches Realatic's headline (₹399 per user on annual billing) and undercuts ClosingFox's ₹499 Growth tier, so "from ₹399/month" works as a marketing line.

### The five things that matter most

1. **The ₹500 extra seat must go.** It currently costs more than the whole ₹499 plan. Re-price it to ₹199 / $4.
2. **WhatsApp message costs should be billed to the customer by Meta, not absorbed by us.** Customers connect their own WhatsApp Business Account through Embedded Signup, so Meta normally bills the payment method on that account. Our usage ledger currently books every send as a Veyrn cost. Confirm which billing model applies, then treat the WhatsApp allowance as a safety cap rather than a cost line.
3. **The AI cost reservation is not a blocker (corrected).** Each AI reply briefly reserves 110,000 input tokens (about ₹2.26), but the reservation settles to the real cost (₹0.15–0.21) when the reply finishes, so monthly spend tracks actual usage. See Section 6.2.
4. **Close four gaps before growth spending in India.** These are what Indian buyers check first, and every real-estate rival has them:
   - property portal lead capture (99acres, MagicBricks, Housing.com, NoBroker)
   - Meta Lead Ads
   - a mobile app with click-to-call and call logging
   - automatic lead assignment
5. **Close three gaps before selling internationally.** Scheduling is hard-coded to IST, there are no portal integrations for the target markets, and there's no SMS. A $9 plan can't absorb human onboarding either, so onboarding must be fully self-serve.

---

## 2. Where we stand today

### 2.1 What the product does (verified in the codebase)

| Area | Status |
|---|---|
| Leads, clients, stages, activities, tasks, follow-ups, saved views, CSV import/export | Shipped |
| Kanban and list pipeline, reports (Pro Plus), global search | Shipped |
| Multi-tenant workspaces, invitations, roles, ownership transfer | Shipped |
| WhatsApp inbox with delivery and read receipts, reviewed replies, Embedded Signup with encrypted per-tenant tokens | Shipped; live multi-tenant onboarding not yet end-to-end verified |
| AI reply drafts (Groq `gpt-oss-120b`), company knowledge, human takeover | Shipped |
| Opt-in automatic AI replies through a durable worker | Shipped behind a flag |
| AI site-visit booking from WhatsApp with Google Calendar conflict checks (Pro Plus) | Shipped |
| Automatic email follow-ups for overdue leads (Resend) | Shipped behind a flag |
| Razorpay subscriptions, quarterly/annual prepay, extra seats, usage allowances with a 70% cost ceiling | Shipped |
| Portal integrations, Meta Lead Ads, mobile app, telephony, SMS, inventory, broadcasts, drip sequences, lead scoring, multi-time-zone scheduling | **Not built** |

### 2.2 What the current price card says

Pro ₹4,000 (1 user), Pro Plus ₹6,000 (3 users), extra users ₹500 each, with 10% off quarterly and 20% off annually. The marketing page also shows a Free tier, and both paid plans promise "standard onboarding". Human onboarding is affordable at ₹4,000 but not at ₹499 (Section 7.4).

---

## 3. The Indian market

### 3.1 Market size

- About **500,000 real-estate brokers** in India, of whom only about 15% use technology effectively. RERA-registered agents grew from 27,073 (2018) to **105,712 (2025)**, up 19% in a year. ([Realty Today](https://therealtytoday.com/news/trending/indias-rera-registered-real-estate-agents-grow-19-in-2025-cross-100000-mark-exp-realty-india-report/), [SME Street](https://smestreet.in/infocus/magicbricks-drives-crm-adoption-among-15000-brokers-in-india-8644352))
- **MagicBricks' READPRO** reached **85,000+ licences across 200+ cities** in six months. It's the portal-backed incumbent, and its pricing isn't public. A portal bundling a CRM with lead supply is the strongest competitive threat in India. ([Realty Today](https://www.therealtytoday.com/news/technology/magicbricks-expands-proptech-solution-readpro-to-200-cities-with-85000-licenses/))

### 3.2 Indian CRM pricing (per user per month unless stated)

| Vendor | Price | Billing | AI | WhatsApp | Source quality |
|---|---|---|---|---|---|
| **Realatic** (real estate) | Free (100 leads/mo); **Pro ₹399/user**; Business custom | Annual for ₹399; 20% off vs monthly | AI WhatsApp agent (auto-replies) only on custom-priced Business | WhatsApp chat, templates, broadcasts on Pro | Vendor page ([realatic.com/pricing](https://realatic.com/pricing)) |
| **ClosingFox** (real estate) | Starter ₹374, Growth ₹499, Developer ₹1,249 | Annual prepaid, minimum 3 users | Not stated | Support, no API | Vendor comparison ([closingfox.com](https://closingfox.com/crm-comparisons/real-estate-crm-pricing-india/)) |
| **Bigin by Zoho** | Free; Express ₹400; Premier ₹720; Bigin 360 ₹1,080 | Annual | Premier 1,000 AI credits/mo; 360 3,000 | Via add-ons | Vendor clarification ([bigin.com](https://www.bigin.com/articles/bigin-india-pricing-clarification.html)); AI credits ([Zoho help](https://help.zoho.com/portal/en/kb/bigin/ai/ai-features/articles/ai-features-in-bigin)) |
| **TeleCRM** | ₹799 (annual) / ₹1,099 (quarterly) | No monthly plan | None | Chat sync +₹200/user; API setup ₹1,999 one-time | Vendor page ([telecrm.in/pricing](https://telecrm.in/pricing)) via aggregator |
| **Zoho CRM** | Standard ₹800, Professional ₹1,400, Enterprise ₹2,400, Ultimate ₹2,600 | Annual | Full Zia assistant from Enterprise | Add-ons | Aggregator ([Business Today](https://www.businesstoday.in/technology/news/story/zoho-explained-products-features-and-pricing-for-indian-businesses-495208-2025-09-23)) |
| **Freshsales** | Free (3 users); Growth ₹1,099; Pro ₹3,599; Enterprise ₹6,099 | Annual | Freddy scoring from Growth; Copilot add-on $29/user | Add-ons | Partner page ([itforsme.in](https://itforsme.in/pricing/freshsales-india)); Copilot ([eesel](https://www.eesel.ai/blog/freshdesk-freddy-copilot-pricing-2026)) |
| **Privyr** (lead CRM) | Free (3 members); Pro ~$12–24/user (USD, about ₹1,140–2,280) | Monthly or annual | – | WhatsApp auto-responder is a **paid add-on** | Vendor page ([privyr.com/pricing](https://www.privyr.com/pricing)) did not show the number; range from [ClosingFox](https://closingfox.com/crm-comparisons/real-estate-crm-pricing-india/) |
| **Sell.Do** (real estate, developers) | About ₹1,500–3,000/user, quote only | Annual typical | None reported | Timeline; BSP charges ₹0.50–1.50/message | Aggregator ([Sell.Do blog](https://www.sell.do/blog/real-estate-crm-pricing-india-2026), [Realatic](https://realatic.com/blog/best-crm-real-estate-india/)) |
| **LeadSquared** | $25–$100/user (sources disagree) | Annual | Some | Yes | Aggregator ([TrustRadius](https://www.trustradius.com/products/leadsquared/pricing)) |
| **Kylas** | ₹12,999/mo **flat, unlimited users**; Professional ₹24,999 | Quarterly or longer | – | – | Aggregator ([Vivelead](https://vivelead.com/blog/crm-pricing-india/)) |
| **MagicBricks READPRO** | Not public | – | "AI-driven" | – | News ([Realty Today](https://www.therealtytoday.com/news/technology/magicbricks-expands-proptech-solution-readpro-to-200-cities-with-85000-licenses/)) |

**WhatsApp tools Indian SMBs already pay for** (these anchor what an AI WhatsApp assistant is worth):

| Tool | Monthly | Notes |
|---|---|---|
| Interakt | ₹999 / ₹2,499 / ₹3,999 | Plus Meta per-message charges |
| AiSensy | ₹1,500 / ₹3,200 | Plus Meta charges |
| WATI | ₹2,499 / ₹4,499 / ₹13,499 | Plus Meta charges |
| Managed WhatsApp AI agents | ₹1,800–₹10,999/mo; agency builds from ₹49,999 setup + ₹14,999/mo | Haptik launched SMB WhatsApp AI agents from ₹10,000 |

Sources: [go4whatsup](https://go4whatsup.com/blog/aisensy-vs-wati-vs-interakt-pricing-showdown-2026/), [codingclave](https://codingclave.com/blog/wati-pricing-india-2026), [Business Today](https://www.businesstoday.in/technology/news/story/haptik-launches-whatsapp-ai-agents-for-smbs-starting-at-rs10000-492296-2025-09-04), [Mayank Digital Labs](https://www.mayankdigitallabs.in/blog/ai-agents-for-small-business-india-2026). All aggregator-grade.

### 3.3 Where ₹499 / ₹699 lands

```
Per user per month, INR (annual billing where offered)
ClosingFox Starter   ███▊                 374
Realatic Pro         ████                 399
Bigin Express        ████                 400
Veyrn Pro (new)      █████                499  ← 1 user
ClosingFox Growth    █████                499
Veyrn Pro Plus/2u    ███▌                 350  ← ₹699 ÷ 2 users
Veyrn Pro Plus/3u    ██▍                  233  ← ₹699 ÷ 3 users
Bigin Premier        ███████▏             720
TeleCRM              ████████             799
Zoho CRM Standard    ████████             800
Freshsales Growth    ███████████          1,099
Privyr Pro           ███████████▍–██████  ~1,140–2,280
Sell.Do              ███████████████…     ~1,500–3,000
Veyrn Pro (old)      ████████████████████████████████████████ 4,000
```

At ₹499 we're priced with the real-estate specialists rather than against them. The old ₹4,000 price was above every vendor in this list except Kylas's flat-rate plan, which covers unlimited users.

---

## 4. The international market

### 4.1 Who would buy at $9 / $15

Our edge is WhatsApp, and WhatsApp is the main sales channel in the UAE and Saudi Arabia, the UK and much of Europe, Brazil and Mexico, Indonesia, Nigeria and South Africa. It is not the main channel in the United States, where agents work by phone and SMS. That decides the comparison set.

### 4.2 International pricing

**Real-estate CRMs (mostly US)**

| Vendor | Price | AI inclusion | Source quality |
|---|---|---|---|
| Follow Up Boss | Grow $58/user (annual) or $69 (monthly); Pro $416–499 flat for 10 users; Platform $833–1,000 for 30 users | AI included at no charge (smart replies, "Gabby" texting assistant, AI scoring); calling +$39/user | Vendor page ([followupboss.com/pricing](https://www.followupboss.com/pricing)) via aggregator ([CloudTalk](https://www.cloudtalk.io/blog/follow-up-boss-pricing/)) |
| Wise Agent | $49/mo flat for up to 5 shared users | AI bot is a metered add-on: **$15 per 10 conversations** | Aggregator ([Luxury Presence](https://www.luxurypresence.com/?p=43410)) |
| LionDesk | $30 / $49 / $99 | Message bundles included | Aggregator ([Capterra](https://www.capterra.com/p/151891/LionDesk/pricing/)) |
| IXACT Contact | $46.75 (annual) / $55 (monthly); team members $28.90 | Texting from $5 for 100 credits | Aggregator ([Luxury Presence](https://www.luxurypresence.com/?p=44436)) |
| Top Producer | $179–$599 per user | – | Aggregator ([Luxury Presence](https://www.luxurypresence.com/blogs/top-producer-pricing/)) |
| Lofty | ~$449+/mo, $299–1,499 setup | **AI Sales Agent $60/mo for 200 leads, +$30 per 100** | Aggregator ([Luxury Presence](https://www.luxurypresence.com/blogs/lofty-pricing/)) |
| BoldTrail (kvCORE) | ~$499+/mo, quote only | Bundled | Aggregator ([aitoolsbakery](https://aitoolsbakery.com/blog/boldtrail-pricing-2026/)) |
| Structurely (AI inside-sales agent) | $499 (team) / $999 (company) + **$0.06–0.08 per action**, $2,000–2,500 setup | It *is* the AI | Aggregator ([Follow Up Ace](https://followupace.com/compare/structurely/)) |

**Horizontal CRMs, the realistic comparison for WhatsApp markets**

| Vendor | Price per user per month | AI inclusion | Source |
|---|---|---|---|
| Bigin by Zoho | $7 / $12 / $18 | AI credits on the top two tiers | [Capterra](https://capterra.com/p/204998/Bigin-by-Zoho-CRM/pricing/) |
| Freshsales | Growth $9, Pro $39, Enterprise $59 | Copilot +$29/user | [eesel](https://www.eesel.ai/blog/freshdesk-freddy-copilot-pricing-2026) |
| HubSpot Starter platform | $15 (annual) / $20 (monthly); $9 promo | **500 Breeze AI credits per seat**, extra about $10 per 1,000 | [eesel](https://www.eesel.ai/blog/how-much-does-hubspot-ai-really-cost) |
| Pipedrive | Lite €14 / €24; Growth €39 / €49 | AI reports from Lite; AI assistant on higher tiers | [zeeg](https://zeeg.me/post/pipedrive-pricing) |
| Zoho CRM | $14 / $23 / $40 / $52 | Zia agents; Zoho-hosted LLM tokens free up to a cap | [automationatlas](https://automationatlas.io/answers/zoho-crm-pricing-explained-2026/) |
| Less Annoying CRM | $15 | None | [Capterra](https://www.capterra.com/p/118921/Less-Annoying-CRM/pricing/) |
| Capsule | $21–$75 | Higher tiers | [dupple](https://dupple.com/pricing/capsule-crm) |
| folk | $30–$100 | Included | [dupple](https://dupple.com/pricing/folk) |

### 4.3 Where $9 / $15 lands

- **Pro at $9 matches the floor of the horizontal market** (Freshsales Growth $9, Bigin Premier $12, HubSpot $15) and adds a WhatsApp inbox, which those plans don't have. That's justified.
- **Pro Plus at $15 for 2–3 users with AI site-visit booking under-prices the value.** HubSpot charges $15–20 *per seat* and Pipedrive's comparable tier is €39. Real-estate rivals charge $58–69 per user before AI. Either keep $15 with 2 included users and AI on the add-on (the recommendation), or raise Pro Plus to $19 with 3 users.
- **We don't compete with US real-estate suites** on features (no MLS/IDX, SMS, dialer or transaction management), so don't market in the US for now. Being 6× cheaper doesn't help if the product is missing what US buyers check for first.

---

## 5. Where we're behind (gap analysis)

Priority: **P0** = buyers reject us without it; **P1** = it costs deals; **P2** = it differentiates.

### 5.1 India

| Gap | Who has it | Priority | Notes |
|---|---|---|---|
| **Portal lead capture** (99acres, MagicBricks, Housing.com, NoBroker) | Sell.Do, Realatic, Corefactors, ClosingFox (6 sources) | **P0** | Portal leads are the main paid lead source for Indian brokers. Start with email-parsing plus webhook ingestion. |
| **Meta (Facebook/Instagram) Lead Ads** | ClosingFox, Privyr, TeleCRM | **P0** | Second-largest source; Privyr built its business on it. |
| **Mobile app** with click-to-call, call logging and offline use | TeleCRM, ClosingFox, Privyr, Realatic | **P0** | Indian agents work from Android phones. A PWA with `tel:` links and manual call outcomes is the minimum; a native app with call detection is the competitive standard. |
| **Automatic lead assignment** (round-robin or rules) | ClosingFox, Privyr, TeleCRM | **P0** | We only have manual assignment. |
| WhatsApp templates and broadcasts | Realatic Pro, Interakt, AiSensy, WATI | P1 | Marketing templates cost the sender ₹0.86 + GST each; needed for re-engagement. |
| Project/unit inventory and cost sheets | Realatic, ClosingFox, Sell.Do | P1 | Essential for builder and channel-partner segments; less so for resale brokers. |
| Multi-channel drip sequences (WhatsApp + email) | Realatic Business, Privyr | P1 | We have single-step overdue email follow-ups. |
| AI lead scoring | Freshsales, Realatic, Follow Up Boss | P1 | Cheap to add on top of the existing AI pipeline. |
| Telephony / IVR / call recording | TeleCRM, Kylas, LeadSquared | P2 | Partner (Exotel, Knowlarity) rather than build. |
| Bookings, payments, post-sales (RERA, TDS, possession) | Realatic Business, PropFlo | P2 | Developer segment only. |
| Hindi and regional-language interface | Few | P2 | The AI already reads Hinglish; the interface doesn't support other languages. |

### 5.2 International

| Gap | Priority | Notes |
|---|---|---|
| **Per-company time zones and business hours** | **P0** | Scheduling is hard-coded to IST (`docs/saas-transition.md`), which breaks site-visit booking anywhere else. |
| **Market portal integrations** (Property Finder and Bayut in the UAE; Rightmove and Zoopla in the UK; Zap Imóveis in Brazil) | **P0 for any market we enter** | Same role as 99acres in India. |
| SMS channel | P1 (P0 for the US) | Twilio-style passthrough. |
| Multi-currency display, invoices and tax handling | P1 | USD checkout through Razorpay international; confirm that Subscriptions support USD plans (Section 7.5). |
| MLS/IDX, transaction management, e-signature | US only | Out of scope until the US is a target. |

### 5.3 Where we lead

| Strength | Rivals at our price | Rivals overall |
|---|---|---|
| WhatsApp inbox with AI drafts and human takeover | Realatic (Pro has inbox; AI only on Business), Privyr (auto-responder add-on) | Interakt/WATI-style tools (no CRM), Follow Up Boss (SMS, not WhatsApp) |
| **AI books site visits against the agent's real Google Calendar with conflict checks** | **None found** | Structurely, Lofty AI agent (US, $60–$999/mo + setup) |
| Strict usage caps, no surprise bills, per-tenant isolation, encrypted tokens | Rarely stated | Enterprise vendors |
| Modern, fast, light interface (Attio/Linear-style) | Most Indian rivals look dated | – |

**Positioning line:** *"The WhatsApp-first real-estate CRM whose AI answers enquiries and books site visits on your calendar, from ₹399/month."*

---

## 6. How competitors include AI, and what ours should cost

### 6.1 The five ways vendors charge for AI

| Model | Examples | Fit for us |
|---|---|---|
| **Bundled in higher tiers** | Zoho (Enterprise), Pipedrive (upper tiers), Follow Up Boss (no extra charge) | Simple, but hides the cost; risky at ₹699 |
| **Credits included per seat** | HubSpot (500/seat, about $10 per 1,000 extra), Bigin (1,000 / 3,000 per month) | Good fit; we already meter "AI units" |
| **Per-seat add-on** | Freshsales Freddy Copilot $29/user | Too expensive for Indian SMBs |
| **Metered per lead or conversation** | Lofty $60/200 leads ($0.30/lead), Wise Agent $15/10 conversations ($1.50 each), Structurely $0.06–0.08/action | Matches our cost shape; anchors value |
| **Separate WhatsApp AI tools** | Interakt/AiSensy/WATI ₹999–₹13,499, Haptik from ₹10,000/mo | The tools we can replace for a WhatsApp-first agent |

### 6.2 What one AI action actually costs us

Provider: Groq `openai/gpt-oss-120b` at **$0.15 per million input and $0.60 per million output tokens** ([Groq model docs](https://console.groq.com/docs/models)). Our configured internal accounting rates are deliberately higher: ₹20 / ₹80 per million.

| Scenario | Input tokens | Output tokens | At Groq list price | At our configured rates |
|---|---|---|---|---|
| Typical reply (about 12k characters of knowledge + 8 messages + instructions) | ~7,500 | ≤700 | **₹0.15** | **₹0.21** |
| Short thread, small knowledge base | ~3,000 | ~400 | ₹0.07 | ₹0.09 |
| **Current reservation bound** (`docs/crm-ai-rollout.md`) | 110,000 | 700 | ₹1.61 | **₹2.26** |

**Finding (corrected 28 October 2026):** the 110,000-token bound is about 14× the realistic request size, but it is only a temporary hold. `crm_finish_ai_draft` settles each reservation to the actual provider cost, so a month's spend reflects real usage (₹0.15–0.21 per reply), not ₹2.26. The bound costs us two smaller things: AI stops about ₹2.26 before the ceiling is actually reached, and an attempt whose outcome can't be confirmed keeps its full ₹2.26 hold until support reconciles it. The bound is the worst case for 24,000 characters of input at 4 UTF-8 bytes each (Hindi or other non-Latin text), so it should stay until input is measured with the model's own tokenizer. **This is not a launch blocker.**

Other variable costs:

| Item | Unit cost | Source |
|---|---|---|
| WhatsApp **service** reply (inside the 24h window), India | Free for the first 1,000/month **per business number**, then ₹0.115 + GST | [Meta pricing docs](https://developers.facebook.com/docs/whatsapp/pricing/) (change effective 1 Oct 2026); [ChatMaxima](https://chatmaxima.com/whatsapp-api-pricing/india/) |
| WhatsApp **utility** template (for example a follow-up outside the window) | ₹0.115 + GST | same |
| WhatsApp **marketing** template | ₹0.8631 + GST (₹1.02) | same |
| Click-to-WhatsApp ad entry point | Free window up to 7 days | Meta docs |
| Follow-up email (Resend Pro, $20 per 50k) | ~₹0.04 | [automationatlas](https://automationatlas.io/answers/resend-pricing-explained-2026/) |
| Google Calendar API | Free | – |

### 6.3 What the AI Assistant add-on should cost

**Recommendation:** ₹399 / $9 per workspace per month for:
- automatic WhatsApp replies, 24×7, with human handover
- AI site-visit booking (on Pro and Pro Plus)
- AI lead scoring and summaries once built
- 1,000 AI actions a month, with top-ups at ₹149 / $3 per 500

Why this price:

1. **The rule of thumb.** AI add-ons commonly price at 25–50% of the base plan ([Monetizely](https://www.getmonetizely.com/articles/the-beginners-cheat-sheet-to-ai-pricing-models-in-2026-e4939)). On a ₹699 base that's ₹175–₹350. ₹399 is slightly above the band, which is justified because the add-on replaces a separate WhatsApp bot tool (₹999–₹4,499).
2. **Anchors.** Wise Agent charges $1.50 per AI conversation and Lofty $0.30 per lead. Ours works out to ₹0.40 (about $0.004) per action included, so the value is easy to explain.
3. **Margin.** 1,000 actions × ₹0.21 = ₹210 worst-case realistic cost, plus about ₹14 in payment fees, leaves **₹175 contribution (44%)** on ₹399. At Groq list prices it's ₹150 (59%). Internationally, $9 nets about ₹815, leaving **₹605 (71%)**.

**What stays in the plans without the add-on**, so the base tiers aren't AI-free:

| Plan | AI included |
|---|---|
| Free | None |
| Pro | 150 AI reply drafts/month (human sends) |
| Pro Plus | 300 AI reply drafts/month + AI lead summaries |
| + AI Assistant | Auto-replies, AI booking, 1,000 actions, top-ups |

**Packaging alternative:** a "Pro Plus AI" tier at ₹999 / $22 instead of an add-on. That's simpler to sell, but it forces AI buyers onto Pro Plus and hides AI cost inside the tier. Prefer the add-on.

### 6.4 Seats

| Option | Effective per-user price on Pro Plus | Verdict |
|---|---|---|
| 3 included users (current) | ₹233 | Cheapest per seat in the market; under-charging, with the most support load per rupee |
| **2 included users** | ₹350 | **Recommended.** Still below Bigin Express (₹400) and Realatic (₹399) |
| Extra users at ₹500 (current) | – | More than the ₹499 plan itself; must change |
| **Extra users at ₹199 / $4** | – | **Recommended.** Below every competitor's per-user price |

---

## 7. Unit economics at the new prices

### 7.1 Assumptions

- Prices exclude GST. Indian B2B customers pay GST on top; exports are zero-rated under a Letter of Undertaking (confirm with your CA).
- **Payment fees:**
  - domestic: about 2% + GST, plus about 1% + GST for Razorpay Subscriptions, so **about 3.5%**
  - international cards: 3% + GST plus the subscription fee, so **about 4.7%** ([Xflowpay](https://www.xflowpay.com/blog/razorpay-international-payment-gateway-charges), [Razorpay](https://razorpay.com/blog/razorpay-payment-gateway-pricing-explained/))
- **Fixed platform cost about ₹12,000/month:**
  - Supabase Pro $25–75 ([makerkit](https://makerkit.dev/blog/saas/supabase-pricing))
  - Vercel Pro $20 + usage ([makerkit](https://makerkit.dev/blog/saas/vercel-cost))
  - Resend Pro $20
  - domain, monitoring and the worker
- Self-serve support averages 15 minutes per workspace per month at ₹400/hour, so **₹100**.
- **WhatsApp is billed by Meta to the customer's own account (7.3).** If we absorb it instead, add the WhatsApp row in 7.2.

### 7.2 Monthly contribution per workspace (at 200 paying workspaces)

| Line (₹) | Pro ₹499 | Pro Plus ₹699 | Pro Plus + AI ₹1,098 | Intl Pro $9 | Intl Pro Plus + AI $24 |
|---|---|---|---|---|---|
| Revenue (net of discounts, excl. GST) | 499 | 699 | 1,098 | 855 | 2,280 |
| Payment fees | −17 | −24 | −38 | −40 | −107 |
| Platform share (₹12,000 ÷ 200) | −60 | −60 | −60 | −60 | −60 |
| Support | −100 | −100 | −120 | −100 | −120 |
| AI drafts (150 / 300 × ₹0.21) | −32 | −63 | −63 | −32 | −63 |
| AI Assistant actions (1,000 × ₹0.21) | – | – | −210 | – | −210 |
| Follow-up email (500 × ₹0.04) | −20 | −20 | −20 | −20 | −20 |
| **Contribution** | **270** | **432** | **587** | **603** | **1,700** |
| **Gross margin** | **54%** | **62%** | **53%** | **71%** | **75%** |
| *If we absorb WhatsApp (300 utility sends × ₹0.136)* | *−41 → 46%* | *−41 → 56%* | *−41 → 50%* | – | – |

Every plan clears the 30% minimum margin you set. With annual billing (20% off), Pro drops to about ₹170 contribution (43%) and stays above the floor. International customers earn **2.2× (Pro) to 2.9× (Pro Plus + AI)** the contribution of their Indian equivalents, which is why the international launch matters even though the product is Indian-first.

### 7.3 WhatsApp billing: confirm before launch

With Embedded Signup, each customer connects *their own* WhatsApp Business Account. Under Meta's Tech Provider model the customer adds a payment method to that account and **Meta bills them directly**; a Solution Partner can extend its own credit line instead. Our code currently books each send at `WHATSAPP_REPLY_COST_PAISE` as a Veyrn cost and caps it with a plan allowance. Confirm which model our Meta app uses:

- **Customer pays Meta:** keep the allowance as an abuse and safety cap, set its internal cost to 0, and say on the pricing page that "WhatsApp message charges are billed by Meta to your WhatsApp Business account". Most Indian rivals do this (TeleCRM, Interakt, WATI and AiSensy all pass Meta charges through).
- **We pay Meta:** keep the cost line, and price broadcast/marketing templates as top-ups. At ₹1.02 per marketing message, a single 1,000-contact broadcast costs more than the ₹699 plan.

The 1 October 2026 change also means automatic replies are free only for the first 1,000 service messages per business number per month ([Meta](https://developers.facebook.com/docs/whatsapp/pricing/)). Busy agents will exceed that, so the customer-pays model matters more now than it did when the cost estimates were written.

### 7.4 Break-even and support

- Fixed platform cost is covered by about **45 Pro workspaces** (₹12,000 ÷ ₹270). Founder time isn't included.
- **Support is the hidden variable.** At ₹499, a single 30-minute onboarding call (about ₹200) uses most of the monthly contribution. Replace "standard onboarding" on the pricing page with:
  - in-app setup checklists
  - CSV and portal import wizards
  - a sample workspace (the demo already exists)
  - short videos

  Offer paid onboarding (₹2,999 one-time, or included with annual Pro Plus) for teams that want a call.

### 7.5 Engineering changes the new card requires

| Change | Why | Where |
|---|---|---|
| Replace computed discounts with an **explicit price table per plan, billing period and currency** | ₹499 × 0.8 × 12 = ₹4,790.40; we want ₹4,788 (₹399 × 12), and USD rounds differently ($86, not $86.40) | `src/lib/crm/plans.ts` `planPrice`; the pricing page; Razorpay Plan ids |
| New Razorpay Plans: 2 plans × 3 periods × 2 currencies, plus seat and AI add-on plans | Each Plan's amount must equal the exact charge | `.env` `RAZORPAY_PLAN_*`; **confirm that Razorpay Subscriptions support USD-denominated plans for international cards** |
| Re-price extra seats to ₹199 / $4 | Current ₹500 exceeds the plan | `RAZORPAY_PLAN_EXTRA_SEAT`, copy in Settings and pricing |
| AI Assistant add-on subscription and entitlement | Gate auto-replies and booking on the add-on, not the tier | Billing migration + `crm_plan_tier` |
| ~~Tighten the AI reservation bound~~ Not needed: reservations settle to actual cost (Section 6.2) | – | – |
| Lower `CRM_OVERHEAD_*_PAISE` and set allowances from Section 7.2 | Ceilings scale with the new revenue | Env + `docs/crm-usage-rollout.md` |
| Per-company time zone | International booking | Calendar slots, workers |
| Migrate any existing ₹4,000/₹6,000 subscribers | Fairness and refund exposure | Credit the remaining balance against the new plans or keep them grandfathered on request |
| Show prices as "₹499 + GST" | Indian B2B convention, and avoids disputes | Pricing page |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| A portal-backed rival (READPRO) bundles CRM with lead supply | Win on WhatsApp and AI booking; integrate portals so agents can use us alongside them |
| AI costs rise (model change, longer contexts) | Usage allowances are enforced per action; reprice top-ups rather than base plans; keep a cheaper fallback (`gpt-oss-20b` is half the price) |
| Meta pricing changes again | Customer-pays billing passes the risk through |
| Cheap prices attract high-support customers | Self-serve onboarding, paid onboarding, annual-first offers |
| Currency moves on USD prices | Indian costs are mostly USD-denominated (Groq, Supabase, Vercel), so USD revenue is a natural hedge |
| Competitors cut prices (ClosingFox ₹374, Bigin ₹400) | Compete on AI booking and WhatsApp depth, not on the lowest number; ₹399 annual is already at the floor |

---

## 9. Suggested sequence

1. **Before announcing the price change:** WhatsApp billing model (7.3), explicit price table and Razorpay plans, ₹199 seats, existing-subscriber migration, pricing page copy.
2. **Within 30 days of launch (India P0):** portal lead capture, Meta Lead Ads, round-robin assignment, a mobile PWA with click-to-call.
3. **AI Assistant add-on launch:** auto-replies and booking gated on the add-on, top-ups, AI lead scoring.
4. **International launch (pick one market first, for example the UAE):** per-company time zones, Property Finder/Bayut integration, USD checkout verified end-to-end.

---

## Appendix A. Price conversions used

| Price | ₹ (at 95) | $ (at 95) |
|---|---|---|
| ₹499 | – | $5.25 |
| ₹699 | – | $7.36 |
| $9 | ₹855 | – |
| $15 | ₹1,425 | – |
| $29 (Freddy Copilot) | ₹2,755 | – |
| $58 (Follow Up Boss Grow, annual) | ₹5,510 | – |

Our USD prices are about 1.6–2× the INR prices at market rates. That's in line with typical purchasing-power pricing for India and gentler than consumer examples such as Spotify (about 7.8×) ([Fungies](https://fungies.io/purchasing-power-parity-saas-pricing-2026)).

## Appendix B. Confidence and limits

- **High confidence (vendor or official pages):** Groq model prices, Meta's WhatsApp pricing model and the October 2026 change, Bigin India prices, Realatic plans, Privyr plan structure, Follow Up Boss plan structure.
- **Medium (consistent across aggregators):** Zoho, Freshsales, TeleCRM, ClosingFox, HubSpot, Pipedrive, Wise Agent, IXACT, LionDesk, Lofty AI add-on, Structurely, Razorpay fees, Supabase/Vercel/Resend.
- **Low (sources disagree or quote-only):** LeadSquared, Sell.Do, BoldTrail, Kylas, READPRO (no public price), Privyr's exact Pro price, the exchange rate (forecast-based).
- Cost model figures (support minutes, usage volumes, 200-workspace base) are planning assumptions. Replace them with measured data after the first 60 days. The 70% cost ceiling in code is a guard, not a measurement.
