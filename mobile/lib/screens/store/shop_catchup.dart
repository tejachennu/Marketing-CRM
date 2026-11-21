import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../campaigns/audience.dart' show readSheet;
import 'store_logic.dart';
import 'store_screen.dart' show NoteBox, confirmAction, openLink, plain;

/// More of the web shop in the app: sizes / colours with a price and stock each, booking a courier from
/// the order page, products from a spreadsheet, and Instagram comments and posts. Same APIs as the web.

Widget _loading() => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));

// ── Sizes and colours ────────────────────────────────────────────────────────

class ProductOptionsScreen extends StatefulWidget {
  const ProductOptionsScreen({super.key, required this.productId, required this.title, required this.currency});
  final String productId;
  final String title;
  final String currency;
  @override
  State<ProductOptionsScreen> createState() => _ProductOptionsScreenState();
}

class _ProductOptionsScreenState extends State<ProductOptionsScreen> {
  final List<(TextEditingController, TextEditingController)> _options = [];
  List<Map<String, dynamic>> _variants = [];
  bool _loaded = false;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/products/options', {'organizationId': app.orgId, 'productId': widget.productId});
      _fill(d);
    } catch (e) {
      if (mounted) setState(() { _loaded = true; _error = plain(e); });
    }
  }

  void _fill(Map d) {
    setState(() {
      _options
        ..clear()
        ..addAll([
          for (final o in (d['options'] as List? ?? const []).cast<Map>())
            (TextEditingController(text: '${o['name']}'), TextEditingController(text: (o['values'] as List? ?? const []).join(', '))),
        ]);
      if (_options.isEmpty) _options.add((TextEditingController(text: 'Size'), TextEditingController()));
      _variants = [for (final v in (d['variants'] as List? ?? const []).cast<Map>()) Map<String, dynamic>.from(v)];
      _loaded = true;
    });
  }

  Future<void> _save() async {
    setState(() { _saving = true; _error = ''; });
    try {
      final options = [
        for (final (name, values) in _options)
          if (name.text.trim().isNotEmpty && values.text.trim().isNotEmpty)
            {'name': name.text.trim(), 'values': values.text.split(',').map((v) => v.trim()).where((v) => v.isNotEmpty).toList()},
      ];
      final d = await AppScope.read(context).ask('/api/commerce/products/options', {'productId': widget.productId, 'options': options, 'variants': _variants}, method: 'PUT');
      _fill(d);
      if (mounted) toast(context, options.isEmpty ? 'Options removed.' : 'Saved. Set the price and stock of each below.');
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sizes and colours')),
      body: !_loaded
          ? _loading()
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                const Text('Each choice can have its own price and stock. Type the choices with commas: S, M, L, XL.', style: TextStyle(color: Brand.muted, fontSize: 13.5)),
                const SizedBox(height: 10),
                for (var i = 0; i < _options.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(children: [
                      SizedBox(width: 96, child: TextField(controller: _options[i].$1, decoration: const InputDecoration(labelText: 'Option'))),
                      const SizedBox(width: 8),
                      Expanded(child: TextField(controller: _options[i].$2, decoration: const InputDecoration(labelText: 'Choices'))),
                      IconButton(tooltip: 'Remove', onPressed: () => setState(() => _options.removeAt(i)), icon: const Icon(Icons.close)),
                    ]),
                  ),
                if (_options.length < 3) TextButton.icon(onPressed: () => setState(() => _options.add((TextEditingController(text: _options.isEmpty ? 'Size' : 'Colour'), TextEditingController()))), icon: const Icon(Icons.add), label: const Text('Add an option')),
                if (_variants.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Text('Price and stock of each', style: TextStyle(fontWeight: FontWeight.w700)),
                  for (final v in _variants)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(children: [
                        Expanded(child: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        SizedBox(width: 84, child: TextFormField(initialValue: v['price'] == null ? '' : '${v['price']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price', hintText: 'Same'), onChanged: (x) => v['price'] = x.trim().isEmpty ? null : num.tryParse(x))),
                        const SizedBox(width: 8),
                        SizedBox(width: 72, child: TextFormField(initialValue: v['stock'] == null ? '' : '${v['stock']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Stock'), onChanged: (x) => v['stock'] = x.trim().isEmpty ? null : int.tryParse(x))),
                        Checkbox(value: v['active'] != false, onChanged: (x) => setState(() => v['active'] = x == true)),
                      ]),
                    ),
                ],
                const SizedBox(height: 12),
                if (_error.isNotEmpty) NoteBox(attention: true, icon: Icons.error_outline, text: _error),
                FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save sizes and colours')),
                const Padding(padding: EdgeInsets.only(top: 8), child: Text('Price empty = the product price. Stock empty = not tracked. Untick to stop selling a choice.', style: TextStyle(color: Brand.muted, fontSize: 12.5))),
              ],
            ),
    );
  }
}

// ── Courier from the order page ──────────────────────────────────────────────

const _shipmentLabels = {
  'booked': 'Booked', 'pickup_scheduled': 'Pickup booked', 'picked_up': 'Picked up', 'in_transit': 'On the way', 'out_for_delivery': 'Out for delivery',
  'delivered': 'Delivered', 'failed_attempt': 'Delivery attempt failed', 'returning': 'Coming back', 'returned': 'Returned', 'cancelled': 'Cancelled', 'lost': 'Lost',
};

class CourierBox extends StatefulWidget {
  const CourierBox({super.key, required this.order, required this.onChanged});
  final Map order;
  final VoidCallback onChanged;
  @override
  State<CourierBox> createState() => _CourierBoxState();
}

class _CourierBoxState extends State<CourierBox> {
  Map? _data;
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/shipping/ship', {'organizationId': app.orgId, 'orderId': '${widget.order['id']}'});
      if (mounted) setState(() => _data = d);
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> _post(Map<String, dynamic> body) async {
    setState(() => _busy = '${body['action']}');
    try {
      final d = await AppScope.read(context).ask('/api/commerce/shipping/ship', {'orderId': widget.order['id'], ...body});
      if (d['shipments'] != null && mounted) setState(() => _data = {...?_data, 'shipments': d['shipments']});
      return d;
    } catch (e) {
      if (mounted) toast(context, plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _book() async {
    final d = await _post({'action': 'rates'});
    if (d == null || !mounted) return;
    final rates = (d['rates'] as List? ?? const []).cast<Map>();
    if (rates.isEmpty) {
      toast(context, 'No courier can take this parcel. ${(d['notes'] as List? ?? const []).join(' ')}');
      return;
    }
    final pick = await showModalBottomSheet<Map>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * 0.8),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(12), children: [
            const Padding(padding: EdgeInsets.all(8), child: Text('Pick a courier', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            for (final r in rates)
              ListTile(
                title: Text('${r['courierName']}'),
                subtitle: Text([if (r['days'] != null) '${r['days']} days', r['provider'] == 'shiprocket' ? 'Shiprocket' : 'Delhivery', if (r['recommended'] == true) 'recommended', if (r['cheapest'] == true) 'cheapest', if (r['fastest'] == true) 'fastest'].join(' · ')),
                trailing: Text(formatMoney(r['price'], 'INR'), style: const TextStyle(fontWeight: FontWeight.w700)),
                onTap: () => Navigator.pop(sheet, r),
              ),
          ]),
        ),
      ),
    );
    if (pick == null || !mounted) return;
    final ok = await confirmAction(context, title: 'Book ${pick['courierName']}?', message: 'The pickup is booked and the label is made. Charge about ${formatMoney(pick['price'], 'INR')}.', yes: 'Book');
    if (!ok) return;
    final booked = await _post({'action': 'book', 'provider': pick['provider'], 'courierId': pick['courierId'], 'price': pick['price']});
    if (booked != null && mounted) { toast(context, 'Courier booked.'); widget.onChanged(); }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) return const SizedBox.shrink();
    final ready = (d['ready'] as List? ?? const []);
    final shipments = (d['shipments'] as List? ?? const []).cast<Map>();
    if (ready.isEmpty && shipments.isEmpty) return const SizedBox.shrink();
    final canEdit = AppScope.of(context).can('write');
    final open = shipments.where((s) => !['cancelled', 'delivered', 'returned', 'lost'].contains(s['status'])).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Padding(padding: EdgeInsets.only(bottom: 6), child: Text('Courier', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
          for (final s in shipments)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${s['courier_name'] ?? (s['provider'] == 'shiprocket' ? 'Shiprocket' : 'Delhivery')} · ${_shipmentLabels[s['status']] ?? s['status']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                if (s['awb'] != null) Text('AWB ${s['awb']}${s['status_text'] != null ? ' · ${s['status_text']}' : ''}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                if (canEdit)
                  Wrap(spacing: 6, children: [
                    if ('${s['label_url'] ?? ''}'.startsWith('https://')) TextButton(onPressed: () => openLink(context, '${s['label_url']}'), child: const Text('Label')),
                    if (s['awb'] != null && s['status'] != 'cancelled') TextButton(onPressed: _busy != null ? null : () => _post({'action': 'refresh', 'shipmentId': s['id']}), child: const Text('Where is it?')),
                    if (['booked', 'pickup_scheduled'].contains(s['status']))
                      TextButton(
                        onPressed: _busy != null ? null : () async {
                          if (await confirmAction(context, title: 'Cancel this booking?', message: 'Only before the courier picks it up.', yes: 'Cancel booking', destructive: true)) await _post({'action': 'cancel', 'shipmentId': s['id']});
                        },
                        child: const Text('Cancel', style: TextStyle(color: Brand.red)),
                      ),
                  ]),
              ]),
            ),
          if (canEdit && ready.isNotEmpty && open.isEmpty)
            d['blocker'] != null
                ? Text('${d['blocker']}', style: const TextStyle(color: Brand.muted, fontSize: 13))
                : OutlinedButton.icon(onPressed: _busy != null ? null : _book, icon: _busy == 'rates' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.local_shipping_outlined, size: 18), label: const Text('Book a courier')),
        ]),
      ),
    );
  }
}

// ── Products from a spreadsheet ──────────────────────────────────────────────

/// Pick an Excel or CSV file and send it to the server, which checks every row (same as the web).
Future<void> uploadProductsSheet(BuildContext context, VoidCallback onDone) async {
  final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['csv', 'xlsx']);
  if (file == null || !context.mounted) return;
  try {
    final sheet = readSheet(file.name, await file.readAsBytes());
    final rows = [sheet.headers, for (final r in sheet.rows) [for (final h in sheet.headers) r[h] ?? '']];
    if (!context.mounted) return;
    final ok = await confirmAction(context, title: 'Add ${sheet.rows.length} products?', message: 'From ${file.name}. A SKU you already have updates that product. Needs the headings Name and Price (Stock, SKU, Category, Description, Photo link, Weight (grams), HSN, GST % are optional).', yes: 'Add products');
    if (!ok || !context.mounted) return;
    final d = await AppScope.read(context).ask('/api/commerce/products/import', {'rows': rows});
    if (!context.mounted) return;
    final errors = (d['errors'] as List? ?? const []);
    toast(context, '${d['added']} added, ${d['updated']} updated.${errors.isEmpty ? '' : ' ${errors.length} rows had problems: ${errors.first}'}');
    onDone();
  } catch (e) {
    if (context.mounted) toast(context, plain(e).replaceAll('at least one person', 'at least one product'));
  }
}

// ── Instagram ────────────────────────────────────────────────────────────────
