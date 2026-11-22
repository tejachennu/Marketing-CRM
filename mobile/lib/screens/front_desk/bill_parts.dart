import 'package:flutter/material.dart';

import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// The pieces of the billing screens (New bill, and the bill after a visit): numbered step cards, how they paid as
/// big tiles, and a receipt-like summary before the button.

/// One step of the bill on a white card: a number, a title, an optional line under it, then the content.
class BillStep extends StatelessWidget {
  const BillStep({super.key, required this.number, required this.title, required this.child, this.hint, this.trailing});
  final int number;
  final String title;
  final String? hint;
  final Widget? trailing;
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: Brand.blueSoft, shape: BoxShape.circle),
              child: Text('$number', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.blue)),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
            ?trailing,
          ],
        ),
        if (hint != null) Padding(padding: const EdgeInsets.only(left: 36, top: 2), child: Text(hint!, style: const TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.3))),
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}

/// How they paid: four big tiles (Cash, UPI, Card, Pay later). null = pay later.
class PaymentTiles extends StatelessWidget {
  const PaymentTiles({super.key, required this.value, required this.onChanged});
  final String? value;
  final ValueChanged<String?> onChanged;
  @override
  Widget build(BuildContext context) {
    const options = [('cash', 'Cash', Icons.payments_outlined), ('upi', 'UPI', Icons.qr_code_2), ('card', 'Card', Icons.credit_card), (null, 'Pay later', Icons.schedule)];
    return Row(
      children: [
        for (var i = 0; i < options.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: _tile(options[i].$1, options[i].$2, options[i].$3)),
        ],
      ],
    );
  }

  Widget _tile(String? key, String label, IconData icon) {
    final on = value == key;
    return Material(
      color: on ? Brand.bubble : Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onChanged(key),
        child: Container(
          height: 72,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: on ? Brand.blue : Brand.border, width: on ? 1.6 : 1)),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: on ? Brand.blue : Brand.textSoft, size: 24),
              const SizedBox(height: 4),
              FittedBox(fit: BoxFit.scaleDown, child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: on ? const Color(0xFF15603E) : Brand.textSoft))),
            ],
          ),
        ),
      ),
    );
  }
}

/// The bill as it will be: each service with who did it and its price, then subtotal, discount, GST and the total.
class BillSummary extends StatelessWidget {
  const BillSummary({super.key, required this.desk, required this.lines, required this.who, required this.discount, required this.total});
  final FrontDesk desk;

  /// The services on the bill (name, price)
  final List<Map<String, dynamic>> lines;

  /// Who did each line (same order), null = anyone
  final List<String?> who;
  final Map<String, num>? discount;
  final num total;

  @override
  Widget build(BuildContext context) {
    final subtotal = lines.fold<num>(0, (t, s) => t + (num.tryParse('${s['price'] ?? 0}') ?? 0));
    final off = discount == null ? 0 : (discount!['type'] == 1 ? discount!['value']! : subtotal * discount!['value']! / 100);
    final gst = total - (subtotal - off);
    Widget line(String a, String b, {bool bold = false, Color? color}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(a, style: TextStyle(fontSize: bold ? 16 : 14, fontWeight: bold ? FontWeight.w700 : FontWeight.w500, color: color ?? Brand.text))),
          Text(b, style: TextStyle(fontSize: bold ? 18 : 14, fontWeight: bold ? FontWeight.w700 : FontWeight.w600, color: color ?? Brand.text)),
        ],
      ),
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.receipt_long_outlined, size: 20, color: Brand.blue),
              SizedBox(width: 8),
              Text('Bill summary', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 10),
          if (lines.isEmpty) const Text('Choose services to see the bill.', style: TextStyle(color: Brand.muted)),
          for (var i = 0; i < lines.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${lines[i]['name'] ?? 'Service'}', style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                        if (i < who.length && who[i] != null) Text('by ${desk.staffName(who[i])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                      ],
                    ),
                  ),
                  Text(formatRupees(lines[i]['price']), style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          if (lines.isNotEmpty) ...[
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider(height: 1)),
            line('Subtotal', formatRupees(subtotal)),
            if (off > 0) line(discount!['type'] == 1 ? 'Discount' : 'Discount (${discount!['value']}%)', '− ${formatRupees(off)}', color: Brand.blue),
            if (desk.hasGst && !desk.pricesIncludeTax && gst > 0.5) line('GST', formatRupees(gst)),
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider(height: 1)),
            line('Total', formatRupees(total), bold: true),
            if (desk.hasGst && desk.pricesIncludeTax) const Text('Prices include GST', style: TextStyle(fontSize: 12, color: Brand.muted)),
          ],
        ],
      ),
    );
  }
}

/// The bottom bar of a bill: what it comes to, and the button.
class BillBar extends StatelessWidget {
  const BillBar({super.key, required this.count, required this.total, required this.label, required this.onPressed, this.icon = Icons.receipt_long});
  final int count;
  final num total;
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Brand.line)),
        boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, -2))],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$count service${count == 1 ? '' : 's'} · total', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(formatRupees(total), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4)),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 22), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
            onPressed: onPressed,
            icon: Icon(icon),
            label: Text(label, style: const TextStyle(fontSize: 16)),
          ),
        ],
      ),
    ),
  );
}

/// The send-on-WhatsApp switch as a row inside a step.
class WhatsAppSwitch extends StatelessWidget {
  const WhatsAppSwitch({super.key, required this.value, required this.onChanged, required this.note});
  final bool value;
  final ValueChanged<bool> onChanged;
  final String note;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
    child: SwitchListTile(
      value: value,
      onChanged: onChanged,
      activeThumbColor: Colors.white,
      activeTrackColor: Brand.blue,
      secondary: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(11)),
        child: const Icon(Icons.chat_outlined, color: Brand.blue, size: 21),
      ),
      title: const Text('Send the bill on WhatsApp', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
      subtitle: Text(note, style: const TextStyle(fontSize: 12.5)),
    ),
  );
}

/// A small person picker for one line: "Anitha ▾" (or "Anyone ▾"); opens the team list.
class PersonPill extends StatelessWidget {
  const PersonPill({super.key, required this.desk, required this.people, required this.value, required this.onChanged});
  final FrontDesk desk;
  final List<Map<String, dynamic>> people;
  final String? value;
  final ValueChanged<String?> onChanged;
  @override
  Widget build(BuildContext context) {
    final name = value == null ? 'Anyone' : desk.staffName(value);
    return Material(
      color: value == null ? Colors.white : Brand.bubble,
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () async {
          final picked = await showModalBottomSheet<String>(
            context: context,
            showDragHandle: true,
            builder: (context) => SafeArea(
              child: ListView(
                shrinkWrap: true,
                children: [
                  const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Who did it?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
                  ListTile(
                    leading: const CircleAvatar(backgroundColor: Brand.lineSoft, child: Icon(Icons.groups_outlined, color: Brand.textSoft)),
                    title: const Text('Anyone'),
                    trailing: value == null ? const Icon(Icons.check, color: Brand.blue) : null,
                    onTap: () => Navigator.pop(context, ''),
                  ),
                  for (final m in people)
                    ListTile(
                      leading: Avatar('${m['name']}', size: 40),
                      title: Text('${m['name']}'),
                      trailing: value == m['id'] ? const Icon(Icons.check, color: Brand.blue) : null,
                      onTap: () => Navigator.pop(context, '${m['id']}'),
                    ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          );
          if (picked == null) return;
          onChanged(picked.isEmpty ? null : picked);
        },
        child: Container(
          padding: const EdgeInsets.fromLTRB(6, 4, 8, 4),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), border: Border.all(color: value == null ? Brand.border : Brand.blue)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              value == null ? const Icon(Icons.person_outline, size: 20, color: Brand.muted) : Avatar(name, size: 22),
              const SizedBox(width: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 110),
                child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: value == null ? Brand.textSoft : const Color(0xFF15603E))),
              ),
              const Icon(Icons.arrow_drop_down, size: 20, color: Brand.muted),
            ],
          ),
        ),
      ),
    );
  }
}
