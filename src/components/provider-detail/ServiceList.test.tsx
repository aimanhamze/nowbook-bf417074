import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceList } from "./ServiceList";
import { visibleServiceCount } from "@/lib/serviceListCollapse";
import { translations, type Lang } from "@/lib/translations";
import type { Service } from "@/lib/mock-data";

const t = (lang: Lang) => (key: string) => (translations[lang] as Record<string, string>)[key];

const make = (n: number, patch: (i: number) => Partial<Service> = () => ({})): Service[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    name: { he: `שירות ${i + 1}`, ar: `שירות ${i + 1}`, en: `שירות ${i + 1}` },
    duration: 15,
    price: 100 + i,
    ...patch(i),
  }));

describe("visibleServiceCount", () => {
  it("up to 8 services: all of them", () => {
    expect([0, 1, 3, 8].map((n) => visibleServiceCount(n, false))).toEqual([0, 1, 3, 8]);
  });

  it("more than 8: six, until expanded", () => {
    expect([9, 14, 40].map((n) => visibleServiceCount(n, false))).toEqual([6, 6, 6]);
    expect([9, 14, 40].map((n) => visibleServiceCount(n, true))).toEqual([9, 14, 40]);
  });
});

describe("ServiceList", () => {
  it("3 services: all rows, no expand row", () => {
    render(<ServiceList services={make(3)} showPrices lang="he" t={t("he")} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("14 services: 6 rows and 'show all 14', expanding and collapsing in place", () => {
    render(<ServiceList services={make(14)} showPrices lang="he" t={t("he")} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const toggle = screen.getByRole("button", { name: "הצג את כל 14 השירותים" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getAllByRole("listitem")).toHaveLength(14);
    expect(screen.getByRole("button", { name: "הצג פחות" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("the expand row is worded in ar and en", () => {
    const { unmount } = render(<ServiceList services={make(14)} showPrices lang="ar" t={t("ar")} />);
    expect(screen.getByRole("button", { name: "عرض جميع الخدمات (14)" })).toBeInTheDocument();
    unmount();
    render(<ServiceList services={make(14)} showPrices lang="en" t={t("en")} />);
    expect(screen.getByRole("button", { name: "Show all 14 services" })).toBeInTheDocument();
  });

  it("prices: ₪ before the number, left-to-right, in every row", () => {
    render(<ServiceList services={make(2, () => ({ price: 1200 }))} showPrices lang="he" t={t("he")} />);
    const prices = screen.getAllByText("₪1,200");
    expect(prices).toHaveLength(2);
    expect(prices[0]).toHaveAttribute("dir", "ltr");
  });

  it("show_prices off: no price anywhere", () => {
    const { container } = render(<ServiceList services={make(3)} showPrices={false} lang="he" t={t("he")} />);
    expect(container.textContent).not.toContain("₪");
  });

  it("a free service shows no price even with prices on", () => {
    const { container } = render(<ServiceList services={make(1, () => ({ price: 0 }))} showPrices lang="he" t={t("he")} />);
    expect(container.textContent).not.toContain("₪");
  });

  it("no service has a picture: no thumbnail column", () => {
    const { container } = render(<ServiceList services={make(3)} showPrices lang="he" t={t("he")} />);
    expect(container.querySelectorAll(".h-11.w-11")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("some have a picture: every row keeps the 44px box so names stay aligned", () => {
    const url = "https://aqlcjjrgsxispdjwrnqf.supabase.co/storage/v1/object/public/provider-images/a.jpg";
    const services = make(3, (i) => (i === 0 ? { image_url: url } : {}));
    const { container } = render(<ServiceList services={services} showPrices lang="he" t={t("he")} />);
    expect(container.querySelectorAll(".h-11.w-11")).toHaveLength(3);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    // Through sized(): render endpoint, width only, resize=contain.
    expect(imgs[0].getAttribute("src")).toBe(
      "https://aqlcjjrgsxispdjwrnqf.supabase.co/storage/v1/render/image/public/provider-images/a.jpg?width=240&resize=contain",
    );
  });

  it("names are bidi-isolated so mixed Hebrew/English wraps in its own order", () => {
    const services = make(1, () => ({ name: { he: "Helix + תכשיט", ar: "Helix + תכשיט", en: "Helix + תכשיט" } }));
    render(<ServiceList services={services} showPrices lang="he" t={t("he")} />);
    expect(screen.getByText("Helix + תכשיט").tagName).toBe("BDI");
  });

  it("rows are not interactive yet", () => {
    const { container } = render(<ServiceList services={make(3)} showPrices lang="he" t={t("he")} />);
    expect(container.querySelectorAll("li a, li button")).toHaveLength(0);
  });
});
