"use client";
import { crmFetch } from "../activity";
import { useEffect, useState } from "react";
import { SkeletonRows } from "../Skeleton";
import { useWorkspaceContext } from "../context";
import { AIDraft } from "../AIDraft";
import { ReplyHistory } from "../ReplyHistory";
import type {
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppConnection,
  WhatsAppSetup,
} from "@/lib/crm/whatsapp-types";

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
  return (
    <>
      <section className="crm-panel crm-whatsapp-status">
        <div>
          <h2>{connection ? connection.display_phone : "WhatsApp inbox"}</h2>
          <p>
            {connection
              ? connection.active
                ? "Business number mapped for incoming messages"
                : "Inbound connection paused"
              : data.user.role === "team"
                ? data.organization?.team_sees_all_leads === false
                  ? "Conversations for your assigned leads"
                  : "Conversations for your workspace's leads"
                : "Your business number has not been connected yet."}
          </p>
          {setup && (
            <ul>
              <li>Business number: {connection ? "mapped" : "setup needed"}</li>
              <li>
                Message receiver:{" "}
                {setup.receiver_ready ? "configured" : "setup needed"}
              </li>
              <li>
                {setup.last_received_at
                  ? `Last message received: ${date(setup.last_received_at)}`
                  : "Waiting for the first incoming message"}
              </li>
            </ul>
          )}
          <p>
            Receive-only setup. Sending messages and AI replies are not enabled
            yet.
          </p>
        </div>
        <button aria-busy={busy} disabled={busy} onClick={reload}>
          {busy ? "Loading…" : "Refresh inbox"}
        </button>
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
          {busy && !items.length && (
            <SkeletonRows rows={4} variant="card" className="is-padded" label="Loading conversations" />
          )}
          {!busy && !items.length && (
            <p className="crm-settings-body">
              No conversations yet. Incoming messages will appear here after
              setup.
            </p>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              className="crm-whatsapp-contact"
              aria-pressed={selected?.id === item.id}
              onClick={() => select(item)}
            >
              <strong>{item.contact_name || `+${item.sender}`}</strong>
              <span>+{item.sender}</span>
              <small>{date(item.last_message_at)}</small>
            </button>
          ))}
          {more && (
            <button
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
          <section className="crm-panel crm-settings-body">
            <h2>Select a conversation</h2>
            <p>
              Each conversation is linked to a CRM lead. New contacts create an
              unassigned lead that an admin can assign or a teammate can claim.
            </p>
          </section>
        )}
      </div>
    </>
  );
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
  const [cursor, setCursor] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const [sent, setSent] = useState(0);
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
  return (
    <section
      className="crm-panel crm-whatsapp-thread"
      aria-label="Conversation messages"
    >
      <div className="crm-panel-heading">
        <div>
          <h2>{conversation.contact_name || `+${conversation.sender}`}</h2>
          <p>+{conversation.sender}</p>
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
      {error && (
        <div role="alert" className="crm-settings-body">
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
      {busy &&
        (items.length ? (
          <p className="crm-settings-body" role="status">
            Loading messages…
          </p>
        ) : (
          <SkeletonRows rows={3} variant="card" className="is-padded" label="Loading messages" />
        ))}
      {more && (
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
      )}
      <ol className="crm-whatsapp-messages">
        {[...items].reverse().map((item) => (
          <li key={item.id}>
            {item.message_type !== "text" && (
              <small>
                {item.message_type} message ·{" "}
                {item.body
                  ? "caption or selection below"
                  : "preview not available"}
              </small>
            )}
            {item.body && <p>{item.body}</p>}
            <time dateTime={item.sent_at}>{date(item.sent_at)}</time>
          </li>
        ))}
      </ol>
      {replyOwner === null ? (
        <>
          <ReplyComposer conversation={conversation.id} onSent={() => setSent((n) => n + 1)} />
          <AIDraft
            key={conversation.id}
            conversation={conversation.id}
            leadId={conversation.lead_id}
          />
        </>
      ) : (
        <p className="crm-plan-notice crm-settings-body">
          Replies to this client are handled by {replyOwner}. You can read the
          conversation and add notes on the lead.
        </p>
      )}
      <ReplyHistory key={`replies-${conversation.id}-${sent}`} conversation={conversation.id} />
      <p className="crm-settings-body crm-muted">
        Every AI reply is a draft. A person reviews and sends it before the customer sees it.
      </p>
    </section>
  );
}

/** A reply typed by a person (no AI), sent within WhatsApp's 24-hour customer window. */
function ReplyComposer({ conversation, onSent }: { conversation: string; onSent: () => void }) {
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
      if (!res.ok) throw new Error(result.error);
      if (result.status === "rejected") throw new Error("WhatsApp rejected this message. Nothing was sent.");
      if (result.status === "unknown")
        throw new Error("Sending couldn't be confirmed. Check WhatsApp before trying again.");
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
      className="crm-settings-body crm-reply-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void send();
      }}
    >
      <label>
        Reply
        <textarea
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
      </label>
      <div>
        <small className="crm-muted">
          Free-text replies are allowed within 24 hours of the customer&apos;s last message.
        </small>
        <button className="crm-primary" disabled={busy || !text.trim()} aria-busy={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <p role="alert" className="crm-error">{error}</p>}
    </form>
  );
}
