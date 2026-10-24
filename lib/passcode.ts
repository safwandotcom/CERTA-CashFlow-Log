// Single shared passcode. The cookie holds a hash of the passcode, so changing
// APP_PASSCODE signs every device out.

export const COOKIE = "certa_unlock";
export const MAX_AGE = 60 * 60 * 24 * 365; // one year

export async function tokenFor(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`certa-cashflow-log:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isUnlocked(cookieValue: string | undefined, passcode = process.env.APP_PASSCODE): Promise<boolean> {
  if (!passcode || !cookieValue) return false;
  return safeEqual(cookieValue, await tokenFor(passcode));
}
