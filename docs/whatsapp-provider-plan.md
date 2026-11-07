# WhatsApp automation through the agent's own provider account

Plan, 6 November 2026. Goal: fully automatic WhatsApp follow-ups and replies sent from each agent's **own number, under their own name**, without waiting for Veyrn's Meta Tech Provider approval and without any manual sending.

## The approach

Each agent opens their own account with a Meta-approved WhatsApp provider, connects their number there, and pastes the provider's API key into Veyrn CRM. The CRM sends and receives through that account.

- The provider is the approved Meta partner and the agent is its customer. Veyrn is software the agent authorises to use their own account, like any CRM integration.
- Veyrn's Meta business portfolio isn't involved, so the Tech Provider application isn't at risk.
- When the Tech Provider review is approved, one-click "Connect with Meta" becomes a second option. Agents on a provider can stay where they are.

## Which provider

| Provider | Monthly fee | Per-message fee on top of Meta | Webhooks / API | Keep WhatsApp Business app on the same number (coexistence) | Verdict |
|---|---|---|---|---|---|
| **Gupshup self-serve** | **None** | $0.001 (about ₹0.09) per template message, and the same per session message in or out | API key and callback URL per app | Yes, documented for self-serve apps | **First choice** |
| AiSensy | Free plan ₹0; Basic ₹1,500 | Service messages ₹0.145 after the free 1,000 | API on paid plans; free-plan limits unclear | Unclear | Second option to check |
| Interakt | ₹999 Starter; WhatsApp API from ₹2,799 | About 12–15% on Meta's rates | Yes | Unclear | Too expensive for a ₹499 customer |
| WATI | ₹2,999 Growth | Own rate card | Growth plan has **no webhooks** | Advertised | Ruled out |
| 360dialog partner platform | €250 per month plus €49 per number | None | Built for ISVs | Yes | Ruled out: about ₹4,700 per agent per month |
| Gupshup partner portal | – | – | Built for ISVs | Yes | Ruled out: requires Veyrn to be a Tech Provider |

Prices are from third-party 2026 comparisons, not the providers' own price pages. Confirm them on each provider's site before quoting customers.

### What a solo agent would pay Gupshup and Meta

Example month: 300 automatic follow-ups as utility templates, plus 600 messages inside open conversations (client replies and AI answers).

| Item | Cost |
|---|---|
| Meta: 300 utility templates × ₹0.115 | ₹35 |
| Meta: service messages (first 1,000 free per number) | ₹0 |
| Gupshup: 900 messages × about ₹0.09 | ₹81 |
| **Total, paid by the agent from their Gupshup wallet** | **about ₹116 + GST** |

If Meta classifies a follow-up template as **marketing**, it costs ₹0.86 instead of ₹0.115, so 300 follow-ups would be about ₹260. The template wording below is designed to qualify as utility.

Veyrn's ₹499 plus about ₹120 at the provider is far below Interakt or WATI alone (₹2,799–₹2,999).

## How it works for the agent

1. **Set up at the provider, about 15 minutes.** Create a gupshup.io account, create a WhatsApp app, and connect the number. With coexistence they scan a QR code from the WhatsApp Business app and keep using it. Coexistence needs the app version to be recent and the number to have about 3 months of active use.
2. **Approve the follow-up templates.** We provide the exact texts, and Meta approves them within minutes to a day.
3. **Connect in the CRM.** Settings → WhatsApp → Connect a provider: paste the API key, app name and number. The CRM shows a callback URL to paste back into Gupshup.
4. **Send a test.** "Send a test message to my phone" confirms both directions work.

We provide a step-by-step guide with screenshots and a 3-minute video. Optionally, offer a paid assisted setup.

## What the CRM automates

| Automation | WhatsApp rule it follows |
|---|---|
| Follow-up for an overdue lead | Outside the 24-hour window, so it must be an **approved template** with the client's name and property filled in |
| Site-visit confirmation and reminder | Utility template |
| Reply to a new enquiry (draft or automatic) | Inside the 24-hour window, so free text is allowed |
| Pause when the client asks to stop, or when the agent takes over | Already built (human handover) |

### Starting template set (utility)

- `followup_property`: "Hi {{1}}, this is {{2}}. Following up on the {{3}} you asked about. Would you like to schedule a visit or get more details?"
- `visit_reminder`: "Hi {{1}}, reminder of your site visit to {{2}} on {{3}} at {{4}}. Reply here if you need to reschedule."
- `visit_confirmed`: "Hi {{1}}, your visit to {{2}} is confirmed for {{3}} at {{4}}. {{5}} will meet you there."

## Build

### Data

- A new table, `crm_whatsapp_providers`, one row per workspace:
  - provider (`gupshup`)
  - app name and source number
  - API key, encrypted with the existing token encryption (`CRM_WHATSAPP_TOKEN_KEY`)
  - a random callback token
  - status and last-verified time
- Readable by RLS only for the owner; the key is never returned to the browser.
- The existing conversation, message and receipt tables are reused unchanged.

### Code

- **A provider adapter.** `send text`, `send template`, `parse incoming webhook`. The current Meta Cloud API code becomes one adapter and Gupshup another, so sending, AI drafts, auto-replies, follow-ups and booking work with either.
- **Webhook.** `POST /api/webhooks/gupshup/[token]` maps the token to a workspace, converts the payload to our internal event shape, and calls the existing `crm_receive_whatsapp` and receipt RPCs. Gupshup can also deliver Meta-format (v3) payloads, which would let us reuse the current parser. Choose that if it's confirmed.
- **Settings UI.** "Connect a provider": key, app name, number, the callback URL to copy, a test-send button, and disconnect.
- **Follow-up worker.** For overdue leads, send the approved follow-up template through the workspace's adapter. Respect allowances and opt-outs, and log it as an activity.
- **Usage.** Messages are paid by the agent at the provider, so Veyrn's internal cost per send is near zero. The allowance stays as a safety cap against runaway automation.

### Phases

| Phase | Scope | Estimate |
|---|---|---|
| 1 | Adapter interface, Gupshup send and receive, settings UI, test send | 4–5 days |
| 2 | Template follow-ups for overdue leads, visit confirmations and reminders | 3–4 days |
| 3 | Setup guide, video, pricing-page copy ("bring your WhatsApp from Gupshup") | 1–2 days |
| 4 | Second provider (AiSensy) if agents ask for it | 3 days |

## Verify before building (one Gupshup sandbox account)

1. The exact send endpoints and authentication for text and template messages on self-serve apps.
2. Whether callbacks are signed. If not, the unguessable per-workspace URL token is the authentication, and the docs should say so.
3. Whether a self-serve app can choose the Meta (v3) callback format.
4. That coexistence onboarding works on a self-serve account with an Indian number.
5. Wallet behaviour when the balance runs out (error codes), so the CRM can warn the agent.

## Risks

- **Setup friction.** Asking a solo agent to open a second account loses some of them. The guide, video and assisted setup reduce this; one-click Tech Provider onboarding removes it later.
- **Template classification.** Meta may class follow-ups as marketing (₹0.86). Keep templates transactional and tied to the client's own enquiry.
- **Coexistence limits.** Broadcast lists stay disabled in the app and throughput is fixed at 20 messages per second, neither of which matters to a solo agent.
- **Provider changes.** Gupshup's pricing or API could change. The adapter keeps a second provider cheap to add.

## Sources

- [Gupshup self-serve pricing analysis](https://codingclave.com/blog/gupshup-whatsapp-pricing-india-2026), [Gupshup pricing guide](https://www.getmacha.com/blog/gupshup-ai-complete-guide)
- [Gupshup coexistence docs](https://docs.gupshup.io/docs/coex), [Gupshup partner docs: Tech Providers](https://partner-docs.gupshup.io/docs/what-is-sp-tp)
- [AiSensy pricing](https://aisensy.com/pricing), [Interakt pricing 2026](https://mark360.ai/blog/interakt-pricing-2026), [WATI pricing India 2026](https://mark360.ai/blog/wati-pricing-2026-india)
- [360dialog partner platform](https://360dialog.com/partners), [360dialog pricing per number](https://chatmitra.com/chatmitra-vs-360dialog/)
- [Coexistence in India](https://blog.getmanifest.ai/whatsapp-business-api-updates-2026/)
