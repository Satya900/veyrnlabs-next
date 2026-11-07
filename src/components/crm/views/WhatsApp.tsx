"use client";
import { crmFetch } from "../activity";
import { useEffect, useRef, useState } from "react";
import { SkeletonRows } from "../Skeleton";
import { useWorkspaceContext } from "../context";
import { AIDraft } from "../AIDraft";
import { deliveryLabel, type Delivery } from "@/lib/crm/delivery";
import type {
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppConnection,
  WhatsAppSetup,
} from "@/lib/crm/whatsapp-types";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
/** List time: clock time for today, otherwise the date. */
function short(value: string) {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const date = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function WhatsApp({
  openLead,
}: {
  openLead: (id: string) => Promise<void>;
}) {
  const { demo, data, reload: reloadWorkspace } = useWorkspaceContext();
  // Team members can see colleagues' conversations when the workspace shares all leads,
  // but replying stays with the lead's assigned agent (and owners/admins).
  const replyOwner = (leadId: string) => {
    if (data.user.role !== "team") return null;
    const owner = data.leads.find((l) => l.id === leadId)?.owner_id;
    if (owner === data.user.id) return null;
    return owner
      ? (data.members.find((m) => m.id === owner)?.name ?? "the assigned agent")
      : "an owner or admin until someone is assigned";
  };
  const [items, setItems] = useState<WhatsAppConversation[]>([]);
  const [connection, setConnection] = useState<WhatsAppConnection | null>(null);
  const [setup, setSetup] = useState<WhatsAppSetup | null>(null);
  const [selected, select] = useState<WhatsAppConversation | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    crmFetch(`/api/crm/whatsapp${cursor}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (controller.signal.aborted) return;
        setItems((current) =>
          cursor
            ? [
                ...current,
                ...result.conversations.filter(
                  (item: WhatsAppConversation) =>
                    !current.some((old) => old.id === item.id),
                ),
              ]
            : result.conversations,
        );
        setConnection(result.connection);
        setSetup(result.setup);
        setMore(result.has_more);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Unable to load inbox.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [cursor, refresh, demo]);
  if (demo)
    return (
      <section className="crm-panel crm-settings-body">
        <h2>WhatsApp inbox</h2>
        <p>
          Connect a business number in your live workspace to receive messages
          here.
        </p>
      </section>
    );
  function reload() {
    setBusy(true);
    setCursor("");
    select(null);
    setRefresh((value) => value + 1);
    // Lead ownership decides who may reply, so pick up any reassignment as well.
    void reloadWorkspace();
  }
  const sending = connection?.active
    ? `Connected through ${connection.provider === "gupshup" ? "Gupshup" : "Meta"} · sending and receiving`
    : connection
      ? "Connection paused. New messages aren't being received."
      : data.user.role === "team"
        ? data.organization?.team_sees_all_leads === false
          ? "Conversations for your assigned leads"
          : "Conversations for your workspace's leads"
        : "Connect your business number in Settings → WhatsApp connection.";
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((item) =>
        [item.contact_name, item.sender].some((v) =>
          v?.toLowerCase().includes(q.replace(/^\+/, "")),
        ),
      )
    : items;
  return (
    <>
      <section className="crm-panel crm-whatsapp-status">
        <div className="crm-whatsapp-status-main">
          <span
            className={connection?.active ? "crm-dot ok" : "crm-dot bad"}
            aria-hidden="true"
          />
          <div>
            <strong>
              {connection ? connection.display_phone : "WhatsApp"}
            </strong>
            <small>{sending}</small>
          </div>
        </div>
        <div className="crm-whatsapp-status-meta">
          {setup && (
            <small>
              {!setup.receiver_ready
                ? "Message receiver isn't configured on the server"
                : setup.last_received_at
                  ? `Last message ${date(setup.last_received_at)}`
                  : "Waiting for the first message"}
            </small>
          )}
          <button aria-busy={busy} disabled={busy} onClick={reload}>
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
      </section>
      {error && (
        <p className="crm-error" role="alert">
          {error}
        </p>
      )}
      <div className="crm-whatsapp-grid">
        <section
          className="crm-panel crm-whatsapp-list"
          aria-label="WhatsApp conversations"
        >
          <div className="crm-whatsapp-search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or number…"
              aria-label="Search conversations"
            />
          </div>
          {busy && !items.length && (
            <SkeletonRows
              rows={4}
              variant="card"
              className="is-padded"
              label="Loading conversations"
            />
          )}
          {!busy && !items.length && (
            <p className="crm-whatsapp-empty">
              No conversations yet. Messages to your business number appear
              here.
            </p>
          )}
          {!!items.length && !shown.length && (
            <p className="crm-whatsapp-empty">No conversations match.</p>
          )}
          {shown.map((item) => {
            const name = item.contact_name || `+${item.sender}`;
            return (
              <button
                key={item.id}
                className="crm-whatsapp-contact"
                aria-pressed={selected?.id === item.id}
                onClick={() => select(item)}
              >
                <span className="crm-whatsapp-avatar" aria-hidden="true">
                  {initials(item.contact_name) || "#"}
                </span>
                <span className="crm-whatsapp-contact-text">
                  <span className="crm-whatsapp-contact-top">
                    <strong>{name}</strong>
                    <time dateTime={item.last_message_at}>
                      {short(item.last_message_at)}
                    </time>
                  </span>
                  <span className="crm-whatsapp-contact-bottom">
                    <small>
                      {item.contact_name
                        ? `+${item.sender}`
                        : "Unknown contact"}
                    </small>
                    {item.opted_out && (
                      <span className="crm-badge lost">Opted out</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {more && !q && (
            <button
              className="crm-whatsapp-more"
              disabled={busy}
              onClick={() => {
                const last = items[items.length - 1];
                setBusy(true);
                const next = `?${new URLSearchParams({ before_time: last.last_message_at, before_id: last.id })}`;
                if (next === cursor) setRefresh((value) => value + 1);
                else setCursor(next);
              }}
            >
              Load older conversations
            </button>
          )}
        </section>
        {selected ? (
          <Conversation
            key={`${selected.id}-${refresh}`}
            conversation={selected}
            openLead={() => openLead(selected.lead_id)}
            replyOwner={replyOwner(selected.lead_id)}
          />
        ) : (
          <section className="crm-panel crm-whatsapp-placeholder">
            <h2>Select a conversation</h2>
            <p>
              Every conversation is linked to a lead. Messages from new numbers
              create an unassigned lead that an admin can assign or a teammate
              can claim.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

export type Insight = {
  lead_id: string;
  score: "hot" | "warm" | "cold";
  score_reason: string;
  summary: string;
  details: Partial<Record<"budget" | "location" | "property_type" | "timeline" | "purpose", string>>;
  suggestions: string[];
  updated_at: string;
};
export const SCORE_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;
const DETAIL_LABEL: [keyof Insight["details"], string][] = [
  ["budget", "Budget"],
  ["location", "Location"],
  ["property_type", "Looking for"],
  ["timeline", "Timeline"],
  ["purpose", "Purpose"],
];

function InsightCard({
  insight,
  thinking,
  error,
  onRefresh,
}: {
  insight: Insight | null;
  thinking: boolean;
  error: string;
  onRefresh?: () => void;
}) {
  if (!insight && !thinking && !error) return null;
  const details = insight ? DETAIL_LABEL.filter(([key]) => insight.details?.[key]) : [];
  return (
    <div className="crm-insight" aria-live="polite">
      <div className="crm-insight-head">
        {insight && (
          <span className={`crm-score ${insight.score}`} title={insight.score_reason}>
            {SCORE_LABEL[insight.score]}
          </span>
        )}
        <p>
          {thinking && !insight
            ? "Reading the chat…"
            : insight?.summary || (error ? "" : "No summary yet.")}
        </p>
        {onRefresh && (
          <button type="button" disabled={thinking} aria-busy={thinking} onClick={onRefresh}>
            {thinking ? "Updating…" : "Refresh"}
          </button>
        )}
      </div>
      {insight?.score_reason && <small className="crm-insight-reason">{insight.score_reason}</small>}
      {details.length > 0 && (
        <dl className="crm-insight-details">
          {details.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{insight!.details[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && <small className="crm-error">{error}</small>}
    </div>
  );
}

type Outgoing = Delivery & {
  id: string;
  origin?: string;
  body: string;
  created_at: string;
};
type Entry =
  | { side: "in"; id: string; at: string; message: WhatsAppMessage }
  | { side: "out"; id: string; at: string; reply: Outgoing };
const ORIGIN: Record<string, string> = {
  manual: "You",
  followup: "Automatic follow-up",
  automatic: "Auto-reply",
  reviewed: "AI reply",
};
function tick(item: Delivery) {
  if (item.delivery_status === "read") return "Read";
  if (item.delivery_status === "delivered") return "Delivered";
  if (item.delivery_status === "failed" || item.status === "rejected")
    return "Not delivered";
  if (item.delivery_status === "sent" || item.status === "accepted")
    return "Sent";
  return "Unconfirmed";
}

function Conversation({
  conversation,
  openLead,
  replyOwner,
}: {
  conversation: WhatsAppConversation;
  openLead: () => Promise<void>;
  /** Null when the viewer may reply; otherwise who handles replies for this lead. */
  replyOwner: string | null;
}) {
  const [items, setItems] = useState<WhatsAppMessage[]>([]);
  const [replies, setReplies] = useState<Outgoing[]>([]);
  const [optedOut, setOptedOut] = useState(Boolean(conversation.opted_out));
  const [cursor, setCursor] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const [sent, setSent] = useState(0);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [thinking, setThinking] = useState(false);
  const [insightError, setInsightError] = useState("");
  const end = useRef<HTMLOListElement>(null);
  const canReply = replyOwner === null;
  async function analyse(force = false) {
    setThinking(true);
    setInsightError("");
    try {
      const res = await crmFetch("/api/crm/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation: conversation.id, force }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setInsight(result.insight);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : "AI insights failed.");
    } finally {
      setThinking(false);
    }
  }
  // Show the saved insight, and refresh it automatically when the customer has written
  // since (one AI action). People who can only read the chat see the last saved one.
  useEffect(() => {
    const controller = new AbortController();
    crmFetch(`/api/crm/ai/insights?conversation=${conversation.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || controller.signal.aborted) return;
        setInsight(result.insight);
        if (result.available && result.stale && canReply) void analyse();
      })
      .catch(() => {
        /* Insights are optional; the chat works without them. */
      });
    return () => controller.abort();
    // analyse is recreated each render; re-run only for a different conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, canReply]);
  useEffect(() => {
    const controller = new AbortController();
    crmFetch(`/api/crm/whatsapp?conversation=${conversation.id}${cursor}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (controller.signal.aborted) return;
        setItems((current) =>
          cursor
            ? [
                ...current,
                ...result.messages.filter(
                  (item: WhatsAppMessage) =>
                    !current.some((old) => old.id === item.id),
                ),
              ]
            : result.messages,
        );
        setMore(result.has_more);
        if (!cursor) setOptedOut(Boolean(result.opted_out));
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Unable to load messages.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [conversation.id, cursor, retry]);
  useEffect(() => {
    const controller = new AbortController();
    crmFetch(`/api/crm/whatsapp/send?conversation=${conversation.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (response.ok && !controller.signal.aborted)
          setReplies(result.attempts);
      })
      .catch(() => {
        /* The thread still shows incoming messages without reply history. */
      });
    return () => controller.abort();
  }, [conversation.id, retry, sent]);
  // While older messages are still unloaded, only show replies from the loaded time range.
  const oldest = more && items.length ? items[items.length - 1].sent_at : null;
  const timeline: Entry[] = [
    ...items.map((message) => ({
      side: "in" as const,
      id: message.id,
      at: message.sent_at,
      message,
    })),
    ...replies
      .filter((reply) => !oldest || reply.created_at >= oldest)
      .map((reply) => ({
        side: "out" as const,
        id: reply.id,
        at: reply.created_at,
        reply,
      })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Keep the newest message in view, except while paging back through older ones.
  useEffect(() => {
    if (!cursor && end.current)
      end.current.scrollTop = end.current.scrollHeight;
  }, [timeline.length, cursor]);
  return (
    <section
      className="crm-panel crm-whatsapp-thread"
      aria-label="Conversation messages"
    >
      <div className="crm-whatsapp-thread-head">
        <span className="crm-whatsapp-avatar" aria-hidden="true">
          {initials(conversation.contact_name) || "#"}
        </span>
        <div>
          <h2>{conversation.contact_name || `+${conversation.sender}`}</h2>
          <small>
            +{conversation.sender}
            {optedOut && <span className="crm-badge lost">Opted out</span>}
          </small>
        </div>
        <button
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            try {
              await openLead();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Unable to open lead.",
              );
            } finally {
              setOpening(false);
            }
          }}
        >
          {opening ? "Opening…" : "Open lead ↗"}
        </button>
      </div>
      <InsightCard
        insight={insight}
        thinking={thinking}
        error={insightError}
        onRefresh={canReply ? () => void analyse(true) : undefined}
      />
      {error && (
        <div role="alert" className="crm-whatsapp-alert">
          {error}{" "}
          <button
            onClick={() => {
              setBusy(true);
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      <ol className="crm-whatsapp-messages" ref={end}>
        {more && (
          <li className="crm-whatsapp-older">
            <button
              disabled={busy}
              onClick={() => {
                const last = items[items.length - 1];
                setBusy(true);
                const next = `&${new URLSearchParams({ before_time: last.sent_at, before_id: last.id })}`;
                if (next === cursor) setRetry((value) => value + 1);
                else setCursor(next);
              }}
            >
              Load older messages
            </button>
          </li>
        )}
        {busy && !items.length && (
          <li className="crm-whatsapp-older">
            <SkeletonRows rows={3} variant="card" label="Loading messages" />
          </li>
        )}
        {!busy && !timeline.length && !error && (
          <li className="crm-whatsapp-older crm-muted">No messages yet.</li>
        )}
        {timeline.map((entry) =>
          entry.side === "in" ? (
            <li key={entry.id} className="crm-bubble in">
              {entry.message.message_type !== "text" && (
                <small>
                  {entry.message.message_type} message
                  {entry.message.body ? "" : " · preview not available"}
                </small>
              )}
              {entry.message.body && <p>{entry.message.body}</p>}
              <time dateTime={entry.at}>{date(entry.at)}</time>
            </li>
          ) : (
            <li
              key={entry.id}
              className={`crm-bubble out${tick(entry.reply) === "Not delivered" ? " failed" : ""}`}
            >
              <small>
                {ORIGIN[entry.reply.origin ?? "reviewed"] ?? "Reply"}
              </small>
              <p>{entry.reply.body}</p>
              <time dateTime={entry.at} title={deliveryLabel(entry.reply)}>
                {date(entry.at)} · {tick(entry.reply)}
              </time>
            </li>
          ),
        )}
      </ol>
      {optedOut ? (
        <p className="crm-whatsapp-notice">
          This contact sent STOP, so nothing can be sent to them. If they
          message START, replies and follow-ups resume.
        </p>
      ) : replyOwner === null ? (
        <ReplyComposer
          conversation={conversation.id}
          suggestions={insight?.suggestions ?? []}
          onSent={() => setSent((n) => n + 1)}
          onBlocked={() => setOptedOut(true)}
        />
      ) : (
        <p className="crm-whatsapp-notice">
          Replies to this client are handled by {replyOwner}. You can read the
          conversation and add notes on the lead.
        </p>
      )}
      {replyOwner === null && !optedOut && (
        <details className="crm-whatsapp-ai">
          <summary>AI reply assistant</summary>
          <AIDraft
            key={conversation.id}
            conversation={conversation.id}
            leadId={conversation.lead_id}
          />
        </details>
      )}
    </section>
  );
}

/** A reply typed by a person (no AI), sent within WhatsApp's 24-hour customer window. */
function ReplyComposer({
  conversation,
  suggestions,
  onSent,
  onBlocked,
}: {
  conversation: string;
  suggestions: string[];
  onSent: () => void;
  onBlocked: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One id per message, so a double-clicked Send can't send it twice.
  const [request, setRequest] = useState(() => crypto.randomUUID());
  async function send() {
    setBusy(true);
    setError("");
    try {
      const res = await crmFetch("/api/crm/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual", conversation, text, request }),
      });
      const result = await res.json();
      if (!res.ok) {
        if (/requested no messages/.test(result.error ?? "")) onBlocked();
        throw new Error(result.error);
      }
      if (result.status === "rejected")
        throw new Error("WhatsApp rejected this message. Nothing was sent.");
      if (result.status === "unknown")
        throw new Error(
          "Sending couldn't be confirmed. Check WhatsApp before trying again.",
        );
      setText("");
      setRequest(crypto.randomUUID());
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="crm-reply-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void send();
      }}
    >
      {suggestions.length > 0 && (
        <div className="crm-suggestions" role="group" aria-label="Suggested replies">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              title={suggestion}
              onClick={() => {
                setText(suggestion);
                setError("");
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <textarea
        aria-label="Reply"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            e.preventDefault();
            void send();
          }
        }}
        maxLength={3000}
        rows={3}
        placeholder="Type your reply…"
      />
      <div>
        <small className="crm-muted">
          Free text works within 24 hours of the customer&apos;s last message.
          ⌘/Ctrl + Enter sends.
        </small>
        <button
          className="crm-primary"
          disabled={busy || !text.trim()}
          aria-busy={busy}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </form>
  );
}
