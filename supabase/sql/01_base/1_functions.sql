-- =====================================================
-- 模块 01_base：基础设施 — 通用函数
-- =====================================================

-- 自动更新 updated_at 触发器函数
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.update_updated_at_column()
    IS '自动更新 updated_at 字段的触发器函数';
