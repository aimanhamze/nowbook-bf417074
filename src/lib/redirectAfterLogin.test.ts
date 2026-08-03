import { describe, it, expect, beforeEach } from "vitest";
import { saveRedirectAfterLogin, consumeRedirectAfterLogin } from "./redirectAfterLogin";

describe("redirectAfterLogin", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips an explicit destination", () => {
    saveRedirectAfterLogin("/provider/5051f95d-5ecf-4564-98e1-ca833267fb64/book");
    expect(consumeRedirectAfterLogin()).toBe("/provider/5051f95d-5ecf-4564-98e1-ca833267fb64/book");
  });

  it("returns null when nothing was saved", () => {
    expect(consumeRedirectAfterLogin()).toBeNull();
  });

  it("consumes the destination so it cannot fire twice", () => {
    saveRedirectAfterLogin("/bookings");
    expect(consumeRedirectAfterLogin()).toBe("/bookings");
    expect(consumeRedirectAfterLogin()).toBeNull();
  });

  it("defaults to the current location including query and hash", () => {
    window.history.pushState({}, "", "/explore?q=hair#top");
    saveRedirectAfterLogin();
    expect(consumeRedirectAfterLogin()).toBe("/explore?q=hair#top");
  });

  it("never saves the login flow itself", () => {
    saveRedirectAfterLogin("/auth");
    expect(consumeRedirectAfterLogin()).toBeNull();

    saveRedirectAfterLogin("/reset-password?token=abc");
    expect(consumeRedirectAfterLogin()).toBeNull();
  });

  it("rejects off-site destinations", () => {
    saveRedirectAfterLogin("https://evil.example.com");
    expect(consumeRedirectAfterLogin()).toBeNull();

    saveRedirectAfterLogin("//evil.example.com");
    expect(consumeRedirectAfterLogin()).toBeNull();
  });
});
