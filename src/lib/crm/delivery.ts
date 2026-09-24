export type Delivery = {
  status: string;
  delivery_status?: string | null;
  delivery_at?: string | null;
  delivery_error_code?: number | null;
};
export function deliveryLabel(item: Delivery) {
  if (item.delivery_status === "read") return "Read by customer";
  if (item.delivery_status === "delivered") return "Delivered to customer";
  if (item.delivery_status === "sent")
    return "Sent by WhatsApp: awaiting delivery";
  if (item.delivery_status === "failed")
    return `Delivery failed${item.delivery_error_code ? ` (Meta code ${item.delivery_error_code})` : ""}: contact support`;
  return (
    (
      {
        accepted: "Accepted by WhatsApp: delivery unconfirmed",
        rejected: "Rejected: contact support",
        unknown: "Outcome uncertain: do not resend",
        dispatching: "Pending: do not resend",
      } as Record<string, string>
    )[item.status] ?? "Status unavailable"
  );
}
