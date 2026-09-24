"use client";
import { useEffect, useState } from "react";
import { deliveryLabel, type Delivery } from "@/lib/crm/delivery";
type Attempt = Delivery & {
  origin?: string;
  id: string;
  status: string;
  body: string;
  created_at: string;
};
export function ReplyHistory({ conversation }: { conversation: string }) {
  const [items, setItems] = useState<Attempt[]>([]),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/crm/whatsapp/send?conversation=${conversation}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!abort.signal.aborted) {
          setItems(data.attempts);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [conversation, version]);
  return (
    <section className="crm-settings-body" aria-label="Reviewed reply history">
      <h3>Recent outgoing replies</h3>
      <button onClick={() => setVersion((v) => v + 1)}>
        Refresh reply history
      </button>
      {error && <p role="status">{error}</p>}
      {!error && items.length === 0 && <p>No outgoing replies yet.</p>}
      <ol className="crm-whatsapp-messages">
        {[...items].reverse().map((item) => (
          <li key={item.id}>
            <small>{item.origin === "automatic" ? "Automatic assistant reply" : "Manually approved reply"}</small>
            <strong>{deliveryLabel(item)}</strong>
            {item.delivery_at && (
              <p>
                Receipt: {new Date(item.delivery_at).toLocaleString("en-IN")}
              </p>
            )}
            <p>{item.body}</p>
            <time dateTime={item.created_at}>
              {new Date(item.created_at).toLocaleString("en-IN")}
            </time>
          </li>
        ))}
      </ol>
      {items.length === 20 && <small>Showing the latest 20 attempts.</small>}
    </section>
  );
}
