'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Eye, Loader2, Mail, MoreHorizontal, Plus, Search, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { useConfirm } from '@/lib/dialog-context'
import {
  ASSIGNABLE_ROLES, DEFAULT_TEAMMATE_ROLE, ROLE_CAPABILITIES, ROLE_TABLE, assignableRoleOf, can, getRoleDisplay,
  getTeamChangeError, isAdmin, isManager, isSuperAdmin, isViewer, type AssignableRole, type RoleSubject,
} from '@/lib/rbac'

interface Teammate {
  id: string
  email: string
  full_name: string | null
  role: string
  see_all: boolean | null
  read_only: boolean | null
  created_at: string
  invite_pending?: boolean
}

type Toast = { tone: 'success' | 'error'; text: string } | null

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'
const input = 'w-full h-11 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[15px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'
const primary = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

/** Two-option switch, used for what an agent can see and do. */
function Segmented({ value, options, onChange, disabled, label }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg bg-[#f1f4f9] dark:bg-slate-800 p-0.5 ${disabled ? 'opacity-50' : ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => value !== option.value && onChange(option.value)}
          className={`px-2.5 h-7 rounded-md text-[12.5px] font-semibold transition-colors ${value === option.value ? 'bg-white dark:bg-slate-900 text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#6B7894] hover:text-[#0E1B3D] dark:hover:text-white'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const display = getRoleDisplay(role)
  return <span className={`inline-flex items-center px-2.5 h-7 rounded-lg border text-[12.5px] font-bold ${display.bg} ${display.color} ${display.border}`}>{display.label}</span>
}

export default function TeamPage() {
  const confirm = useConfirm()
  const [me, setMe] = useState<RoleSubject>(null)
  const [orgId, setOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [team, setTeam] = useState<Teammate[]>([])
  const [seatLimit, setSeatLimit] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState<{ fullName: string; email: string; role: AssignableRole }>({ fullName: '', email: '', role: DEFAULT_TEAMMATE_ROLE })
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)

  const flash = (tone: 'success' | 'error', text: string) => {
    setToast({ tone, text })
    window.setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 4500)
  }

  const load = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/teammates?organizationId=${organizationId}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The team could not be loaded.')
    setTeam(data.teammates || [])
    setSeatLimit(data.seatLimit ?? null)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return
        const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only, organizations(name)').eq('id', user.id).maybeSingle()
        if (!profile?.organization_id) { setLoadError('Your account is not part of a workspace.'); return }
        setMe({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })
        setOrgId(profile.organization_id)
        setOrgName((profile as any).organizations?.name || '')
        await load(profile.organization_id)
      } catch (err: any) {
        setLoadError(err.message || 'The team could not be loaded.')
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  const canManage = can(me, 'team.manage')
  const adminCount = useMemo(() => team.filter((member) => isAdmin(member) && !isSuperAdmin(member)).length, [team])
  const pendingCount = team.filter((member) => member.invite_pending).length
  const seatsFull = seatLimit !== null && team.length >= seatLimit

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const order = (member: Teammate) => (member.role === 'owner' ? 0 : isAdmin(member) ? 1 : isManager(member) ? 2 : isViewer(member) ? 4 : 3)
    return team
      .filter((member) => !q || `${member.full_name || ''} ${member.email}`.toLowerCase().includes(q))
      .sort((a, b) => order(a) - order(b) || (a.full_name || a.email).localeCompare(b.full_name || b.email))
  }, [team, query])

  const counts = useMemo(() => {
    const tally = { admins: 0, managers: 0, agents: 0, viewers: 0 }
    for (const member of team) {
      if (isAdmin(member)) tally.admins++
      else if (isManager(member)) tally.managers++
      else if (isViewer(member)) tally.viewers++
      else tally.agents++
    }
    return tally
  }, [team])

  async function patch(member: Teammate, body: Record<string, unknown>, success: string) {
    setBusyId(member.id)
    try {
      const res = await fetch('/api/teammates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.id, organizationId: orgId, ...body }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The change could not be saved.')
      if (data.teammate) setTeam((current) => current.map((m) => (m.id === member.id ? { ...m, ...data.teammate } : m)))
      flash('success', success)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function changeRole(member: Teammate, role: AssignableRole) {
    if (assignableRoleOf(member) === role) return
    const option = ASSIGNABLE_ROLES.find((r) => r.value === role)!
    const name = member.full_name || member.email
    if (!(await confirm({ title: `Make ${name} ${/^[AEIOU]/.test(option.label) ? 'an' : 'a'} ${option.label}?`, message: option.description, confirmLabel: 'Change role' }))) return
    await patch(member, { role }, `${name} is now ${option.label === 'Admin' ? 'an' : 'a'} ${option.label}.`)
  }

  async function remove(member: Teammate) {
    const name = member.full_name || member.email
    if (!(await confirm({ title: `Remove ${name}?`, message: 'They can no longer sign in. Their chats, leads and tickets go back to the unassigned list.', confirmLabel: 'Remove', destructive: true }))) return
    setBusyId(member.id)
    try {
      const res = await fetch(`/api/teammates?userId=${member.id}&organizationId=${orgId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'They could not be removed.')
      setTeam((current) => current.filter((m) => m.id !== member.id))
      flash('success', `${name} was removed.`)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function resend(member: Teammate) {
    await patch(member, { resendInvite: true }, `A new sign-in link was emailed to ${member.email}.`)
    setTeam((current) => current.map((m) => (m.id === member.id ? { ...m, invite_pending: true } : m)))
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault()
    setInviting(true)
    setInviteError('')
    try {
      const res = await fetch('/api/teammates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...invite, organizationId: orgId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The invite could not be sent.')
      setInviteOpen(false)
      setInvite({ fullName: '', email: '', role: DEFAULT_TEAMMATE_ROLE })
      await load(orgId)
      if (data.inviteSent === false) flash('error', `${invite.fullName} was added, but the email did not go out. Use "Send sign-in link" to try again.`)
      else flash('success', `Invite sent to ${invite.email}.`)
    } catch (err: any) {
      setInviteError(err.message)
    } finally {
      setInviting(false)
    }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>
  }
  if (loadError) {
    return <div className="p-6"><div className={`${card} p-6 text-[15px] text-[#b91c1c]`}>{loadError}</div></div>
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Team</h1>
            <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-1">
              Who can sign in to {orgName || 'your workspace'}, and what each person can do.
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={() => { setInviteError(''); setInviteOpen(true) }} disabled={seatsFull} className={primary} title={seatsFull ? `This workspace can have up to ${seatLimit} people` : undefined}>
              <UserPlus size={18} /> Invite teammate
            </button>
          )}
        </div>

        {toast && (
          <div role="status" className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14px] font-medium ${toast.tone === 'success' ? 'bg-[#e8f7f1] text-[#047857]' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
            {toast.tone === 'success' ? <Check size={18} className="mt-0.5 shrink-0" /> : <X size={18} className="mt-0.5 shrink-0" />}
            <span>{toast.text}</span>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['People', seatLimit ? `${team.length} / ${seatLimit}` : String(team.length)],
            ['Admins', String(counts.admins)],
            ['Managers', String(counts.managers)],
            ['Agents', String(counts.agents)],
            [pendingCount ? 'Invites pending' : 'Viewers', String(pendingCount || counts.viewers)],
          ].map(([label, value]) => (
            <div key={label} className={`${card} px-4 py-3.5`}>
              <div className="text-[13px] font-semibold text-[#6B7894]">{label}</div>
              <div className="text-[24px] font-extrabold text-[#0E1B3D] dark:text-white leading-tight mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {/* Members */}
        <div className={`${card} overflow-visible`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800">
            <h2 className="text-[17px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Users size={18} className="text-[#1D5BEA]" /> Members</h2>
            <label className="relative sm:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" className={`${input} h-10 pl-9 text-[14px]`} aria-label="Search the team" />
            </label>
          </div>

          {visible.length === 0 ? (
            <div className="px-5 py-12 text-center text-[15px] text-[#6B7894]">{team.length ? 'Nobody matches that search.' : 'No one here yet.'}</div>
          ) : (
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {visible.map((member) => {
                const self = member.id === me?.id
                const name = member.full_name || member.email.split('@')[0]
                // Allowed to give this person a role at all (the server still refuses removing the last admin)
                const canChangeRole = getTeamChangeError(me, member, { role: assignableRoleOf(member) }, { adminCount }) === null
                const accessError = getTeamChangeError(me, member, { access: true }, { adminCount })
                const isAgent = !isManager(member) && !isViewer(member)
                const canRemove = getTeamChangeError(me, member, { remove: true }, { adminCount }) === null
                const busy = busyId === member.id
                return (
                  <li key={member.id} className="px-4 sm:px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
                    {/* Who */}
                    <div className="flex items-center gap-3 min-w-0 lg:w-[34%]">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-[#eef3fe] dark:bg-slate-800 text-[#1D5BEA] dark:text-blue-300 flex items-center justify-center text-[14px] font-bold">{initials(name)}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{name}</span>
                          {self && <span className="text-[12px] font-semibold text-[#6B7894]">(you)</span>}
                          {member.invite_pending && <span className="inline-flex items-center gap-1 px-2 h-6 rounded-md bg-[#fff7e8] text-[#92400e] text-[12px] font-semibold"><Mail size={12} /> Invite pending</span>}
                        </div>
                        <div className="text-[13.5px] text-[#6B7894] truncate">{member.email}</div>
                      </div>
                    </div>

                    {/* Role */}
                    <div className="lg:w-[18%]">
                      {canChangeRole ? (
                        <select
                          aria-label={`Role for ${name}`}
                          value={assignableRoleOf(member)}
                          disabled={busy}
                          onChange={(e) => changeRole(member, e.target.value as AssignableRole)}
                          className="h-9 pl-3 pr-8 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[14px] font-semibold text-[#0E1B3D] dark:text-white cursor-pointer focus:outline-none focus:border-[#1D5BEA]"
                        >
                          {ASSIGNABLE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                    </div>

                    {/* Access */}
                    <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#4a5672] dark:text-slate-400">
                      {isAgent ? (
                        <>
                          <span className="flex items-center gap-2">
                            <span className="font-semibold">Sees</span>
                            <Segmented
                              label={`What ${name} can see`}
                              value={member.see_all ? 'all' : 'assigned'}
                              options={[{ value: 'assigned', label: 'Assigned' }, { value: 'all', label: 'Everything' }]}
                              disabled={busy || accessError !== null}
                              onChange={(value) => patch(member, { seeAll: value === 'all' }, value === 'all' ? `${name} now sees every chat, lead and ticket.` : `${name} now sees only their assigned work.`)}
                            />
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="font-semibold">Can</span>
                            <Segmented
                              label={`What ${name} can do`}
                              value={member.read_only ? 'view' : 'edit'}
                              options={[{ value: 'edit', label: 'Reply & edit' }, { value: 'view', label: 'View only' }]}
                              disabled={busy || accessError !== null}
                              onChange={(value) => patch(member, { readOnly: value === 'view' }, value === 'view' ? `${name} can now only view.` : `${name} can now reply and edit.`)}
                            />
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {isViewer(member) ? <Eye size={15} className="text-[#6B7894]" /> : <ShieldCheck size={15} className="text-[#00A884]" />}
                          {getRoleDisplay(member.role).description}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    {canManage && !self && (canRemove || member.role !== 'owner') && (
                      <div className="relative lg:ml-auto self-start lg:self-center">
                        <button
                          type="button"
                          aria-label={`More for ${name}`}
                          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === member.id ? null : member.id) }}
                          className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={18} />}
                        </button>
                        {menuFor === member.id && (
                          <div className="absolute right-0 mt-1 w-56 z-20 rounded-xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => { setMenuFor(null); resend(member) }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[14px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer">
                              <Mail size={16} /> Send sign-in link
                            </button>
                            {canRemove && (
                              <button type="button" onClick={() => { setMenuFor(null); remove(member) }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[14px] text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer">
                                <Trash2 size={16} /> Remove from team
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {!canManage && (
          <p className="text-[14px] text-[#6B7894]">As a manager you can set what agents see and do. Inviting, removing and changing roles is done by an admin.</p>
        )}

        {/* What each role can do */}
        <div className={card}>
          <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800">
            <h2 className="text-[17px] font-bold text-[#0E1B3D] dark:text-white">What each role can do</h2>
            <p className="text-[14px] text-[#6B7894] mt-0.5">The same rules apply everywhere in WAMA CRM, including the mobile view.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="text-left text-[13px] text-[#6B7894]">
                  <th className="px-4 sm:px-5 py-3 font-semibold">&nbsp;</th>
                  {ROLE_TABLE.map((role) => <th key={role.label} className="px-3 py-3 font-bold text-[#0E1B3D] dark:text-white text-center">{role.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROLE_CAPABILITIES.map((capability) => (
                  <tr key={capability.permission} className="border-t border-[#eef1f6] dark:border-slate-800">
                    <td className="px-4 sm:px-5 py-3 text-[#0E1B3D] dark:text-slate-200">{capability.label}</td>
                    {ROLE_TABLE.map((role) => {
                      const allowed = can(role.subject, capability.permission)
                      // Agents can be given these per person, from the switches above
                      const optional = !allowed && role.label === 'Agent' && can({ ...role.subject, see_all: true }, capability.permission)
                      return (
                        <td key={role.label} className="px-3 py-3 text-center">
                          {allowed ? <Check size={18} className="inline text-[#00A884]" aria-label="Yes" />
                            : optional ? <span className="text-[12px] font-semibold text-[#1D5BEA]">If allowed</span>
                            : <span className="text-[#c3cad8]" aria-label="No">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 sm:px-5 py-3 border-t border-[#eef1f6] dark:border-slate-800 text-[13px] text-[#6B7894]">
            &ldquo;If allowed&rdquo;: switch an agent to <strong>Sees: Everything</strong> above. <strong>View only</strong> stops an agent from replying or editing.
          </p>
        </div>
      </div>

      {/* Invite */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0E1B3D]/40 p-0 sm:p-4" onClick={() => !inviting && setInviteOpen(false)}>
          <form onSubmit={submitInvite} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg bg-white dark:bg-[#111b21] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5">
              <h2 className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">Invite a teammate</h2>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="Close" className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-[14px] text-[#4a5672] dark:text-slate-400">They get an email with a link to set their password.</p>
              {inviteError && <div className="rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3.5 py-2.5 text-[14px] font-medium">{inviteError}</div>}
              <label className="block">
                <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Full name</span>
                <input required maxLength={120} value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} placeholder="Priya Sharma" className={input} autoFocus />
              </label>
              <label className="block">
                <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Work email</span>
                <input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="priya@yourbusiness.in" className={input} />
              </label>
              <fieldset>
                <legend className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Role</legend>
                <div className="space-y-2">
                  {ASSIGNABLE_ROLES.map((role) => (
                    <label key={role.value} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors ${invite.role === role.value ? 'border-[#1D5BEA] bg-[#eef3fe] dark:bg-blue-950/30' : 'border-[#e3e8f2] dark:border-slate-700 hover:border-[#b9c7e4]'}`}>
                      <input type="radio" name="role" value={role.value} checked={invite.role === role.value} onChange={() => setInvite({ ...invite, role: role.value })} className="mt-1 accent-[#1D5BEA]" />
                      <span>
                        <span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">{role.label}</span>
                        <span className="block text-[13.5px] text-[#4a5672] dark:text-slate-400 leading-snug">{role.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
              <button type="button" onClick={() => setInviteOpen(false)} className="h-11 px-5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
              <button type="submit" disabled={inviting} className={primary}>{inviting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Send invite</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
