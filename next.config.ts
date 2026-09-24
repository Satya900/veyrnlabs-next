import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Lets `next dev` serve HMR/dev assets when reached through the ngrok tunnel used for
  // local OAuth/webhook testing (Razorpay, Google Calendar). Dev-mode only; production
  // builds have no such cross-origin restriction to begin with.
  allowedDevOrigins: ["damion-unperpetuated-inaccurately.ngrok-free.dev"],
};

export default nextConfig;
