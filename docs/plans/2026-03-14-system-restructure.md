# 系统重构计划 — Server 专注 AI 对话 + Supabase 重建

> 日期: 2026-03-14
> 状态: 已执行

## TL;DR

重构整个系统架构：Server **只处理** AI 对话相关（对话流、会话管理、Agent 列表），其余所有业务（用户注册/登录、权限、人员管理等）全部由前端直连 Supabase 处理。Supabase 数据库**完全重置**，只保留 4 个核心 SQL 模块。

---

## 架构原则

| 职责 | 承担方 | 端点/方式 |
|------|--------|-----------|
| AI 对话流 | Server | `POST /agents/{id}/agui` |
| 会话 CRUD | Server | `GET/DELETE /api/sessions` |
| Agent 列表 | Server | `GET /api/agents` |
| 健康检查 | Server | `GET /status` |
| 用户注册/登录 | Supabase Auth | `supabase.auth.signUp / signIn` |
| 用户资料/角色权限 | Supabase RPC | `current_profile()` 等 |
| 管理员人员管理 | Supabase RPC | `admin_list_users()` 等 |
| 头像存储 | Supabase Storage | avatars bucket |

### Decisions

- `imitate_*` 目录为参考文件，**不修改**
- 去掉多租户体系，只保留单系统 **student / teacher / admin** 三角色
- AI 对话历史继续存 **SQLite** (`server/data/agno.db`)，不迁移到 Supabase
- Server 只保留 4 个端点组：health、agents、sessions、AGUI 流
- courses / assignments / mistake_records 等教学模块**暂不重建**，后续按需添加

---

## Supabase 重置命令

在执行 Phase 2 之前，先用以下命令彻底重置 Supabase 数据库：

```bash
# 方式 1: 使用 supabase CLI（推荐）
supabase db reset

# 方式 2: 如果 CLI 不可用，直接连 PostgreSQL 执行以下 SQL
```

```sql
-- ============================================================
-- Supabase 数据库完全重置 SQL
-- 警告: 此操作不可逆，将删除所有自定义表、函数、触发器、类型、策略
-- ============================================================

-- 1. 删除所有自定义触发器
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
    ) LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I CASCADE', r.trigger_name, r.event_object_table);
    END LOOP;
END $$;

-- 2. 删除 auth schema 上的自定义触发器（如 on_auth_user_created）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 3. 删除所有自定义函数
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT routines.routine_name, routines.specific_name,
               pg_get_function_identity_arguments(p.oid) AS args
        FROM information_schema.routines
        JOIN pg_proc p ON p.proname = routines.routine_name
        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
        WHERE routines.routine_schema = 'public'
          AND routines.routine_type = 'FUNCTION'
    ) LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.routine_name, r.args);
    END LOOP;
END $$;

-- 4. 删除所有自定义表（按依赖顺序）
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('schema_migrations')
        ORDER BY tablename
    ) LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;
END $$;

-- 5. 删除所有自定义枚举类型
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype = 'e'
    ) LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;

-- 6. 清理存储桶策略和桶
DELETE FROM storage.objects WHERE bucket_id IN ('avatars');
DELETE FROM storage.buckets WHERE id IN ('avatars');

-- 7. 清理 auth.users 中的测试用户（可选，谨慎使用）
-- DELETE FROM auth.users;

-- 验证清理结果
SELECT 'Tables' AS type, count(*) FROM pg_tables WHERE schemaname = 'public'
UNION ALL
SELECT 'Functions', count(*) FROM information_schema.routines WHERE routine_schema = 'public'
UNION ALL
SELECT 'Types', count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e';
```

---

## Phase 1: 清理旧文档与 Server 冗余代码

### Step 1.1 — 删除旧文档
- [x] 删除 `docs/` 目录下所有旧文件
- [x] 删除 `docs/plans/` 下所有旧 plan 文件

### Step 1.2 — 删除 Server 冗余代码 ✅

| 操作 | 文件 | 原因 |
|------|------|------|
| 删除 | `server/src/api/admin_users.py` | 管理员用户管理迁移到 Supabase RPC |
| 删除 | `server/src/api/auth.py` | 注册走 Supabase Auth，不再需要 direct-signup |
| 删除 | `server/src/services/admin_user_service.py` | 同上 |

### Step 1.3 — 更新 app.py ✅（已确认无需修改，app.py 本就只注册了 health/agents/sessions）

保留: `health_router`、`agents_router`、`sessions_router`、CORS、AuthMiddleware、AGUISessionMiddleware

---

## Phase 2: Supabase 数据库重建

### Step 2.1 — 清理旧 SQL 文件 ✅
- 删除 `supabase/migrations/` 下所有迁移文件
- 删除 `supabase/sql/` 下所有旧 SQL 文件目录（01_base/02_teaching/03_agent/04_profiles/05_storage）

### Step 2.2 — 重建 4 个 SQL 模块 ✅

#### 模块 01_base — 基础设施

`supabase/sql/01_base/1_functions.sql`:
- `update_updated_at_column()` — 通用 updated_at 触发器函数

---

#### 模块 02_profiles — 用户资料与角色

**类型** `supabase/sql/02_profiles/1_types.sql`:
- `user_role` 枚举: `'student'`, `'teacher'`, `'admin'`
- `account_status` 枚举: `'active'`, `'suspended'`

**表** `supabase/sql/02_profiles/2_tables.sql`:
```
profiles
├── id          uuid PK, FK → auth.users(id) ON DELETE CASCADE
├── email       text UNIQUE
├── role        user_role DEFAULT 'student'
├── display_name text
├── avatar_url  text
├── phone       text
├── last_sign_in_at timestamptz
├── account_status  account_status DEFAULT 'active'
├── status_reason   text
├── created_at  timestamptz DEFAULT now()
└── updated_at  timestamptz DEFAULT now()

索引: unique lower(email), role, account_status
```

**用户 RPC** `supabase/sql/02_profiles/3_functions.sql`:
| 函数 | 说明 |
|------|------|
| `current_profile()` | 获取当前用户资料 |
| `ensure_current_profile(p_role, p_display_name, p_email)` | 确保 profile 存在（注册后首次调用） |
| `update_profile_info(p_display_name, p_phone)` | 更新基本信息 |
| `update_avatar_url(p_avatar_url)` | 更新头像 |
| `verify_user_password(p_password)` | 验证密码 |
| `is_current_user_admin()` | 检查当前用户是否管理员 |

**管理员 RPC** `supabase/sql/02_profiles/4_admin_functions.sql`:
| 函数 | 说明 |
|------|------|
| `admin_list_users(p_keyword, p_role, p_status, p_page, p_page_size, p_last_login_start, p_last_login_end)` | 分页用户列表（支持搜索/筛选） |
| `admin_update_user_basic(p_user_id, p_display_name, p_phone, p_role, p_avatar_url)` | 更新用户信息 |
| `admin_set_user_status(p_user_id, p_status, p_reason)` | 停用/启用用户 |
| `admin_create_user(p_email, p_password, p_role, p_display_name, p_phone)` | 创建用户 |
| `admin_reset_user_password(p_user_id, p_new_password)` | 重置密码 |
| `admin_delete_user(p_user_id)` | 删除用户 |

**触发器** `supabase/sql/02_profiles/5_triggers.sql`:
- `on_auth_user_created` → 注册时自动创建 profiles 记录
- `trg_profiles_updated_at` → 自动更新 updated_at

**RLS 策略** `supabase/sql/02_profiles/6_rls.sql`:
- `"Users can view own profile"` — SELECT own
- `"Users can insert own profile"` — INSERT own
- `"Users can update own profile"` — UPDATE own（限制可修改字段）
- `"Admins can view all profiles"` — SELECT for admin role

---

#### 模块 03_agents — AI 智能体配置

**类型** `supabase/sql/03_agents/1_types.sql`:
- `agent_status` 枚举: `'enabled'`, `'disabled'`

**表** `supabase/sql/03_agents/2_tables.sql`:
```
agents
├── id          uuid PK DEFAULT gen_random_uuid()
├── name        text NOT NULL
├── target_role text DEFAULT 'all'  (all/student/teacher)
├── status      agent_status DEFAULT 'enabled'
├── description text
├── avatar      text
├── instructions text
├── model_name  text
├── temperature numeric CHECK (>= 0 AND <= 2)
├── created_at  timestamptz DEFAULT now()
└── updated_at  timestamptz DEFAULT now()

索引: status, target_role
```

**触发器** `supabase/sql/03_agents/3_triggers.sql`:
- `set_agents_updated_at` → 自动更新 updated_at

**种子数据** `supabase/sql/03_agents/4_seed.sql`:
- 教学助手（target_role: student）— 学生学习辅导
- 教师教学智能体（target_role: teacher）— 教师教学支持

---

#### 模块 04_storage — 文件存储

**存储桶** `supabase/sql/04_storage/1_buckets.sql`:
- `avatars` bucket — 2MB 限制，JPEG/PNG/GIF/WebP

**策略** `supabase/sql/04_storage/2_policies.sql`:
- 用户上传/更新/删除自己的头像
- 所有人可读取头像

### Step 2.3 — 生成统一迁移文件 ✅

已合并为：`supabase/migrations/20260314_init.sql`

---

## Phase 3: Server 端精简

### Step 3.1 — 精简 app.py ✅
- app.py 本就只注册了 health/agents/sessions，无需修改

### Step 3.2 — 确认 agent_manager.py ✅
- 已确认无 tenant_id 相关逻辑，agents 表字段映射完全匹配

### Step 3.3 — Server 最终端点清单
```
GET  /status                    — 健康检查
GET  /api/agents                — Agent 列表（可选 role 过滤）
GET  /api/sessions              — 会话列表（分页）
GET  /api/sessions/{id}         — 会话详情（含消息历史）
DELETE /api/sessions/{id}       — 删除会话
POST /agents/{agent_id}/agui   — AI 对话流（SSE）
```

---

## Phase 4: 前端(web/) 适配

### Step 4.1 — 清理对已删除 Server 端点的调用 ✅
- 已确认：前端无任何对 `/api/auth/direct-signup` 或 `/api/admin` 的调用
- admin 管理页面已全部走 Supabase RPC

### Step 4.2 — 前端服务层保留清单

**连接 Server（AI 对话相关）：**
- `web/src/services/api.ts` — HTTP 请求工具
- `web/src/services/agent.ts` — AGUI 流式传输
- `web/src/services/session.ts` — 会话 API

**连接 Supabase（业务数据）：**
- `web/src/services/supabaseRpc.ts` — RPC 封装
- `web/src/services/adminUsers.ts` — 管理员 RPC
- `web/src/lib/supabase.ts` — Supabase 客户端
- `web/src/lib/profile.ts` — 用户资料 RPC
- `web/src/lib/storage.ts` — 头像存储

---

## Phase 5: 验证

### 5.1 — 数据库
- [ ] `supabase db reset` 重置并执行迁移
- [ ] 验证所有表、函数、触发器、RLS 创建成功
- [ ] 测试 `ensure_current_profile` / `admin_list_users` 等 RPC

### 5.2 — Server
- [ ] 启动 server，确认只暴露上述 6 个端点
- [ ] 确认 admin/auth 端点不再存在

### 5.3 — 前端
- [ ] 注册新用户 → 自动创建 profile → 角色路由跳转
- [ ] 登录 → 根据角色重定向
- [ ] 学生/教师 → AI 对话正常
- [ ] 管理员 → 人员管理 CRUD、停用、重置密码正常

---

## 文件变更清单

### 需要删除
```
server/src/api/admin_users.py
server/src/api/auth.py
server/src/services/admin_user_service.py
supabase/migrations/*              (所有旧迁移)
supabase/sql/*                     (所有旧 SQL 目录)
docs/*.md                          (所有旧文档)
docs/plans/2026-03-09-*.md         (所有旧 plan)
docs/plans/2026-03-14-frontend-*.md
```

### 需要修改
```
server/src/app.py                  — 移除 admin/auth router 注册
server/src/services/agent_manager.py — 确认 agents 表字段映射
```

### 需要新建
```
supabase/sql/01_base/1_functions.sql
supabase/sql/02_profiles/1_types.sql
supabase/sql/02_profiles/2_tables.sql
supabase/sql/02_profiles/3_functions.sql
supabase/sql/02_profiles/4_admin_functions.sql
supabase/sql/02_profiles/5_triggers.sql
supabase/sql/02_profiles/6_rls.sql
supabase/sql/03_agents/1_types.sql
supabase/sql/03_agents/2_tables.sql
supabase/sql/03_agents/3_triggers.sql
supabase/sql/03_agents/4_seed.sql
supabase/sql/04_storage/1_buckets.sql
supabase/sql/04_storage/2_policies.sql
supabase/migrations/20260314_init.sql  — 统一迁移(合并以上所有)
```

### 不动（参考文件）
```
imitate_web/
imitate_server/
imitate_supabase/
```
