import { describe, it, expect, beforeEach } from "vitest";
import { bookPath, resolvePreselectedService, PRESELECT_PARAM } from "./bookingPreselect";
import { consumeRedirectAfterLogin, saveRedirectAfterLogin } from "./redirectAfterLogin";
import type { Service } from "./mock-data";

const svc = (id: string): Service => ({
  id, name: { he: id, ar: id, en: id }, duration: 15, price: 100,
});

const PROVIDER_A = "11111111-1111-4111-8111-111111111111";
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";

const salon = { category: "piercing", services: [svc(A1), svc(A2)] };

describe("resolvePreselectedService", () => {
  it("a valid id of this provider preselects that service", () => {
    expect(resolvePreselectedService(A2, salon)).toBe(salon.services[1]);
  });

  it("no parameter: nothing is preselected", () => {
    expect(resolvePreselectedService(null, salon)).toBeNull();
    expect(resolvePreselectedService(undefined, salon)).toBeNull();
    expect(resolvePreselectedService("", salon)).toBeNull();
  });

  it("an unknown id is ignored", () => {
    expect(resolvePreselectedService("cccccccc-0000-4000-8000-000000000009", salon)).toBeNull();
    expect(resolvePreselectedService("not-a-uuid", salon)).toBeNull();
    expect(resolvePreselectedService("'; drop table bookings; --", salon)).toBeNull();
  });

  it("another provider's service is ignored", () => {
    // provider.services holds only this provider's active services, so an id
    // that belongs elsewhere can never be selected here.
    expect(resolvePreselectedService(B1, salon)).toBeNull();
  });

  it("a fitness studio ignores the parameter, even for one of its own services", () => {
    expect(resolvePreselectedService(A1, { ...salon, category: "fitness_studio" })).toBeNull();
  });

  it("an academy ignores the parameter", () => {
    expect(resolvePreselectedService(A1, { ...salon, category: "academy" })).toBeNull();
  });

  it("a restored booking draft wins over the parameter", () => {
    expect(resolvePreselectedService(A1, salon, true)).toBeNull();
  });
});

describe("bookPath", () => {
  it("without a service it is the plain booking path", () => {
    expect(bookPath(PROVIDER_A)).toBe(`/provider/${PROVIDER_A}/book`);
    expect(bookPath(PROVIDER_A, null)).toBe(`/provider/${PROVIDER_A}/book`);
    expect(bookPath(PROVIDER_A, "")).toBe(`/provider/${PROVIDER_A}/book`);
  });

  it("with a service it carries ?service=<id>", () => {
    expect(bookPath(PROVIDER_A, A1)).toBe(`/provider/${PROVIDER_A}/book?service=${A1}`);
  });

  it("the id is encoded, so a hostile value cannot add parameters", () => {
    const url = new URL(bookPath(PROVIDER_A, "x&admin=1#y"), "https://app.example");
    expect([...url.searchParams.keys()]).toEqual([PRESELECT_PARAM]);
    expect(url.searchParams.get(PRESELECT_PARAM)).toBe("x&admin=1#y");
    expect(url.hash).toBe("");
  });
});

describe("login redirect round trip", () => {
  beforeEach(() => sessionStorage.clear());

  it("the preselected service survives being sent to /auth and back", () => {
    // What the booking page's sign-in gate saves …
    saveRedirectAfterLogin(bookPath(PROVIDER_A, A2));
    // … is what /auth navigates to after login …
    const target = consumeRedirectAfterLogin();
    expect(target).toBe(`/provider/${PROVIDER_A}/book?service=${A2}`);
    // … and the booking page then reads the same service from it.
    const params = new URL(target!, "https://app.example").searchParams;
    expect(resolvePreselectedService(params.get(PRESELECT_PARAM), salon)).toBe(salon.services[1]);
    // Consumed once.
    expect(consumeRedirectAfterLogin()).toBeNull();
  });

  it("without a service the gate saves the plain booking path, as before", () => {
    saveRedirectAfterLogin(bookPath(PROVIDER_A, null));
    expect(consumeRedirectAfterLogin()).toBe(`/provider/${PROVIDER_A}/book`);
  });
});
