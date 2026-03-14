-- =====================================================
-- 模块 02_profiles：管理员 RPC 函数
-- =====================================================

-- 管理员分页查询用户列表
CREATE OR REPLACE FUNCTION public.admin_list_users(
    p_keyword TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_page integer DEFAULT 1,
    p_page_size integer DEFAULT 20,
    p_last_login_start timestamptz DEFAULT NULL,
    p_last_login_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    email text,
    role public.user_role,
    display_name text,
    avatar_url text,
    phone text,
    last_sign_in_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    account_status public.account_status,
    status_reason text,
    total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_keyword text;
    v_role text;
    v_status text;
    v_page integer;
    v_page_size integer;
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可访问';
    END IF;

    v_keyword := NULLIF(BTRIM(p_keyword), '');
    v_role := lower(COALESCE(NULLIF(BTRIM(p_role), ''), ''));
    v_status := lower(COALESCE(NULLIF(BTRIM(p_status), ''), ''));

    IF v_role <> '' AND v_role NOT IN ('student', 'teacher', 'admin') THEN
        RAISE EXCEPTION 'role 非法';
    END IF;

    IF v_status <> '' AND v_status NOT IN ('active', 'suspended') THEN
        RAISE EXCEPTION 'status 非法';
    END IF;

    v_page := GREATEST(COALESCE(p_page, 1), 1);
    v_page_size := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);

    RETURN QUERY
    WITH filtered AS (
        SELECT p.*
        FROM public.profiles p
        WHERE (v_keyword IS NULL OR (
                p.email ILIKE '%' || v_keyword || '%'
                OR COALESCE(p.display_name, '') ILIKE '%' || v_keyword || '%'
                OR COALESCE(p.phone, '') ILIKE '%' || v_keyword || '%'
            ))
          AND (v_role = '' OR p.role::text = v_role)
          AND (v_status = '' OR p.account_status::text = v_status)
          AND (p_last_login_start IS NULL OR p.last_sign_in_at >= p_last_login_start)
          AND (p_last_login_end IS NULL OR p.last_sign_in_at <= p_last_login_end)
    ),
    counted AS (
        SELECT COUNT(*)::bigint AS cnt FROM filtered
    ),
    paged AS (
        SELECT *
        FROM filtered
        ORDER BY updated_at DESC, created_at DESC
        LIMIT v_page_size OFFSET (v_page - 1) * v_page_size
    )
    SELECT
        paged.id,
        paged.email,
        paged.role,
        paged.display_name,
        paged.avatar_url,
        paged.phone,
        paged.last_sign_in_at,
        paged.created_at,
        paged.updated_at,
        paged.account_status,
        paged.status_reason,
        counted.cnt
    FROM paged CROSS JOIN counted;
END;
$$;

COMMENT ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, integer, integer, timestamptz, timestamptz)
    IS '管理员分页查询用户列表，返回 total_count';
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, integer, integer, timestamptz, timestamptz) TO authenticated;

-- 管理员更新用户基础信息
CREATE OR REPLACE FUNCTION public.admin_update_user_basic(
    p_user_id uuid,
    p_display_name TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_user_id uuid;
    v_new_role public.user_role;
    v_phone text;
    v_display_name text;
    v_target public.profiles;
    v_admin_count bigint;
    v_updated public.profiles;
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可操作';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id 不能为空';
    END IF;

    v_current_user_id := auth.uid();

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '用户不存在';
    END IF;

    -- 角色处理
    v_new_role := COALESCE(
        NULLIF(lower(BTRIM(p_role)), '')::public.user_role,
        v_target.role
    );

    IF v_current_user_id = p_user_id AND v_new_role <> v_target.role THEN
        RAISE EXCEPTION '不能修改自己的角色';
    END IF;

    IF v_target.role = 'admin' AND v_new_role <> 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND account_status = 'active';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION '系统至少保留一个 active admin';
        END IF;
    END IF;

    -- display_name
    IF p_display_name IS NOT NULL THEN
        v_display_name := NULLIF(BTRIM(p_display_name), '');
        IF v_display_name IS NULL THEN
            RAISE EXCEPTION 'display_name 不能为空';
        END IF;
        IF char_length(v_display_name) > 50 THEN
            RAISE EXCEPTION 'display_name 长度不能超过 50';
        END IF;
    ELSE
        v_display_name := v_target.display_name;
    END IF;

    -- phone
    IF p_phone IS NOT NULL THEN
        v_phone := NULLIF(BTRIM(p_phone), '');
        IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+\-\s()]{6,20}$' THEN
            RAISE EXCEPTION 'phone 格式不正确';
        END IF;
    ELSE
        v_phone := v_target.phone;
    END IF;

    UPDATE public.profiles
    SET
        display_name = v_display_name,
        phone = v_phone,
        role = v_new_role,
        avatar_url = CASE
            WHEN p_avatar_url IS NULL THEN avatar_url
            ELSE NULLIF(BTRIM(p_avatar_url), '')
        END,
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.admin_update_user_basic(uuid, TEXT, TEXT, TEXT, TEXT)
    IS '管理员更新用户基础信息（显示名/手机号/角色/头像）';
GRANT EXECUTE ON FUNCTION public.admin_update_user_basic(uuid, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 管理员设置用户状态
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
    p_user_id uuid,
    p_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_user_id uuid;
    v_status public.account_status;
    v_reason text;
    v_target public.profiles;
    v_admin_count bigint;
    v_updated public.profiles;
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可操作';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id 不能为空';
    END IF;

    v_current_user_id := auth.uid();

    IF lower(BTRIM(p_status)) NOT IN ('active', 'suspended') THEN
        RAISE EXCEPTION 'status 非法';
    END IF;
    v_status := lower(BTRIM(p_status))::public.account_status;

    IF v_current_user_id = p_user_id AND v_status = 'suspended' THEN
        RAISE EXCEPTION '不能停用自己';
    END IF;

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '用户不存在';
    END IF;

    IF v_target.role = 'admin' AND v_status = 'suspended' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND account_status = 'active';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION '系统至少保留一个 active admin';
        END IF;
    END IF;

    v_reason := NULLIF(BTRIM(p_reason), '');
    IF v_status = 'suspended' AND v_reason IS NULL THEN
        RAISE EXCEPTION '停用时必须填写原因';
    END IF;

    UPDATE public.profiles
    SET
        account_status = v_status,
        status_reason = CASE
            WHEN v_status = 'active' THEN NULL
            ELSE v_reason
        END,
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_status(uuid, TEXT, TEXT)
    IS '管理员更新用户状态（active/suspended）';
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, TEXT, TEXT) TO authenticated;

-- 管理员创建用户
CREATE OR REPLACE FUNCTION public.admin_create_user(
    p_email TEXT,
    p_password TEXT,
    p_role TEXT DEFAULT 'student',
    p_display_name TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
    user_id uuid,
    email text,
    role text,
    display_name text,
    phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_email text;
    v_password text;
    v_role public.user_role;
    v_display_name text;
    v_phone text;
    v_user_id uuid;
    v_instance_id uuid;
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可操作';
    END IF;

    -- 邮箱校验
    v_email := lower(COALESCE(NULLIF(BTRIM(p_email), ''), ''));
    IF v_email = '' OR position('@' in v_email) <= 1 THEN
        RAISE EXCEPTION '邮箱格式不正确';
    END IF;

    -- 密码校验
    v_password := COALESCE(p_password, '');
    IF char_length(v_password) < 8 THEN
        RAISE EXCEPTION '密码至少 8 位';
    END IF;

    -- 角色校验
    IF lower(COALESCE(NULLIF(BTRIM(p_role), ''), 'student')) NOT IN ('student', 'teacher', 'admin') THEN
        RAISE EXCEPTION 'role 非法';
    END IF;
    v_role := lower(COALESCE(NULLIF(BTRIM(p_role), ''), 'student'))::public.user_role;

    -- display_name 校验
    v_display_name := NULLIF(BTRIM(p_display_name), '');
    IF v_display_name IS NOT NULL AND char_length(v_display_name) > 50 THEN
        RAISE EXCEPTION 'display_name 长度不能超过 50';
    END IF;

    -- phone 校验
    v_phone := NULLIF(BTRIM(p_phone), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+\-\s()]{6,20}$' THEN
        RAISE EXCEPTION 'phone 格式不正确';
    END IF;

    -- 邮箱唯一性
    IF EXISTS (
        SELECT 1 FROM auth.users u WHERE lower(COALESCE(u.email, '')) = v_email
    ) THEN
        RAISE EXCEPTION '该邮箱已注册';
    END IF;

    -- 获取 instance_id
    SELECT id INTO v_instance_id FROM auth.instances LIMIT 1;
    IF v_instance_id IS NULL THEN
        v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    v_user_id := gen_random_uuid();

    -- 插入 auth.users
    INSERT INTO auth.users (
        id, instance_id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token,
        email_change_token_new, email_change
    )
    VALUES (
        v_user_id, v_instance_id, 'authenticated', 'authenticated', v_email,
        crypt(v_password, gen_salt('bf')), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_strip_nulls(jsonb_build_object(
            'role', v_role::text,
            'display_name', v_display_name,
            'phone', v_phone
        )),
        now(), now(), '', '', '', ''
    );

    -- 插入 profiles
    INSERT INTO public.profiles (
        id, email, role, display_name, phone,
        account_status, status_reason, last_sign_in_at
    )
    VALUES (
        v_user_id, v_email, v_role,
        COALESCE(v_display_name, split_part(v_email, '@', 1)),
        v_phone, 'active', NULL, NULL
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        phone = EXCLUDED.phone,
        account_status = 'active',
        status_reason = NULL,
        updated_at = now();

    RETURN QUERY SELECT v_user_id, v_email, v_role::text, v_display_name, v_phone;
END;
$$;

COMMENT ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, TEXT)
    IS '管理员创建用户（支持 student/teacher/admin），并同步 profile';
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 管理员重置用户密码
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
    p_user_id uuid,
    p_new_password TEXT
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可操作';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id 不能为空';
    END IF;

    IF char_length(COALESCE(p_new_password, '')) < 8 THEN
        RAISE EXCEPTION '密码至少 8 位';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION '用户不存在';
    END IF;

    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')), updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '用户不存在';
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.admin_reset_user_password(uuid, TEXT)
    IS '管理员重置指定用户密码';
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, TEXT) TO authenticated;

-- 管理员删除用户
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_target public.profiles;
    v_admin_count bigint;
BEGIN
    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION '仅管理员可操作';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id 不能为空';
    END IF;

    IF auth.uid() = p_user_id THEN
        RAISE EXCEPTION '不能删除自己';
    END IF;

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '用户不存在';
    END IF;

    IF v_target.role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND account_status = 'active';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION '系统至少保留一个 active admin';
        END IF;
    END IF;

    -- profiles 会因 CASCADE 自动删除
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_user(uuid)
    IS '管理员删除用户（同时删除 auth.users 和 profiles）';
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
