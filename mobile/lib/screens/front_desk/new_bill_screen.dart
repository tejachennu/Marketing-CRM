import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
import 'bill_parts.dart';
import 'logic.dart';
import 'pickers.dart';

/// A bill for a walk-in: customer, services, who did it, discount, how they paid. Saved on the
/// phone at once; the server makes the GST invoice (and sends it on WhatsApp) when it syncs.
class NewBillScreen extends StatefulWidget {
  const NewBillScreen({super.key});
  @override
  State<NewBillScreen> createState() => _NewBillScreenState();
}

class _NewBillScreenState extends State<NewBillScreen> {
  Map<String, dynamic> _customer = const {};
  List<String> _services = [];

  /// How many of each picked service (missing = 1): 2 × Threading.
  Map<String, int> _qty = {};
  Map<String, String?> _who = {};
  Map<String, num>? _discount;

  /// The customer's membership card used on this bill (the server takes its sessions, discount and credit).
  Map<String, dynamic>? _card;

  /// The lines as billed, each with its count and who did it: the card's free sessions and discount taken off first,
  /// as the server does (a card can split 3 × Facial into 1 free and 2 paid, so who did it travels on the line).
  ({List<Map<String, dynamic>> lines, int free, num discount}) _billed(FrontDesk desk) {
    final lines = [
      for (final id in _services)
        if (desk.service(id) case final s?) {...s, 'quantity': _qty[id] ?? 1, 'staff_id': _who[id]},
    ];
    return _card == null ? (lines: lines, free: 0, discount: 0) : applyMemberCard(_card!, lines);
  }

  /// Services on the bill, counting each one as many times as it is done.
  int get _units => _services.fold(0, (sum, id) => sum + (_qty[id] ?? 1));

  num _total(FrontDesk desk) =>
      desk.estimateLines(_billed(desk).lines, discountPercent: _discount?['type'] == 0 ? _discount!['value']! : 0, discountAmount: _discount?['type'] == 1 ? _discount!['value']! : 0);

  /// Paid from the card's credit (up to the bill's total).
  num _fromCard(num total) => _card == null ? 0 : (num.tryParse('${_card!['credit_balance'] ?? ''}') ?? 0).clamp(0, total);
  String? _payment = 'upi';
  bool _whatsapp = true;
  bool _saving = false;
  bool _tried = false;

  Future<void> _save(FrontDesk desk) async {
    final app = AppScope.read(context);
    setState(() => _tried = true);
    if (phoneError('${_customer['phone'] ?? ''}') != null) return toast(context, 'Check the mobile number.');
    if (_services.isEmpty) return toast(context, 'Choose at least one service.');
    setState(() => _saving = true);
    final name = '${_customer['name'] ?? ''}'.trim();
    final phone = '${_customer['phone'] ?? ''}'.trim();
    final total = _total(desk);
    final fromCard = _fromCard(total);
    final covered = fromCard > 0 && total - fromCard <= 0;
    final items = [
      for (final line in _billed(desk).lines) {...line, 'staff_name': desk.staffName(line['staff_id'] as String?)},
    ];
    final staffIds = [for (final id in _services) _who[id]];
    final oneStaff = staffIds.toSet().length == 1 ? staffIds.first : null;
    final localId = AppState.newLocalId();
    await app.counterAction(
      kind: 'bill',
      label: 'Bill for ${name.isEmpty ? 'walk-in' : name} · ${formatRupees(total)}',
      localId: localId,
      resultIdPath: 'invoice.id',
      action: {
        'type': 'walk_in_bill',
        // The server needs a name or a phone: an empty walk-in goes as "Walk-in customer", as on the web
        'customer': {'contact_id': _customer['contact_id'], 'name': name.isEmpty ? 'Walk-in customer' : name, 'phone': phone.isEmpty ? null : phone},
        'service_ids': _services,
        'quantities': [for (final id in _services) _qty[id] ?? 1],
        'staff_id': oneStaff,
        'staff_ids': staffIds,
        'discount': ?discountBody(_discount),
        'payment_method': _payment,
        'membership_id': ?_card?['id'],
        'send_whatsapp': _whatsapp,
      },
      preview: {
        'customer_name': name.isEmpty ? 'Walk-in customer' : name,
        'customer_phone': phone.isEmpty ? null : phone,
        'total': total,
        'membership_paid': fromCard,
        'status': covered || _payment != null ? 'paid' : 'unpaid',
        'payment_method': covered ? 'membership' : _payment,
        'issued_at': DateTime.now().toUtc().toIso8601String(),
        'items': items,
      },
    );
    if (!mounted) return;
    toast(context, app.online ? 'Bill saved.' : 'Bill saved on the phone. It syncs when you are online.');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app);
    final billed = _billed(desk);
    final total = _total(desk);
    final fromCard = _fromCard(total);
    final toCollect = (total - fromCard).clamp(0, double.infinity);
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('New bill')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
              children: [
                BillStep(
                  number: 1,
                  title: 'Customer',
                  hint: 'Leave empty for a walk-in. Numbers from any country work.',
                  child: CustomerPicker(
                    optional: true,
                    phoneError: _tried ? phoneError('${_customer['phone'] ?? ''}') : null,
                    onChanged: (c) => setState(() => _customer = c),
                    onRepeat: (ids, staff) => setState(() {
                      _services = ids.where((id) => desk.service(id) != null && desk.service(id)!['billable'] != false).toList();
                      _qty = {};
                      _who = {for (var i = 0; i < ids.length; i++) ids[i]: i < staff.length && desk.staff.any((m) => m['id'] == staff[i]) ? staff[i] : null};
                    }),
                  ),
                ),
                BillStep(
                  number: 2,
                  title: 'Services',
                  trailing: _services.isEmpty ? null : Pill('${_services.length} picked', tone: PillTone.blue),
                  child: ServicePicker(
                    forBill: true,
                    desk: desk,
                    selected: _services,
                    counts: _qty,
                    // A shop that takes no appointments has no use for minutes on a bill
                    showTime: app.takesAppointments,
                    onChanged: (v) => setState(() {
                      _services = v;
                      _qty = {for (final e in _qty.entries) if (v.contains(e.key)) e.key: e.value};
                    }),
                    onCount: (id, n) => setState(() => _qty = {..._qty, id: n}),
                  ),
                ),
                if (_services.isNotEmpty && desk.staff.isNotEmpty)
                  BillStep(
                    number: 3,
                    title: 'Who did it',
                    hint: 'It counts for their commission.',
                    child: WhoDidIt(desk: desk, serviceIds: _services, counts: _qty, value: _who, onChanged: (v) => setState(() => _who = v)),
                  ),
                MembershipCards(
                  contactId: _customer['contact_id'] == null ? null : '${_customer['contact_id']}',
                  phone: '${_customer['phone'] ?? ''}',
                  value: _card,
                  onChanged: (c) => setState(() => _card = c),
                  effect: cardEffect(free: billed.free, discount: billed.discount, credit: fromCard),
                ),
                BillStep(
                  number: _services.isNotEmpty && desk.staff.isNotEmpty ? 4 : 3,
                  title: 'Discount',
                  // Prices before GST: the server never takes off more than that
                  child: DiscountPicker(value: _discount, max: desk.discountRoom(billed.lines), onChanged: (v) => setState(() => _discount = v)),
                ),
                BillStep(
                  number: _services.isNotEmpty && desk.staff.isNotEmpty ? 5 : 4,
                  title: 'Paid by',
                  child: fromCard > 0 && toCollect <= 0
                      ? const Text('Nothing to collect. The membership card pays it.', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.blue))
                      : PaymentTiles(value: _payment, onChanged: (v) => setState(() => _payment = v)),
                ),
                WhatsAppSwitch(
                  value: _whatsapp,
                  onChanged: (v) => setState(() => _whatsapp = v),
                  note: 'Goes when the bill syncs. After 24 hours without a reply from them, your bill template is used.',
                ),
                BillSummary(
                  desk: desk,
                  lines: billed.lines,
                  who: [for (final line in billed.lines) line['staff_id'] as String?],
                  discount: _discount,
                  total: total,
                  paid: [('Paid from membership', fromCard)],
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BillBar(
        count: _units,
        total: toCollect,
        caption: fromCard <= 0 ? null : (toCollect <= 0 ? 'Paid by the membership card' : '$_units service${_units == 1 ? '' : 's'} · to collect'),
        label: 'Save bill',
        icon: Icons.check,
        onPressed: _saving || _services.isEmpty ? null : () => _save(desk),
      ),
    );
  }
}
