-- =====================================================
-- 模块 02_profiles：RLS 策略
-- =====================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 用户查看自己的 profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- 管理员可查看所有 profile
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    USING (public.is_current_user_admin());

-- 用户插入自己的 profile（仅 student/teacher）
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id AND role IN ('student', 'teacher'));

-- 用户更新自己的 profile（仅 student/teacher）
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role IN ('student', 'teacher'));
