import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_logic.dart';
import 'store_screen.dart';

class _Line {
  _Line({this.productId, required this.title, required this.price, this.image}) : name = TextEditingController(text: title), priceText = TextEditingController(text: price);
  final String? productId;
  final String title, price;
  final Object? image;
  final TextEditingController name, priceText;
  int quantity = 1;
  num get unit => num.tryParse(priceText.text.trim()) ?? 0;
}

/// An order taken in the shop or on a phone call (as on the web's New order): who, what, how they
/// get it, and how they pay. Saved with the same API as the web.
class NewOrderScreen extends StatefulWidget {
  const NewOrderScreen({super.key, required this.currency});
  final String currency;
  @override
  State<NewOrderScreen> createState() => _NewOrderScreenState();
}

class _NewOrderScreenState extends State<NewOrderScreen> {
  String _channel = 'in_store';
  String _handover = 'now';
  bool _paid = true;
  String _method = 'cash';
  final _name = TextEditingController();
  String _phone = '';
  final _search = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _found = const [];
  final List<_Line> _lines = [];
  final _street = TextEditingController();
  final _area = TextEditingController();
  final _city = TextEditingController();
  final _pin = TextEditingController();
  final _state = TextEditingController();
  final _fee = TextEditingController();
  final _note = TextEditingController();
  bool _saving = false;
  String _error = '';

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_name, _search, _street, _area, _city, _pin, _state, _fee, _note]) {
      c.dispose();
    }
    for (final l in _lines) {
      l.name.dispose();
      l.priceText.dispose();
    }
    super.dispose();
  }

  void _setChannel(String channel) => setState(() {
    _channel = channel;
    if (channel == 'phone' && _handover == 'now') _handover = 'pickup';
  });

  void _setHandover(String handover) => setState(() {
    _handover = handover;
    if (handover == 'now') _paid = true;
  });

  void _lookUp(String text) {
    _debounce?.cancel();
    if (text.trim().length < 2) {
      setState(() => _found = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      final app = AppScope.read(context);
      try {
        final data = await app.backend.get('/api/commerce/products', {'organizationId': app.orgId, 'limit': '8', 'search': text.trim()});
        if (mounted) setState(() => _found = [for (final p in (data['products'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)]);
      } catch (_) {
        if (mounted) setState(() => _found = const []);
      }
    });
  }

  void _addProduct(Map<String, dynamic> product) => setState(() {
    final same = _lines.where((l) => l.productId == product['id']).firstOrNull;
    if (same != null) {
      same.quantity++;
    } else {
      _lines.add(_Line(productId: '${product['id']}', title: '${product['title']}', price: '${product['price'] ?? ''}', image: product['image_url']));
    }
    _search.clear();
    _found = const [];
  });

  void _addTyped() => setState(() {
    _lines.add(_Line(title: _search.text.trim(), price: ''));
    _search.clear();
    _found = const [];
  });

  num get _subtotal => _lines.fold<num>(0, (sum, l) => sum + l.unit * l.quantity);

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = '';
    });
    try {
      final data = await AppScope.read(context).ask('/api/commerce/orders', {
        'action': 'create',
        'channel': _channel,
        'customer': {'name': _name.text.trim(), 'phone': _phone},
        'items': [
          for (final l in _lines) {'productId': l.productId, 'title': l.name.text.trim(), 'price': l.priceText.text.trim().isEmpty ? null : l.priceText.text.trim(), 'quantity': l.quantity},
        ],
        'handover': _handover,
        'paid': _paid,
        'paymentMethod': _paid ? _method : null,
        'shippingFee': _handover == 'delivery' && _fee.text.trim().isNotEmpty ? _fee.text.trim() : null,
        'address': _handover == 'delivery'
            ? {
                'full_name': _name.text.trim(),
                'phone_number': _phone,
                'address_line_1': _street.text.trim(),
                'address_line_2': _area.text.trim(),
                'city': _city.text.trim(),
                'state': _state.text.trim(),
                'pincode': _pin.text.trim(),
              }
            : null,
        'note': _note.text.trim(),
      });
      if (!mounted) return;
      final order = Map<String, dynamic>.from(data['order'] as Map? ?? const {});
      toast(context, 'Order #${order['order_number']} saved.');
      Navigator.pop(context, order);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _choices(List<(String, String)> options, String value, ValueChanged<String> onPick) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [for (final (id, label) in options) ChoiceChip(label: Text(label), selected: value == id, onSelected: (_) => onPick(id))],
  );

  Widget _title(String text) => Padding(
    padding: const EdgeInsets.only(top: 18, bottom: 8),
    child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
  );

  @override
  Widget build(BuildContext context) {
    final fee = _handover == 'delivery' ? (num.tryParse(_fee.text.trim()) ?? 0) : 0;
    final query = _search.text.trim();
    return Scaffold(
      appBar: AppBar(title: const Text('New order')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          _title('Where did it come from?'),
          _choices(const [('in_store', 'In the shop'), ('phone', 'Phone call')], _channel, _setChannel),
          _title('Customer'),
          TextField(
            controller: _name,
            maxLength: 120,
            decoration: InputDecoration(labelText: 'Name${_channel == 'in_store' && _handover != 'delivery' ? ' (optional)' : ''}', counterText: ''),
          ),
          const SizedBox(height: 10),
          PhoneField(value: _phone, onChanged: (v) => _phone = v, label: 'Mobile number${_channel == 'in_store' ? ' (optional)' : ''}'),
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('An existing customer is found by their number; a new one is added to your contacts.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          ),
          _title('Items'),
          TextField(
            controller: _search,
            onChanged: (v) {
              setState(() {});
              _lookUp(v);
            },
            decoration: const InputDecoration(hintText: 'Search your products, or type an item', prefixIcon: Icon(Icons.search)),
          ),
          if (query.length >= 2)
            Card(
              margin: const EdgeInsets.only(top: 6),
              child: Column(
                children: [
                  for (final p in _found)
                    ListTile(
                      dense: true,
                      title: Text('${p['title']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: Text(formatMoney(p['price'], p['currency'])),
                      onTap: () => _addProduct(p),
                    ),
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.add, color: Brand.blue),
                    title: Text(
                      'Add “$query” with its own price',
                      style: const TextStyle(color: Brand.blue, fontWeight: FontWeight.w600),
                    ),
                    onTap: _addTyped,
                  ),
                ],
              ),
            ),
          if (_lines.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Search for a product, or type the name of anything you sold.', style: TextStyle(color: Brand.muted, fontSize: 13)),
            ),
          for (final l in _lines)
            Card(
              margin: const EdgeInsets.only(top: 8),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: l.productId != null
                              ? Text(
                                  l.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                )
                              : TextField(
                                  controller: l.name,
                                  decoration: const InputDecoration(labelText: 'Item name', isDense: true),
                                ),
                        ),
                        IconButton(
                          tooltip: 'Remove',
                          onPressed: () => setState(() => _lines.remove(l)),
                          icon: const Icon(Icons.delete_outline, color: Brand.muted),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        IconButton.outlined(onPressed: () => setState(() => l.quantity = l.quantity > 1 ? l.quantity - 1 : 1), icon: const Icon(Icons.remove, size: 18)),
                        SizedBox(
                          width: 34,
                          child: Text(
                            '${l.quantity}',
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        IconButton.outlined(onPressed: () => setState(() => l.quantity++), icon: const Icon(Icons.add, size: 18)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: l.priceText,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(labelText: 'Price', isDense: true),
                          ),
                        ),
                      ],
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(formatMoney(l.unit * l.quantity, widget.currency), style: const TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          _title('How does the customer get it?'),
          _choices([if (_channel == 'in_store') ('now', 'Takes it now'), ('pickup', 'Picks up later'), ('delivery', 'Delivery')], _handover, _setHandover),
          if (_handover == 'delivery') ...[
            const SizedBox(height: 12),
            TextField(
              controller: _street,
              decoration: const InputDecoration(labelText: 'House, street'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _area,
              decoration: const InputDecoration(labelText: 'Area, landmark (optional)'),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _city,
                    decoration: const InputDecoration(labelText: 'City'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _pin,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'PIN code'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _state,
              decoration: const InputDecoration(labelText: 'State (optional)'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _fee,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Delivery charge', helperText: 'Leave empty to use your store\'s shipping fee.'),
            ),
          ],
          _title('Payment'),
          _choices(
            [('paid', 'Paid now'), if (_handover != 'now') ('later', _handover == 'delivery' ? 'Pays on delivery' : 'Pays at pick up')],
            _paid ? 'paid' : 'later',
            (v) => setState(() => _paid = v == 'paid'),
          ),
          if (_paid) ...[
            const SizedBox(height: 8),
            _choices(const [('cash', 'Cash'), ('upi', 'UPI'), ('card', 'Card')], _method, (v) => setState(() => _method = v)),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _note,
            maxLength: 1000,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Note (optional)', counterText: ''),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Brand.line),
            ),
            child: Row(
              children: [
                Expanded(child: Text('Total${_handover == 'delivery' && _fee.text.trim().isEmpty ? ' (plus your shipping fee)' : ''}')),
                Text(formatMoney(_subtotal + fee, widget.currency), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          if (_error.isNotEmpty) ...[const SizedBox(height: 10), NoteBox(attention: true, icon: Icons.error_outline, text: _error)],
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _saving || _lines.isEmpty ? null : _save,
            child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save order'),
          ),
        ],
      ),
    );
  }
}
