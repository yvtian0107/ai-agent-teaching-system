"use client";

import { Spin } from "antd";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getRoleRedirectPath } from "@/lib/profile";
import { useAuthStore } from "@/store/authStore";

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.authInitialized);

  useEffect(() => {
    if (!authInitialized) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    router.replace(getRoleRedirectPath(user.role));
  }, [authInitialized, router, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-3)] p-6">
      <Spin size="large" />
    </div>
  );
}
