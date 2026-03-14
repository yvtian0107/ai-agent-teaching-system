-- =====================================================
-- 模块 02_profiles：触发器
-- =====================================================

-- 自动更新 updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auth.users 注册/更新时同步到 profiles
CREATE OR REPLACE FUNCTION public.sync_auth_user_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    metadata JSONB;
    requested_role TEXT;
    normalized_role public.user_role;
    existing_role public.user_role;
    display_name_value TEXT;
    avatar_url_value TEXT;
    phone_value TEXT;
BEGIN
    metadata := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
    requested_role := lower(COALESCE(metadata ->> 'role', ''));

    -- 查询现有角色，防止登录时被 metadata 覆盖
    SELECT p.role INTO existing_role
    FROM public.profiles AS p
    WHERE p.id = NEW.id;

    IF existing_role IS NOT NULL THEN
        normalized_role := existing_role;
    ELSIF requested_role IN ('student', 'teacher') THEN
        normalized_role := requested_role::public.user_role;
    ELSE
        normalized_role := 'student';
    END IF;

    display_name_value := NULLIF(BTRIM(
        COALESCE(metadata ->> 'display_name', metadata ->> 'full_name')
    ), '');
    avatar_url_value := NULLIF(BTRIM(metadata ->> 'avatar_url'), '');
    phone_value := NULLIF(BTRIM(metadata ->> 'phone'), '');

    INSERT INTO public.profiles (
        id, email, role, display_name, avatar_url, phone, last_sign_in_at
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        normalized_role,
        COALESCE(display_name_value, split_part(COALESCE(NEW.email, ''), '@', 1)),
        avatar_url_value,
        phone_value,
        NEW.last_sign_in_at
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = CASE
            WHEN public.profiles.role IS NOT NULL THEN public.profiles.role
            ELSE normalized_role
        END,
        display_name = COALESCE(display_name_value, public.profiles.display_name),
        avatar_url = COALESCE(avatar_url_value, public.profiles.avatar_url),
        phone = COALESCE(phone_value, public.profiles.phone),
        last_sign_in_at = COALESCE(NEW.last_sign_in_at, public.profiles.last_sign_in_at),
        updated_at = now();

    RETURN NEW;
END;
$$;

-- 注册时自动创建 profile
DROP TRIGGER IF EXISTS trg_auth_users_profile_insert ON auth.users;
CREATE TRIGGER trg_auth_users_profile_insert
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_profile();

-- auth.users 更新时同步
DROP TRIGGER IF EXISTS trg_auth_users_profile_update ON auth.users;
CREATE TRIGGER trg_auth_users_profile_update
    AFTER UPDATE OF email, raw_user_meta_data, last_sign_in_at ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_profile();

-- 回填历史用户（已有 auth.users 但无 profile 的情况）
INSERT INTO public.profiles (id, email, role, display_name, last_sign_in_at)
SELECT
    u.id,
    COALESCE(u.email, ''),
    CASE
        WHEN lower(COALESCE(u.raw_user_meta_data ->> 'role', '')) IN ('student', 'teacher', 'admin')
            THEN lower(u.raw_user_meta_data ->> 'role')::public.user_role
        ELSE 'student'::public.user_role
    END,
    NULLIF(BTRIM(COALESCE(
        u.raw_user_meta_data ->> 'display_name',
        u.raw_user_meta_data ->> 'full_name',
        split_part(COALESCE(u.email, ''), '@', 1)
    )), ''),
    u.last_sign_in_at
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;
