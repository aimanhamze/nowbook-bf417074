import { describe, it, expect } from "vitest";
import { isWhatsAppMobile } from "./whatsappPhone";

describe("isWhatsAppMobile", () => {
  it("accepts a local mobile however the provider formats it", () => {
    expect(isWhatsAppMobile("0501234567")).toBe(true);
    expect(isWhatsAppMobile("050-123-4567")).toBe(true);
    expect(isWhatsAppMobile("050-1234567")).toBe(true);
    expect(isWhatsAppMobile("050 123 4567")).toBe(true);
    expect(isWhatsAppMobile(" 059-123-4567 ")).toBe(true);
  });

  it("accepts the international forms", () => {
    expect(isWhatsAppMobile("+972501234567")).toBe(true);
    expect(isWhatsAppMobile("+972 50 123 4567")).toBe(true);
    expect(isWhatsAppMobile("972501234567")).toBe(true);
    expect(isWhatsAppMobile("00972501234567")).toBe(true);
  });

  it("drops a trunk zero typed after the country code", () => {
    expect(isWhatsAppMobile("+972-050-123-4567")).toBe(true);
    expect(isWhatsAppMobile("009720501234567")).toBe(true);
  });

  it("accepts the bare 9-digit national number", () => {
    expect(isWhatsAppMobile("501234567")).toBe(true);
  });

  it("rejects landlines and 07X VoIP numbers", () => {
    expect(isWhatsAppMobile("077-123-4567")).toBe(false);
    expect(isWhatsAppMobile("072-123-4567")).toBe(false);
    expect(isWhatsAppMobile("02-123-4567")).toBe(false);
    expect(isWhatsAppMobile("08-9123456")).toBe(false);
    expect(isWhatsAppMobile("+972 77 123 4567")).toBe(false);
  });

  it("rejects a digit too few or too many", () => {
    expect(isWhatsAppMobile("050-123-456")).toBe(false);
    expect(isWhatsAppMobile("050-123-45678")).toBe(false);
    expect(isWhatsAppMobile("+97250123456")).toBe(false);
  });

  it("rejects foreign numbers", () => {
    expect(isWhatsAppMobile("+44 7700 900123")).toBe(false);
    expect(isWhatsAppMobile("+1 555 010 0000")).toBe(false);
  });

  it("rejects empty and garbage input", () => {
    expect(isWhatsAppMobile("")).toBe(false);
    expect(isWhatsAppMobile(null)).toBe(false);
    expect(isWhatsAppMobile(undefined)).toBe(false);
    expect(isWhatsAppMobile("123")).toBe(false);
    expect(isWhatsAppMobile("abc")).toBe(false);
    // A local '0' followed by the country code is not a number anyone dials.
    expect(isWhatsAppMobile("0972501234567")).toBe(false);
  });
});
