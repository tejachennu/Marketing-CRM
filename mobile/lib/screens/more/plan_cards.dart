import 'package:flutter/material.dart';

import '../../data/format.dart';
import '../../ui/theme.dart';

/// One plan, as on the web's plan picker: name, price, what it is for, what it includes (tap to see
/// all), and the button to move to it. [action] is null in store builds (plans are bought on the web).
class PlanCard extends StatelessWidget {
  const PlanCard({super.key, required this.plan, required this.current, required this.pending, required this.currentPrice, this.busy = false, this.onChoose});

  final Map plan;
  final bool current;
  final bool pending;
  final num currentPrice;
  final bool busy;
  final VoidCallback? onChoose;

  @override
  Widget build(BuildContext context) {
    final price = (plan['price'] as num?) ?? 0;
    final features = ((plan['features'] as List?) ?? const []).map((f) => '$f').toList();
    final label = current
        ? 'Your plan'
        : pending
        ? 'Starts on your bill date'
        : price > currentPrice
        ? 'Upgrade to ${plan['name']}'
        : 'Switch to ${plan['name']}';
    // A Material (not a decorated box) so the tile's tap ripple shows on the card's colour
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: current ? Brand.bubble : Colors.white,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: current ? Brand.blue : Brand.line, width: current ? 1.5 : 1),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.fromLTRB(14, 6, 10, 0),
            childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            title: Row(
              children: [
                Flexible(
                  child: Text('${plan['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                ),
                if (current) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(20)),
                    child: const Text(
                      'Current',
                      style: TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ],
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: formatRupees(price),
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.text),
                        ),
                        const TextSpan(
                          text: ' / month',
                          style: TextStyle(color: Brand.muted),
                        ),
                      ],
                    ),
                  ),
                  Text('${plan['tagline'] ?? ''}', style: const TextStyle(color: Brand.textSoft, fontSize: 13)),
                  if (plan['whatsapp'] == 'shared')
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'No WhatsApp setup needed',
                        style: TextStyle(color: Brand.textSoft, fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                ],
              ),
            ),
            children: [
              for (final f in features)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check, size: 17, color: Brand.blue),
                      const SizedBox(width: 8),
                      Expanded(child: Text(f, style: const TextStyle(fontSize: 13.5))),
                    ],
                  ),
                ),
              if (onChoose != null || current || pending)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: current || pending || busy ? null : onChoose,
                      child: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(label, textAlign: TextAlign.center),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The message wallet: booking messages from WAMA's number, paid at Meta's price.
class MessageWalletCard extends StatelessWidget {
  const MessageWalletCard({super.key, required this.balance, required this.price, required this.history, required this.options, this.busy = false, this.onTopup});

  final num balance;
  final num price;
  final List<Map> history;
  final List<num> options;
  final bool busy;
  final void Function(num amount)? onTopup;

  @override
  Widget build(BuildContext context) {
    final low = balance < 100;
    final left = price > 0 ? (balance / price).floor() : null;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Brand.line),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text("WhatsApp messages at Meta's price, no extra charge", style: TextStyle(color: Brand.textSoft, fontSize: 13)),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: low ? Brand.redSoft : Brand.page, borderRadius: BorderRadius.circular(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  formatRupees(balance),
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: low ? Brand.red : Brand.text),
                ),
                Text(
                  '${left != null ? 'About $left booking messages at ${formatRupees(price)} each.' : 'Booking messages are free right now.'}${low ? ' Top up so confirmations and reminders keep going out.' : ''}',
                  style: const TextStyle(color: Brand.textSoft, fontSize: 13),
                ),
              ],
            ),
          ),
          if (onTopup != null) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [for (final amount in options) OutlinedButton(onPressed: busy ? null : () => onTopup!(amount), child: Text('+ ${formatRupees(amount)}'))],
            ),
          ],
          const SizedBox(height: 8),
          const Text('A message that does not reach the customer is not charged.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          if (history.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text('Recent', style: TextStyle(fontWeight: FontWeight.w700)),
            for (final row in history.take(6))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        switch (row['kind']) {
                          'topup' => 'Top-up',
                          'refund' => 'Refund (not delivered)',
                          'adjustment' => 'Added by WAMA',
                          _ => 'Message sent',
                        },
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Brand.textSoft, fontSize: 13),
                      ),
                    ),
                    Text('${((row['amount'] as num?) ?? 0) < 0 ? '−' : '+'}${formatRupees(((row['amount'] as num?) ?? 0).abs())}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}
