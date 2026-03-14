import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import AuthInitializer from "@/components/AuthInitializer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Teaching System Console",
  description: "面向教师与学生的一体化 AI 教学平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AntdRegistry>
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: "#5046e5",
                colorInfo: "#5046e5",
                colorSuccess: "#10b981",
                colorWarning: "#f59e0b",
                colorError: "#ef4444",
                borderRadius: 12,
                fontFamily:
                  "var(--font-geist-sans), 'Segoe UI', 'PingFang SC', sans-serif",
                colorBgBase: "#f6f8fc",
                colorTextBase: "#0f172a",
              },
              components: {
                Layout: {
                  siderBg: "rgba(255, 255, 255, 0.88)",
                  headerBg: "rgba(255, 255, 255, 0.74)",
                  bodyBg: "#f6f8fc",
                },
                Menu: {
                  itemBg: "transparent",
                  itemSelectedBg: "rgba(80, 70, 229, 0.12)",
                  itemSelectedColor: "#4338ca",
                  itemBorderRadius: 10,
                },
              },
            }}
          >
            <AuthInitializer />
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
