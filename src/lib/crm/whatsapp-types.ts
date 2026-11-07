export type WhatsAppConversation = {
  id: string;
  lead_id: string;
  sender: string;
  contact_name: string;
  last_message_at: string;
  opted_out?: boolean;
};
export type WhatsAppMessage = {
  id: string;
  message_type: string;
  body: string;
  sent_at: string;
};
export type WhatsAppConnection = {
  display_phone: string;
  active: boolean;
  provider?: "meta" | "gupshup";
};
export type WhatsAppSetup = {
  receiver_ready: boolean;
  last_received_at: string | null;
};
