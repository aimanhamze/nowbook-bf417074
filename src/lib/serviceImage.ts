import { supabase } from "@/integrations/supabase/client";

// Optional illustrative image per service (provider_services.image_url).
//
// Stored in the EXISTING public `provider-images` bucket, in the owner's own
// folder — the same {auth.uid()}/... layout as the cover/avatar uploads in
// useProviderProfile, which is what the bucket's storage policies key on. No
// compression step: none of the existing uploads resize either, so the 5MB cap
// below is the only size control.

export const SERVICE_IMAGE_BUCKET = "provider-images";
export const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ServiceImageError = "IMAGE_INVALID_TYPE" | "IMAGE_TOO_LARGE";

/** Client-side gate, run when the file is picked. null = acceptable. */
export function validateServiceImage(file: Pick<File, "type" | "size">): ServiceImageError | null {
  if (!file.type || !file.type.startsWith("image/")) return "IMAGE_INVALID_TYPE";
  if (file.size > SERVICE_IMAGE_MAX_BYTES) return "IMAGE_TOO_LARGE";
  return null;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};

/** Lowercase alphanumeric extension from the file name, else from the MIME type, else jpg. */
export function serviceImageExtension(file: Pick<File, "name" | "type">): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
  const clean = fromName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean) return clean;
  return MIME_EXTENSIONS[file.type] ?? "jpg";
}

/** {userId}/service-{serviceId}-{timestamp}.{ext} */
export function serviceImagePath(
  userId: string,
  serviceId: string,
  file: Pick<File, "name" | "type">,
  now: number = Date.now(),
): string {
  return `${userId}/service-${serviceId}-${now}.${serviceImageExtension(file)}`;
}

/**
 * The bucket path behind a stored public URL, but ONLY when it is one of this
 * owner's service images. Anything else — another bucket, an external URL, the
 * owner's cover/avatar, someone else's folder — returns null, so a replace or
 * remove can never delete a file this feature did not create.
 */
export function serviceImagePathFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${SERVICE_IMAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  let path = url.slice(at + marker.length).split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  return path.startsWith(`${userId}/service-`) ? path : null;
}

/** Uploads the file and returns its public URL. */
export async function uploadServiceImage({
  userId,
  serviceId,
  file,
}: {
  userId: string;
  serviceId: string;
  file: File;
}): Promise<string> {
  const filePath = serviceImagePath(userId, serviceId, file);
  const { error } = await supabase.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(filePath, file, { cacheControl: "3600", contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(SERVICE_IMAGE_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Best-effort removal of a replaced/removed image. Never throws: the row has
 * already been updated by the time this runs, so a failed delete only leaves
 * an orphaned file, never a broken image on a service.
 */
export async function deleteServiceImage(url: string | null | undefined, userId: string): Promise<boolean> {
  const path = serviceImagePathFromUrl(url, userId);
  if (!path) return false;
  try {
    const { error } = await supabase.storage.from(SERVICE_IMAGE_BUCKET).remove([path]);
    if (error) {
      console.warn("[service-image] old file not removed:", path, error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[service-image] old file not removed:", path, err);
    return false;
  }
}
