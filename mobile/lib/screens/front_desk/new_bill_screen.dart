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
  Map<String, String?> _who = {};
  Map<String, num>? _discount;

  num _total(FrontDesk desk) => desk.estimate(_services, discountPercent: _discount?['type'] == 0 ? _discount!['value']! : 0, discountAmount: _discount?['type'] == 1 ? _discount!['value']! : 0);
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
    final total = _total(desk);
    final items = [
      for (final id in _services) {...?desk.service(id), 'staff_name': desk.staffName(_who[id])},
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
        'customer': {'contact_id': _customer['contact_id'], 'name': name, 'phone': _customer['phone']},
        'service_ids': _services,
        'staff_id': oneStaff,
        'staff_ids': staffIds,
        'discount': ?discountBody(_discount),
        'payment_method': _payment,
        'send_whatsapp': _whatsapp,
      },
      preview: {
        'customer_name': name.isEmpty ? 'Walk-in customer' : name,
        'customer_phone': _customer['phone'],
        'total': total,
        'status': _payment == null ? 'unpaid' : 'paid',
        'payment_method': _payment,
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
    final total = _total(desk);
    final subtotal = desk.estimate(_services);
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
                      _who = {for (var i = 0; i < ids.length; i++) ids[i]: i < staff.length && desk.staff.any((m) => m['id'] == staff[i]) ? staff[i] : null};
                    }),
                  ),
                ),
                BillStep(
                  number: 2,
                  title: 'Services',
                  trailing: _services.isEmpty ? null : Pill('${_services.length} picked', tone: PillTone.blue),
                  child: ServicePicker(forBill: true, desk: desk, selected: _services, onChanged: (v) => setState(() => _services = v)),
                ),
                if (_services.isNotEmpty && desk.staff.isNotEmpty)
                  BillStep(
                    number: 3,
                    title: 'Who did it',
                    hint: 'It counts for their commission.',
                    child: WhoDidIt(desk: desk, serviceIds: _services, value: _who, onChanged: (v) => setState(() => _who = v)),
                  ),
                BillStep(
                  number: _services.isNotEmpty && desk.staff.isNotEmpty ? 4 : 3,
                  title: 'Discount',
                  child: DiscountPicker(value: _discount, max: subtotal, onChanged: (v) => setState(() => _discount = v)),
                ),
                BillStep(
                  number: _services.isNotEmpty && desk.staff.isNotEmpty ? 5 : 4,
                  title: 'Paid by',
                  child: PaymentTiles(value: _payment, onChanged: (v) => setState(() => _payment = v)),
                ),
                WhatsAppSwitch(
                  value: _whatsapp,
                  onChanged: (v) => setState(() => _whatsapp = v),
                  note: 'Goes when the bill syncs. After 24 hours without a reply from them, your bill template is used.',
                ),
                BillSummary(
                  desk: desk,
                  lines: [for (final id in _services) ?desk.service(id)],
                  who: [for (final id in _services) if (desk.service(id) != null) _who[id]],
                  discount: _discount,
                  total: total,
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BillBar(
        count: _services.length,
        total: total,
        label: 'Save bill',
        icon: Icons.check,
        onPressed: _saving || _services.isEmpty ? null : () => _save(desk),
      ),
    );
  }
}
