import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/store/authStore";

interface EnsureProfileInput {
  role: UserRole;
  displayName?: string | null;
}

export function extractRoleFromMetadata(
  metadata: User["user_metadata"] | null | undefined
): UserRole | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const role = (metadata as { role?: unknown }).role;
  if (role === "teacher" || role === "student" || role === "admin") {
    return role;
  }
  return null;
}

export function normalizeUserRole(rawRole: unknown, fallback: UserRole = "student"): UserRole {
  if (rawRole === "teacher" || rawRole === "student" || rawRole === "admin") {
    return rawRole;
  }
  return fallback;
}

export interface CurrentProfile {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
}

function toCurrentProfile(payload: unknown): CurrentProfile | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string") {
    return null;
  }

  return {
    id: row.id,
    email: typeof row.email === "string" ? row.email : "",
    role: normalizeUserRole(row.role, "student"),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
    phone: typeof row.phone === "string" ? row.phone : null,
  };
}

export async function fetchCurrentProfileByRpc(): Promise<CurrentProfile | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("current_profile");

  if (error) {
    return null;
  }

  if (Array.isArray(data)) {
    return toCurrentProfile(data[0]);
  }

  return toCurrentProfile(data);
}

export async function ensureProfileForUser(user: User, input: EnsureProfileInput): Promise<void> {
  const supabase = getSupabaseClient();
  const rpcParams = {
    p_role: input.role,
    p_display_name: input.displayName?.trim() || null,
    p_email: user.email ?? "",
  };

  // current workspace does not have generated RPC typings for this function yet.
  const { error } = await supabase.rpc("ensure_current_profile", rpcParams as never);

  if (error) {
    throw new Error(error.message || "Profile 初始化失败");
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveCurrentProfileWithRetry(
  fallbackRole: UserRole,
  maxAttempts = 3
): Promise<{ profile: CurrentProfile | null; role: UserRole }> {
  let profile: CurrentProfile | null = null;
  let resolvedRole: UserRole = fallbackRole;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    profile = await fetchCurrentProfileByRpc();
    if (profile) {
      resolvedRole = profile.role;
      break;
    }

    if (attempt < maxAttempts - 1) {
      await wait(180 * (attempt + 1));
    }
  }

  return { profile, role: resolvedRole };
}

export async function resolveUserRoleWithRetry(
  _userId: string,
  fallbackRole: UserRole,
  maxAttempts = 3
): Promise<UserRole> {
  const { role: resolvedRole } = await resolveCurrentProfileWithRetry(
    fallbackRole,
    maxAttempts
  );
  return resolvedRole;
}

export function getRoleRedirectPath(role: UserRole): string {
  if (role === "admin") {
    return "/admin/users";
  }

  if (role === "teacher") {
    return "/teacher";
  }
  return "/student/learn";
}

export async function updateProfileInfo(input: {
  displayName: string;
  phone: string | null;
}) {
  const supabase = getSupabaseClient();
  const params = {
    p_display_name: input.displayName.trim(),
    p_phone: input.phone,
  };
  // current workspace does not have generated RPC typings for this function yet.
  const { data, error } = await supabase.rpc("update_profile_info", params as never);
  return { data, error };
}

export async function updateAvatarUrl(avatarUrl: string) {
  const supabase = getSupabaseClient();
  const params = {
    p_avatar_url: avatarUrl,
  };
  // current workspace does not have generated RPC typings for this function yet.
  const { data, error } = await supabase.rpc("update_avatar_url", params as never);
  return { data, error };
}

export async function verifyCurrentPassword(currentPassword: string) {
  const supabase = getSupabaseClient();
  const params = {
    p_password: currentPassword,
  };
  // current workspace does not have generated RPC typings for this function yet.
  const { data, error } = await supabase.rpc("verify_user_password", params as never);
  return { data, error };
}

export async function updatePassword(newPassword: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  return { data, error };
}
