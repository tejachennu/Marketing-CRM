import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'bill_parts.dart';
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

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, date: widget.date);
    final a = widget.appointment;
    final lines = _lines(desk);
    final who = [..._bookedWho, for (final id in _extra) if (desk.service(id) != null) _extraWho[id]];
    final total = _total(desk);
    final team = desk.staff.isNotEmpty;
    var step = 0;
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Make the bill'),
            Text('${a['customer_name'] ?? 'Customer'}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.muted)),
          ],
        ),
      ),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
              children: [
                BillStep(
                  number: ++step,
                  title: 'Booked',
                  hint: team ? 'Tap a name to change who did it.' : null,
                  child: Column(
                    children: [
                      for (var i = 0; i < _booked.length; i++) ...[
                        if (i > 0) const Divider(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${_booked[i]['name']}', style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                                  Text(formatRupees(_booked[i]['price']), style: const TextStyle(fontSize: 13, color: Brand.muted)),
                                ],
                              ),
                            ),
                            if (team)
                              PersonPill(
                                desk: desk,
                                people: [
                                  for (final m in desk.staff)
                                    if ((m['service_ids'] as List? ?? const []).isEmpty || (m['service_ids'] as List).contains(_booked[i]['service_id']) || m['id'] == _bookedWho[i]) Map<String, dynamic>.from(m),
                                ],
                                value: _bookedWho[i],
                                onChanged: (v) => setState(() => _bookedWho[i] = v),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                BillStep(
                  number: ++step,
                  title: 'Anything extra?',
                  hint: 'Services they had on top of the booking.',
                  trailing: _extra.isEmpty ? null : Pill('${_extra.length} added', tone: PillTone.blue),
                  child: ServicePicker(forBill: true, desk: desk, selected: _extra, onChanged: (v) => setState(() => _extra = v)),
                ),
                if (_extra.isNotEmpty && team)
                  BillStep(
                    number: ++step,
                    title: 'Who did the extras',
                    child: WhoDidIt(desk: desk, serviceIds: _extra, value: _extraWho, onChanged: (v) => setState(() => _extraWho = v)),
                  ),
                BillStep(
                  number: ++step,
                  title: 'Discount',
                  child: DiscountPicker(value: _discount, max: _subtotal(desk), onChanged: (v) => setState(() => _discount = v)),
                ),
                BillStep(
                  number: ++step,
                  title: 'Paid by',
                  child: PaymentTiles(value: _payment, onChanged: (v) => setState(() => _payment = v)),
                ),
                WhatsAppSwitch(
                  value: _whatsapp,
                  onChanged: (v) => setState(() => _whatsapp = v),
                  note: 'After 24 hours without a reply from them, your bill template is used.',
                ),
                BillSummary(desk: desk, lines: lines, who: who, discount: _discount, total: total),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BillBar(count: lines.length, total: total, label: 'Make the bill', onPressed: () => _save(desk)),
    );
  }
}
