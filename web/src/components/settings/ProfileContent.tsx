'use client'

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react'
import { Button, Form, Input, Spin, message } from 'antd'
import { UploadOutlined, LockOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import {
  fetchCurrentProfileByRpc,
  type CurrentProfile,
  updateAvatarUrl,
  updateProfileInfo,
  updatePassword,
  verifyCurrentPassword,
} from '@/lib/profile'
import { deleteOldAvatar, uploadAvatar, validateImageFile } from '@/lib/storage'
import { useAuthStore } from '@/store/authStore'

interface PasswordValidation {
  minLength: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasNumber: boolean
}

interface PasswordFormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

type ProfileView = 'main' | 'changePassword'

function PasswordRule({ isValid, text }: { isValid: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      {isValid ? (
        <CheckOutlined className="text-xs" style={{ color: 'var(--color-success)' }} />
      ) : (
        <CloseOutlined className="text-xs" style={{ color: 'var(--color-fail)' }} />
      )}
      <span className="text-sm" style={{ color: isValid ? 'var(--color-success)' : 'var(--color-fail)' }}>
        {text}
      </span>
    </div>
  )
}

function getFallbackDisplayName(email?: string, displayName?: string | null): string {
  const cleanDisplayName = displayName?.trim()
  if (cleanDisplayName) {
    return cleanDisplayName
  }
  const emailPrefix = email?.split('@')[0]?.trim()
  if (emailPrefix) {
    return emailPrefix
  }
  return ''
}

function normalizePhone(phone?: string | null): string {
  return (phone || '').trim()
}

function mapRoleLabel(role?: string | null): string {
  if (role === 'teacher') return '教师'
  if (role === 'admin') return '管理员'
  return '学生'
}

const PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/

export default function ProfileContent() {
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [localDisplayName, setLocalDisplayName] = useState(
    getFallbackDisplayName(user?.email, user?.displayName ?? null)
  )
  const [localPhone, setLocalPhone] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(user?.avatarUrl || undefined)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [initializing, setInitializing] = useState(true)
  const [currentView, setCurrentView] = useState<ProfileView>('main')
  const [loading, setLoading] = useState(false)

  const [form] = Form.useForm<PasswordFormValues>()

  const [passwordValidation, setPasswordValidation] = useState<PasswordValidation>({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
  })
  const [showValidation, setShowValidation] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadProfile = async () => {
      setInitializing(true)
      const currentProfile = await fetchCurrentProfileByRpc()
      if (!mounted) {
        return
      }

      setProfile(currentProfile)
      setLocalDisplayName(
        getFallbackDisplayName(user?.email, currentProfile?.displayName ?? user?.displayName ?? null)
      )
      setLocalPhone(normalizePhone(currentProfile?.phone))
      setAvatarPreview(currentProfile?.avatarUrl ?? user?.avatarUrl ?? undefined)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setInitializing(false)
    }

    void loadProfile()

    return () => {
      mounted = false
    }
  }, [user?.avatarUrl, user?.displayName, user?.email])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validation = validateImageFile(file)
    if (!validation.valid) {
      message.error(validation.error || '头像文件不符合要求')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      setAvatarPreview(String(ev.target?.result || ''))
      setSelectedFile(file)
    }
    reader.readAsDataURL(file)
  }

  const handleProfileSave = async () => {
    if (!user?.id) {
      message.error('当前用户未登录')
      return
    }

    setLoading(true)

    try {
      const originalDisplayName = getFallbackDisplayName(user.email, profile?.displayName ?? user.displayName ?? null)
      const normalizedDisplayName = localDisplayName.trim()
      const normalizedPhone = normalizePhone(localPhone)
      const originalPhone = normalizePhone(profile?.phone)
      const displayNameChanged = normalizedDisplayName !== originalDisplayName
      const phoneChanged = normalizedPhone !== originalPhone
      const hasNewFile = !!selectedFile

      if (!hasNewFile && !displayNameChanged && !phoneChanged) {
        message.info('没有可保存的改动')
        setLoading(false)
        return
      }

      if (displayNameChanged && !normalizedDisplayName) {
        message.error('显示名称不能为空')
        setLoading(false)
        return
      }

      if (normalizedPhone && !PHONE_PATTERN.test(normalizedPhone)) {
        message.error('手机号格式不正确')
        setLoading(false)
        return
      }

      let hasError = false
      let newAvatarUrl: string | undefined

      if (hasNewFile) {
        const { data: uploadData, error: uploadError } = await uploadAvatar(user.id, selectedFile)

        if (uploadError || !uploadData) {
          message.error('头像上传失败，请稍后重试')
          setLoading(false)
          return
        }

        newAvatarUrl = uploadData.url

        if (profile?.avatarUrl && profile.avatarUrl !== newAvatarUrl) {
          await deleteOldAvatar(profile.avatarUrl)
        }
      }

      if (newAvatarUrl) {
        const { error: avatarError } = await updateAvatarUrl(newAvatarUrl)
        if (avatarError) {
          message.error('头像地址保存失败，请稍后重试')
          hasError = true
        }
      }

      if (displayNameChanged || phoneChanged) {
        const { error: profileInfoError } = await updateProfileInfo({
          displayName: normalizedDisplayName,
          phone: normalizedPhone || null,
        })
        if (profileInfoError) {
          message.error('个人资料更新失败，请稍后重试')
          hasError = true
        }
      }

      if (!hasError) {
        const nextDisplayName = normalizedDisplayName || originalDisplayName || null
        const nextAvatarUrl = newAvatarUrl ?? profile?.avatarUrl ?? user.avatarUrl ?? null
        const nextPhone = normalizedPhone || null

        setProfile((prev) => {
          if (prev) {
            return {
              ...prev,
              displayName: nextDisplayName,
              avatarUrl: nextAvatarUrl,
              phone: nextPhone,
            }
          }

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            displayName: nextDisplayName,
            avatarUrl: nextAvatarUrl,
            phone: nextPhone,
          }
        })

        setUser({
          ...user,
          displayName: nextDisplayName,
          avatarUrl: nextAvatarUrl,
        })

        setLocalDisplayName(nextDisplayName || '')
        setLocalPhone(nextPhone || '')
        setAvatarPreview(nextAvatarUrl || undefined)
        setSelectedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }

        message.success('个人信息已保存')
      }
    } catch {
      message.error('个人信息保存失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChangePassword = () => {
    setCurrentView('changePassword')
    form.resetFields()
    setPasswordValidation({
      minLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
    })
    setShowValidation(false)
  }

  const handleBackToProfile = () => {
    setCurrentView('main')
    setLoading(false)
    form.resetFields()
    setPasswordValidation({
      minLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
    })
    setShowValidation(false)
  }

  const validatePassword = (password: string): PasswordValidation => {
    return {
      minLength: password.length >= 6,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
    }
  }

  const isPasswordValid = (validation: PasswordValidation) => {
    return (
      validation.minLength &&
      validation.hasUppercase &&
      validation.hasLowercase &&
      validation.hasNumber
    )
  }

  const handleSubmitPasswordChange = async (values: PasswordFormValues) => {
    setLoading(true)

    try {
      const { data: verified, error: verifyError } = await verifyCurrentPassword(values.oldPassword)

      if (verifyError || !verified) {
        form.setFields([
          {
            name: 'oldPassword',
            errors: ['当前密码不正确'],
          },
        ])
        setLoading(false)
        return
      }

      const { error: updateError } = await updatePassword(values.newPassword)

      if (updateError) {
        const lowerMessage = updateError.message?.toLowerCase?.() || ''
        if (lowerMessage.includes('same') || lowerMessage.includes('different')) {
          message.error('新密码不能与当前密码相同')
        } else {
          message.error(updateError.message || '密码修改失败，请稍后重试')
        }
        setLoading(false)
        return
      }

      message.success('密码修改成功')
      handleBackToProfile()
    } catch {
      message.error('密码修改失败，请稍后重试')
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <div className="h-full min-h-[360px] flex items-center justify-center">
        <Spin size="large" />
      </div>
    )
  }

  if (currentView === 'changePassword') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-y-auto pr-1">
          <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-3">修改密码</h3>

          <Form
            form={form}
            onFinish={handleSubmitPasswordChange}
            layout="vertical"
            onFieldsChange={(changedFields) => {
              const passwordField = changedFields.find((field) => field.name?.[0] === 'newPassword')
              if (passwordField && passwordField.value !== undefined) {
                const password = passwordField.value || ''
                const validation = validatePassword(password)
                setPasswordValidation(validation)
                setShowValidation(password.length > 0)
              }
            }}
          >
            <Form.Item
              name="oldPassword"
              label={<span className="text-[var(--color-text-2)]">当前密码</span>}
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password
                placeholder="请输入当前密码"
                className="rounded-lg"
                prefix={<LockOutlined className="!text-[var(--color-text-3)]" />}
                autoFocus
              />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label={<span className="text-[var(--color-text-2)]">新密码</span>}
              rules={[
                { required: true, message: '请输入新密码' },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve()
                    const validation = validatePassword(value)
                    if (isPasswordValid(validation)) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('密码不符合安全规则'))
                  },
                },
              ]}
              validateTrigger={['onChange', 'onBlur']}
            >
              <Input.Password
                placeholder="请输入新密码"
                className="rounded-lg"
                prefix={<LockOutlined className="!text-[var(--color-text-3)]" />}
              />
            </Form.Item>

            {showValidation && !isPasswordValid(passwordValidation) && (
              <div className="mb-6 -mt-2">
                <div className="space-y-1">
                  <PasswordRule isValid={passwordValidation.minLength} text="至少 6 个字符" />
                  <PasswordRule isValid={passwordValidation.hasUppercase} text="至少包含 1 个大写字母" />
                  <PasswordRule isValid={passwordValidation.hasLowercase} text="至少包含 1 个小写字母" />
                  <PasswordRule isValid={passwordValidation.hasNumber} text="至少包含 1 个数字" />
                </div>
              </div>
            )}

            <Form.Item
              name="confirmPassword"
              label={<span className="text-[var(--color-text-2)]">确认密码</span>}
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'))
                  },
                }),
              ]}
            >
              <Input.Password
                placeholder="请再次输入新密码"
                className="rounded-lg"
                prefix={<LockOutlined className="!text-[var(--color-text-3)]" />}
              />
            </Form.Item>
          </Form>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <Button onClick={handleBackToProfile} className="rounded-lg">
            取消
          </Button>
          <Button
            type="primary"
            loading={loading}
            onClick={() => form.submit()}
            className="rounded-lg"
            style={{ background: 'var(--gradient-primary)', border: 'none' }}
          >
            确认修改
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto pr-1">
        <h3 className="text-lg font-semibold text-[var(--color-text-1)] mb-4">个人信息</h3>

        <div className="space-y-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-[var(--color-bg-3)] overflow-hidden flex items-center justify-center border border-[var(--color-border)]">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="avatar"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="text-3xl text-gray-400">{localDisplayName.charAt(0).toUpperCase()}</div>
                  )}
                </div>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -right-1 -bottom-0 w-7 h-7 bg-[var(--color-primary)] text-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                  title="上传头像"
                  type="button"
                >
                  <UploadOutlined className="text-white text-base" />
                </button>
              </div>

              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>

            <div className="flex-1">
              <div>
                <label className="block text-sm text-[var(--color-text-2)] mb-2">邮箱地址</label>
                <Input
                  value={user?.email || profile?.email || ''}
                  className="rounded-lg"
                  size="large"
                  disabled
                />
              </div>

              <div className="mt-3">
                <label className="block text-sm text-[var(--color-text-2)] mb-2">用户角色</label>
                <Input
                  value={mapRoleLabel(profile?.role || user?.role || 'student')}
                  className="rounded-lg"
                  size="large"
                  disabled
                />
              </div>

              <div className="mt-3">
                  <label className="block text-sm text-[var(--color-text-2)] mb-2">显示名称</label>
                  <Input
                    value={localDisplayName}
                    onChange={(e) => setLocalDisplayName(e.target.value)}
                    className="rounded-lg"
                    size="large"
                    placeholder="请输入显示名称"
                  />
              </div>

              <div className="mt-3">
                <label className="block text-sm text-[var(--color-text-2)] mb-2">手机号</label>
                <Input
                  value={localPhone}
                  onChange={(e) => setLocalPhone(e.target.value)}
                  className="rounded-lg"
                  size="large"
                  placeholder="请输入手机号"
                />
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-1)] flex items-center justify-between">
            <div>
              <div className="text-base font-medium text-[var(--color-text-1)]">登录密码</div>
              <div className="text-sm text-[var(--color-text-3)] mt-1">定期更新密码可提升账号安全性</div>
            </div>
            <Button
              type="default"
              size="small"
              onClick={handleOpenChangePassword}
              className="!text-sm !bg-[var(--color-bg-2)] !text-[var(--color-text-2)] hover:!border-[var(--color-primary)] hover:!text-[var(--color-primary)]"
            >
              修改密码
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex justify-end">
        <Button
          type="primary"
          onClick={handleProfileSave}
          loading={loading}
          className="rounded-lg"
          style={{ background: 'var(--gradient-primary)', border: 'none' }}
        >
          保存
        </Button>
      </div>
    </div>
  )
}
