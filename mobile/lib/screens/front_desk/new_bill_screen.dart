import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
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
      appBar: AppBar(title: const Text('New bill')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                FormSection(
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
                FormSection(
                  title: 'Services',
                  child: ServicePicker(forBill: true, desk: desk, selected: _services, onChanged: (v) => setState(() => _services = v)),
                ),
                FormSection(
                  title: 'Who did it',
                  hint: _services.length > 1 ? 'Picks for each service; it counts for their commission.' : null,
                  child: WhoDidIt(desk: desk, serviceIds: _services, value: _who, onChanged: (v) => setState(() => _who = v)),
                ),
                FormSection(
                  title: 'Discount',
                  child: DiscountPicker(value: _discount, max: subtotal, onChanged: (v) => setState(() => _discount = v)),
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
                    subtitle: const Text('Goes when the bill syncs. After 24 hours without a reply from them, your bill template is used.'),
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
                      '${_services.length} service${_services.length == 1 ? '' : 's'}${desk.hasGst ? (desk.pricesIncludeTax ? ' · incl. GST' : ' · + GST') : ''}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                    ),
                    Text(formatRupees(total), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4)),
                  ],
                ),
              ),
              FilledButton.icon(onPressed: _saving || _services.isEmpty ? null : () => _save(desk), icon: const Icon(Icons.check), label: const Text('Save bill')),
            ],
          ),
        ),
      ),
    );
  }
}
