import { supabase } from "@/integrations/supabase/client";
import { SERVICE_IMAGE_BUCKET, serviceImageExtension, validateServiceImage } from "@/lib/serviceImage";

// Instructor photos and course images, stored exactly like service images: the
// public `provider-images` bucket, in the owner's own {auth.uid()}/ folder that
// the bucket's storage policies key on. Same 5MB / image-only gate.
//
//   {uid}/instructor-{instructorId}-{ts}.{ext}
//   {uid}/course-{courseId}-{ts}.{ext}

export type AcademyImageKind = "instructor" | "course";

export const validateAcademyImage = validateServiceImage;

export function academyImagePath(
  userId: string,
  kind: AcademyImageKind,
  id: string,
  file: Pick<File, "name" | "type">,
  now: number = Date.now(),
): string {
  return `${userId}/${kind}-${id}-${now}.${serviceImageExtension(file)}`;
}

/**
 * The bucket path behind a stored public URL, but ONLY when it is this owner's
 * image of this kind. Anything else returns null, so a replace or remove can
 * never delete a file this feature did not create.
 */
export function academyImagePathFromUrl(
  url: string | null | undefined,
  userId: string,
  kind: AcademyImageKind,
): string | null {
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
  return path.startsWith(`${userId}/${kind}-`) ? path : null;
}

/** Uploads the file and returns its public URL. Throws on a rejected file. */
export async function uploadAcademyImage({
  userId,
  kind,
  id,
  file,
}: {
  userId: string;
  kind: AcademyImageKind;
  id: string;
  file: File;
}): Promise<string> {
  const invalid = validateAcademyImage(file);
  if (invalid) throw new Error(invalid);
  const filePath = academyImagePath(userId, kind, id, file);
  const { error } = await supabase.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(filePath, file, { cacheControl: "3600", contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(SERVICE_IMAGE_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

/** Best-effort removal of a replaced/removed image. Never throws. */
export async function deleteAcademyImage(
  url: string | null | undefined,
  userId: string,
  kind: AcademyImageKind,
): Promise<boolean> {
  const path = academyImagePathFromUrl(url, userId, kind);
  if (!path) return false;
  try {
    const { error } = await supabase.storage.from(SERVICE_IMAGE_BUCKET).remove([path]);
    if (error) {
      console.warn("[academy-image] old file not removed:", path, error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[academy-image] old file not removed:", path, err);
    return false;
  }
}
