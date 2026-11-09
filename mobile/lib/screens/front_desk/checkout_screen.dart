import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';
import 'pickers.dart';

/// Done with a visit: add anything extra they had, who did each service, a discount, how they
/// paid, then the bill. Works offline like every counter action.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.appointment, this.date});
  final Map<String, dynamic> appointment;
  final String? date;
  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  late final List<Map<String, dynamic>> _booked = [for (final s in (widget.appointment['services'] as List? ?? const [])) Map<String, dynamic>.from(s ?? const {})];
  List<String> _extra = [];
  // Who did each line: booked lines first (by position), then the extras (by service id)
  late final List<String?> _bookedWho = [for (final s in _booked) (s['staff_id'] ?? widget.appointment['staff_id']) as String?];
  Map<String, String?> _extraWho = {};
  Map<String, num>? _discount;
  String? _payment = 'upi';
  bool _whatsapp = true;

  List<Map<String, dynamic>> _lines(FrontDesk desk) => [..._booked, ..._extra.map(desk.service).whereType<Map<String, dynamic>>()];

  num _subtotal(FrontDesk desk) => _lines(desk).fold<num>(0, (t, s) => t + (num.tryParse('${s['price'] ?? 0}') ?? 0));

  num _total(FrontDesk desk) =>
      desk.estimateLines(_lines(desk), discountPercent: _discount?['type'] == 0 ? _discount!['value']! : 0, discountAmount: _discount?['type'] == 1 ? _discount!['value']! : 0);

  Future<void> _save(FrontDesk desk) async {
    final app = AppScope.read(context);
    final a = widget.appointment;
    final staffIds = [..._bookedWho, for (final id in _extra) _extraWho[id]];
    final items = [
      for (var i = 0; i < _booked.length; i++) {..._booked[i], 'staff_name': desk.staffName(_bookedWho[i])},
      for (final id in _extra) {...?desk.service(id), 'staff_name': desk.staffName(_extraWho[id])},
    ];
    final total = _total(desk);
    await app.counterAction(
      kind: 'checkout',
      label: 'Billed · ${a['customer_name']}',
      localId: AppState.newLocalId(),
      resultIdPath: 'invoice.id',
      action: {
        'type': 'complete_and_bill',
        'appointment_id': a['id'],
        'extra_service_ids': _extra,
        'staff_ids': staffIds,
        'discount': ?discountBody(_discount),
        'payment_method': _payment,
        'send_whatsapp': _whatsapp,
      },
      preview: {
        'customer_name': a['customer_name'],
        'customer_phone': a['customer_phone'],
        'total': total,
        'status': _payment == null ? 'unpaid' : 'paid',
        'payment_method': _payment,
        'issued_at': DateTime.now().toUtc().toIso8601String(),
        'items': items,
      },
    );
    if (!mounted) return;
    toast(context, app.online ? 'Billed.' : 'Billed on the phone. It syncs when you are online.');
    Navigator.pop(context, true);
  }

  Widget _whoChips(FrontDesk desk, String? serviceId, String? value, ValueChanged<String?> onChanged) {
    final people = desk.staff.where((m) {
      final ids = (m['service_ids'] as List? ?? const []);
      return serviceId == null || ids.isEmpty || ids.contains(serviceId) || m['id'] == value;
    });
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        ChoiceChip(label: const Text('Anyone'), selected: value == null, onSelected: (_) => onChanged(null)),
        for (final m in people) ChoiceChip(label: Text('${m['name']}'), selected: value == m['id'], onSelected: (_) => onChanged('${m['id']}')),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, date: widget.date);
    final a = widget.appointment;
    return Scaffold(
      appBar: AppBar(title: Text('Bill · ${a['customer_name']}')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                FormSection(
                  title: 'Booked',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var i = 0; i < _booked.length; i++) ...[
                        Row(
                          children: [
                            Expanded(
                              child: Text('${_booked[i]['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            ),
                            Text(formatRupees(_booked[i]['price']), style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        if (desk.staff.isNotEmpty) _whoChips(desk, _booked[i]['service_id'] as String?, _bookedWho[i], (v) => setState(() => _bookedWho[i] = v)),
                        const SizedBox(height: 12),
                      ],
                    ],
                  ),
                ),
                FormSection(
                  title: 'Anything extra?',
                  hint: 'Add services they had on top of the booking.',
                  child: ServicePicker(desk: desk, selected: _extra, onChanged: (v) => setState(() => _extra = v)),
                ),
                if (_extra.isNotEmpty && desk.staff.isNotEmpty)
                  FormSection(
                    title: 'Who did the extras',
                    child: WhoDidIt(desk: desk, serviceIds: _extra, value: _extraWho, onChanged: (v) => setState(() => _extraWho = v)),
                  ),
                FormSection(
                  title: 'Discount',
                  child: DiscountPicker(value: _discount, max: _subtotal(desk), onChanged: (v) => setState(() => _discount = v)),
                ),
                FormSection(
                  title: 'Paid by',
                  child: Wrap(
                    spacing: 8,
                    children: [
                      for (final m in ['cash', 'upi', 'card']) ChoiceChip(label: Text(paymentLabels[m]!), selected: _payment == m, onSelected: (_) => setState(() => _payment = m)),
                      ChoiceChip(label: const Text('Pay later'), selected: _payment == null, onSelected: (_) => setState(() => _payment = null)),
                    ],
                  ),
                ),
                Card(
                  child: SwitchListTile(
                    value: _whatsapp,
                    onChanged: (v) => setState(() => _whatsapp = v),
                    activeThumbColor: Colors.white,
                    activeTrackColor: Brand.blue,
                    title: const Text('Send the bill on WhatsApp', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    subtitle: const Text('After 24 hours without a reply from them, your bill template is used.'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_booked.length + _extra.length} service${_booked.length + _extra.length == 1 ? '' : 's'}${desk.hasGst ? (desk.pricesIncludeTax ? ' · incl. GST' : ' · + GST') : ''}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                    ),
                    Text(formatRupees(_total(desk)), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4)),
                  ],
                ),
              ),
              FilledButton.icon(onPressed: () => _save(desk), icon: const Icon(Icons.receipt_long), label: const Text('Make the bill')),
            ],
          ),
        ),
      ),
    );
  }
}
