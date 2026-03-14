export type AdminUserRole = "student" | "teacher" | "admin";
export type AdminAccountStatus = "active" | "suspended";

export interface AdminUser {
  id: string;
  email: string;
  role: AdminUserRole;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
  accountStatus: AdminAccountStatus;
  statusReason: string | null;
}

export interface AdminUserListQuery {
  keyword?: string;
  role?: AdminUserRole;
  status?: AdminAccountStatus;
  page?: number;
  pageSize?: number;
  lastLoginStart?: string;
  lastLoginEnd?: string;
}

export interface AdminUserListResult {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateAdminUserPayload {
  email: string;
  password: string;
  role: AdminUserRole;
  displayName?: string | null;
  phone?: string | null;
}

export interface UpdateAdminUserPayload {
  displayName?: string | null;
  phone?: string | null;
  role?: AdminUserRole;
  avatarUrl?: string | null;
}

export interface SetAdminUserStatusPayload {
  status: AdminAccountStatus;
  reason?: string | null;
}

export interface ResetAdminUserPasswordPayload {
  newPassword: string;
}

export interface AdminUserStats {
  total: number;
  studentCount: number;
  teacherCount: number;
  adminCount: number;
  recent7dActiveCount: number;
}
