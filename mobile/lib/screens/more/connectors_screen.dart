import 'package:flutter/material.dart';

import '../../config.dart';
import '../../data/app_state.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../store/store_screen.dart' show openLink, plain;

/// The connectors a business can use, as on the web (Connectors page): Front Desk, E-commerce or Sales Pipeline.
/// One at a time: using another one switches the current one off (nothing is deleted). Admins switch; others see.
class ConnectorsScreen extends StatefulWidget {
  const ConnectorsScreen({super.key});
  @override
  State<ConnectorsScreen> createState() => _ConnectorsScreenState();
}

class _Connector {
  const _Connector(this.key, this.name, this.tagline, this.points, this.inApp);
  final String key;
  final String name;
  final String tagline;
  final List<String> points;

  /// Where it lives in the app ('' = on the web only)
  final String inApp;
}

const _connectors = [
  _Connector('salon', 'Front Desk', 'Bookings, bills and reviews for salons, clinics, studios and service centres.', [
    'Bookings and walk-in bills in a few taps',
    'GST bills sent on WhatsApp',
    'Bookings and reviews from WhatsApp',
  ], 'Front Desk and Bills tabs'),
  _Connector('ecommerce', 'E-commerce', 'Sell from your WhatsApp catalog and your own online store.', [
    'Your products inside WhatsApp and on your website',
    'UPI, card or cash on delivery',
    'Orders, delivery and reports in one place',
  ], 'Store tab'),
  _Connector('pipeline', 'Sales Pipeline', 'Track every deal from the first message to won.', [
    'Deals by stage, follow-ups due today',
    'WhatsApp a lead in one tap',
    'Won, lost and win rate by person',
  ], ''),
];

class _ConnectorsScreenState extends State<ConnectorsScreen> {
  List<Map<String, dynamic>>? _list;
  List<String> _only = const [];
  String _error = '';
  String _busy = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/connectors', {'organizationId': app.orgId});
      if (mounted) _apply(data);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _apply(Map<String, dynamic> data) => setState(() {
    _error = '';
    _list = [for (final c in (data['connectors'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)];
    _only = [for (final k in ((data['plan'] as Map?)?['only'] as List? ?? const [])) '$k'];
  });

  String? get _current {
    for (final c in _list ?? const <Map<String, dynamic>>[]) {
      if (c['enabled'] == true && c['active'] != false) return '${c['key']}';
    }
    return null;
  }

  String _name(String key) => _connectors.firstWhere((c) => c.key == key, orElse: () => _Connector(key, key, '', const [], '')).name;

  Future<void> _switch(_Connector c, bool on) async {
    final app = AppScope.read(context);
    final current = _current;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(on ? (current == null ? 'Switch on ${c.name}?' : 'Use ${c.name} instead?') : 'Switch ${c.name} off?'),
        content: Text(
          on
              ? '${current == null ? '' : 'You can use one connector at a time. ${_name(current)} will be switched off. '}Nothing is deleted: switch back any time and everything is still there.'
              : 'It leaves your app and menu. Nothing is deleted: switch it back on any time.',
          style: const TextStyle(height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(on ? (current == null ? 'Switch on' : 'Use ${c.name}') : 'Switch off')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = c.key);
    try {
      final data = await app.ask('/api/connectors', {'key': c.key, 'enabled': on});
      if (!mounted) return;
      _apply(data);
      // The bottom bar and More follow the connector in use
      await app.load('me', '/api/mobile/me', force: true);
      app.refreshAll();
      if (mounted) toast(context, on ? '${c.name} is on${c.inApp.isEmpty ? '. Open it on the web.' : ': find it in the ${c.inApp}.'}' : '${c.name} is off.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Widget _icon(String key, {required bool on}) {
    final color = on ? Colors.white : Brand.blue;
    final icon = switch (key) {
      'salon' => FrontDeskIcon(size: 26, color: color),
      'ecommerce' => Icon(Icons.shopping_bag_outlined, size: 26, color: color),
      _ => Icon(Icons.trending_up, size: 26, color: color),
    };
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(color: on ? Brand.blue : Brand.blueSoft, borderRadius: BorderRadius.circular(14)),
      alignment: Alignment.center,
      child: icon,
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final admin = app.can('settings');
    final current = _current;
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Connectors')),
      body: _list == null
          ? (_error.isNotEmpty ? EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error) : const SkeletonCards())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                    child: Text(
                      current == null
                          ? 'Pick the app made for your kind of business. One at a time; switch any time.'
                          : 'In use: ${_name(current)}. One connector at a time; switching keeps all your data.',
                      style: const TextStyle(color: Brand.textSoft, height: 1.4),
                    ),
                  ),
                  for (final c in _connectors) ...[
                    _card(c, on: current == c.key, admin: admin, locked: _only.isNotEmpty && !_only.contains(c.key)),
                    const SizedBox(height: 10),
                  ],
                  if (!admin) const Padding(padding: EdgeInsets.all(8), child: Text('Only admins can switch connectors.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted))),
                ],
              ),
            ),
    );
  }

  Widget _card(_Connector c, {required bool on, required bool admin, required bool locked}) {
    final busy = _busy == c.key;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: on ? Brand.blue : Brand.line, width: on ? 1.5 : 1),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _icon(c.key, on: on),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(c.tagline, style: const TextStyle(fontSize: 13, color: Brand.muted, height: 1.3)),
                  ],
                ),
              ),
              if (on) const Padding(padding: EdgeInsets.only(left: 8), child: Pill('In use', tone: PillTone.blue, icon: Icons.check)),
            ],
          ),
          const SizedBox(height: 12),
          for (final p in c.points)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.check_circle, size: 17, color: Brand.blue)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(p, style: const TextStyle(fontSize: 14, height: 1.3))),
                ],
              ),
            ),
          if (c.inApp.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.language, size: 16, color: Brand.muted),
                  const SizedBox(width: 6),
                  const Expanded(child: Text('Works on the web for now', style: TextStyle(fontSize: 12.5, color: Brand.muted))),
                  if (on) TextButton(onPressed: () => openLink(context, '${AppConfig.apiBase}/dashboard/leads'), child: const Text('Open')),
                ],
              ),
            ),
          const Divider(height: 20),
          if (locked)
            const Text('Your plan includes Front Desk only. Change plan in Billing to use this.', style: TextStyle(fontSize: 13, color: Brand.muted))
          else if (!admin)
            Text(on ? 'In use' : 'Not in use', style: const TextStyle(color: Brand.muted))
          else
            Row(
              children: [
                Expanded(
                  child: on
                      ? OutlinedButton(onPressed: _busy.isNotEmpty ? null : () => _switch(c, false), child: Text(busy ? 'Saving…' : 'Switch off'))
                      : FilledButton(
                          onPressed: _busy.isNotEmpty ? null : () => _switch(c, true),
                          child: Text(busy ? 'Saving…' : _current == null ? 'Switch on' : 'Use this instead'),
                        ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
