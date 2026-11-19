import type { SyntheticEvent } from "react";

// Sized image URLs via Supabase Storage image transformations.
//
// Provider photos are stored in the DB as full public object URLs
// (…/storage/v1/object/public/<bucket>/<path>) and are 1–10 MB originals.
// `sized()` rewrites ONLY our own PROD project's URLs to the render endpoint
// (…/storage/v1/render/image/public/<bucket>/<path>?width=…), which serves a
// resized, auto-WebP copy from the CDN. Every other URL — Unsplash, the old
// seed project host, data:/blob:, empty — is returned unchanged.
//
// Transformations can be refused (e.g. the org Spend Cap blocks them once the
// cycle's origin-image quota is used up), so every <img> using `sized()` must
// also use `withOriginalFallback()`: on the first error it swaps to the
// original URL once; a second error goes to the caller's own handler.
//
// Every caller (incl. the map-pin HTML in Nearby.tsx and the gallery viewer
// preload) goes through sized(), so the kill switch below covers them all.

export const OWN_STORAGE_HOST = "aqlcjjrgsxispdjwrnqf.supabase.co";

/**
 * Kill switch: VITE_IMAGE_TRANSFORMS=off makes sized() return every URL
 * unchanged (originals everywhere). Unset or any other value = on. Read per
 * call so tests can stub it; Vite inlines it at build time.
 */
export function imageTransformsEnabled(): boolean {
  const flag = import.meta.env.VITE_IMAGE_TRANSFORMS;
  return typeof flag !== "string" || flag.trim().toLowerCase() !== "off";
}
const OBJECT_PREFIX = "/storage/v1/object/public/";
const RENDER_PREFIX = "/storage/v1/render/image/public/";

export interface SizeOptions {
  width: number;
  height?: number;
  /** 20–100; Supabase default is 80. */
  quality?: number;
  /** Supabase default is "cover". */
  resize?: "cover" | "contain" | "fill";
}

export function sized(url: string, opts: SizeOptions): string;
export function sized(url: string | null | undefined, opts: SizeOptions): string | null | undefined;
export function sized(url: string | null | undefined, opts: SizeOptions): string | null | undefined {
  if (!url || !imageTransformsEnabled()) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" || parsed.host !== OWN_STORAGE_HOST) return url;
  if (!parsed.pathname.startsWith(OBJECT_PREFIX)) return url;

  parsed.pathname = RENDER_PREFIX + parsed.pathname.slice(OBJECT_PREFIX.length);
  parsed.searchParams.set("width", String(Math.round(opts.width)));
  if (opts.height != null) parsed.searchParams.set("height", String(Math.round(opts.height)));
  if (opts.quality != null) parsed.searchParams.set("quality", String(Math.round(opts.quality)));
  if (opts.resize) parsed.searchParams.set("resize", opts.resize);
  return parsed.toString();
}

/**
 * onError handler for an <img> whose src came from `sized(original, …)`.
 * First failure: swap to the original URL (once per original — the guard is
 * stored on the element, so it cannot loop). Any later failure, or a src that
 * already IS the original, goes to `onFinalError`.
 */
export function withOriginalFallback(
  original: string | null | undefined,
  onFinalError?: (e: SyntheticEvent<HTMLImageElement>) => void,
) {
  return (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (original && img.dataset.fallbackFor !== original && img.getAttribute("src") !== original) {
      img.dataset.fallbackFor = original;
      img.src = original;
      return;
    }
    onFinalError?.(e);
  };
}
