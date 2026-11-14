import { describe, it, expect } from "vitest";
import { customerLabel, labelIsPhone, looksLikeEmail } from "./customerLabel";

describe("customerLabel", () => {
  it("uses a real name", () => {
    expect(customerLabel("  דנה כהן ", "0501234567", "לקוח")).toBe("דנה כהן");
  });
  it("never shows an email as the name: falls back to the phone", () => {
    expect(customerLabel("customer2@test.dev", "0501234567", "לקוח")).toBe("0501234567");
  });
  it("falls back to the translated word with no usable name or phone", () => {
    expect(customerLabel("a@b.co", null, "Customer")).toBe("Customer");
    expect(customerLabel("", "  ", "Customer")).toBe("Customer");
    expect(customerLabel(null, undefined, "عميل")).toBe("عميل");
  });
  it("keeps names that merely contain @ with spaces", () => {
    expect(looksLikeEmail("Dana @ studio")).toBe(false);
    expect(looksLikeEmail(" x@y ")).toBe(true);
  });
  it("labelIsPhone tells when the phone is the label", () => {
    expect(labelIsPhone("x@y.z", "050")).toBe(true);
    expect(labelIsPhone("Dana", "050")).toBe(false);
    expect(labelIsPhone(null, null)).toBe(false);
  });
});
