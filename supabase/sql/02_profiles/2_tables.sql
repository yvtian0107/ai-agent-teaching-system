-- =====================================================
-- 模块 02_profiles：用户资料表
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    role          public.user_role NOT NULL DEFAULT 'student',
    display_name  TEXT,
    avatar_url    TEXT,
    phone         TEXT,
    last_sign_in_at TIMESTAMPTZ,
    account_status  public.account_status NOT NULL DEFAULT 'active',
    status_reason   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '用户资料表，记录角色与基础信息';
COMMENT ON COLUMN public.profiles.role IS '用户身份：student / teacher / admin';
COMMENT ON COLUMN public.profiles.account_status IS '账号状态：active / suspended';

-- 索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
    ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_role
    ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_account_status
    ON public.profiles (account_status);

-- 授权
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
