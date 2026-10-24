import { describe, expect, it } from "vitest";
import { isUnlocked, safeEqual, tokenFor } from "@/lib/passcode";

describe("passcode", () => {
  it("unlocks only with the cookie made from the current passcode", async () => {
    const cookie = await tokenFor("11223344");
    expect(await isUnlocked(cookie, "11223344")).toBe(true);
    expect(await isUnlocked(cookie, "99999999")).toBe(false); // passcode changed → signed out
    expect(await isUnlocked(undefined, "11223344")).toBe(false);
    expect(await isUnlocked("11223344", "11223344")).toBe(false); // the raw passcode isn't a valid cookie
  });

  it("stays locked when no passcode is configured", async () => {
    expect(await isUnlocked(await tokenFor(""), "")).toBe(false);
    expect(await isUnlocked(await tokenFor("x"), undefined)).toBe(false);
  });

  it("compares strings exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
