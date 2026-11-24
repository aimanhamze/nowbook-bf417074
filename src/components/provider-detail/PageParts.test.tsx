import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutText, ReviewRow, SectionHeading } from "./PageParts";
import type { Review } from "@/hooks/useReviews";

const review = (patch: Partial<Review> = {}): Review => ({
  id: "r1",
  user_id: "u1",
  provider_id: "p1",
  booking_id: null,
  rating: 4,
  comment: "Great service",
  display_name: "Dana",
  created_at: "2026-11-20T10:00:00Z",
  ...patch,
});

describe("provider page parts", () => {
  // The heading went back to the shared SectionLabel look (orange bar); what
  // this page still guarantees is the size, the contrast and no RTL tracking.
  it("SectionHeading: the shared label with the bar, at 13px, readable grey, no RTL letter-spacing", () => {
    render(<SectionHeading>שירותים</SectionHeading>);
    const h = screen.getByRole("heading", { level: 2, name: "שירותים" });
    expect(h.querySelector("span.bg-accent")).toBeTruthy();
    expect(h.className).toContain("text-[13px]");
    expect(h.className).toContain("text-foreground/70");
    expect(h.className).toContain("rtl:tracking-normal");
    expect(h.className).not.toMatch(/text-xs|muted-foreground/);
  });

  it("ReviewRow: name, date, a labelled rating and the comment in its own direction", () => {
    render(<ul><ReviewRow review={review()} anonymousLabel="Guest" /></ul>);
    expect(screen.getByText("Dana")).toBeTruthy();
    expect(screen.getByText("20/11/2026")).toBeTruthy();
    expect(screen.getByRole("img", { name: "4/5" })).toBeTruthy();
    expect(screen.getByText("Great service").getAttribute("dir")).toBe("auto");
  });

  it("ReviewRow: no name falls back to the translated label; no comment, no paragraph", () => {
    const { container } = render(
      <ul><ReviewRow review={review({ display_name: null, comment: null })} anonymousLabel="אורח" /></ul>,
    );
    expect(screen.getByText("אורח")).toBeTruthy();
    expect(container.querySelector("p")).toBeNull();
  });

  it("AboutText: dir=auto, three-line clamp, and no 'read more' when nothing is cut", () => {
    render(<AboutText text="Short text" moreLabel="Read more" lessLabel="Show less" />);
    const p = screen.getByText("Short text");
    expect(p.getAttribute("dir")).toBe("auto");
    expect(p.className).toContain("line-clamp-3");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
