"use client";

import "../student/dashboard.css";
import { TeamOutlined } from "@ant-design/icons";
import RoleDashboardLayout from "@/components/layout/RoleDashboardLayout";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleDashboardLayout
      title="AI Teaching Studio"
      menuItems={[
        {
          key: "users",
          href: "/admin/users",
          label: "人员管理",
          icon: <TeamOutlined />,
        },
      ]}
    >
      {children}
    </RoleDashboardLayout>
  );
}
