import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/app_state.dart';
import '../../data/format.dart' show formatWhen;
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../chats/chat_screen.dart';
import 'flow_tab.dart';
import 'products_tab.dart';
import 'store_logic.dart';
import 'store_settings.dart';

/// E-commerce, as on the web's Commerce page: Orders, Products, Go live (order flow) and Store
/// settings, with the store's totals and the set-up checklist. Same APIs as the web.
class StoreScreen extends StatefulWidget {
  const StoreScreen({super.key, this.initialTab = 0, this.asTab = false});
  final int initialTab;

  /// Shown as a bottom-bar tab (no back arrow).
  final bool asTab;
  @override
  State<StoreScreen> createState() => StoreScreenState();
}

class StoreScreenState extends State<StoreScreen> {
  Map<String, dynamic>? org;
  String error = '';
  Map<String, dynamic>? summary;
  int? productCount;

  @override
  void initState() {
    super.initState();
    unawaited(loadOrg());
  }

  Future<void> loadOrg() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/organization', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(() {
        org = Map<String, dynamic>.from(data['organization'] as Map? ?? const {});
        error = '';
      });
      final products = await app.backend.get('/api/commerce/products', {'organizationId': app.orgId, 'limit': '1'});
      if (mounted) setState(() => productCount = ((products['pagination'] as Map?)?['total'] as num?)?.toInt());
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  /// Settings saved in a tab: the checklist and the other tabs see them at once.
  void saved(Map<String, dynamic> changes) => setState(() => org = {...?org, ...changes});
  void setSummary(Map<String, dynamic> value) => setState(() => summary = value);
  void setProductCount(int value) => setState(() => productCount = value);

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final manage = app.can('manage');
    final org = this.org;
    final tabs = [
      Tab(text: 'Orders${summary != null ? ' ${summary!['total']}' : ''}'),
      Tab(text: 'Products${productCount != null ? ' $productCount' : ''}'),
      if (manage) const Tab(text: 'Go live'),
      if (manage) const Tab(text: 'Store'),
    ];
    return DefaultTabController(
      length: tabs.length,
      initialIndex: widget.initialTab.clamp(0, tabs.length - 1),
      child: Scaffold(
        backgroundColor: Brand.page,
        appBar: AppBar(
          automaticallyImplyLeading: !widget.asTab,
          title: const Text('E-commerce'),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelColor: Brand.blue,
            unselectedLabelColor: Brand.muted,
            indicatorColor: Brand.blue,
            labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            tabs: tabs,
          ),
        ),
        body: org == null
            ? Center(
                child: error.isEmpty
                    ? const CircularProgressIndicator()
                    : EmptyState(
                        icon: Icons.storefront_outlined,
                        title: 'The store could not be loaded',
                        text: error,
                        action: FilledButton(onPressed: loadOrg, child: const Text('Try again')),
                      ),
              )
            : TabBarView(
                children: [
                  OrdersTab(store: this),
                  ProductsTab(store: this),
                  if (manage) FlowTab(store: this),
                  if (manage) StoreSettingsTab(store: this),
                ],
              ),
      ),
    );
  }
}

/// The checklist and the store-off note, above the Orders list until the store can take orders.
class StoreNotes extends StatelessWidget {
  const StoreNotes({super.key, required this.store});
  final StoreScreenState store;
  @override
  Widget build(BuildContext context) {
    final org = store.org!;
    final setup = StoreSetup(org);
    final manage = AppScope.of(context).can('manage');
    final storeOff = org['enable_commerce'] == false && (setup.catalogLinked || setup.paymentGateway || setup.addressFlow);
    final steps = [
      (setup.whatsappConnected, 'Connect WhatsApp', 'Needed to receive orders and message customers. On the web: Settings.'),
      (setup.catalogLinked, 'Link your Meta catalog', 'Lets customers add products to a cart in WhatsApp.'),
      (setup.paymentGateway || setup.cashOnDelivery, 'Choose how customers pay', 'An in-chat payment gateway, Cash on Delivery, or both.'),
      (setup.addressFlow, 'Collect delivery addresses (optional)', 'Sends an address form after each order.'),
    ];
    return Column(
      children: [
        if (storeOff)
          NoteBox(
            attention: true,
            icon: Icons.pause_circle_outline,
            text: 'Your store is switched off. Carts that customers send on WhatsApp are not turned into orders.${manage ? ' Switch it on in the Store tab.' : ''}',
          ),
        if (!setup.complete)
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Finish setting up your store', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text('Customers can order once the first three steps are done.${manage ? '' : ' An admin or manager can complete them.'}', style: const TextStyle(color: Brand.muted, fontSize: 13.5)),
                const SizedBox(height: 10),
                for (final (done, title, detail) in steps)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, size: 20, color: done ? Brand.blue : Brand.border),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: TextStyle(fontWeight: FontWeight.w600, color: done ? Brand.muted : Brand.text, decoration: done ? TextDecoration.lineThrough : null),
                              ),
                              if (!done) Text(detail, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

// ── Small shared pieces ──

/// A coloured note: grey for information, red for something that needs attention.
class NoteBox extends StatelessWidget {
  const NoteBox({super.key, required this.text, this.icon = Icons.info_outline, this.attention = false, this.action});
  final String text;
  final IconData icon;
  final bool attention;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: attention ? Brand.redSoft : Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: attention ? const Color(0xFFF5C9C9) : Brand.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: attention ? Brand.red : Brand.textSoft),
            const SizedBox(width: 8),
            Expanded(
              child: Text(text, style: TextStyle(fontSize: 13.5, height: 1.35, color: attention ? Brand.red : Brand.textSoft)),
            ),
          ],
        ),
        if (action != null) ...[const SizedBox(height: 8), Align(alignment: Alignment.centerRight, child: action)],
      ],
    ),
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final Object? status;
  @override
  Widget build(BuildContext context) {
    final tone = switch ('$status') {
      'paid' || 'cod_confirmed' || 'shipped' => PillTone.blue,
      'awaiting_address' || 'payment_pending' || 'cart_submitted' => PillTone.navy,
      _ => PillTone.grey,
    };
    return Pill(statusLabel(status), tone: tone);
  }
}

/// A second label, only when the payment needs someone's attention.
Widget? paymentFlag(Map order) {
  if (needsRefund(order)) return const Pill('Refund due', tone: PillTone.red);
  if (order['payment_status'] == 'refunded') return const Pill('Refunded');
  if (order['payment_status'] == 'failed' && order['status'] != 'canceled') return const Pill('Payment failed', tone: PillTone.red);
  return null;
}

Future<bool> confirmAction(BuildContext context, {required String title, required String message, required String yes, String no = 'Cancel', bool destructive = false}) async =>
    await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: Text(no)),
          FilledButton(
            style: destructive ? FilledButton.styleFrom(backgroundColor: Brand.red) : null,
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(yes),
          ),
        ],
      ),
    ) ==
    true;

Future<void> showMessage(BuildContext context, String title, String message) => showDialog<void>(
  context: context,
  builder: (dialog) => AlertDialog(
    title: Text(title),
    content: SingleChildScrollView(child: Text(message)),
    actions: [TextButton(onPressed: () => Navigator.pop(dialog), child: const Text('OK'))],
  ),
);

Future<void> openLink(BuildContext context, String url) async {
  final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
  if (!ok && context.mounted) toast(context, 'Could not open $url');
}

String plain(Object e) => '$e'.replaceFirst('Exception: ', '');

/// A product photo from the catalog, or a bag when there is none.
class ProductImage extends StatelessWidget {
  const ProductImage(this.url, {super.key, this.size = 48, this.faded = false});
  final Object? url;
  final double size;
  final bool faded;
  @override
  Widget build(BuildContext context) {
    final link = '${url ?? ''}';
    final fallback = Container(
      width: size,
      height: size,
      color: Brand.lineSoft,
      child: Icon(Icons.shopping_bag_outlined, color: Brand.faint, size: size * 0.45),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: link.startsWith('http')
          ? Opacity(
              opacity: faded ? 0.5 : 1,
              child: Image.network(link, width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, _, _) => fallback),
            )
          : fallback,
    );
  }
}

// ── Orders ──

class OrdersTab extends StatefulWidget {
  const OrdersTab({super.key, required this.store});
  final StoreScreenState store;
  @override
  State<OrdersTab> createState() => _OrdersTabState();
}

class _OrdersTabState extends State<OrdersTab> with AutomaticKeepAliveClientMixin {
  static const pageSize = 25;
  String _view = 'all';
  String _search = '';
  Timer? _debounce;
  Timer? _refresh;
  List<Map<String, dynamic>>? _orders;
  int _page = 1;
  int _pages = 1;
  int _total = 0;
  bool _loading = false;
  String _error = '';
  int _ask = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load(1);
    // New carts and payments arrive from WhatsApp at any time: look again every 30 seconds
    _refresh = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted && !_loading) _load(_page, silent: true);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _load(int page, {bool silent = false}) async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    if (!silent) setState(() => _loading = true);
    try {
      final data = await app.backend.get('/api/commerce/orders', {'organizationId': app.orgId, 'view': _view, 'page': '$page', 'limit': '$pageSize', if (_search.isNotEmpty) 'search': _search});
      if (!mounted || ask != _ask) return;
      final pagination = (data['pagination'] as Map?) ?? const {};
      setState(() {
        _orders = [for (final o in (data['orders'] as List? ?? const [])) Map<String, dynamic>.from(o as Map)];
        _page = page;
        _pages = (pagination['pages'] as num?)?.toInt() ?? 1;
        _total = (pagination['total'] as num?)?.toInt() ?? 0;
        _error = '';
      });
      if (data['summary'] is Map) widget.store.setSummary(Map<String, dynamic>.from(data['summary'] as Map));
    } catch (e) {
      if (mounted && ask == _ask && !silent) setState(() => _error = plain(e));
    } finally {
      if (mounted && ask == _ask) setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> order) async {
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => OrderScreen(order: order, collectsAddress: StoreSetup(widget.store.org!).addressFlow),
      ),
    );
    if (changed == true && mounted) await _load(_page, silent: true);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final summary = widget.store.summary;
    final orders = _orders;
    final revenue = (summary?['revenue'] as List? ?? const []);
    final currency = '${widget.store.org?['currency'] ?? 'INR'}';
    Widget tile(String label, String value, String note, IconData icon, {bool attention = false}) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Brand.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                  ),
                ),
                Icon(icon, size: 16, color: Brand.blue),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            ),
            Text(
              note,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, color: attention ? Brand.red : Brand.muted),
            ),
          ],
        ),
      ),
    );
    final refundDue = (summary?['refundDue'] as num?)?.toInt() ?? 0;
    return RefreshIndicator(
      onRefresh: () async {
        await widget.store.loadOrg();
        await _load(_page);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
        children: [
          StoreNotes(store: widget.store),
          Row(
            children: [
              tile(
                'Revenue received',
                summary == null ? '—' : formatMoney(revenue.isEmpty ? 0 : revenue.first['amount'], revenue.isEmpty ? currency : revenue.first['currency']),
                revenue.length > 1 ? 'Also ${revenue.skip(1).map((r) => formatMoney(r['amount'], r['currency'])).join(', ')}' : 'Paid orders, not canceled',
                Icons.account_balance_wallet_outlined,
              ),
              const SizedBox(width: 8),
              tile('Orders', '${summary?['total'] ?? '—'}', 'Carts received on WhatsApp', Icons.inventory_2_outlined),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              tile('Awaiting customer', '${summary?['awaiting'] ?? '—'}', 'Address or payment not done', Icons.schedule),
              const SizedBox(width: 8),
              tile(
                'To ship',
                '${summary?['toShip'] ?? '—'}',
                refundDue > 0 ? '$refundDue canceled after payment: refund due' : 'Paid or COD confirmed',
                Icons.local_shipping_outlined,
                attention: refundDue > 0,
              ),
            ],
          ),
          SearchField(
            hint: 'Order number, name or phone',
            padding: const EdgeInsets.fromLTRB(0, 12, 0, 4),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () {
                _search = v.trim();
                _load(1);
              });
            },
          ),
          FilterChips(
            padding: const EdgeInsets.symmetric(vertical: 6),
            children: [
              for (final (id, label, key) in orderViews)
                ChoiceChip(
                  label: Text(summary == null ? label : '$label ${summary[key] ?? 0}'),
                  selected: _view == id,
                  onSelected: (_) {
                    setState(() => _view = id);
                    _load(1);
                  },
                ),
            ],
          ),
          if (_error.isNotEmpty)
            NoteBox(
              attention: true,
              icon: Icons.error_outline,
              text: 'Orders could not be loaded: $_error',
              action: TextButton(onPressed: () => _load(_page), child: const Text('Try again')),
            ),
          if (orders == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (orders.isEmpty)
            EmptyState(
              icon: Icons.inventory_2_outlined,
              title: _view != 'all' || _search.isNotEmpty ? 'No orders match this view' : 'No orders yet',
              text: _view != 'all' || _search.isNotEmpty ? 'Try a different filter or search.' : 'When a customer sends a cart from your WhatsApp catalog, the order appears here on its own.',
            )
          else
            Card(
              child: Column(
                children: [
                  for (var i = 0; i < orders.length; i++) ...[if (i > 0) const Divider(height: 1, indent: 16), _OrderRow(order: orders[i], onTap: () => _open(orders[i]))],
                ],
              ),
            ),
          if (_pages > 1)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Page $_page of $_pages · $_total orders', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                  ),
                  IconButton(onPressed: _page > 1 && !_loading ? () => _load(_page - 1) : null, icon: const Icon(Icons.chevron_left)),
                  IconButton(onPressed: _page < _pages && !_loading ? () => _load(_page + 1) : null, icon: const Icon(Icons.chevron_right)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order, required this.onTap});
  final Map<String, dynamic> order;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final flag = paymentFlag(order);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('#${order['order_number']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                ),
                Text(formatWhen('${order['created_at']}'), style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                Expanded(
                  child: Text(
                    customerName(order),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Brand.textSoft),
                  ),
                ),
                Text(formatMoney(order['total_amount'], order['currency']), style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              itemSummary(order),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, color: Brand.muted),
            ),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, children: [StatusPill(order['status']), ?flag]),
          ],
        ),
      ),
    );
  }
}

/// One order: customer, items and totals, payment, delivery, and the next steps (as the web's side panel).
class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.order, required this.collectsAddress});
  final Map<String, dynamic> order;
  final bool collectsAddress;
  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  late Map<String, dynamic> _order = widget.order;
  bool _notify = true;
  String? _busy;
  bool _changed = false;
  late final _carrier = TextEditingController(text: '${(_order['shipping_address'] as Map?)?['carrier'] ?? ''}');
  late final _tracking = TextEditingController(text: '${(_order['shipping_address'] as Map?)?['tracking_number'] ?? ''}');

  Map get _address => (_order['shipping_address'] as Map?) ?? const {};

  @override
  void dispose() {
    _carrier.dispose();
    _tracking.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>?> _patch(Map<String, dynamic> changes, String action) async {
    final app = AppScope.read(context);
    setState(() => _busy = action);
    try {
      final data = await app.ask('/api/commerce/orders', {'orderId': _order['id'], ...changes}, method: 'PATCH');
      if (data['order'] is Map) setState(() => _order = {..._order, ...Map<String, dynamic>.from(data['order'] as Map)});
      _changed = true;
      return data;
    } catch (e) {
      if (mounted) toast(context, plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _setStatus(String status) async {
    final total = formatMoney(_order['total_amount'], _order['currency']);
    final number = _order['order_number'];
    if (status == 'canceled') {
      final ok = await confirmAction(
        context,
        title: 'Cancel order #$number?',
        message: _order['payment_status'] == 'paid'
            ? 'This order is already paid. Canceling it here does not return the money: refund $total through your payment provider afterwards.'
            : hasPaymentRequest(_order)
            ? 'The payment request in the customer\'s chat is withdrawn too, so they can no longer pay for it. A canceled order cannot be reopened.'
            : 'A canceled order cannot be reopened.',
        yes: 'Cancel order',
        no: 'Keep order',
        destructive: true,
      );
      if (!ok) return;
    }
    if (status == 'paid' && mounted) {
      final ok = await confirmAction(
        context,
        title: 'Mark #$number as paid?',
        message: 'Only do this if you have received $total outside WhatsApp (bank transfer, cash, a payment link). Payments made in the chat are recorded on their own.',
        yes: 'Yes, it is paid',
      );
      if (!ok) return;
    }
    final data = await _patch({
      'status': status,
      'notifyCustomer': _notify,
      if (status == 'shipped') ...{'trackingNumber': _tracking.text.trim(), 'carrier': _carrier.text.trim()},
    }, status);
    if (data == null || !mounted) return;
    final label = statusLabel(status);
    final withdrawn = status == 'canceled' && data['paymentRequestCanceled'] == true ? ' The payment request in their chat was withdrawn.' : '';
    if (!_notify) {
      toast(context, 'Order #$number is now “$label”.$withdrawn');
    } else if (data['notified'] == true) {
      toast(context, 'Order #$number is now “$label”. The customer was told on WhatsApp.$withdrawn');
    } else {
      await showMessage(context, 'Customer not told', 'Order #$number is now “$label”, but the customer was not told: ${data['notifyError'] ?? 'WhatsApp did not accept the message.'}');
    }
  }

  Future<void> _remind() async {
    final app = AppScope.read(context);
    setState(() => _busy = 'remind');
    try {
      final data = await app.ask('/api/commerce/orders', {'orderId': _order['id'], 'action': 'remind'});
      if (data['order'] is Map) setState(() => _order = {..._order, ...Map<String, dynamic>.from(data['order'] as Map)});
      if (mounted) toast(context, 'Reminder sent: the customer got ${reminderSent[data['step']] ?? 'the next step'}.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _refunded() async {
    final ok = await confirmAction(
      context,
      title: 'Mark as refunded?',
      message:
          'Confirm that ${formatMoney(_order['total_amount'], _order['currency'])} has gone back to the customer through your payment provider. This only records it here; it does not move any money.',
      yes: 'Yes, it is refunded',
    );
    if (!ok) return;
    final data = await _patch({'paymentStatus': 'refunded'}, 'refund');
    if (data != null && mounted) toast(context, 'Order #${_order['order_number']} is marked as refunded.');
  }

  void _openChat() {
    final app = AppScope.read(context);
    final id = _order['conversation_id'];
    final list = (app.cached('conversations')?['conversations'] as List? ?? const []);
    final found = list.cast<Map?>().firstWhere((c) => c!['id'] == id, orElse: () => null);
    final contact = (_order['contact'] as Map?) ?? const {};
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          conversation: found != null
              ? Map<String, dynamic>.from(found)
              : {
                  'id': id,
                  'contact': {'id': _order['contact_id'], ...contact},
                },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final order = _order;
    final currency = order['currency'];
    final items = (order['items'] as List? ?? const []);
    final next = nextStatuses(order['status']);
    final isOpen = openCheckoutStatuses.contains(order['status']);
    final isToShip = toShipStatuses.contains(order['status']);
    final (payText, payAttention) = paymentLabel(order);
    final address = _address;
    final hasAddress = '${address['address_line_1'] ?? ''}'.trim().isNotEmpty;
    final waitingOn = widget.collectsAddress && !hasAddress ? 'their delivery address' : 'payment';
    final trackingChanged = _tracking.text.trim() != '${address['tracking_number'] ?? ''}' || _carrier.text.trim() != '${address['carrier'] ?? ''}';
    final flag = paymentFlag(order);
    final canEdit = app.can('write');
    Widget section(String title, List<Widget> children, {Widget? trailing}) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.muted),
                  ),
                ),
                ?trailing,
              ],
            ),
            const SizedBox(height: 6),
            ...children,
          ],
        ),
      ),
    );
    Widget line(String label, String value, {bool bold = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: bold ? Brand.text : Brand.textSoft, fontWeight: bold ? FontWeight.w700 : FontWeight.w400),
            ),
          ),
          Text(value, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500)),
        ],
      ),
    );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: Scaffold(
        appBar: AppBar(title: Text('Order #${order['order_number']}')),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 10, left: 4),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  StatusPill(order['status']),
                  ?flag,
                  Text(formatWhen('${order['created_at']}'), style: const TextStyle(color: Brand.muted, fontSize: 13)),
                ],
              ),
            ),
            if (needsRefund(order))
              NoteBox(
                attention: true,
                icon: Icons.error_outline,
                text: 'Refund ${formatMoney(order['total_amount'], currency)}. The customer paid for this order and it was canceled. Return the money through your payment provider.',
                action: canEdit ? OutlinedButton(onPressed: _busy != null ? null : _refunded, child: const Text('I have refunded it')) : null,
              ),
            section('Customer', [
              Text(customerName(order), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              Text('${(order['contact'] as Map?)?['phone_number'] ?? 'No phone number'}', style: const TextStyle(color: Brand.muted)),
              if ('${order['customer_note'] ?? ''}'.trim().isNotEmpty) ...[
                const SizedBox(height: 6),
                Text('Note with the cart: “${order['customer_note']}”', style: const TextStyle(color: Brand.textSoft)),
              ],
              if (order['conversation_id'] != null) ...[const SizedBox(height: 8), OutlinedButton.icon(onPressed: _openChat, icon: const Icon(Icons.chat_outlined), label: const Text('Open chat'))],
            ]),
            section('Items', [
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      ProductImage(item['image_url'], size: 44),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${item['title']}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            Text(
                              '${item['quantity']} × ${formatMoney(item['unit_price'], currency)} · SKU ${item['retailer_id']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(formatMoney(item['total_price'], currency), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              if (items.isEmpty) const Text('No item details were recorded for this order.', style: TextStyle(color: Brand.muted)),
              const Divider(height: 18),
              line('Subtotal', formatMoney(order['subtotal'], currency)),
              line('Shipping${address['delivery_speed'] == 'express' ? ' (express)' : ''}', ((order['shipping_fee'] as num?) ?? 0) > 0 ? formatMoney(order['shipping_fee'], currency) : 'Free'),
              if (((order['tax_amount'] as num?) ?? 0) > 0) line('Tax', formatMoney(order['tax_amount'], currency)),
              line('Total', formatMoney(order['total_amount'], currency), bold: true),
            ]),
            section('Payment', [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: payText,
                      style: TextStyle(fontWeight: FontWeight.w700, color: payAttention ? Brand.red : Brand.text),
                    ),
                    if (order['payment_status'] == 'paid' && order['payment_method'] != null)
                      TextSpan(
                        text: ' · ${paymentMethodLabels[order['payment_method']] ?? order['payment_method']}',
                        style: const TextStyle(color: Brand.muted),
                      ),
                  ],
                ),
              ),
              if (hasPaymentRequest(order) && order['payment_status'] != 'paid' && isOpen)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('A payment request is waiting in the customer\'s chat (reference ${order['meta_payment_reference']}).', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                ),
            ]),
            section(
              'Deliver to',
              [
                if (hasAddress) ...[
                  Text('${address['full_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(formatAddress(address)),
                  if ('${address['phone_number'] ?? ''}'.isNotEmpty) Text('${address['phone_number']}'),
                  Text(
                    '${'${address['delivery_speed'] ?? 'standard'}'[0].toUpperCase()}${'${address['delivery_speed'] ?? 'standard'}'.substring(1)} delivery',
                    style: const TextStyle(color: Brand.muted),
                  ),
                  if ('${address['notes'] ?? ''}'.isNotEmpty) Text('Note: ${address['notes']}', style: const TextStyle(color: Brand.muted)),
                ] else
                  Text(
                    widget.collectsAddress ? 'The customer has not filled in the address form yet.' : 'This store does not collect addresses in the chat. Ask the customer for it in the chat.',
                    style: const TextStyle(color: Brand.muted),
                  ),
                if ('${address['carrier'] ?? ''}${address['tracking_number'] ?? ''}'.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Row(
                      children: [
                        const Icon(Icons.local_shipping_outlined, size: 18, color: Brand.blue),
                        const SizedBox(width: 6),
                        Expanded(child: Text([address['carrier'] ?? 'Shipped', address['tracking_number']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '))),
                      ],
                    ),
                  ),
              ],
              trailing: hasAddress
                  ? TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: [address['full_name'], formatAddress(address), address['phone_number']].where((x) => '${x ?? ''}'.isNotEmpty).join('\n')));
                        if (context.mounted) toast(context, 'Address copied.');
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Copy'),
                    )
                  : null,
            ),
            // The next steps: only the moves that make sense from this status
            if (next.isEmpty)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'This order is ${statusLabel(order['status']).toLowerCase()}. No further steps.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Brand.muted),
                ),
              )
            else if (!canEdit)
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text(
                  'Your account is read-only, so you can see this order but not change it.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Brand.muted),
                ),
              )
            else
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (isOpen) ...[
                      Text('Waiting on the customer for $waitingOn.', style: const TextStyle(color: Brand.textSoft)),
                      const SizedBox(height: 6),
                      OutlinedButton.icon(
                        onPressed: _busy != null ? null : _remind,
                        icon: _busy == 'remind' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.notifications_active_outlined),
                        label: const Text('Send reminder'),
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (isToShip || order['status'] == 'shipped') ...[
                      TextField(
                        controller: _carrier,
                        maxLength: 60,
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(labelText: 'Courier (optional)', counterText: ''),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _tracking,
                        maxLength: 80,
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(labelText: 'Tracking number (optional)', counterText: ''),
                      ),
                      if (order['status'] == 'shipped' && trackingChanged) ...[
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: _busy != null
                              ? null
                              : () async {
                                  final data = await _patch({'trackingNumber': _tracking.text.trim(), 'carrier': _carrier.text.trim()}, 'tracking');
                                  if (data != null && context.mounted) toast(context, 'Tracking details saved.');
                                },
                          child: const Text('Save tracking details'),
                        ),
                      ],
                      const SizedBox(height: 4),
                    ],
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: _notify,
                      onChanged: (v) => setState(() => _notify = v ?? true),
                      title: const Text('Tell the customer on WhatsApp when the status changes', style: TextStyle(fontSize: 14)),
                    ),
                    for (final status in next.where((s) => s != 'canceled')) ...[
                      FilledButton(
                        onPressed: _busy != null ? null : () => _setStatus(status),
                        child: _busy == status
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text(switch (status) {
                                'paid' => 'Mark as paid',
                                'cod_confirmed' => 'Confirm as Cash on Delivery',
                                'shipped' => 'Mark as shipped',
                                _ => 'Mark as delivered',
                              }),
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (next.contains('canceled'))
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Brand.red,
                          side: const BorderSide(color: Color(0xFFF5C9C9)),
                        ),
                        onPressed: _busy != null ? null : () => _setStatus('canceled'),
                        child: const Text('Cancel order'),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
