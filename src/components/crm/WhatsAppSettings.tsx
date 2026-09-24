"use client";
import { useEffect, useState } from "react";
type MetaSDK = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (result: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ) => void;
};
declare global {
  interface Window {
    FB?: MetaSDK;
  }
}
type Setup = {
  ready: boolean;
  appId: string;
  configId: string;
  version: string;
  connection?: { active: boolean; display_phone: string };
};
export function WhatsAppSettings({
  role,
  demo,
}: {
  role: string;
  demo: boolean;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [code, setCode] = useState("");
  const [assets, setAssets] = useState<{ waba: string; phone: string } | null>(
    null,
  );
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        !["https://www.facebook.com", "https://web.facebook.com"].includes(
          event.origin,
        )
      )
        return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (
          data.type === "WA_EMBEDDED_SIGNUP" &&
          data.event === "FINISH" &&
          /^\d+$/.test(data.data?.waba_id) &&
          /^\d+$/.test(data.data?.phone_number_id)
        )
          setAssets({
            waba: data.data.waba_id,
            phone: data.data.phone_number_id,
          });
      } catch {
        /* Ignore unrelated window messages. */
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  if (role === "team") return null;
  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/crm/whatsapp/connect", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSetup(data);
      if (data.ready && role === "owner") {
        if (!window.FB)
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://connect.facebook.net/en_US/sdk.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Meta could not load."));
            document.body.appendChild(script);
          });
        window.FB?.init({
          appId: data.appId,
          version: data.version,
          xfbml: false,
          cookie: false,
        });
        setSdkReady(true);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(disconnect = false) {
    if (
      disconnect &&
      !window.confirm(
        "Disconnect WhatsApp and pause automatic replies? Conversation history will remain available.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/crm/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          disconnect ? { action: "disconnect" } : { code, ...assets, pin },
        ),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setCode("");
      setAssets(null);
      setPin("");
      await load();
      setMessage(
        disconnect
          ? "WhatsApp disconnected."
          : "WhatsApp connected. Send a test message to confirm your inbox.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <h2>WhatsApp connection</h2>
        <button disabled={busy || demo} onClick={() => void load()}>
          Manage connection
        </button>
      </div>
      <div className="crm-settings-body">
        {setup?.connection && (
          <p>
            {setup.connection.display_phone} ·{" "}
            {setup.connection.active ? "Connected" : "Disconnected"}
          </p>
        )}
        {setup && !setup.ready && (
          <p>
            Customer number onboarding is awaiting Meta app configuration.
            Contact your administrator.
          </p>
        )}
        {role === "owner" && setup?.ready && (
          <>
            <p>
              Authorize your business account and number through Meta. Reconnect
              here if your permissions expire.
            </p>
            <button
              disabled={busy || !sdkReady}
              onClick={() => {
                setCode("");
                setAssets(null);
                window.FB?.login(
                  (result) => {
                    if (result.authResponse?.code)
                      setCode(result.authResponse.code);
                    else
                      setMessage(
                        "Meta authorization was cancelled or incomplete.",
                      );
                  },
                  {
                    config_id: setup.configId,
                    response_type: "code",
                    override_default_response_type: true,
                    extras: { setup: {}, sessionInfoVersion: "3" },
                  },
                );
              }}
            >
              Connect with Meta
            </button>
            {code && assets && (
              <>
                <label>
                  Six-digit registration PIN (only for a new Cloud API number)
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button
                  disabled={busy || (!!pin && !/^\d{6}$/.test(pin))}
                  onClick={() => void save()}
                >
                  Finish connecting
                </button>
              </>
            )}
          </>
        )}
        {role === "owner" && setup?.connection?.active && (
          <button disabled={busy} onClick={() => void save(true)}>
            Disconnect WhatsApp
          </button>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
