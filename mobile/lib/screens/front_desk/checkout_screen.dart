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

  /// The customer's membership card used on this bill (the server takes its sessions, discount and credit).
  Map<String, dynamic>? _card;

  List<Map<String, dynamic>> _lines(FrontDesk desk) => [..._booked, ..._extra.map(desk.service).whereType<Map<String, dynamic>>()];

  /// The lines as billed: the card's free sessions and discount taken off first, as the server does.
  ({List<Map<String, dynamic>> lines, int free, num discount}) _billed(FrontDesk desk) => _card == null ? (lines: _lines(desk), free: 0, discount: 0) : applyMemberCard(_card!, _lines(desk));

  num _total(FrontDesk desk) =>
      desk.estimateLines(_billed(desk).lines, discountPercent: _discount?['type'] == 0 ? _discount!['value']! : 0, discountAmount: _discount?['type'] == 1 ? _discount!['value']! : 0);

  /// Paid from the card's credit, and paid online when booking (website or booking page): the server takes both off
  /// what is due, card first.
  (num, num) _paidBefore(num total) {
    final a = widget.appointment;
    final credit = _card == null ? 0 : (num.tryParse('${_card!['credit_balance'] ?? ''}') ?? 0).clamp(0, total);
    final advance = a['payment_status'] == 'paid' ? (num.tryParse('${a['payment_paid'] ?? ''}') ?? 0).clamp(0, total - credit) : 0;
    return (credit, advance);
  }

  Future<void> _save(FrontDesk desk) async {
    final app = AppScope.read(context);
    final a = widget.appointment;
    final staffIds = [..._bookedWho, for (final id in _extra) _extraWho[id]];
    final billed = _billed(desk).lines;
    final who = [..._bookedWho, for (final id in _extra) if (desk.service(id) != null) _extraWho[id]];
    final items = [
      for (var i = 0; i < billed.length; i++) {...billed[i], 'staff_name': desk.staffName(i < who.length ? who[i] : null)},
    ];
    final total = _total(desk);
    final (fromCard, fromAdvance) = _paidBefore(total);
    final covered = fromCard + fromAdvance > 0 && total - fromCard - fromAdvance <= 0;
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
        'membership_id': ?_card?['id'],
        'send_whatsapp': _whatsapp,
      },
      preview: {
        'customer_name': a['customer_name'],
        'customer_phone': a['customer_phone'],
        'total': total,
        'membership_paid': fromCard,
        'advance_paid': fromAdvance,
        'status': covered || _payment != null ? 'paid' : 'unpaid',
        'payment_method': covered ? (fromAdvance > 0 && fromAdvance >= fromCard ? 'online' : 'membership') : _payment,
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
    final billed = _billed(desk);
    final lines = billed.lines;
    final who = [..._bookedWho, for (final id in _extra) if (desk.service(id) != null) _extraWho[id]];
    final total = _total(desk);
    final (fromCard, fromAdvance) = _paidBefore(total);
    final toCollect = (total - fromCard - fromAdvance).clamp(0, double.infinity);
    final paidBefore = fromCard + fromAdvance > 0;
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
                MembershipCards(
                  contactId: a['contact_id'] == null ? null : '${a['contact_id']}',
                  phone: '${a['customer_phone'] ?? ''}',
                  value: _card,
                  onChanged: (c) => setState(() => _card = c),
                  effect: cardEffect(free: billed.free, discount: billed.discount, credit: fromCard),
                ),
                BillStep(
                  number: ++step,
                  title: 'Discount',
                  child: DiscountPicker(value: _discount, max: desk.discountRoom(lines), onChanged: (v) => setState(() => _discount = v)),
                ),
                BillStep(
                  number: ++step,
                  title: 'Paid by',
                  hint: fromAdvance > 0 && toCollect > 0 ? '${formatRupees(fromAdvance)} was paid online when booking. Collect only the rest.' : null,
                  child: paidBefore && toCollect <= 0
                      ? const Text('Nothing to collect. It is already paid.', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.blue))
                      : PaymentTiles(value: _payment, onChanged: (v) => setState(() => _payment = v)),
                ),
                WhatsAppSwitch(
                  value: _whatsapp,
                  onChanged: (v) => setState(() => _whatsapp = v),
                  note: 'After 24 hours without a reply from them, your bill template is used.',
                ),
                BillSummary(desk: desk, lines: lines, who: who, discount: _discount, total: total, paid: [('Paid from membership', fromCard), ('Paid online when booking', fromAdvance)]),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BillBar(
        count: lines.length,
        total: toCollect,
        caption: !paidBefore ? null : (toCollect <= 0 ? 'Already paid' : '${lines.length} service${lines.length == 1 ? '' : 's'} · to collect'),
        label: 'Make the bill',
        onPressed: () => _save(desk),
      ),
    );
  }
}
