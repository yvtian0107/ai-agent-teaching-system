-- =====================================================
-- 模块 02_profiles：用户 RPC 函数
-- =====================================================

-- 获取当前用户 profile
CREATE OR REPLACE FUNCTION public.current_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.profiles
    WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_profile() IS '获取当前登录用户的完整 profile 信息';
GRANT EXECUTE ON FUNCTION public.current_profile() TO authenticated;

-- 确保当前用户 profile 存在（注册后首次调用）
CREATE OR REPLACE FUNCTION public.ensure_current_profile(
    p_role TEXT DEFAULT 'student',
    p_display_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_email TEXT;
    v_role public.user_role;
    v_profile public.profiles;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '用户未登录';
    END IF;

    -- 只允许 student / teacher 自行注册
    IF lower(COALESCE(p_role, 'student')) IN ('student', 'teacher') THEN
        v_role := lower(p_role)::public.user_role;
    ELSE
        v_role := 'student';
    END IF;

    SELECT COALESCE(NULLIF(BTRIM(p_email), ''), u.email, '')
    INTO v_email
    FROM auth.users AS u
    WHERE u.id = v_user_id;

    INSERT INTO public.profiles (
        id, email, role, display_name, last_sign_in_at
    )
    VALUES (
        v_user_id,
        COALESCE(v_email, ''),
        v_role,
        NULLIF(BTRIM(p_display_name), ''),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = CASE
            WHEN public.profiles.role = 'admin' THEN 'admin'::public.user_role
            ELSE EXCLUDED.role
        END,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        last_sign_in_at = now(),
        updated_at = now()
    RETURNING * INTO v_profile;

    RETURN v_profile;
END;
$$;

COMMENT ON FUNCTION public.ensure_current_profile(TEXT, TEXT, TEXT) IS '确保当前用户 profile 存在并同步 role/display_name/email';
GRANT EXECUTE ON FUNCTION public.ensure_current_profile(TEXT, TEXT, TEXT) TO authenticated;

-- 更新当前用户基础资料
CREATE OR REPLACE FUNCTION public.update_profile_info(
    p_display_name TEXT,
    p_phone TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_display_name TEXT;
    v_phone TEXT;
BEGIN
    v_display_name := NULLIF(BTRIM(p_display_name), '');
    IF v_display_name IS NULL THEN
        RAISE EXCEPTION 'display_name 不能为空';
    END IF;

    v_phone := NULLIF(BTRIM(p_phone), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+\-\s()]{6,20}$' THEN
        RAISE EXCEPTION 'phone 格式不正确';
    END IF;

    UPDATE public.profiles
    SET
        display_name = v_display_name,
        phone = v_phone,
        updated_at = now()
    WHERE id = auth.uid();

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.update_profile_info(TEXT, TEXT) IS '更新当前登录用户 display_name/phone';
GRANT EXECUTE ON FUNCTION public.update_profile_info(TEXT, TEXT) TO authenticated;

-- 更新当前用户头像
CREATE OR REPLACE FUNCTION public.update_avatar_url(p_avatar_url TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.profiles
    SET
        avatar_url = NULLIF(BTRIM(p_avatar_url), ''),
        updated_at = now()
    WHERE id = auth.uid();

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.update_avatar_url(TEXT) IS '更新当前登录用户的 avatar_url';
GRANT EXECUTE ON FUNCTION public.update_avatar_url(TEXT) TO authenticated;

-- 验证当前用户密码
CREATE OR REPLACE FUNCTION public.verify_user_password(p_password TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '用户未登录';
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM auth.users
        WHERE id = v_user_id
          AND encrypted_password = crypt(p_password::TEXT, encrypted_password)
    );
END;
$$;

COMMENT ON FUNCTION public.verify_user_password(TEXT) IS '验证当前登录用户密码是否正确';
GRANT EXECUTE ON FUNCTION public.verify_user_password(TEXT) TO authenticated;

-- 检查当前用户是否管理员
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
          AND account_status = 'active'
    );
$$;

COMMENT ON FUNCTION public.is_current_user_admin() IS '判断当前登录用户是否为 active admin';
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;
