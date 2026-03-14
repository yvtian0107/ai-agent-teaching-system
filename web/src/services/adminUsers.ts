import { supabaseRpc } from "@/services/supabaseRpc";
import type {
  AdminUser,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserRole,
  AdminUserStats,
  CreateAdminUserPayload,
  ResetAdminUserPasswordPayload,
  SetAdminUserStatusPayload,
  UpdateAdminUserPayload,
} from "@/types/admin-user";

interface AdminUserRow {
  id: string;
  email: string;
  role: AdminUserRole;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
  account_status: "active" | "suspended";
  status_reason: string | null;
}

interface AdminListUsersRpcRow extends AdminUserRow {
  total_count: number | string | null;
}

interface CreateAdminUserResponse {
  user_id: string;
  email: string;
  role: AdminUserRole;
  display_name: string | null;
  phone: string | null;
}

interface CreateAdminUserRpcRow {
  user_id: string;
  email: string;
  role: string;
  display_name: string | null;
  phone: string | null;
}

interface ResetAdminUserPasswordResponse {
  user_id: string;
  password_reset: boolean;
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    phone: row.phone,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accountStatus: row.account_status,
    statusReason: row.status_reason,
  };
}

function buildAdminListUsersRpcParams(query?: AdminUserListQuery): Record<string, unknown> {
  const keyword = query?.keyword?.trim();

  return {
    p_keyword: keyword || null,
    p_role: query?.role || null,
    p_status: query?.status || null,
    p_page: query?.page || 1,
    p_page_size: query?.pageSize || 20,
    p_last_login_start: query?.lastLoginStart || null,
    p_last_login_end: query?.lastLoginEnd || null,
  };
}

function getTotalFromAdminListRows(rows: AdminListUsersRpcRow[]): number {
  const raw = rows[0]?.total_count;
  const parsed = Number(raw ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function normalizeAdminRole(role: string): AdminUserRole {
  if (role === "teacher") {
    return "teacher";
  }
  if (role === "admin") {
    return "admin";
  }
  return "student";
}

function toCreateAdminUserResponse(
  row: CreateAdminUserRpcRow | null | undefined
): CreateAdminUserResponse {
  if (!row || !row.user_id || !row.email) {
    throw new Error("创建用户失败：未返回用户信息");
  }

  return {
    user_id: row.user_id,
    email: row.email,
    role: normalizeAdminRole(row.role),
    display_name: row.display_name,
    phone: row.phone,
  };
}

function unwrapRpcRow<TRow>(data: TRow[] | TRow): TRow | null {
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }
  return data ?? null;
}

function mapAdminMutationError(error: unknown, fallbackMessage: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const lowered = raw.toLowerCase();

  const isDuplicatedEmail =
    raw.includes("该邮箱已注册") ||
    lowered.includes("already registered") ||
    lowered.includes("already exists") ||
    lowered.includes("duplicate key value") ||
    lowered.includes("users_email_key");

  if (isDuplicatedEmail) {
    return new Error("该邮箱已注册，请直接登录");
  }

  const isPasswordTooShort =
    raw.includes("密码至少 8 位") ||
    (lowered.includes("password") && lowered.includes("8"));

  if (isPasswordTooShort) {
    return new Error("密码至少 8 位");
  }

  const isInvalidEmail =
    raw.includes("邮箱格式不正确") ||
    (lowered.includes("email") && lowered.includes("invalid"));

  if (isInvalidEmail) {
    return new Error("邮箱格式不正确");
  }

  if (raw.includes("role 非法")) {
    return new Error("角色不合法");
  }

  if (raw.includes("display_name 不能为空")) {
    return new Error("显示名称不能为空");
  }

  if (raw.includes("display_name 长度不能超过 50")) {
    return new Error("显示名称长度不能超过 50");
  }

  if (raw.includes("phone 格式不正确")) {
    return new Error("手机号格式不正确");
  }

  if (raw.includes("不能修改自己的角色")) {
    return new Error("不能修改自己的角色");
  }

  if (raw.includes("不能停用自己")) {
    return new Error("不能停用自己");
  }

  if (raw.includes("系统至少保留一个 active admin")) {
    return new Error("系统至少保留一个 active admin");
  }

  if (raw.includes("停用时必须填写原因")) {
    return new Error("停用时必须填写原因");
  }

  if (raw.includes("用户不存在")) {
    return new Error("用户不存在");
  }

  if (raw.includes("仅管理员可操作") || raw.includes("仅管理员可访问")) {
    return new Error("仅管理员可操作");
  }

  return error instanceof Error ? error : new Error(raw || fallbackMessage);
}

function mapCreateAdminUserError(error: unknown): Error {
  return mapAdminMutationError(error, "创建用户失败");
}

export async function listAdminUsers(query?: AdminUserListQuery): Promise<AdminUserListResult> {
  const page = Number(query?.page || 1);
  const pageSize = Number(query?.pageSize || 20);

  const rpcParams = buildAdminListUsersRpcParams(query);
  const rows = await supabaseRpc<AdminListUsersRpcRow[]>("admin_list_users", rpcParams);

  let total = getTotalFromAdminListRows(rows);

  // admin_list_users 在空分页时不会返回 total_count，需要补一次轻量查询保持分页语义。
  if (rows.length === 0 && page > 1) {
    const fallbackRows = await supabaseRpc<AdminListUsersRpcRow[]>("admin_list_users", {
      ...rpcParams,
      p_page: 1,
      p_page_size: 1,
    });
    total = getTotalFromAdminListRows(fallbackRows);
  }

  return {
    users: rows.map(toAdminUser),
    total,
    page,
    pageSize,
  };
}

export async function createAdminUser(payload: CreateAdminUserPayload) {
  const rpcParams = {
    p_email: payload.email.trim().toLowerCase(),
    p_password: payload.password,
    p_role: payload.role,
    p_display_name: payload.displayName?.trim() || null,
    p_phone: payload.phone?.trim() || null,
  };

  try {
    const data = await supabaseRpc<CreateAdminUserRpcRow[] | CreateAdminUserRpcRow>(
      "admin_create_user",
      rpcParams
    );

    if (Array.isArray(data)) {
      return toCreateAdminUserResponse(data[0]);
    }

    return toCreateAdminUserResponse(data);
  } catch (error) {
    throw mapCreateAdminUserError(error);
  }
}

export async function updateAdminUser(userId: string, payload: UpdateAdminUserPayload) {
  const rpcParams = {
    p_user_id: userId,
    p_display_name:
      payload.displayName === undefined ? null : (payload.displayName?.trim() ?? null),
    p_phone: payload.phone === undefined ? null : (payload.phone?.trim() ?? null),
    p_role: payload.role === undefined ? null : payload.role,
    p_avatar_url: payload.avatarUrl === undefined ? null : (payload.avatarUrl?.trim() ?? null),
  };

  try {
    const data = await supabaseRpc<AdminUserRow[] | AdminUserRow>(
      "admin_update_user_basic",
      rpcParams
    );
    const row = unwrapRpcRow(data);

    if (!row) {
      throw new Error("更新用户失败：未返回用户信息");
    }

    return toAdminUser(row);
  } catch (error) {
    throw mapAdminMutationError(error, "更新用户失败");
  }
}

export async function setAdminUserStatus(userId: string, payload: SetAdminUserStatusPayload) {
  const rpcParams = {
    p_user_id: userId,
    p_status: payload.status,
    p_reason: payload.reason?.trim() || null,
  };

  try {
    const data = await supabaseRpc<AdminUserRow[] | AdminUserRow>(
      "admin_set_user_status",
      rpcParams
    );
    const row = unwrapRpcRow(data);

    if (!row) {
      throw new Error("更新账号状态失败：未返回用户信息");
    }

    return toAdminUser(row);
  } catch (error) {
    throw mapAdminMutationError(error, "更新账号状态失败");
  }
}

export async function resetAdminUserPassword(
  userId: string,
  payload: ResetAdminUserPasswordPayload
) {
  const rpcParams = {
    p_user_id: userId,
    p_new_password: payload.newPassword,
  };

  try {
    const data = await supabaseRpc<boolean>("admin_reset_user_password", rpcParams);

    return {
      user_id: userId,
      password_reset: Boolean(data),
    } satisfies ResetAdminUserPasswordResponse;
  } catch (error) {
    throw mapAdminMutationError(error, "重置密码失败");
  }
}

async function fetchCount(params?: AdminUserListQuery): Promise<number> {
  const result = await listAdminUsers({
    ...params,
    page: 1,
    pageSize: 1,
  });
  return result.total;
}

export async function getAdminUserStats(): Promise<AdminUserStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [total, studentCount, teacherCount, adminCount, recent7dActiveCount] = await Promise.all([
    fetchCount(),
    fetchCount({ role: "student" }),
    fetchCount({ role: "teacher" }),
    fetchCount({ role: "admin" }),
    fetchCount({ lastLoginStart: sevenDaysAgo }),
  ]);

  return {
    total,
    studentCount,
    teacherCount,
    adminCount,
    recent7dActiveCount,
  };
}
