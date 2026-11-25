import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_screen.dart' show confirmAction;

/// The business's own online payment accounts, as on the web (Store → Website and Front Desk → Website and
/// booking): Razorpay (UPI, cards, net banking) and Stripe (cards, Apple Pay, Google Pay), and which one customers
/// pay with when both are connected. Keys are checked by the server before they are saved; secrets are never shown.
class OnlinePaymentsScreen extends StatefulWidget {
  const OnlinePaymentsScreen({super.key});
  @override
  State<OnlinePaymentsScreen> createState() => _OnlinePaymentsScreenState();
}

class _OnlinePaymentsScreenState extends State<OnlinePaymentsScreen> {
  Map<String, dynamic>? _state;
  String _error = '';
  String _busy = '';
  String? _open;
  final _keyId = TextEditingController();
  final _keySecret = TextEditingController();
  final _rzpHook = TextEditingController();
  final _stripeKey = TextEditingController();
  final _stripeHook = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final c in [_keyId, _keySecret, _rzpHook, _stripeKey, _stripeHook]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/commerce/storefront/payments', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(() {
        _state = data;
        _keyId.text = '${data['keyId'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _run(String what, Future<Map<String, dynamic>> Function() step, String done) async {
    setState(() {
      _busy = what;
      _error = '';
    });
    try {
      final next = await step();
      if (!mounted) return;
      setState(() {
        _state = next;
        _open = null;
        for (final c in [_keySecret, _rzpHook, _stripeKey, _stripeHook]) {
          c.clear();
        }
      });
      toast(context, done);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  /// Ask first: keys go at once, customers cannot pay online, and the secret has to be found again.
  Future<void> _disconnect(String gateway, Future<Map<String, dynamic>> Function() step) async {
    final name = gateway == 'stripe' ? 'Stripe' : 'Razorpay';
    final ok = await confirmAction(
      context,
      title: 'Disconnect $name?',
      message: 'Customers cannot pay online with $name until you connect it again, and you will need your ${gateway == 'stripe' ? 'secret key' : 'Key Secret'} again.',
      yes: 'Disconnect',
      destructive: true,
    );
    if (ok && mounted) await _run('$gateway-off', step, '$name disconnected.');
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final admin = app.can('settings');
    final s = _state;
    Future<Map<String, dynamic>> put(Map<String, dynamic> body) => app.ask('/api/commerce/storefront/payments', body, method: 'PUT');
    Future<Map<String, dynamic>> del(String gateway) => app.backend.send('DELETE', '/api/commerce/storefront/payments?organizationId=${app.orgId}&gateway=$gateway', const {});
    final stripe = Map<String, dynamic>.from(s?['stripe'] as Map? ?? const {});
    final gateways = [for (final g in (s?['gateways'] as List? ?? const [])) '$g'];
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Online payment')),
      body: s == null
          ? (_error.isNotEmpty ? EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error) : const SkeletonCards())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text('Customers pay on your website and when they book. The money goes straight to your own account.', style: TextStyle(color: Brand.textSoft)),
                const SizedBox(height: 14),
                _gateway(
                  name: 'Razorpay',
                  about: 'UPI, cards, net banking · about 2% fee',
                  connected: s['connected'] == true,
                  account: '${s['keyId'] ?? ''}',
                  live: s['live'] == true,
                  webhook: s['webhook'] == true,
                  admin: admin,
                  open: _open == 'razorpay',
                  onToggle: () => setState(() => _open = _open == 'razorpay' ? null : 'razorpay'),
                  form: [
                    const Text('Razorpay → Account & Settings → API Keys → Generate key. Paste both here.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                    const SizedBox(height: 10),
                    TextField(controller: _keyId, decoration: const InputDecoration(labelText: 'Key ID', hintText: 'rzp_live_…')),
                    const SizedBox(height: 10),
                    TextField(controller: _keySecret, obscureText: true, decoration: InputDecoration(labelText: s['connected'] == true ? 'Key Secret (empty = keep)' : 'Key Secret')),
                    const SizedBox(height: 10),
                    TextField(controller: _rzpHook, obscureText: true, decoration: InputDecoration(labelText: 'Webhook secret (recommended)', helperText: 'Webhook address: ${s['webhookUrl'] ?? ''}', helperMaxLines: 3)),
                  ],
                  onSave: _busy.isNotEmpty
                      ? null
                      : () => _run('razorpay', () => put({'keyId': _keyId.text.trim(), if (_keySecret.text.trim().isNotEmpty) 'keySecret': _keySecret.text.trim(), if (_rzpHook.text.trim().isNotEmpty) 'webhookSecret': _rzpHook.text.trim()}), 'Razorpay connected.'),
                  onDisconnect: _busy.isNotEmpty ? null : () => _disconnect('razorpay', () => del('razorpay')),
                ),
                const SizedBox(height: 10),
                _gateway(
                  name: 'Stripe',
                  about: 'Cards, Apple Pay, Google Pay · good for customers abroad',
                  connected: stripe['connected'] == true,
                  account: '${stripe['key'] ?? ''}',
                  live: stripe['live'] == true,
                  webhook: stripe['webhook'] == true,
                  admin: admin,
                  open: _open == 'stripe',
                  onToggle: () => setState(() => _open = _open == 'stripe' ? null : 'stripe'),
                  form: [
                    const Text('Stripe → Developers → API keys → Secret key (sk_live_…). Use sk_test_… to try with no real money.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                    const SizedBox(height: 10),
                    TextField(controller: _stripeKey, obscureText: true, decoration: InputDecoration(labelText: stripe['connected'] == true ? 'Secret key (empty = keep)' : 'Secret key')),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _stripeHook,
                      obscureText: true,
                      decoration: InputDecoration(labelText: 'Signing secret (whsec_…, recommended)', helperText: 'Webhook address: ${stripe['webhookUrl'] ?? ''} · events checkout.session.completed and checkout.session.async_payment_succeeded', helperMaxLines: 4),
                    ),
                  ],
                  onSave: _busy.isNotEmpty
                      ? null
                      : () => _run('stripe', () => put({'gateway': 'stripe', if (_stripeKey.text.trim().isNotEmpty) 'secretKey': _stripeKey.text.trim(), if (_stripeHook.text.trim().isNotEmpty) 'webhookSecret': _stripeHook.text.trim()}), 'Stripe connected.'),
                  onDisconnect: _busy.isNotEmpty ? null : () => _disconnect('stripe', () => del('stripe')),
                ),
                if (gateways.length > 1) ...[
                  const SizedBox(height: 16),
                  const Text('Customers pay with', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: [for (final g in gateways) ButtonSegment(value: g, label: Text(g == 'stripe' ? 'Stripe' : 'Razorpay'))],
                    selected: {'${s['use'] ?? gateways.first}'},
                    onSelectionChanged: !admin || _busy.isNotEmpty ? null : (v) => _run('use', () => put({'use': v.first}), 'Customers now pay with ${v.first == 'stripe' ? 'Stripe' : 'Razorpay'}.'),
                  ),
                ],
                if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error, style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600))),
                if (!admin) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Only admins connect payment accounts.', style: TextStyle(color: Brand.muted))),
              ],
            ),
    );
  }

  Widget _gateway({
    required String name,
    required String about,
    required bool connected,
    required String account,
    required bool live,
    required bool webhook,
    required bool admin,
    required bool open,
    required VoidCallback onToggle,
    required List<Widget> form,
    required VoidCallback? onSave,
    required VoidCallback? onDisconnect,
  }) {
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              CircleAvatar(radius: 18, backgroundColor: connected ? Brand.blue : Brand.lineSoft, child: Text(name[0], style: TextStyle(color: connected ? Colors.white : Brand.textSoft, fontWeight: FontWeight.w700))),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(connected ? '$name · Connected' : name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
                    Text(
                      connected ? '$account${live ? '' : ' · test mode, no real money'}${webhook ? '' : ' · webhook not set'}' : about,
                      style: TextStyle(fontSize: 12.5, color: connected && !live ? Brand.red : Brand.muted),
                    ),
                  ],
                ),
              ),
              if (admin) TextButton(onPressed: onToggle, child: Text(open ? 'Close' : connected ? 'Change' : 'Connect')),
            ],
          ),
          if (open) ...[
            const Divider(height: 24),
            ...form,
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: FilledButton(onPressed: onSave, child: Text(connected ? 'Save' : 'Connect $name'))),
                if (connected) ...[const SizedBox(width: 10), OutlinedButton(onPressed: onDisconnect, child: const Text('Disconnect'))],
              ],
            ),
          ],
        ],
      ),
    );
  }
}
