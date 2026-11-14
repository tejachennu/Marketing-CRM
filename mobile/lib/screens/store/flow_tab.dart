import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart' show formatWhen;
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_logic.dart';
import 'store_screen.dart';

/// Go live (the web's Order flow tab): is the store ready, what to fix, what customers are sent at
/// each step, and how far each recent order got.
class FlowTab extends StatefulWidget {
  const FlowTab({super.key, required this.store});
  final StoreScreenState store;
  @override
  State<FlowTab> createState() => _FlowTabState();
}

class _FlowTabState extends State<FlowTab> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _meta;
  List<Map<String, dynamic>>? _orders;
  bool _checking = false;
  bool _enabling = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final q = {'organizationId': app.orgId};
    setState(() => _checking = true);
    Future<Map<String, dynamic>?> read(String path) => app.backend.get(path, q).then<Map<String, dynamic>?>((d) => d).catchError((Object e) => <String, dynamic>{'_error': plain(e)});
    final results = await Future.wait([read('/api/commerce/meta-detect'), read('/api/commerce/catalog'), read('/api/commerce/order-flow')]);
    if (!mounted) return;
    final meta = results[0]!, catalog = results[1]!, flow = results[2]!;
    setState(() {
      final catalogStatus = catalog['_error'] == null ? {'linked': catalog['linked'], 'linkedError': catalog['linkedError'], 'connected': catalog['connected']} : null;
      _meta = meta['_error'] != null
          ? {'connectionError': meta['_error']}
          : (meta['success'] == false ? {'connectionError': meta['connectionError'] ?? 'Meta could not be reached.'} : {...meta, 'catalogStatus': catalogStatus});
      _orders = [for (final o in (flow['orders'] as List? ?? const [])) Map<String, dynamic>.from(o as Map)];
      _checking = false;
    });
  }

  Future<void> _enableCart() async {
    setState(() => _enabling = true);
    try {
      await AppScope.read(context).ask('/api/commerce/meta-detect', {'action': 'enable_cart'});
      setState(
        () => _meta = {
          ...?_meta,
          'commerceSettings': {...?(_meta?['commerceSettings'] as Map?), 'is_cart_enabled': true, 'is_catalog_visible': true},
          'commerceSettingsError': null,
        },
      );
      if (mounted) toast(context, 'Cart and catalog are now on for your WhatsApp number.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _enabling = false);
    }
  }

  Future<void> _switchOn() async {
    try {
      await AppScope.read(context).ask('/api/organization', {
        'updates': {'enable_commerce': true},
      }, method: 'PATCH');
      widget.store.saved({'enable_commerce': true});
      if (mounted) toast(context, 'Store switched on: new carts become orders.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  Widget? _fix(GoLiveCheck check) {
    if (check.state == 'ok' || check.state == 'unknown' || check.fix == null) return null;
    final org = widget.store.org!;
    if (check.fix == 'enable_cart') return TextButton(onPressed: _enabling ? null : _enableCart, child: Text(_enabling ? 'Turning on…' : 'Turn on'));
    if (check.fix == 'settings') return TextButton(onPressed: () => openLink(context, 'https://wamacrm.magnetora.in/dashboard/settings'), child: const Text('Open on web'));
    if (check.fix == 'whatsapp_manager') return TextButton(onPressed: () => openLink(context, 'https://business.facebook.com/wa/manage/'), child: const Text('WhatsApp Manager'));
    if (check.id == 'store' && org['enable_commerce'] == false) return TextButton(onPressed: _switchOn, child: const Text('Switch on'));
    return TextButton(onPressed: () => DefaultTabController.of(context).animateTo(3), child: const Text('Store settings'));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final org = widget.store.org!;
    final checks = goLiveChecks(org, _meta);
    final ready = _meta != null && readyToSell(checks);
    final blocking = checks.where((c) => c.required && c.state == 'error').length;

    final total = formatMoney(499, org['currency']);
    const sample = 'ORD-XXXXXX-XXXX';
    final received = CheckoutText.received(sample, 1, total);
    final collectsAddress = '${org['commerce_address_flow_id'] ?? ''}'.trim().isNotEmpty;
    final step = paymentStep(org);
    final intro = collectsAddress ? 'Thanks, your delivery address is saved. Order #$sample total: $total.' : received;
    final (payText, payButtons) = switch (step) {
      'choice' => ('$intro\n\n${CheckoutText.askHowToPay(total)}', ['Pay online', 'Cash on Delivery']),
      'payment' => ('$intro\n\n${CheckoutText.payOnline}', ['Review and pay']),
      'cod' => ('$intro\n\n${CheckoutText.confirmCod(total)}', ['Confirm order']),
      _ => ('$intro\n\n${CheckoutText.acknowledge}', <String>[]),
    };
    final online = step == 'choice' || step == 'payment';
    final cod = step == 'choice' || step == 'cod';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(_meta == null ? Icons.hourglass_empty : (ready ? Icons.rocket_launch_outlined : Icons.error_outline), color: _meta == null ? Brand.muted : (ready ? Brand.blue : Brand.red)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _meta == null ? 'Checking your store with Meta…' : (ready ? 'Ready to take orders on WhatsApp' : '$blocking thing${blocking == 1 ? '' : 's'} to fix before you go live'),
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(onPressed: _checking ? null : _load, icon: const Icon(Icons.refresh), tooltip: 'Check again'),
                  ],
                ),
                Text(
                  ready ? 'Send a test cart from another phone to see the whole flow end to end.' : 'Each check reads your settings and what Meta reports for your WhatsApp account.',
                  style: const TextStyle(color: Brand.muted, fontSize: 13),
                ),
                const SizedBox(height: 8),
                for (var i = 0; i < checks.length; i++) _checkRow(i, checks[i]),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('How an order flows', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                Text('With your current settings, for a sample order of $total. These are the exact messages customers get.', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                const SizedBox(height: 12),
                _Step(
                  icon: Icons.shopping_cart_outlined,
                  title: '1. Customer sends a cart',
                  note: org['enable_ai'] != false && org['commerce_ai_assistant'] != false
                      ? 'They open your catalog in the chat, or just ask (“do you have…?”) and the AI shopping assistant replies with product cards. They add products and tap Send cart.'
                      : 'They open your catalog in the chat, add products and tap Send cart.',
                  bubbles: [_Bubble(customer: true, text: '🛒 1 item · $total')],
                ),
                _Step(
                  icon: Icons.inventory_2_outlined,
                  title: '2. The order is created and confirmed',
                  note: 'An order appears in Orders straight away, and the customer is answered in seconds.',
                  bubbles: [
                    collectsAddress ? _Bubble(text: '$received\n\n${CheckoutText.askAddress}', buttons: const ['Add address']) : _Bubble(text: payText, buttons: payButtons),
                  ],
                ),
                _Step(
                  icon: Icons.place_outlined,
                  title: '3. Delivery address',
                  off: !collectsAddress,
                  note: collectsAddress
                      ? 'Name, phone, address, city, state, PIN and standard or express delivery. Express adds its charge to the total.'
                      : 'Skipped: no address form is set in Store settings.',
                  bubbles: [
                    const _Bubble(customer: true, text: '📍 Address submitted'),
                    _Bubble(text: payText, buttons: payButtons),
                  ],
                ),
                _Step(
                  icon: Icons.account_balance_wallet_outlined,
                  title: '4. Payment',
                  note: switch (step) {
                    'choice' => 'The customer picks online payment or Cash on Delivery.',
                    'payment' => 'Online payment only: the customer pays by UPI or card inside WhatsApp.',
                    'cod' => 'Cash on Delivery only: one tap confirms the order.',
                    _ => 'No way to pay is set up: the customer is only told your team will call.',
                  },
                  bubbles: [
                    if (cod) ...[_Bubble(customer: true, text: step == 'choice' ? 'Cash on Delivery' : 'Confirm order'), _Bubble(text: CheckoutText.codConfirmed(sample, total))],
                    if (online) ...[
                      if (step == 'choice') ...[
                        const _Bubble(customer: true, text: 'Pay online'),
                        _Bubble(text: 'Order #$sample: $total.\n\n${CheckoutText.payOnline}', buttons: const ['Review and pay']),
                      ],
                      const _Bubble(customer: true, text: '💳 Paid by UPI'),
                      _Bubble(text: CheckoutText.paid(total, sample)),
                    ],
                  ],
                ),
                const _Step(
                  icon: Icons.local_shipping_outlined,
                  title: '5. Your team ships it',
                  last: true,
                  note: 'Orders → To ship → Mark as shipped (with courier and tracking), then Mark as delivered. The customer is messaged at each step. For Cash on Delivery, Mark as paid once the cash is collected.',
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Recent orders', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const Text('What each customer was sent, so you can see where a checkout stopped.', style: TextStyle(color: Brand.muted, fontSize: 13)),
                const SizedBox(height: 10),
                if (_orders == null)
                  const Center(child: CircularProgressIndicator())
                else if (_orders!.isEmpty)
                  const Text(
                    'No orders yet. From another phone, open your WhatsApp chat, tap the shop icon, add a product and send the cart. It will show here within seconds.',
                    style: TextStyle(color: Brand.muted),
                  )
                else
                  for (final order in _orders!) _recent(order),
              ],
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'In-chat online payment works for businesses in India, in rupees, with a payment setup in WhatsApp Manager → Payments (Razorpay, PayU, BillDesk or Zaakpay).',
            style: TextStyle(color: Brand.muted, fontSize: 12.5),
          ),
        ],
      ),
    );
  }

  Widget _checkRow(int index, GoLiveCheck check) {
    final (icon, color) = switch (check.state) {
      'ok' => (Icons.check_circle, Brand.blue),
      'warning' => (Icons.warning_amber_rounded, const Color(0xFFB7791F)),
      'error' => (Icons.cancel, Brand.red),
      'skipped' => (Icons.remove_circle_outline, Brand.faint),
      _ => (Icons.hourglass_empty, Brand.faint),
    };
    final fix = _fix(check);
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${index + 1}. ${check.title}${check.required ? '' : ' (optional)'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(check.detail, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                ?fix,
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _recent(Map<String, dynamic> order) {
    final trail = [for (final t in (order['trail'] as List? ?? const [])) Map<String, dynamic>.from(t as Map)];
    final replies = trail.where((t) => t['sender_type'] == 'user');
    final delivered = replies.any((t) => t['status'] != 'failed');
    final failure = replies.where((t) => t['status'] == 'failed').firstOrNull;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Brand.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('#${order['order_number']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(
                      '${customerName(order)} · ${formatMoney(order['total_amount'], order['currency'])} · ${formatWhen('${order['created_at']}')}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Brand.muted, fontSize: 12.5),
                    ),
                  ],
                ),
              ),
              StatusPill(order['status']),
            ],
          ),
          const SizedBox(height: 6),
          for (final entry in trail)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    entry['sender_type'] == 'contact' ? Icons.shopping_cart_outlined : (entry['status'] == 'failed' ? Icons.cancel_outlined : Icons.check_circle_outline),
                    size: 16,
                    color: entry['sender_type'] == 'contact' ? Brand.faint : (entry['status'] == 'failed' ? Brand.red : Brand.blue),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '${'${entry['body']}'.replaceAll(RegExp(r'^\[|\]$'), '')}${entry['status'] == 'failed' && entry['error_message'] != null ? '\n${entry['error_message']}' : ''}',
                      style: TextStyle(fontSize: 12.5, color: entry['status'] == 'failed' ? Brand.red : Brand.textSoft),
                    ),
                  ),
                ],
              ),
            ),
          if (!delivered)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: NoteBox(
                attention: true,
                icon: Icons.error_outline,
                text: failure != null
                    ? 'No checkout message reached this customer. Fix the reason above, then open the order and use “Send reminder”.'
                    : 'No checkout message was recorded for this order. It came in while the store was set up differently, or before this was tracked.',
              ),
            ),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.icon, required this.title, required this.note, this.bubbles = const [], this.off = false, this.last = false});
  final IconData icon;
  final String title, note;
  final List<Widget> bubbles;
  final bool off, last;
  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: last ? 0 : 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: off ? Brand.lineSoft : Brand.blueSoft, borderRadius: BorderRadius.circular(10)),
          child: Icon(icon, size: 18, color: off ? Brand.faint : Brand.blue),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(fontWeight: FontWeight.w700, color: off ? Brand.faint : Brand.text, decoration: off ? TextDecoration.lineThrough : null),
              ),
              Text(note, style: const TextStyle(color: Brand.muted, fontSize: 13)),
              if (bubbles.isNotEmpty && !off)
                Container(
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Brand.chatBg, borderRadius: BorderRadius.circular(12)),
                  child: Column(children: bubbles),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.text, this.customer = false, this.buttons = const []});
  final String text;
  final bool customer;
  final List<String> buttons;
  @override
  Widget build(BuildContext context) => Align(
    alignment: customer ? Alignment.centerRight : Alignment.centerLeft,
    child: Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      constraints: const BoxConstraints(maxWidth: 320),
      decoration: BoxDecoration(color: customer ? Brand.bubble : Colors.white, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
            child: Text(text, style: const TextStyle(fontSize: 13.5, height: 1.3)),
          ),
          for (final b in buttons) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 7),
              child: Text(
                b,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Brand.blue, fontWeight: FontWeight.w600, fontSize: 13.5),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
