import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// One bill: what was done, the total, and Mark paid / Send on WhatsApp.
class BillScreen extends StatelessWidget {
  const BillScreen({super.key, required this.invoiceId, this.invoicesKey = 'invoices'});
  final String invoiceId;

  /// Which list of bills it was opened from.
  final String invoicesKey;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, invoicesKey: invoicesKey);
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
                Text('Paid ${formatRupees(i['total'])} by', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
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

    num n(Object? v) => num.tryParse('${v ?? ''}') ?? 0;
    final itemsTotal = items.fold<num>(0, (sum, x) => sum + n(x['price']) * (n(x['quantity']) == 0 ? 1 : n(x['quantity'])));
    final subtotal = i['subtotal'] == null ? itemsTotal : n(i['subtotal']);
    final discount = n(i['discount']);
    final cgst = n(i['cgst']), sgst = n(i['sgst']), igst = n(i['igst']);
    final changing = i['_changing'] == true;
    final phone = '${i['customer_phone'] ?? ''}';
    final link = i['public_token'] == null ? null : '${AppConfig.apiBase}/i/${i['public_token']}';

    void send() {
      app.counterAction(kind: 'send', label: 'Send ${i['number']} on WhatsApp', action: {'type': 'send_invoice', 'invoice_id': i['id']});
      toast(context, app.online ? 'Sending the bill on WhatsApp.' : 'It will be sent when you are online.');
    }

    Future<void> cancel() async {
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: Text('Cancel bill ${i['number']}?'),
          content: const Text('It stays on record as cancelled and is left out of sales. This cannot be undone.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep it')),
            TextButton(
              onPressed: () => Navigator.pop(d, true),
              style: TextButton.styleFrom(foregroundColor: Brand.red),
              child: const Text('Cancel bill'),
            ),
          ],
        ),
      );
      if (ok != true) return;
      app.counterAction(kind: 'payment', label: 'Cancel bill ${i['number']}', action: {'type': 'void_invoice', 'invoice_id': i['id']});
      if (context.mounted) toast(context, app.online ? 'Bill cancelled.' : 'Cancelled. It syncs when you are online.');
    }

    final (statusText, statusBg, statusFg, statusIcon) = switch (status) {
      'paid' => ('Paid${paymentLabels[i['payment_method']] == null ? '' : ' · ${paymentLabels[i['payment_method']]}'}', Brand.bubble, const Color(0xFF15603E), Icons.check_circle),
      'void' => ('Cancelled', Brand.page, Brand.muted, Icons.block),
      _ => ('Not paid yet', Brand.redSoft, Brand.red, Icons.schedule),
    };

    Widget amountRow(String label, String value, {bool strong = false, Color? color}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: strong ? 16 : 14, fontWeight: strong ? FontWeight.w700 : FontWeight.w400, color: strong ? Brand.text : Brand.textSoft),
            ),
          ),
          Text(
            value,
            style: TextStyle(fontSize: strong ? 18 : 14, fontWeight: strong ? FontWeight.w700 : FontWeight.w600, color: color ?? Brand.text),
          ),
        ],
      ),
    );

    return Scaffold(
      appBar: AppBar(
        title: Text('${i['number']}'),
        actions: [
          if (link != null && status != 'void')
            IconButton(
              tooltip: 'Copy bill link',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: link));
                toast(context, 'Bill link copied. Paste it in any chat.');
              },
              icon: const Icon(Icons.link),
            ),
        ],
      ),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                // The bill, like a receipt
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: Brand.line),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        color: status == 'void' ? Brand.page : Brand.blue,
                        padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    desk.businessName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: status == 'void' ? Brand.textSoft : Colors.white),
                                  ),
                                ),
                                Text(
                                  desk.hasGst ? 'TAX INVOICE' : 'BILL',
                                  style: TextStyle(fontSize: 11, letterSpacing: 1.3, fontWeight: FontWeight.w700, color: status == 'void' ? Brand.muted : Colors.white70),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Text(
                              formatRupees(i['total']),
                              style: TextStyle(
                                fontSize: 36,
                                fontWeight: FontWeight.w700,
                                letterSpacing: -0.8,
                                color: status == 'void' ? Brand.muted : Colors.white,
                                decoration: status == 'void' ? TextDecoration.lineThrough : null,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(formatWhen(i['issued_at']), style: TextStyle(fontSize: 13.5, color: status == 'void' ? Brand.muted : Colors.white.withValues(alpha: 0.85))),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
                        child: Row(
                          children: [
                            if (changing)
                              const WaitingPill()
                            else
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(color: statusBg, borderRadius: BorderRadius.circular(20)),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(statusIcon, size: 15, color: statusFg),
                                    const SizedBox(width: 5),
                                    Text(
                                      statusText,
                                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: statusFg),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                      const Divider(height: 1),
                      // Customer
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 12, 8, 12),
                        child: Row(
                          children: [
                            Avatar('${i['customer_name'] ?? 'Customer'}', size: 40),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${i['customer_name'] ?? 'Customer'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
                                  ),
                                  Text(phone.isEmpty ? 'No phone number' : phone, style: const TextStyle(fontSize: 13, color: Brand.muted)),
                                ],
                              ),
                            ),
                            if (phone.isNotEmpty)
                              IconButton(
                                tooltip: 'Call',
                                onPressed: () => launchUrl(Uri.parse('tel:$phone')),
                                icon: const Icon(Icons.call_outlined, color: Brand.blue),
                              ),
                          ],
                        ),
                      ),
                      const Divider(height: 1),
                      // What was done
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 12, 18, 4),
                        child: Text(
                          '${items.length} item${items.length == 1 ? '' : 's'}',
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.muted),
                        ),
                      ),
                      for (final x in items)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 6, 18, 6),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${n(x['quantity']) > 1 ? '${n(x['quantity'])} × ' : ''}${x['name']}',
                                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, decoration: status == 'void' ? TextDecoration.lineThrough : null),
                                    ),
                                    if ('${x['staff_name'] ?? ''}'.isNotEmpty) Text('by ${x['staff_name']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 12),
                              Text(formatRupees(n(x['price']) * (n(x['quantity']) == 0 ? 1 : n(x['quantity']))), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      // Totals
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
                        child: Column(
                          children: [
                            const Divider(height: 12),
                            if (discount > 0 || cgst + sgst + igst > 0) amountRow('Subtotal', formatRupees(subtotal)),
                            if (discount > 0) amountRow('Discount', '− ${formatRupees(discount)}', color: const Color(0xFF15603E)),
                            if (cgst > 0) amountRow('CGST', formatRupees(cgst)),
                            if (sgst > 0) amountRow('SGST', formatRupees(sgst)),
                            if (igst > 0) amountRow('IGST', formatRupees(igst)),
                            amountRow('Total', formatRupees(i['total']), strong: true),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                if (status == 'void')
                  const Padding(
                    padding: EdgeInsets.fromLTRB(4, 12, 4, 0),
                    child: Text('This bill was cancelled. It stays on record but is not counted in sales.', style: TextStyle(color: Brand.muted, fontSize: 13)),
                  ),
                const SizedBox(height: 18),
                // What to do next: the main step first
                if (status == 'unpaid' && !changing) ...[FilledButton.icon(onPressed: pay, icon: const Icon(Icons.payments_outlined), label: const Text('Mark paid')), const SizedBox(height: 10)],
                if (status != 'void' && phone.isNotEmpty) ...[
                  status == 'unpaid'
                      ? OutlinedButton.icon(onPressed: send, icon: const Icon(Icons.send_outlined), label: const Text('Send on WhatsApp'))
                      : FilledButton.icon(onPressed: send, icon: const Icon(Icons.send_outlined), label: const Text('Send on WhatsApp')),
                  const SizedBox(height: 10),
                ],
                if (status != 'void' && link != null)
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: link));
                            toast(context, 'Bill link copied. Paste it in any chat.');
                          },
                          icon: const Icon(Icons.link, size: 19),
                          label: const Text('Copy link'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => SharePlus.instance.share(ShareParams(text: 'Your bill ${i['number']} from ${desk.businessName}: ${formatRupees(i['total'])}\n$link')),
                          icon: const Icon(Icons.share_outlined, size: 19),
                          label: const Text('Share'),
                        ),
                      ),
                    ],
                  ),
                if (status != 'void' && app.can('manage') && !changing) ...[
                  const SizedBox(height: 18),
                  Center(
                    child: TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: Brand.red),
                      onPressed: cancel,
                      icon: const Icon(Icons.block, size: 18),
                      label: const Text('Cancel this bill'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
