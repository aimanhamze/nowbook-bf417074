import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ProviderIdGuard } from "./ProviderIdGuard";

const ID = "7e552c65-eac5-4254-ad4a-c9631fbb3c78";

function Page({ name }: { name: string }) {
  const { id } = useParams();
  const location = useLocation();
  return <p data-testid="page">{`${name} id=${id} at=${location.pathname}${location.search}`}</p>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/provider/:id" element={<ProviderIdGuard><Page name="detail" /></ProviderIdGuard>} />
        <Route path="/provider/:id/book" element={<ProviderIdGuard subpath="/book"><Page name="book" /></ProviderIdGuard>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId("page").textContent;
}

describe("ProviderIdGuard", () => {
  it("replaces the broken template link with the clean provider URL", () => {
    expect(renderAt(`/provider/%7B%7B1%7D%7D${ID}`)).toBe(`detail id=${ID} at=/provider/${ID}`);
  });

  it("keeps /book and the query string", () => {
    expect(renderAt(`/provider/%7B%7B1%7D%7D${ID}/book?service=x`)).toBe(`book id=${ID} at=/provider/${ID}/book?service=x`);
  });

  it("a clean id renders untouched", () => {
    expect(renderAt(`/provider/${ID}`)).toBe(`detail id=${ID} at=/provider/${ID}`);
  });

  it("garbage renders the page as is (it shows not available)", () => {
    expect(renderAt("/provider/%7B%7B1%7D%7D")).toBe("detail id={{1}} at=/provider/%7B%7B1%7D%7D");
  });
});
