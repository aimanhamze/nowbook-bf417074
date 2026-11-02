import { describe, expect, it } from "vitest";
import { resolveProviderRouteId } from "./providerRouteId";

const ID = "7e552c65-eac5-4254-ad4a-c9631fbb3c78";

describe("resolveProviderRouteId", () => {
  it("a clean UUID renders as is", () => {
    expect(resolveProviderRouteId(ID)).toEqual({ kind: "ok", id: ID });
    expect(resolveProviderRouteId(ID.toUpperCase())).toEqual({ kind: "ok", id: ID.toUpperCase() });
  });

  it("the broken template link redirects to the bare UUID", () => {
    // The exact link from the PROD test, as sent.
    const url = `https://www.ehjezly.co.il/provider/%7B%7B1%7D%7D${ID}`;
    expect(resolveProviderRouteId(url)).toEqual({ kind: "redirect", id: ID });
    // The :id param as React Router hands it over: decoded, and percent-encoded.
    expect(resolveProviderRouteId(`{{1}}${ID}`)).toEqual({ kind: "redirect", id: ID });
    expect(resolveProviderRouteId(`%7B%7B1%7D%7D${ID}`)).toEqual({ kind: "redirect", id: ID });
  });

  it("junk after the UUID redirects too; the first UUID wins", () => {
    expect(resolveProviderRouteId(`${ID}}}`)).toEqual({ kind: "redirect", id: ID });
    const other = "00000000-0000-4000-8000-000000000001";
    expect(resolveProviderRouteId(`x${ID}y${other}`)).toEqual({ kind: "redirect", id: ID });
  });

  it("garbage has no id: the page shows not available", () => {
    for (const param of [undefined, "", "{{1}}", "%7B%7B1%7D%7D", "abc", "7e552c65-eac5-4254-ad4a-c9631fbb3c7", "7e552c65eac54254ad4ac9631fbb3c78"]) {
      expect(resolveProviderRouteId(param), String(param)).toEqual({ kind: "none" });
    }
  });
});
