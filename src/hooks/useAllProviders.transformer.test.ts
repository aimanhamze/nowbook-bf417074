import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { dbProviderToProvider, type DbProvider, type DbService } from "./useAllProviders";

const dbProvider: DbProvider = {
  id: "p1",
  user_id: "u1",
  business_name: "Studio",
  category: "nails",
  address: "Main St",
  about: null,
  phone: null,
  cover_image: null,
  avatar_image: null,
  average_rating: null,
  min_lead_time_minutes: 15,
  social_links: null,
};

const service = (over: Partial<DbService> = {}): DbService => ({
  id: "s1",
  provider_id: "p1",
  name: "Gel",
  duration: 60,
  price: 120,
  is_active: true,
  sort_order: 0,
  service_type: "private",
  max_capacity: 1,
  scheduled_time: null,
  latest_start_time: null,
  ...over,
});

describe("dbProviderToProvider — service image_url", () => {
  it("passes a stored image URL through to the UI service", () => {
    const p = dbProviderToProvider(dbProvider, [service({ image_url: "https://x/img.jpg" })]);
    expect(p.services[0].image_url).toBe("https://x/img.jpg");
  });

  it("maps a missing column (pre-migration row) to null, so the icon shows", () => {
    const p = dbProviderToProvider(dbProvider, [service()]);
    expect(p.services[0].image_url).toBeNull();
  });

  it("treats null, empty and whitespace-only values as no image", () => {
    const p = dbProviderToProvider(dbProvider, [
      service({ id: "a", image_url: null }),
      service({ id: "b", image_url: "" }),
      service({ id: "c", image_url: "   " }),
    ]);
    expect(p.services.map((s) => s.image_url)).toEqual([null, null, null]);
  });

  it("leaves the rest of the service mapping unchanged", () => {
    const p = dbProviderToProvider(dbProvider, [
      service({ image_url: "https://x/img.jpg" }),
      service({ id: "off", is_active: false, image_url: "https://x/off.jpg" }),
    ]);
    expect(p.services).toHaveLength(1);
    expect(p.services[0]).toMatchObject({
      id: "s1",
      name: { he: "Gel", ar: "Gel", en: "Gel" },
      duration: 60,
      price: 120,
      service_type: "private",
      max_capacity: 1,
    });
  });
});
