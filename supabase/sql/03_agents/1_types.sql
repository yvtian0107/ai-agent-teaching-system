-- =====================================================
-- 模块 03_agents：智能体枚举类型
-- =====================================================

DO $$ BEGIN
    CREATE TYPE public.agent_status AS ENUM ('enabled', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
