import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../data/local_store.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
import '../ai/assistant_screen.dart';
import '../ai/knowledge_screen.dart';
import '../front_desk/booking_flow_screen.dart';
import '../front_desk/logic.dart';
import 'signup_screen.dart';

/// Account, workspace, templates and the sync status.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final user = app.me?['user'] ?? const {};
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Panel(
                  child: Row(
                    children: [
                      Avatar('${user['name'] ?? user['email'] ?? 'You'}', size: 52),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${user['name'] ?? 'You'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                            Text('${user['email'] ?? ''}', style: const TextStyle(color: Brand.muted)),
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              children: [
                                Pill(app.orgName, tone: PillTone.navy),
                                Pill('${user['role'] ?? ''}'),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Panel(
                  onTap: () => Navigator.pushNamed(context, '/sync'),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: app.online ? Brand.blueSoft : Brand.page, borderRadius: BorderRadius.circular(12)),
                        child: Icon(app.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined, color: app.online ? Brand.blue : Brand.textSoft),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(app.online ? 'Online' : 'Offline', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                            Text(
                              app.waitingCount == 0 ? 'Everything is saved · synced ${formatAgo(app.lastSync)}' : '${app.waitingCount} change${app.waitingCount == 1 ? '' : 's'} waiting to sync',
                              style: const TextStyle(color: Brand.muted, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right, color: Brand.faint),
                    ],
                  ),
                ),
                const SectionLabel('AI'),
                Card(
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.menu_book_outlined, color: Brand.navy),
                        title: const Text('Knowledge base', style: TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text('${articlesOf(app).length} answers the AI uses'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const KnowledgeScreen())),
                      ),
                      const Divider(indent: 56),
                      ListTile(
                        leading: const Icon(Icons.smart_toy_outlined, color: Brand.navy),
                        title: const Text('Try the AI chatbot', style: TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: const Text('Ask like a customer, see its reply'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AssistantScreen())),
                      ),
                    ],
                  ),
                ),
                if (app.frontDeskOn && app.can('manage')) ...[
                  const SectionLabel('Front Desk'),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.event_available_outlined, color: Brand.navy),
                      title: const Text('Booking flow on WhatsApp', style: TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(((FrontDesk(app).settings['booking_flow'] as Map?)?['enabled'] == true) ? 'On · customers book in taps' : 'Off · set it up'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BookingFlowScreen())),
                    ),
                  ),
                ],
                const SectionLabel('Workspace'),
                Card(
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.description_outlined, color: Brand.navy),
                        title: const Text('WhatsApp templates', style: TextStyle(fontWeight: FontWeight.w600)),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.pushNamed(context, '/templates'),
                      ),
                      const Divider(indent: 56),
                      ListTile(
                        leading: const Padding(
                          padding: EdgeInsets.only(left: 2),
                          child: FrontDeskIcon(size: 22, color: Brand.navy),
                        ),
                        title: const Text('Front Desk', style: TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(app.frontDeskOn ? 'On' : 'Off · switch on in Connectors on the web'),
                      ),
                      const Divider(indent: 56),
                      const ListTile(
                        leading: Icon(Icons.language, color: Brand.navy),
                        title: Text('Setup, team and billing', style: TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text('On the web at wamacrm.magnetora.in'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Brand.red,
                    side: const BorderSide(color: Color(0xFFF3C7C7)),
                  ),
                  onPressed: () async {
                    final waiting = app.waitingCount;
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Sign out?'),
                        content: Text(
                          waiting > 0
                              ? '$waiting change${waiting == 1 ? ' has' : 's have'} not synced yet and will be lost. Sync first if you can.'
                              : 'The copy of your data on this phone is removed.',
                        ),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                          TextButton(
                            onPressed: () => Navigator.pop(context, true),
                            style: TextButton.styleFrom(foregroundColor: Brand.red),
                            child: const Text('Sign out'),
                          ),
                        ],
                      ),
                    );
                    if (ok == true) await app.signOut();
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What is waiting to reach the server, what was refused and why, with Try again and Discard.
class SyncScreen extends StatelessWidget {
  const SyncScreen({super.key});

  IconData _icon(String kind) => switch (kind) {
    'bill' || 'checkout' || 'payment' || 'send' => Icons.receipt_long_outlined,
    'booking' || 'appointment' => Icons.event_note_outlined,
    'contact' => Icons.person_outline,
    'knowledge' => Icons.menu_book_outlined,
    'chat_setting' => Icons.smart_toy_outlined,
    'ticket' => Icons.confirmation_number_outlined,
    'settings' => Icons.tune,
    'message' => Icons.chat_bubble_outline,
    _ => Icons.campaign_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final items = app.outbox;
    final failed = items.where((i) => i.state == OutboxState.failed).toList();
    final waiting = items.where((i) => i.state != OutboxState.failed).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Sync')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(app.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined, color: app.online ? Brand.blue : Brand.textSoft, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(app.online ? 'Online' : 'No internet', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  app.online
                      ? 'Changes go to the server as you make them. Last full sync ${formatAgo(app.lastSync)}.'
                      : 'Keep working: bills, bookings, contacts, messages and campaigns are saved on this phone and sent in order when the internet is back.',
                  style: const TextStyle(color: Brand.textSoft, height: 1.4),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: app.syncing || app.refreshing ? null : () => app.syncNow(),
                  icon: app.syncing || app.refreshing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.sync),
                  label: Text(app.syncing || app.refreshing ? 'Syncing…' : 'Sync now'),
                ),
              ],
            ),
          ),
          if (failed.isNotEmpty) ...[SectionLabel('Could not be saved · ${failed.length}'), for (final item in failed) _ItemCard(item: item, icon: _icon(item.kind))],
          SectionLabel('Waiting to sync · ${waiting.length}'),
          if (waiting.isEmpty)
            const Panel(
              child: Text('Nothing waiting. Everything on this phone is on the server too.', style: TextStyle(color: Brand.muted)),
            ),
          for (final item in waiting) _ItemCard(item: item, icon: _icon(item.kind)),
        ],
      ),
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.icon});
  final OutboxItem item;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    final failed = item.state == OutboxState.failed;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(color: failed ? Brand.redSoft : Brand.page, borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, size: 20, color: failed ? Brand.red : Brand.navy),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text('Made ${formatAgo(item.createdAt)}${item.state == OutboxState.sending ? ' · sending…' : ''}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    ],
                  ),
                ),
              ],
            ),
            if (item.error != null) ...[
              const SizedBox(height: 10),
              Text(
                item.error!,
                style: TextStyle(color: failed ? Brand.red : Brand.textSoft, fontWeight: FontWeight.w600, fontSize: 13.5),
              ),
            ],
            if (failed) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(onPressed: () => app.discard(item), child: const Text('Discard')),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(onPressed: () => app.retry(item), child: const Text('Try again')),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String? _error;

  bool _tried = false;
  String? get _emailErr => _tried ? emailError(_email.text, required: true) : null;
  String? get _passwordErr => _tried && _password.text.isEmpty ? 'Enter your password.' : null;

  Future<void> _go() async {
    setState(() => _tried = true);
    if (_emailErr != null || _passwordErr != null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).signIn(_email.text.trim(), _password.text);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 60,
                      height: 60,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(18)),
                      child: const Text(
                        'W',
                        style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  const Text('Sign in to WAMA CRM', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                  const SizedBox(height: 6),
                  const Text('Your Front Desk, chats, contacts and campaigns. After you sign in once, the app keeps working without internet.', style: TextStyle(color: Brand.textSoft, height: 1.4)),
                  const SizedBox(height: 26),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    onChanged: (_) => _tried ? setState(() {}) : null,
                    decoration: InputDecoration(labelText: 'Email', prefixIcon: const Icon(Icons.mail_outline), errorText: _emailErr),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    onChanged: (_) => _tried ? setState(() {}) : null,
                    obscureText: _hide,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      errorText: _passwordErr,
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(onPressed: () => setState(() => _hide = !_hide), icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined)),
                    ),
                    onSubmitted: (_) => _go(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _busy ? null : _go,
                    child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Sign in'),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Use the same email and password as the web app. Forgot it? Reset it on wamacrm.magnetora.in.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12.5, color: Brand.muted),
                  ),
                  const SizedBox(height: 18),
                  const Divider(),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SignupScreen())),
                    child: const Text('New here? Create an account'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
