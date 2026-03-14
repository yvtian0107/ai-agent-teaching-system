-- =====================================================
-- 模块 02_profiles：用户枚举类型
-- =====================================================

-- 用户角色
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('student', 'teacher', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 账号状态
DO $$ BEGIN
    CREATE TYPE public.account_status AS ENUM ('active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
