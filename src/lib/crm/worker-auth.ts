import { timingSafeEqual } from "node:crypto";
export function workerAuthorized(request: Request) {
  const key = process.env.CRM_WORKER_SECRET ?? "",
    supplied = request.headers.get("authorization") ?? "",
    expected = `Bearer ${key}`;
  return (
    key.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}
