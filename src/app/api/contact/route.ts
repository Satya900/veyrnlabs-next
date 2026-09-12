import { NextResponse } from "next/server";

export async function POST() {
  // Do not claim delivery until an email or CRM integration is configured.
  return NextResponse.json(
    { error: "Contact delivery is not configured. Please email hello@veyrnlabs.com." },
    { status: 503 },
  );
}
