import "server-only";
import { supabase } from "./server";

/** Reserve a conservative upper bound BEFORE a provider request. Duplicate keys fail closed. */
export async function reserveUsage(input: {
  organizationId: string;
  eventKey: string;
  kind: "ai" | "whatsapp" | "overhead";
  units: number;
  maximumCostPaise: number;
}) {
  if (
    !Number.isSafeInteger(input.units) ||
    input.units <= 0 ||
    !Number.isSafeInteger(input.maximumCostPaise) ||
    input.maximumCostPaise <= 0
  )
    throw new Error("Usage requires positive integer units and cost in paise.");
  const { data, error } = await supabase(undefined, true).rpc(
    "crm_reserve_usage",
    {
      org: input.organizationId,
      request_key: input.eventKey,
      usage_kind: input.kind,
      quantity: input.units,
      max_cost_paise: input.maximumCostPaise,
    },
  );
  if (error || typeof data !== "string")
    throw new Error(
      "Usage reservation denied. Do not dispatch the provider request.",
    );
  return data;
}

/** Reconcile from trusted provider usage. Cancel only after confirming no billable action occurred. */
export async function finishUsage(
  organizationId: string,
  eventId: string,
  actualCostPaise: number,
  cancel = false,
) {
  if (
    !Number.isSafeInteger(actualCostPaise) ||
    actualCostPaise < 0 ||
    (cancel && actualCostPaise !== 0)
  )
    throw new Error("Invalid actual usage cost.");
  const { error } = await supabase(undefined, true).rpc("crm_finish_usage", {
    org: organizationId,
    event: eventId,
    final_cost_paise: actualCostPaise,
    cancel,
  });
  if (error)
    throw new Error(
      "Usage reconciliation failed; keep the reservation for review.",
    );
}
