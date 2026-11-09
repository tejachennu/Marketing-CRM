import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// One bill: what was done, the total, and Mark paid / Send on WhatsApp.
class BillScreen extends StatelessWidget {
  const BillScreen({super.key, required this.invoiceId});
  final String invoiceId;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app);
    final i = desk.invoices.cast<Map<String, dynamic>?>().firstWhere((x) => '${x!['id']}' == invoiceId, orElse: () => null);
    if (i == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(icon: Icons.receipt_long_outlined, title: 'Not found', text: 'This bill is not in the list on the phone.'),
      );
    }
    final status = '${i['status']}';
    final items = [for (final x in (i['items'] as List? ?? const [])) Map<String, dynamic>.from(x)];

    Future<void> pay() async {
      final method = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Paid ${formatRupees(i['total'])} by', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                for (final m in ['upi', 'cash', 'card'])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: OutlinedButton(onPressed: () => Navigator.pop(context, m), child: Text(paymentLabels[m]!)),
                  ),
              ],
            ),
          ),
        ),
      );
      if (method == null) return;
      app.counterAction(kind: 'payment', label: 'Payment for ${i['number']} · ${paymentLabels[method]}', action: {'type': 'pay_invoice', 'invoice_id': i['id'], 'payment_method': method});
      if (context.mounted) toast(context, app.online ? 'Marked paid.' : 'Marked paid. It syncs when you are online.');
    }

    return Scaffold(
      appBar: AppBar(title: Text('${i['number']}')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              desk.hasGst ? 'TAX INVOICE' : 'BILL',
                              style: const TextStyle(fontSize: 11.5, letterSpacing: 1.4, fontWeight: FontWeight.w800, color: Brand.blue),
                            ),
                          ),
                          if (i['_changing'] == true)
                            const WaitingPill()
                          else
                            Pill(
                              status == 'paid'
                                  ? 'Paid · ${paymentLabels[i['payment_method']] ?? ''}'
                                  : status == 'void'
                                  ? 'Cancelled'
                                  : 'Unpaid',
                              tone: status == 'unpaid' ? PillTone.red : PillTone.grey,
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(formatRupees(i['total']), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -0.8)),
                      const SizedBox(height: 4),
                      Text('${i['customer_name']} · ${formatWhen(i['issued_at'])}', style: const TextStyle(color: Brand.muted)),
                      if (i['customer_phone'] != null) Text('${i['customer_phone']}', style: const TextStyle(color: Brand.muted)),
                    ],
                  ),
                ),
                const SectionLabel('Items'),
                Card(
                  child: Column(
                    children: [
                      for (final x in items)
                        ListTile(
                          title: Text('${x['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: '${x['staff_name'] ?? ''}'.isEmpty ? null : Text('by ${x['staff_name']}'),
                          trailing: Text(formatRupees(x['price']), style: const TextStyle(fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                if (status == 'unpaid' && i['_changing'] != true) ...[
                  FilledButton.icon(onPressed: pay, icon: const Icon(Icons.payments_outlined), label: const Text('Mark paid')),
                  const SizedBox(height: 10),
                ],
                if (status != 'void' && i['customer_phone'] != null)
                  OutlinedButton.icon(
                    onPressed: () {
                      app.counterAction(kind: 'send', label: 'Send ${i['number']} on WhatsApp', action: {'type': 'send_invoice', 'invoice_id': i['id']});
                      toast(context, app.online ? 'Sending the bill on WhatsApp.' : 'It will be sent when you are online.');
                    },
                    icon: const Icon(Icons.send_outlined),
                    label: const Text('Send on WhatsApp'),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
