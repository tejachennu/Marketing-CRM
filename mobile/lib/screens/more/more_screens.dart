import 'billing_screen.dart';
import 'grow_screen.dart';

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
import '../campaigns/campaigns_screen.dart';
import '../contacts/contacts_screen.dart';
import '../front_desk/reviews_team.dart';
import '../front_desk/setup_screen.dart';

/// Account, workspace, templates and the sync status.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final user = app.me?['user'] ?? const {};
    void open(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('More')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                // You, as in WhatsApp's settings
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  child: Row(
                    children: [
                      Avatar('${user['name'] ?? user['email'] ?? 'You'}', size: 64),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${user['name'] ?? 'You'}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                            const SizedBox(height: 2),
                            Text('${user['email'] ?? ''}', style: const TextStyle(color: Brand.muted, fontSize: 14)),
                            const SizedBox(height: 2),
                            Text(
                              [app.orgName, '${user['role'] ?? ''}'.replaceAll('_', ' ')].where((x) => x.trim().isNotEmpty).join(' · '),
                              style: const TextStyle(color: Brand.textSoft, fontSize: 13.5, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const _Gap(),
                _Row(
                  icon: app.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                  iconColor: app.online ? Brand.blue : Brand.textSoft,
                  title: app.online ? 'Online' : 'Offline',
                  subtitle: app.waitingCount == 0 ? 'Everything is saved · synced ${formatAgo(app.lastSync)}' : '${app.waitingCount} change${app.waitingCount == 1 ? '' : 's'} waiting to sync',
                  onTap: () => Navigator.pushNamed(context, '/sync'),
                ),
                const _Gap(),
                _Row(
                  icon: Icons.trending_up,
                  iconColor: Brand.blue,
                  title: 'Grow your business with marketing',
                  subtitle: 'Google and Meta ads, photos, videos, Instagram',
                  onTap: () => open(const GrowScreen()),
                ),
                const _Gap(),
                _Row(icon: Icons.people_outline, title: 'Contacts', subtitle: '${(app.cached('contacts')?['contacts'] as List? ?? const []).length} people', onTap: () => open(const ContactsScreen())),
                if (app.can('campaigns')) _Row(icon: Icons.campaign_outlined, title: 'Campaigns', subtitle: 'Send a WhatsApp template to many customers', onTap: () => open(const CampaignsScreen())),
                const _Gap(),
                const _Title('AI'),
                _Row(icon: Icons.menu_book_outlined, title: 'Knowledge base', subtitle: '${articlesOf(app).length} answers the AI uses', onTap: () => open(const KnowledgeScreen())),
                _Row(icon: Icons.smart_toy_outlined, title: 'Try the AI chatbot', subtitle: 'Ask like a customer, see its reply', onTap: () => open(const AssistantScreen())),
                if (app.frontDeskOn && app.can('manage')) ...[
                  const _Gap(),
                  const _Title('Front Desk'),
                  _Row(icon: Icons.star_outline_rounded, title: 'Reviews', subtitle: 'What customers said after their visit', onTap: () => open(const ReviewsScreen())),
                  _Row(icon: Icons.groups_outlined, title: 'Team', subtitle: 'Sales, services and commission for each person', onTap: () => open(const TeamScreen())),
                  _Row(
                    leading: const FrontDeskIcon(size: 24, color: Brand.textSoft),
                    title: 'Front Desk setup',
                    subtitle: 'Services, team, business details, WhatsApp, templates',
                    onTap: () => open(const SetupScreen()),
                  ),
                  _Row(
                    icon: Icons.event_available_outlined,
                    title: 'Booking flow on WhatsApp',
                    subtitle: ((FrontDesk(app).settings['booking_flow'] as Map?)?['enabled'] == true) ? 'On · customers book in taps' : 'Off · set it up',
                    onTap: () => open(const BookingFlowScreen()),
                  ),
                ],
                const _Gap(),
                const _Title('Workspace'),
                _Row(
                  icon: Icons.description_outlined,
                  title: 'WhatsApp templates',
                  subtitle: 'Messages Meta has approved, for campaigns and replies',
                  onTap: () => Navigator.pushNamed(context, '/templates'),
                ),
                if (!app.frontDeskOn)
                  const _Row(
                    leading: FrontDeskIcon(size: 24, color: Brand.textSoft),
                    title: 'Front Desk',
                    subtitle: 'Off · an admin can switch it on in Connectors on the web',
                  ),
                _Row(icon: Icons.credit_card, title: 'Billing', subtitle: 'Plan, AI credit and payments', onTap: () => open(const BillingScreen())),
                const _Row(icon: Icons.language, title: 'Team members and connectors', subtitle: 'On the web at wamacrm.magnetora.in'),
                const _Gap(),
                _Row(
                  icon: Icons.logout,
                  iconColor: Brand.red,
                  title: 'Sign out',
                  titleColor: Brand.red,
                  onTap: () async {
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
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The light grey strip between groups.
class _Gap extends StatelessWidget {
  const _Gap();
  @override
  Widget build(BuildContext context) => Container(height: 8, color: Brand.page);
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 2),
    child: Text(
      text,
      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.muted),
    ),
  );
}

/// A settings row: icon, title and a line under it.
class _Row extends StatelessWidget {
  const _Row({this.icon, this.leading, required this.title, this.subtitle, this.onTap, this.iconColor = Brand.textSoft, this.titleColor});
  final IconData? icon;
  final Widget? leading;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color iconColor;
  final Color? titleColor;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 16, 14),
      child: Row(
        children: [
          SizedBox(width: 26, child: leading ?? Icon(icon, color: iconColor, size: 24)),
          const SizedBox(width: 22),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: titleColor ?? Brand.text),
                ),
                if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: const TextStyle(fontSize: 13.5, color: Brand.muted, height: 1.3))],
              ],
            ),
          ),
        ],
      ),
    ),
  );
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
                      child: Text(app.online ? 'Online' : 'No internet', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
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
  // After a first "Continue with Google": the business name step
  Map<String, dynamic>? _newAccount;
  final _business = TextEditingController();
  final _name = TextEditingController();
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

  Future<void> _google() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final next = await AppScope.read(context).signInWithGoogle();
      if (next != null && mounted) {
        setState(() {
          _newAccount = next;
          _name.text = '${next['name'] ?? ''}';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finishBusiness() async {
    if (_business.text.trim().length < 2) {
      setState(() => _error = 'Please type your business name.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).finishGoogleSignUp(_business.text.trim(), _name.text.trim());
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _errorBox() => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
    child: Text(
      _error!,
      style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
    ),
  );

  /// The one step after a first Google sign-in: the business name (and their own name).
  List<Widget> _businessStep() => [
    Align(alignment: Alignment.centerLeft, child: Image.asset('assets/app_icon.png', width: 68, height: 68)),
    const SizedBox(height: 22),
    const Text('Name your business', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
    const SizedBox(height: 6),
    Text(
      'One last step. Your 14-day free trial starts now${'${_newAccount?['email'] ?? ''}'.isEmpty ? '' : ' for ${_newAccount!['email']}'}.',
      style: const TextStyle(color: Brand.textSoft, height: 1.4),
    ),
    const SizedBox(height: 22),
    TextField(
      controller: _business,
      autofocus: true,
      textCapitalization: TextCapitalization.words,
      decoration: const InputDecoration(labelText: 'Business name', hintText: 'Glow Salon', prefixIcon: Icon(Icons.storefront_outlined)),
    ),
    const SizedBox(height: 12),
    TextField(
      controller: _name,
      textCapitalization: TextCapitalization.words,
      decoration: const InputDecoration(labelText: 'Your name', prefixIcon: Icon(Icons.person_outline)),
      onSubmitted: (_) => _finishBusiness(),
    ),
    if (_error != null) ...[const SizedBox(height: 12), _errorBox()],
    const SizedBox(height: 18),
    FilledButton(
      onPressed: _busy ? null : _finishBusiness,
      child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Start my free trial'),
    ),
  ];

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
                children: _newAccount != null
                    ? _businessStep()
                    : [
                        Align(alignment: Alignment.centerLeft, child: Image.asset('assets/app_icon.png', width: 68, height: 68)),
                        const SizedBox(height: 22),
                        const Text('Sign in to WAMA CRM', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
                        const SizedBox(height: 6),
                        const Text(
                          'Your Front Desk, chats, contacts and campaigns. After you sign in once, the app keeps working without internet.',
                          style: TextStyle(color: Brand.textSoft, height: 1.4),
                        ),
                        const SizedBox(height: 26),
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _google,
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(50),
                            foregroundColor: Brand.text,
                            side: const BorderSide(color: Brand.line),
                          ),
                          icon: const Text(
                            'G',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF4285F4)),
                          ),
                          label: const Text('Continue with Google', style: TextStyle(fontWeight: FontWeight.w600)),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 14),
                          child: Row(
                            children: [
                              Expanded(child: Divider()),
                              Flexible(
                                child: Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 10),
                                  child: Text(
                                    'or with your email',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: Brand.muted, fontSize: 12.5),
                                  ),
                                ),
                              ),
                              Expanded(child: Divider()),
                            ],
                          ),
                        ),
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
                          'New here? Continue with Google to start a free trial. Forgot your password? Reset it on wamacrm.magnetora.in.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 12.5, color: Brand.muted),
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
