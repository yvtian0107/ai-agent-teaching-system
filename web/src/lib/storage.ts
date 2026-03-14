import { getSupabaseClient } from "@/lib/supabase";

const AVATAR_BUCKET = "avatars";
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface UploadResult {
  url: string;
  path: string;
}

export function validateImageFile(file: File): FileValidationResult {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "仅支持 JPG、PNG、GIF、WEBP 格式图片",
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: "头像文件大小不能超过 2MB",
    };
  }

  return { valid: true };
}

export async function uploadAvatar(
  userId: string,
  file: File
): Promise<{ data: UploadResult | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const fileExt = file.name.split(".").pop() || "jpg";
  const fileName = `avatar_${Date.now()}.${fileExt}`;
  const filePath = `${userId}/${fileName}`;

  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type,
      });

    if (error) {
      return { data: null, error: error.message };
    }

    const { data: urlData } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(data.path);

    return {
      data: {
        url: urlData.publicUrl,
        path: data.path,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteOldAvatar(avatarUrl: string): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    const urlParts = avatarUrl.split(`/storage/v1/object/public/${AVATAR_BUCKET}/`);
    if (urlParts.length < 2) {
      return;
    }

    const filePath = urlParts[1];
    await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
  } catch {
    // Ignore non-fatal deletion errors.
  }
}
