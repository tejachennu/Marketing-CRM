import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'setup_screen.dart';

/// Front Desk: add services from the store's product catalog (tick boxes, many at once), and
/// the change history of everything in Setup. Both need the internet.

/// A product picture, or a quiet box when there is none.
class ItemThumb extends StatelessWidget {
  const ItemThumb({super.key, this.url, this.size = 44});
  final String? url;
  final double size;
  @override
  Widget build(BuildContext context) {
    final box = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Brand.page,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Brand.line),
      ),
      child: Icon(Icons.inventory_2_outlined, size: size * 0.45, color: Brand.faint),
    );
    final link = url ?? '';
    if (!link.startsWith('https://')) return box;
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.network(link, width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, _, _) => box),
    );
  }
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});
  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  List<Map<String, dynamic>>? _items;
  String _hint = '';
  String _query = '';
  String _group = 'All';
  final Set<String> _ticked = {};
  bool _billable = true;
  int _minutes = 30;
  int _gst = 18;
  String _category = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/salon/catalog', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(() {
        _items = [for (final p in (data['products'] as List? ?? const [])) Map<String, dynamic>.from(p)];
        _hint = '${data['hint'] ?? ''}';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _items = [];
        _hint = '$e'.replaceFirst('Exception: ', '');
      });
    }
  }

  String _groupOf(Map<String, dynamic> p) => '${p['category'] ?? ''}'.trim().isEmpty ? 'Other' : '${p['category']}'.trim();

  List<Map<String, dynamic>> get _shown {
    final words = _query.trim().toLowerCase();
    return (_items ?? const [])
        .where((p) => (_group == 'All' || _groupOf(p) == _group) && (words.isEmpty || '${p['name']}'.toLowerCase().contains(words) || _groupOf(p).toLowerCase().contains(words)))
        .toList();
  }

  Future<void> _add() async {
    setState(() => _busy = true);
    final count = _ticked.length;
    final ok = await saveSetup(
      context,
      (app) =>
          app.ask('/api/salon/catalog', {'product_ids': _ticked.toList(), 'billable': _billable, 'duration_minutes': _minutes, 'tax_rate': _gst, 'category': _category.isEmpty ? null : _category}),
      done: 'Added $count from the catalog${_billable ? '' : ' (not on bills)'}.',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context);
  }

  Future<void> _refresh() async {
    setState(() => _busy = true);
    var changed = 0;
    final ok = await saveSetup(context, (app) async {
      final data = await app.ask('/api/salon/catalog', {'action': 'refresh'});
      changed = (data['changed'] as List? ?? const []).length;
      return data;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      toast(context, changed > 0 ? 'Updated $changed from the catalog.' : 'Everything already matches the catalog.');
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final shown = _shown;
    final open = shown.where((p) => p['service_id'] == null).toList();
    final allTicked = open.isNotEmpty && open.every((p) => _ticked.contains(p['id']));
    final groups = [
      'All',
      ...{for (final p in items ?? const <Map<String, dynamic>>[]) _groupOf(p)}.toList()..sort(),
    ];
    final linked = (items ?? const []).where((p) => p['service_id'] != null).length;
    final categories = [for (final c in (settingsOf(AppScope.of(context))['service_categories'] as List? ?? const [])) '$c'];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add from catalog'),
        actions: [if (linked > 0) IconButton(tooltip: 'Update names and prices', onPressed: _busy ? null : _refresh, icon: const Icon(Icons.sync))],
      ),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: [EmptyState(icon: Icons.inventory_2_outlined, title: 'Your catalog is empty', text: _hint.isEmpty ? 'Add products in E-commerce first.' : _hint)],
            )
          : ListView(
              padding: const EdgeInsets.only(bottom: 120),
              children: [
                SearchField(hint: 'Search the catalog', onChanged: (v) => setState(() => _query = v)),
                if (groups.length > 2)
                  FilterChips(
                    children: [for (final g in groups) ChoiceChip(label: Text(g), selected: _group == g, onSelected: (_) => setState(() => _group = g))],
                  ),
                CheckboxListTile(
                  value: allTicked,
                  onChanged: open.isEmpty
                      ? null
                      : (_) => setState(() {
                          if (allTicked) {
                            _ticked.removeAll(open.map((p) => '${p['id']}'));
                          } else {
                            _ticked.addAll(open.map((p) => '${p['id']}'));
                          }
                        }),
                  controlAffinity: ListTileControlAffinity.leading,
                  activeColor: Brand.blue,
                  title: const Text('Tick all shown', style: TextStyle(fontWeight: FontWeight.w700)),
                  secondary: Text('${_ticked.length} ticked', style: const TextStyle(color: Brand.muted)),
                ),
                const Divider(height: 1),
                if (shown.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Nothing matches.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Brand.muted),
                    ),
                  ),
                for (final p in shown) _row(p),
                if (_ticked.isNotEmpty) ...[
                  const SectionLabel('For the ticked items'),
                  Card(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            value: _billable,
                            activeThumbColor: Colors.white,
                            activeTrackColor: Brand.blue,
                            onChanged: (v) => setState(() => _billable = v),
                            title: const Text('Use in bills', style: TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: const Text('Off: customers can book them, but they never go on a bill'),
                          ),
                          const Text('Time each one takes', style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final m in [15, 30, 45, 60, 90]) ChoiceChip(label: Text('$m min'), selected: _minutes == m, onSelected: (_) => setState(() => _minutes = m)),
                            ],
                          ),
                          const SizedBox(height: 12),
                          const Text('GST', style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final r in [0, 5, 12, 18, 28]) ChoiceChip(label: Text('$r%'), selected: _gst == r, onSelected: (_) => setState(() => _gst = r)),
                            ],
                          ),
                          const SizedBox(height: 12),
                          const Text('Category', style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              ChoiceChip(label: const Text('Same as catalog'), selected: _category.isEmpty, onSelected: (_) => setState(() => _category = '')),
                              for (final c in categories) ChoiceChip(label: Text(c), selected: _category == c, onSelected: (_) => setState(() => _category = c)),
                            ],
                          ),
                          const SizedBox(height: 10),
                          const Text('You can change any of these per item afterwards.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
      bottomNavigationBar: (items?.isNotEmpty ?? false)
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton.icon(
                  onPressed: _busy || _ticked.isEmpty ? null : _add,
                  icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.add),
                  label: Text(_ticked.isEmpty ? 'Tick items to add' : 'Add ${_ticked.length} to services'),
                ),
              ),
            )
          : null,
    );
  }

  Widget _row(Map<String, dynamic> p) {
    final added = p['service_id'] != null;
    final on = _ticked.contains(p['id']);
    final note = added ? (p['billable'] == false ? 'Added · not on bills' : 'Already added') : '${_groupOf(p)}${p['available'] == false ? ' · out of stock' : ''}';
    return Material(
      color: on ? Brand.bubble.withValues(alpha: 0.5) : Colors.transparent,
      child: InkWell(
        onTap: added ? null : () => setState(() => on ? _ticked.remove(p['id']) : _ticked.add('${p['id']}')),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 16, 8),
          child: Row(
            children: [
              Checkbox(value: added || on, activeColor: added ? Brand.faint : Brand.blue, onChanged: added ? null : (_) => setState(() => on ? _ticked.remove(p['id']) : _ticked.add('${p['id']}'))),
              ItemThumb(url: p['image_url'] as String?),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${p['name']}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: added ? Brand.muted : Brand.text),
                    ),
                    Text(
                      note,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Brand.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(formatRupees(p['price']), style: const TextStyle(fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Change history ──

const _areas = {
  '': 'Everything',
  'service': 'Services',
  'catalog': 'Catalog',
  'category': 'Categories',
  'team': 'Team',
  'business': 'Business',
  'whatsapp': 'WhatsApp',
  'booking_flow': 'Booking flow',
  'templates': 'Templates',
};

const _fieldNames = {
  'name': 'Name',
  'category': 'Category',
  'price': 'Price',
  'duration_minutes': 'Minutes',
  'tax_rate': 'GST',
  'sac_code': 'SAC code',
  'active': 'On offer',
  'billable': 'Use in bills',
  'phone': 'Phone',
  'service_ids': 'Services',
  'commission_percent': 'Commission',
  'business_name': 'Business name',
  'prices_include_tax': 'Prices include GST',
  'invoice_prefix': 'Invoice number starts with',
  'invoice_note': 'Invoice note',
  'opens_at': 'Opens at',
  'closes_at': 'Closes at',
  'chat_assistant': 'WhatsApp assistant',
  'auto_approve_bookings': 'Accept bookings on their own',
  'reminders_enabled': 'Reminders',
  'feedback_enabled': 'Feedback after visits',
  'review_link': 'Review link',
  'services': 'Services moved',
  'services_moved': 'Services moved',
};

String _value(String key, Object? v) {
  if (v == null || v == '') return 'empty';
  if (v is bool) return v ? 'on' : 'off';
  if (key == 'price') return formatRupees(v);
  if (key == 'tax_rate' || key == 'commission_percent') return '$v%';
  if (v is List) return '${v.length} picked';
  if (v is Map) return 'changed';
  final text = '$v';
  return text.length > 60 ? '${text.substring(0, 60)}…' : text;
}

/// One plain line per change, the same as the web.
List<String> describeChange(Map? details) {
  if (details == null) return const [];
  final lines = <String>[];
  String label(String k) => _fieldNames[k] ?? k.replaceAll('_', ' ');
  if (details['from'] is String && details['to'] is String) lines.add('${details['from']} → ${details['to']}');
  details.forEach((k, v) {
    final key = '$k';
    if (v is Map && v.containsKey('from') && v.containsKey('to')) {
      lines.add('${label(key)}: ${_value(key, v['from'])} → ${_value(key, v['to'])}');
    } else if (key == 'items' && v is List) {
      final names = [
        for (final item in v.take(8))
          if (item is String) item else if (item is Map) '${item['name']}${item.containsKey('to') ? ' ${_value('price', item['from'])} → ${_value('price', item['to'])}' : ''}',
      ];
      lines.add('${names.join(', ')}${v.length > 8 ? ' and ${v.length - 8} more' : ''}');
    } else if (key == 'order' && v is List) {
      lines.add('New order: ${v.join(', ')}');
    } else if (key == 'billable') {
      lines.add('Use in bills: ${v == true ? 'on' : 'off'}');
    } else if (key == 'from' || key == 'to') {
      // shown above
    } else if (v != null && v is! Map && v is! List) {
      lines.add('${label(key)}: ${_value(key, v)}');
    }
  });
  return lines;
}

String _when(String iso) {
  final t = DateTime.tryParse(iso);
  if (t == null) return '';
  final ist = t.toUtc().add(const Duration(hours: 5, minutes: 30));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final h = ist.hour % 12 == 0 ? 12 : ist.hour % 12;
  return '${ist.day} ${months[ist.month - 1]}, $h:${ist.minute.toString().padLeft(2, '0')} ${ist.hour >= 12 ? 'pm' : 'am'}';
}

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  static const _page = 40;
  String _area = '';
  List<Map<String, dynamic>>? _entries;
  bool _more = false;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({String? before}) async {
    final app = AppScope.read(context);
    setState(() {
      _busy = true;
      _error = '';
      if (before == null) _entries = null;
    });
    try {
      final data = await app.backend.get('/api/salon/history', {
        'organizationId': app.orgId,
        'limit': '$_page',
        if (_area.isNotEmpty) 'area': _area,
        // ignore: use_null_aware_elements
        if (before != null) 'before': before,
      });
      final list = [for (final e in (data['entries'] as List? ?? const [])) Map<String, dynamic>.from(e)];
      if (!mounted) return;
      setState(() {
        _entries = before == null ? list : [...?_entries, ...list];
        _more = list.length == _page;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e'.replaceFirst('Exception: ', '');
        _entries ??= [];
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries;
    return Scaffold(
      appBar: AppBar(title: const Text('Change history')),
      body: RefreshIndicator(
        onRefresh: () => _load(),
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            FilterChips(
              children: [
                for (final a in _areas.entries)
                  ChoiceChip(
                    label: Text(a.value),
                    selected: _area == a.key,
                    onSelected: (_) {
                      setState(() => _area = a.key);
                      _load();
                    },
                  ),
              ],
            ),
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Text(_error, style: const TextStyle(color: Brand.red)),
              ),
            if (entries == null)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (entries.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: EmptyState(icon: Icons.history, title: 'No changes yet', text: 'Changes to services, team and settings show up here: who made them and when.'),
              )
            else
              for (var i = 0; i < entries.length; i++) _entry(entries[i], last: i == entries.length - 1),
            if (_more && entries != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: OutlinedButton(
                  onPressed: _busy ? null : () => _load(before: '${entries.last['created_at']}'),
                  child: const Text('Show older'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _entry(Map<String, dynamic> e, {required bool last}) {
    final lines = describeChange(e['details'] as Map?);
    final named = '${e['target'] ?? ''}';
    final target = named.isNotEmpty ? named : '${_areas[e['area']] ?? 'the'} settings';
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 40,
            child: Column(
              children: [
                const SizedBox(height: 18),
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: Brand.blue,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                ),
                if (!last) Expanded(child: Container(width: 1.5, color: Brand.line)),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 12, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      style: const TextStyle(fontSize: 15, color: Brand.text),
                      children: [
                        TextSpan(
                          text: '${e['user_name'] ?? 'Someone'}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        TextSpan(text: ' ${e['action']} '),
                        if (target.isNotEmpty)
                          TextSpan(
                            text: target,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text('${_areas[e['area']] ?? e['area']} · ${_when('${e['created_at']}')}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  if (lines.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(10)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [for (final l in lines) Text(l, style: const TextStyle(fontSize: 13.5, color: Brand.textSoft))],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
