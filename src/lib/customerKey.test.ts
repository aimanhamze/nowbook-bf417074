import { describe, it, expect } from "vitest";
import {
  PHONE_KEY_DIGITS,
  customerKey,
  isRegisteredKey,
  normalizePhone,
  type CustomerKeyable,
} from "./customerKey";

// Booking-shaped fixture with only the identity fields that matter.
function booking(over: Partial<CustomerKeyable> = {}): CustomerKeyable {
  return { id: "row-1", user_id: null, linked_user_id: null, customer_phone: null, ...over };
}

describe("normalizePhone", () => {
  it("collapses every format variant of the same number to one value", () => {
    const variants = [
      "0501234567",
      "050-1234567",
      "050 123 4567",
      "  050.123.4567  ",
      "+972501234567",
      "+972-50-123-4567",
      "00972501234567",
      "(050) 123-4567",
    ];
    const keys = new Set(variants.map((v) => normalizePhone(v)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("501234567");
  });

  it("keeps the LAST 9 digits so national and E.164 forms agree", () => {
    expect(normalizePhone("0501234567")).toHaveLength(PHONE_KEY_DIGITS);
    expect(normalizePhone("0501234567")).toBe(normalizePhone("+972501234567"));
  });

  it("distinguishes genuinely different numbers", () => {
    expect(normalizePhone("0501234567")).not.toBe(normalizePhone("0507654321"));
  });

  it("returns null for missing, empty or sub-9-digit input", () => {
    for (const bad of [null, undefined, "", "   ", "abc", "12345678", "05-0123"]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });

  it("accepts exactly 9 digits (the DB trigger's floor)", () => {
    expect(normalizePhone("123456789")).toBe("123456789");
  });
});

describe("customerKey", () => {
  it("keys an app booking on its account", () => {
    expect(customerKey(booking({ user_id: "user-a" }))).toBe("u:user-a");
  });

  it("collapses phone format variants to ONE walk-in customer", () => {
    const keys = new Set(
      ["0501234567", "050-1234567", "+972501234567", "050 123 4567"].map((phone, i) =>
        customerKey(booking({ id: `row-${i}`, customer_phone: phone }))
      )
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("p:501234567");
  });

  it("prefers linked_user_id over the phone", () => {
    const key = customerKey(
      booking({ linked_user_id: "user-b", customer_phone: "050-1234567" })
    );
    expect(key).toBe("u:user-b");
  });

  it("prefers user_id over linked_user_id", () => {
    const key = customerKey(booking({ user_id: "user-a", linked_user_id: "user-b" }));
    expect(key).toBe("u:user-a");
  });

  // The 47-row live case: a walk-in the DB trigger matched to an account must
  // NOT count as a second customer alongside that person's own app bookings.
  it("gives a linked walk-in and that user's own booking the SAME key", () => {
    const appBooking = booking({ id: "row-app", user_id: "user-c" });
    const linkedWalkin = booking({
      id: "row-walkin",
      user_id: null,
      linked_user_id: "user-c",
      customer_phone: "050-9999999",
    });
    expect(customerKey(linkedWalkin)).toBe(customerKey(appBooking));
    expect(new Set([customerKey(appBooking), customerKey(linkedWalkin)]).size).toBe(1);
  });

  it("keeps an UNlinked walk-in separate from an unrelated account", () => {
    const walkin = customerKey(booking({ id: "row-w", customer_phone: "0501234567" }));
    const account = customerKey(booking({ id: "row-u", user_id: "user-a" }));
    expect(walkin).not.toBe(account);
  });

  it("falls back to the booking id when there is no account and no usable phone", () => {
    expect(customerKey(booking({ id: "row-x" }))).toBe("w:row-x");
    expect(customerKey(booking({ id: "row-y", customer_phone: "123" }))).toBe("w:row-y");
  });

  it("keeps phone-less walk-ins distinct rather than collapsing them into one", () => {
    const a = customerKey(booking({ id: "row-a" }));
    const b = customerKey(booking({ id: "row-b" }));
    expect(a).not.toBe(b);
  });

  it("always returns a non-empty key", () => {
    for (const b of [
      booking(),
      booking({ user_id: "u" }),
      booking({ customer_phone: "0501234567" }),
      booking({ customer_phone: "" }),
    ]) {
      expect(customerKey(b).length).toBeGreaterThan(2);
    }
  });
});

describe("isRegisteredKey", () => {
  it("is true only for account keys", () => {
    expect(isRegisteredKey("u:user-a")).toBe(true);
    expect(isRegisteredKey("p:501234567")).toBe(false);
    expect(isRegisteredKey("w:row-1")).toBe(false);
  });

  it("treats a linked walk-in as registered", () => {
    expect(isRegisteredKey(customerKey(booking({ linked_user_id: "user-b" })))).toBe(true);
  });
});
