'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import {
  User,
  Mail,
  Shield,
  Building2,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  Loader2,
  Check,
  ChevronRight,
} from 'lucide-react'

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: string
  organization_id: string
  created_at: string
}

interface OrgDetails {
  name: string
  slug: string
  enable_ai: boolean
  enable_email: boolean
  enable_messages: boolean
  enable_phone_calls: boolean
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }
  return (email?.[0] || 'U').toUpperCase()
}

function getRoleBadge(role: string) {
  const map: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
    owner: { bg: 'bg-emerald-100', text: 'text-emerald-700', darkBg: 'dark:bg-emerald-900/40', darkText: 'dark:text-emerald-300' },
    admin: { bg: 'bg-blue-100', text: 'text-blue-700', darkBg: 'dark:bg-blue-900/40', darkText: 'dark:text-blue-300' },
    agent: { bg: 'bg-slate-100', text: 'text-slate-700', darkBg: 'dark:bg-slate-800/60', darkText: 'dark:text-slate-300' },
    viewer: { bg: 'bg-amber-100', text: 'text-amber-700', darkBg: 'dark:bg-amber-900/40', darkText: 'dark:text-amber-300' },
  }
  const style = map[role] || map.agent
  return style
}

function getPasswordStrength(password: string): { label: string; color: string; barColor: string; percent: number } {
  if (!password) return { label: '', color: '', barColor: '', percent: 0 }
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 2) return { label: 'Weak', color: 'text-red-500', barColor: 'bg-red-500', percent: 33 }
  if (score <= 3) return { label: 'Medium', color: 'text-amber-500', barColor: 'bg-amber-500', percent: 66 }
  return { label: 'Strong', color: 'text-emerald-500', barColor: 'bg-emerald-500', percent: 100 }
}

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [org, setOrg] = useState<OrgDetails | null>(null)

  // Edit name state
  const [editName, setEditName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  // Change password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Logout state
  const [loggingOut, setLoggingOut] = useState(false)

  // Notification
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; title: string; message: string } | null>(null)
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showNotification(type: 'success' | 'error', message: string, title = '') {
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current)
    setNotification({ type, message, title })
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null)
      notificationTimeoutRef.current = null
    }, 4000)
  }

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    try {
      await restoreSupabaseSession()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      const userId = session.user.id
      const userEmail = session.user.email || ''

      const { data: profileData } = await supabase
        .from('users')
        .select('full_name, organization_id, role, created_at')
        .eq('id', userId)
        .maybeSingle()

      if (profileData) {
        const p: UserProfile = {
          id: userId,
          email: userEmail,
          full_name: profileData.full_name,
          role: profileData.role || 'agent',
          organization_id: profileData.organization_id,
          created_at: profileData.created_at,
        }
        setProfile(p)
        setEditName(profileData.full_name || '')

        if (profileData.organization_id) {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('name, slug, enable_ai, enable_email, enable_messages, enable_phone_calls')
            .eq('id', profileData.organization_id)
            .maybeSingle()

          if (orgData) {
            setOrg(orgData as OrgDetails)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveName() {
    if (!profile || editName.trim() === (profile.full_name || '')) return
    setSavingName(true)
    setNameSaved(false)
    try {
      const { error } = await supabase
        .from('users')
        .update({ full_name: editName.trim() })
        .eq('id', profile.id)

      if (error) throw error

      setProfile({ ...profile, full_name: editName.trim() })
      setNameSaved(true)
      showNotification('success', 'Your name has been updated successfully.', 'Profile Updated')
      setTimeout(() => setNameSaved(false), 2500)
    } catch (err: any) {
      console.error('Failed to update name:', err)
      showNotification('error', err.message || 'Failed to update name.', 'Update Failed')
    } finally {
      setSavingName(false)
    }
  }

  async function handleChangePassword() {
    setPasswordMessage(null)

    if (!newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Please fill in both password fields.' })
      return
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setChangingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({ type: 'success', text: 'Password updated successfully!' })
      showNotification('success', 'Your password has been changed.', 'Password Updated')
    } catch (err: any) {
      console.error('Failed to change password:', err)
      setPasswordMessage({ type: 'error', text: err.message || 'Failed to change password.' })
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      await supabase.auth.signOut()
      authSessionManager.clearSession()
      router.push('/login')
    } catch (err) {
      console.error('Logout error:', err)
      setLoggingOut(false)
    }
  }

  const passwordStrength = getPasswordStrength(newPassword)
  const nameChanged = editName.trim() !== (profile?.full_name || '')

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-sm text-[#667781] dark:text-[#8696a0] font-semibold">Unable to load profile.</p>
      </div>
    )
  }

  const roleBadge = getRoleBadge(profile.role)
  const initials = getInitials(profile.full_name, profile.email)
  const memberSince = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const enabledFeatures: string[] = []
  if (org) {
    if (org.enable_ai !== false) enabledFeatures.push('AI Copilot')
    if (org.enable_email !== false) enabledFeatures.push('Email')
    if (org.enable_messages !== false) enabledFeatures.push('Messaging')
    if (org.enable_phone_calls !== false) enabledFeatures.push('Phone Calls')
  }

  return (
    <div className="p-4 pb-24 md:pb-6 md:p-6 font-sans h-full bg-[#f0f2f5] dark:bg-[#0b141a] text-[#111b21] dark:text-[#e9edef] overflow-y-auto">
      {/* ── Notification Toast ── */}
      {notification && (
        <div
          className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl max-w-sm w-full select-none"
          style={{
            borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : '#ef4444'}`,
            animation: 'slideInFromTop 0.3s ease-out',
          }}
        >
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-[#111b21] dark:text-white mb-1">{notification.title}</h4>
            )}
            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">
              {notification.message}
            </p>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] p-1 rounded-full cursor-pointer transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-6">
        {/* ── Page Header ── */}
        <div className="mb-2 select-none">
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21] dark:text-white">Profile</h1>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-semibold">
            Manage your personal information and security settings
          </p>
        </div>

        {/* ═══════════════════════════════════════════
            1. Profile Header Card
        ═══════════════════════════════════════════ */}
        <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden"
          style={{ animation: 'fadeInUp 0.4s ease-out' }}
        >
          {/* Gradient banner */}
          <div className="h-20 bg-gradient-to-r from-[#00a884] via-[#008069] to-[#025144]" />

          <div className="px-5 pb-5 -mt-10">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#00a884] to-[#008069] flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white dark:ring-[#111b21] shadow-lg select-none">
              {initials}
            </div>

            <div className="mt-3 space-y-1">
              <h2 className="text-lg font-bold text-[#111b21] dark:text-white leading-tight">
                {profile.full_name || profile.email.split('@')[0]}
              </h2>

              <div className="flex items-center gap-2 text-xs text-[#667781] dark:text-[#8696a0] font-semibold">
                <Mail size={13} className="flex-shrink-0" />
                <span className="truncate">{profile.email}</span>
              </div>

              <div className="flex items-center gap-3 pt-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold capitalize ${roleBadge.bg} ${roleBadge.text} ${roleBadge.darkBg} ${roleBadge.darkText}`}>
                  <Shield size={11} />
                  {profile.role}
                </span>

                <span className="inline-flex items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold">
                  <Calendar size={11} />
                  Member since {memberSince}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            2. Personal Information
        ═══════════════════════════════════════════ */}
        <div
          className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-sm"
          style={{ animation: 'fadeInUp 0.5s ease-out' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-[#00a884]" />
            <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Personal Information</h3>
          </div>

          <div className="space-y-4">
            {/* Full Name (editable) */}
            <div>
              <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                Full Name
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter your full name"
                  className="flex-1 px-3.5 py-2.5 border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] transition-all placeholder:text-[#8696a0]"
                />
                <button
                  onClick={handleSaveName}
                  disabled={!nameChanged || savingName}
                  className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer select-none ${
                    nameChanged
                      ? 'bg-[#00a884] hover:bg-[#008069] text-white shadow-sm'
                      : 'bg-[#e9edef] dark:bg-[#2a3942] text-[#8696a0] cursor-not-allowed'
                  }`}
                >
                  {savingName ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : nameSaved ? (
                    <Check size={13} />
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full pl-9 pr-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <p className="text-[10px] text-[#8696a0] mt-1 font-medium">Email cannot be changed</p>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            3. Change Password
        ═══════════════════════════════════════════ */}
        <div
          className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-sm"
          style={{ animation: 'fadeInUp 0.6s ease-out' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-[#00a884]" />
            <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Change Password</h3>
          </div>

          <div className="space-y-4">
            {/* New Password */}
            <div>
              <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setPasswordMessage(null)
                  }}
                  placeholder="Enter new password"
                  className="w-full pl-9 pr-10 py-2.5 border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] transition-all placeholder:text-[#8696a0]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer transition-colors"
                >
                  {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {newPassword && (
                <div className="mt-2 space-y-1.5" style={{ animation: 'fadeInUp 0.2s ease-out' }}>
                  <div className="w-full h-1.5 bg-[#e9edef] dark:bg-[#2a3942] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${passwordStrength.barColor}`}
                      style={{ width: `${passwordStrength.percent}%` }}
                    />
                  </div>
                  <p className={`text-[10px] font-bold ${passwordStrength.color}`}>
                    {passwordStrength.label}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setPasswordMessage(null)
                  }}
                  placeholder="Confirm new password"
                  className="w-full pl-9 pr-10 py-2.5 border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] transition-all placeholder:text-[#8696a0]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              {/* Mismatch indicator */}
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-[10px] text-red-500 font-bold mt-1" style={{ animation: 'fadeInUp 0.2s ease-out' }}>
                  Passwords do not match
                </p>
              )}
            </div>

            {/* Password message */}
            {passwordMessage && (
              <div
                className={`text-xs font-semibold px-3 py-2 rounded-lg ${
                  passwordMessage.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}
                style={{ animation: 'fadeInUp 0.2s ease-out' }}
              >
                {passwordMessage.text}
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={changingPassword || !newPassword || !confirmPassword}
              className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer select-none ${
                newPassword && confirmPassword
                  ? 'bg-[#00a884] hover:bg-[#008069] text-white shadow-sm'
                  : 'bg-[#e9edef] dark:bg-[#2a3942] text-[#8696a0] cursor-not-allowed'
              }`}
            >
              {changingPassword ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Updating…
                </>
              ) : (
                <>
                  <Lock size={13} />
                  Update Password
                </>
              )}
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            4. Organization Details
        ═══════════════════════════════════════════ */}
        {org && (
          <div
            className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-sm"
            style={{ animation: 'fadeInUp 0.7s ease-out' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Building2 size={16} className="text-[#00a884]" />
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Organization</h3>
            </div>

            <div className="space-y-3">
              {/* Org Name */}
              <div className="flex items-center justify-between py-2.5 border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0">
                <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Name</span>
                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">{org.name}</span>
              </div>

              {/* Org Slug */}
              <div className="flex items-center justify-between py-2.5 border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0">
                <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Slug</span>
                <span className="text-xs font-mono font-semibold text-[#667781] dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#0c1317] px-2 py-0.5 rounded">
                  {org.slug}
                </span>
              </div>

              {/* Your Role */}
              <div className="flex items-center justify-between py-2.5 border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0">
                <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Your Role</span>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold capitalize ${roleBadge.bg} ${roleBadge.text} ${roleBadge.darkBg} ${roleBadge.darkText}`}>
                  <Shield size={10} />
                  {profile.role}
                </span>
              </div>

              {/* Features Enabled */}
              <div className="pt-2">
                <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block mb-2">
                  Features Enabled
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {enabledFeatures.length > 0 ? (
                    enabledFeatures.map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-[#00a884]/10 text-[#008069] dark:bg-[#00a884]/20 dark:text-[#00e676]"
                      >
                        <Check size={9} />
                        {f}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-[#8696a0] font-semibold">No features enabled</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            5. Danger Zone
        ═══════════════════════════════════════════ */}
        <div
          className="bg-white dark:bg-[#111b21] rounded-xl border border-red-200 dark:border-red-900/40 p-5 shadow-sm"
          style={{ animation: 'fadeInUp 0.8s ease-out' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <LogOut size={16} className="text-red-500" />
            <h3 className="text-sm font-bold text-red-600 dark:text-red-400">Danger Zone</h3>
          </div>
          <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold mb-4">
            Sign out of your account on this device. You will need to log in again to access the dashboard.
          </p>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full sm:w-auto px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer select-none shadow-sm"
          >
            {loggingOut ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Signing out…
              </>
            ) : (
              <>
                <LogOut size={13} />
                Sign Out
                <ChevronRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Inline Keyframes ── */}
      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideInFromTop {
          from {
            opacity: 0;
            transform: translateY(-16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
