import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_logic.dart';
import 'store_screen.dart' show NoteBox, confirmAction, openLink, plain;

/// The shop's newer parts, as on the web: GST invoice and returns on the order page, and Reports,
/// Reviews, Offers and loyalty points, Returns, GST invoices, WhatsApp messages and Delivery partners
/// from the Store tab. Same /api/commerce/* calls as the web.

Widget _title(String text) => Padding(
  padding: const EdgeInsets.only(bottom: 6),
  child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
);
Widget _hint(String text) => Padding(
  padding: const EdgeInsets.only(top: 4),
  child: Text(text, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
);
Widget _loading() => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));

// ── Order page: GST invoice ──────────────────────────────────────────────────

class OrderInvoiceBox extends StatefulWidget {
  const OrderInvoiceBox({super.key, required this.order});
  final Map order;
  @override
  State<OrderInvoiceBox> createState() => _OrderInvoiceBoxState();
}

class _OrderInvoiceBoxState extends State<OrderInvoiceBox> {
  Map? _invoice;
  bool _canIssue = false;
  bool _loaded = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/invoices', {'organizationId': app.orgId, 'orderId': '${widget.order['id']}'});
      if (mounted) setState(() { _invoice = d['invoice'] as Map?; _canIssue = d['canIssue'] == true; _loaded = true; });
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _make() async {
    setState(() => _busy = true);
    try {
      final d = await AppScope.read(context).ask('/api/commerce/invoices', {'orderId': widget.order['id']});
      setState(() => _invoice = d['invoice'] as Map?);
      if (mounted && _invoice != null) await openLink(context, '${_invoice!['url']}');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded || (_invoice == null && !_canIssue)) return const SizedBox.shrink();
    final inv = _invoice;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _title('Invoice'),
            if (inv != null)
              Row(
                children: [
                  const Icon(Icons.receipt_long_outlined, color: Brand.blue, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${inv['number']}${inv['status'] == 'cancelled' ? ' · Cancelled' : ''}', style: TextStyle(fontWeight: FontWeight.w700, color: inv['status'] == 'cancelled' ? Brand.red : Brand.text))),
                  IconButton(tooltip: 'Copy link', icon: const Icon(Icons.copy, size: 18), onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: '${inv['url']}'));
                    if (context.mounted) toast(context, 'Invoice link copied.');
                  }),
                  TextButton(onPressed: () => openLink(context, '${inv['url']}'), child: const Text('Open')),
                ],
              )
            else if (AppScope.of(context).can('write'))
              Row(
                children: [
                  const Expanded(child: Text('Made by itself when the order is shipped or delivered.', style: TextStyle(color: Brand.muted, fontSize: 13))),
                  OutlinedButton(onPressed: _busy ? null : _make, child: Text(_busy ? 'Making…' : 'Make now')),
                ],
              )
            else
              const Text('Made when the order is shipped or delivered.', style: TextStyle(color: Brand.muted)),
          ],
        ),
      ),
    );
  }
}

// ── Order page: returns and refunds ──────────────────────────────────────────

const returnLabels = {'asked': 'Return asked', 'accepted': 'Return accepted', 'declined': 'Return declined', 'refunded': 'Returned and refunded'};

class OrderReturnsBox extends StatefulWidget {
  const OrderReturnsBox({super.key, required this.order, required this.onChanged});
  final Map order;
  final VoidCallback onChanged;
  @override
  State<OrderReturnsBox> createState() => _OrderReturnsBoxState();
}

class _OrderReturnsBoxState extends State<OrderReturnsBox> {
  Map? _state;
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/returns', {'organizationId': app.orgId, 'orderId': '${widget.order['id']}'});
      if (mounted) setState(() => _state = d);
    } catch (_) {}
  }

  Future<void> _post(Map<String, dynamic> body, String done) async {
    setState(() => _busy = '${body['action']}');
    try {
      await AppScope.read(context).ask('/api/commerce/returns', {'orderId': widget.order['id'], ...body});
      if (mounted) toast(context, done);
      await _load();
      widget.onChanged();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _refund() async {
    final s = _state!;
    final left = (s['left'] as num?) ?? 0;
    final amount = TextEditingController(text: '$left');
    final reason = TextEditingController(text: '${(s['return'] as Map?)?['reason'] ?? ''}');
    var restock = s['return'] != null;
    final viaRazorpay = s['viaRazorpay'] == true;
    final go = await showDialog<bool>(
      context: context,
      builder: (dialog) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Refund this order'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(viaRazorpay
                    ? 'The customer paid online, so the money goes back through your Razorpay to the same card, UPI or bank account (5–7 working days).'
                    : 'This order was not paid through your Razorpay. Pay the customer back yourself (UPI, cash, bank), then record it here.'),
                const SizedBox(height: 12),
                TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Amount (at most ${formatMoney(left, widget.order['currency'])})')),
                TextField(controller: reason, maxLength: 200, decoration: const InputDecoration(labelText: 'Reason (optional)', counterText: '')),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: restock,
                  onChanged: (v) => setLocal(() => restock = v == true),
                  title: const Text('Put the sizes / colours back in stock', style: TextStyle(fontSize: 14)),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(dialog, true), child: Text(viaRazorpay ? 'Refund through Razorpay' : 'Record refund')),
          ],
        ),
      ),
    );
    if (go != true) return;
    await _post({'action': 'refund', 'amount': num.tryParse(amount.text.trim()) ?? 0, 'reason': reason.text.trim(), 'restock': restock}, viaRazorpay ? 'Refund sent through Razorpay.' : 'Refund recorded.');
  }

  @override
  Widget build(BuildContext context) {
    final s = _state;
    if (s == null) return const SizedBox.shrink();
    final ask = s['return'] as Map?;
    final refunds = (s['refunds'] as List? ?? const []);
    final paid = (s['paid'] as num?) ?? 0;
    final left = (s['left'] as num?) ?? 0;
    if (ask == null && paid <= 0 && refunds.isEmpty) return const SizedBox.shrink();
    final canEdit = AppScope.of(context).can('write');
    final currency = widget.order['currency'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _title('Returns and refunds'),
            if (ask != null) ...[
              Text('${returnLabels[ask['status']] ?? 'Return'}: ${ask['reason']}${'${ask['note'] ?? ''}'.isNotEmpty ? ' — “${ask['note']}”' : ''}', style: TextStyle(color: ask['status'] == 'asked' ? Brand.red : Brand.text, fontWeight: FontWeight.w600)),
              if (ask['status'] == 'asked' && canEdit)
                Wrap(spacing: 8, children: [
                  OutlinedButton(onPressed: _busy != null ? null : () => _post({'action': 'accept'}, 'Return accepted. The customer was told on WhatsApp.'), child: const Text('Accept')),
                  OutlinedButton(onPressed: _busy != null ? null : () => _post({'action': 'decline'}, 'Return declined. The customer was told on WhatsApp.'), child: const Text('Decline')),
                ]),
              const SizedBox(height: 6),
            ],
            for (final r in refunds.cast<Map>())
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(children: [
                  Expanded(child: Text('${r['method'] == 'razorpay' ? 'Through Razorpay${r['status'] == 'pending' ? ' (on its way)' : ''}' : 'Paid back by hand'}${'${r['reason'] ?? ''}'.isNotEmpty ? ' · ${r['reason']}' : ''}', style: const TextStyle(color: Brand.textSoft, fontSize: 13))),
                  Text('− ${formatMoney(r['amount'], currency)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                ]),
              ),
            if (left > 0 && canEdit)
              Row(children: [
                Expanded(child: Text(((s['refunded'] as num?) ?? 0) > 0 ? '${formatMoney(left, currency)} of ${formatMoney(paid, currency)} can still be refunded.' : 'Paid ${formatMoney(paid, currency)}.', style: const TextStyle(color: Brand.muted, fontSize: 13))),
                OutlinedButton.icon(onPressed: _busy != null ? null : _refund, icon: const Icon(Icons.undo, size: 18), label: const Text('Refund')),
              ]),
          ],
        ),
      ),
    );
  }
}

// ── Reports ──────────────────────────────────────────────────────────────────

class ShopReportsScreen extends StatefulWidget {
  const ShopReportsScreen({super.key, required this.currency});
  final String currency;
  @override
  State<ShopReportsScreen> createState() => _ShopReportsScreenState();
}

class _ShopReportsScreenState extends State<ShopReportsScreen> {
  int _days = 30;
  Map? _report;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    setState(() { _report = null; _error = ''; });
    try {
      final d = await app.backend.get('/api/commerce/reports', {'organizationId': app.orgId, 'days': '$_days'});
      if (mounted) setState(() => _report = d['report'] as Map?);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _report;
    String money(Object? n) => formatMoney(n, widget.currency);
    Widget metric(String label, String value, String note) => Expanded(
      child: Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
          const SizedBox(height: 4),
          FittedBox(fit: BoxFit.scaleDown, child: Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20))),
          Text(note, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 11.5)),
        ]),
      ),
    );
    final daily = (r?['daily'] as List? ?? const []).cast<Map>();
    final peak = daily.fold<num>(1, (m, d) => ((d['sales'] as num?) ?? 0) > m ? (d['sales'] as num) : m);
    return Scaffold(
      appBar: AppBar(title: const Text('Shop reports')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 32),
          children: [
            SegmentedButton<int>(
              segments: const [ButtonSegment(value: 7, label: Text('7 days')), ButtonSegment(value: 30, label: Text('30 days')), ButtonSegment(value: 90, label: Text('90 days'))],
              selected: {_days},
              onSelectionChanged: (v) { setState(() => _days = v.first); _load(); },
            ),
            const SizedBox(height: 12),
            if (_error.isNotEmpty) NoteBox(attention: true, icon: Icons.error_outline, text: _error),
            if (r == null && _error.isEmpty) _loading(),
            if (r != null) ...[
              Row(children: [
                metric('Store visits', '${r['visits']}', r['conversion'] == null ? 'Counted from now on' : '${r['conversion']}% of visits ordered'),
                const SizedBox(width: 8),
                metric('Orders', '${r['orders']}', ((r['cancelled'] as num?) ?? 0) > 0 ? '${r['cancelled']} cancelled (not counted)' : 'No cancelled orders'),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                metric('Sales', money(r['sales']), 'About ${money(r['averageOrder'])} per order'),
                const SizedBox(width: 8),
                metric('Customers', '${((r['newCustomers'] as num?) ?? 0) + ((r['returningCustomers'] as num?) ?? 0)}', '${r['newCustomers']} new · ${r['returningCustomers']} came back'),
              ]),
              const SizedBox(height: 10),
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _title('Sales each day'),
                  SizedBox(
                    height: 110,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      for (final d in daily)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 0.5),
                            child: FractionallySizedBox(
                              heightFactor: ((d['sales'] as num?) ?? 0) > 0 ? (((d['sales'] as num) / peak).clamp(0.04, 1.0)).toDouble() : 0.02,
                              child: Container(decoration: BoxDecoration(color: ((d['sales'] as num?) ?? 0) > 0 ? Brand.blue : Brand.line, borderRadius: const BorderRadius.vertical(top: Radius.circular(2)))),
                            ),
                          ),
                        ),
                    ]),
                  ),
                ]),
              ),
              const SizedBox(height: 10),
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _title('What sells'),
                  if ((r['topProducts'] as List? ?? const []).isEmpty) const Text('No orders in this period yet.', style: TextStyle(color: Brand.muted)),
                  for (final p in (r['topProducts'] as List? ?? const []).cast<Map>())
                    Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                      Expanded(child: Text('${p['title']}', maxLines: 1, overflow: TextOverflow.ellipsis)),
                      Text('${p['quantity']} sold  ', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                      Text(money(p['sales']), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ])),
                ]),
              ),
              const SizedBox(height: 10),
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _title('Best customers'),
                  if ((r['customers'] as List? ?? const []).isEmpty) const Text('No customers in this period yet.', style: TextStyle(color: Brand.muted)),
                  for (final c in (r['customers'] as List? ?? const []).cast<Map>())
                    Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                      Expanded(child: Text('${c['name']}\n${c['phone']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5))),
                      Text('${c['orders']} orders  ', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                      Text(money(c['spent']), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ])),
                ]),
              ),
              const SizedBox(height: 10),
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _title('Where orders came from'),
                  for (final c in (r['channels'] as List? ?? const []).cast<Map>())
                    Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                      Expanded(child: Text('${c['label']}')),
                      Text('${c['orders']} · ${money(c['sales'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    ])),
                  const Divider(height: 20),
                  _title('Carts left at checkout'),
                  Text('${(r['carts'] as Map?)?['left'] ?? 0} left · ${(r['carts'] as Map?)?['reminded'] ?? 0} reminded · ${(r['carts'] as Map?)?['cameBack'] ?? 0} came back'),
                  if ((((r['carts'] as Map?)?['value'] as num?) ?? 0) > 0) _hint('${money((r['carts'] as Map)['value'])} still sitting in carts.'),
                ]),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Reviews ──────────────────────────────────────────────────────────────────

class ShopReviewsScreen extends StatefulWidget {
  const ShopReviewsScreen({super.key});
  @override
  State<ShopReviewsScreen> createState() => _ShopReviewsScreenState();
}

class _ShopReviewsScreenState extends State<ShopReviewsScreen> {
  List<Map>? _reviews;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/reviews', {'organizationId': app.orgId});
      if (mounted) setState(() => _reviews = (d['reviews'] as List? ?? const []).cast<Map>());
    } catch (e) {
      if (mounted) { setState(() => _reviews = const []); toast(context, plain(e)); }
    }
  }

  Future<void> _toggle(Map r) async {
    try {
      await AppScope.read(context).ask('/api/commerce/reviews', {'id': r['id'], 'published': r['published'] == false}, method: 'PATCH');
      setState(() => r['published'] = r['published'] == false);
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _reviews;
    final canManage = AppScope.of(context).can('manage');
    return Scaffold(
      appBar: AppBar(title: const Text('Customer reviews')),
      body: list == null
          ? _loading()
          : list.isEmpty
          ? const EmptyState(icon: Icons.star_outline, title: 'No reviews yet', text: 'Customers are asked "How was it?" on WhatsApp when an order is delivered.')
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                padding: const EdgeInsets.all(12),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final r = list[i];
                  final stars = ((r['rating'] as num?) ?? 0).toInt();
                  return Panel(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Text('★' * stars + '☆' * (5 - stars), style: const TextStyle(color: Color(0xFFE6A700), fontSize: 16)),
                        const SizedBox(width: 8),
                        Expanded(child: Text('${(r['product'] as Map?)?['title'] ?? 'Product'}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                      ]),
                      if ('${r['body'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${r['body']}')),
                      if ((r['photos'] as List? ?? const []).isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Wrap(spacing: 6, children: [for (final url in (r['photos'] as List)) ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network('$url', width: 64, height: 64, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox(width: 64, height: 64)))]),
                        ),
                      Row(children: [
                        Expanded(child: Text('${r['customer_name'] ?? 'A customer'}${(r['order'] as Map?)?['order_number'] != null ? ' · #${(r['order'] as Map)['order_number']}' : ''}', style: const TextStyle(color: Brand.muted, fontSize: 12.5))),
                        if (canManage) TextButton(onPressed: () => _toggle(r), child: Text(r['published'] == false ? 'Show on store' : 'Hide')),
                      ]),
                    ]),
                  );
                },
              ),
            ),
    );
  }
}

// ── Offers, codes for one customer, loyalty points ───────────────────────────

const _offerKinds = {'percent': '% off', 'flat': '₹ off', 'free_delivery': 'Free delivery', 'buy_get': 'Buy X get Y free'};

class ShopOffersScreen extends StatefulWidget {
  const ShopOffersScreen({super.key});
  @override
  State<ShopOffersScreen> createState() => _ShopOffersScreenState();
}

class _ShopOffersScreenState extends State<ShopOffersScreen> {
  List<Map>? _offers;
  Map? _loyalty;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final results = await Future.wait([
        app.backend.get('/api/commerce/discounts', {'organizationId': app.orgId}),
        app.backend.get('/api/commerce/loyalty', {'organizationId': app.orgId}).catchError((_) => <String, dynamic>{}),
      ]);
      if (mounted) setState(() { _offers = (results[0]['discounts'] as List? ?? const []).cast<Map>(); _loyalty = results[1]['settings'] as Map?; });
    } catch (e) {
      if (mounted) { setState(() => _offers = const []); toast(context, plain(e)); }
    }
  }

  Future<void> _edit([Map? offer]) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _OfferForm(offer: offer)));
    if (saved == true) _load();
  }

  Future<void> _delete(Map offer) async {
    final ok = await confirmAction(context, title: 'Remove "${offer['title']}"?', message: 'Orders that used it keep their discount.', yes: 'Remove', destructive: true);
    if (!ok || !mounted) return;
    final app = AppScope.read(context);
    try {
      await app.backend.send('DELETE', '/api/commerce/discounts?organizationId=${app.orgId}&id=${offer['id']}', const {});
      _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  Future<void> _saveLoyalty() async {
    try {
      final d = await AppScope.read(context).ask('/api/commerce/loyalty', {'settings': _loyalty}, method: 'PUT');
      setState(() => _loyalty = d['settings'] as Map?);
      if (mounted) toast(context, 'Loyalty points saved.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _offers;
    final l = _loyalty;
    return Scaffold(
      appBar: AppBar(title: const Text('Offers and points')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('New offer')),
      body: list == null
          ? _loading()
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                children: [
                  if (l != null)
                    Panel(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: l['on'] == true,
                          onChanged: (v) => setState(() => l['on'] = v),
                          title: const Text('Loyalty points', style: TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: const Text('Points back on delivered orders, used on the next order (1 point = ₹1). Customers sign in on your store to use them.'),
                        ),
                        if (l['on'] == true)
                          Row(children: [
                            Expanded(child: TextFormField(initialValue: '${l['percent']}', keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Points back (%)'), onChanged: (v) => l['percent'] = num.tryParse(v) ?? 0)),
                            const SizedBox(width: 8),
                            Expanded(child: TextFormField(initialValue: '${l['minUse']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Use from'), onChanged: (v) => l['minUse'] = int.tryParse(v) ?? 0)),
                            const SizedBox(width: 8),
                            Expanded(child: TextFormField(initialValue: '${l['maxPercent']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'At most %'), onChanged: (v) => l['maxPercent'] = int.tryParse(v) ?? 0)),
                          ]),
                        Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _saveLoyalty, child: const Text('Save points'))),
                      ]),
                    ),
                  const SizedBox(height: 10),
                  if (list.isEmpty) const EmptyState(icon: Icons.local_offer_outlined, title: 'No offers yet', text: 'Make a code like DIWALI10, free delivery above ₹999, or buy 2 get 1.'),
                  for (final o in list)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        title: Text('${o['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([
                          o['code'] == null ? 'Applies by itself' : 'Code ${o['code']}',
                          '${o['uses'] ?? 0} used',
                          if ('${o['for_phone'] ?? ''}'.isNotEmpty) 'only for ${o['for_phone']}',
                          if (o['active'] == false) 'Off',
                        ].join(' · ')),
                        onTap: () => _edit(o),
                        trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: () => _delete(o)),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class _OfferForm extends StatefulWidget {
  const _OfferForm({this.offer});
  final Map? offer;
  @override
  State<_OfferForm> createState() => _OfferFormState();
}

class _OfferFormState extends State<_OfferForm> {
  late final Map _o = widget.offer ?? const {};
  late String _kind = '${_o['kind'] ?? 'percent'}';
  late bool _automatic = widget.offer != null && _o['code'] == null;
  late final _code = TextEditingController(text: '${_o['code'] ?? ''}');
  late final _value = TextEditingController(text: '${_o['value'] ?? 10}');
  late final _buy = TextEditingController(text: '${_o['buy_qty'] ?? 2}');
  late final _get = TextEditingController(text: '${_o['get_qty'] ?? 1}');
  late final _min = TextEditingController(text: ((_o['min_order'] as num?) ?? 0) > 0 ? '${_o['min_order']}' : '');
  late final _title = TextEditingController(text: '${_o['title'] ?? ''}');
  late final _phone = TextEditingController(text: '${_o['for_phone'] ?? ''}');
  late bool _once = _o['once_per_phone'] ?? true;
  late bool _first = _o['first_order_only'] == true;
  late bool _active = _o['active'] != false;
  bool _saving = false;
  String _error = '';

  Future<void> _save() async {
    setState(() { _saving = true; _error = ''; });
    try {
      await AppScope.read(context).ask('/api/commerce/discounts', {
        'discount': {
          if (_o['id'] != null) 'id': _o['id'],
          'title': _title.text.trim(), 'kind': _kind, 'automatic': _automatic, 'code': _automatic ? null : _code.text.trim(),
          'value': _value.text.trim(), 'buy_qty': _buy.text.trim(), 'get_qty': _get.text.trim(), 'min_order': _min.text.trim(),
          'once_per_phone': _once, 'first_order_only': _first, 'active': _active, 'for_phone': _automatic ? '' : _phone.text.trim(),
          'starts_at': _o['starts_at'], 'ends_at': _o['ends_at'], 'max_uses': _o['max_uses'],
        },
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    return Scaffold(
      appBar: AppBar(title: Text(widget.offer == null ? 'New offer' : 'Edit offer')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          SwitchListTile(contentPadding: EdgeInsets.zero, value: _automatic, onChanged: (v) => setState(() => _automatic = v), title: const Text('Applies by itself (no code)')),
          if (!_automatic) TextField(controller: _code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Code', hintText: 'DIWALI10')),
          gap,
          DropdownButtonFormField<String>(initialValue: _kind, isExpanded: true, decoration: const InputDecoration(labelText: 'What it gives'), items: [for (final e in _offerKinds.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setState(() => _kind = v ?? 'percent')),
          gap,
          if (_kind == 'percent' || _kind == 'flat') TextField(controller: _value, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: _kind == 'percent' ? 'Percent off' : 'Rupees off')),
          if (_kind == 'buy_get') Row(children: [
            Expanded(child: TextField(controller: _buy, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Buy'))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _get, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Get free'))),
          ]),
          gap,
          TextField(controller: _min, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Minimum order (optional)')),
          gap,
          TextField(controller: _title, maxLength: 80, decoration: const InputDecoration(labelText: 'Name shown to customers (optional)', counterText: '')),
          if (!_automatic) ...[
            gap,
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Only for one customer (optional)', hintText: 'Their phone number', helperText: 'Only orders with this phone can use the code.')),
          ],
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _first, onChanged: (v) => setState(() => _first = v == true), title: const Text('First order only')),
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _once, onChanged: (v) => setState(() => _once = v == true), title: const Text('Once per customer')),
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (v) => setState(() => _active = v == true), title: const Text('On')),
          if (_error.isNotEmpty) NoteBox(attention: true, icon: Icons.error_outline, text: _error),
          FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save offer')),
        ],
      ),
    );
  }
}

// ── Settings: Returns, GST invoices, WhatsApp messages, Delivery partners ───

/// One settings screen that loads from `path` and saves `{settings}` (or `{messages}`) with PUT.
class _SettingsScreen extends StatefulWidget {
  const _SettingsScreen({required this.title, required this.path, required this.builder, this.key_ = 'settings', this.intro = ''});
  final String title;
  final String path;
  final String key_;
  final String intro;
  final List<Widget> Function(Map values, void Function(VoidCallback) update) builder;
  @override
  State<_SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<_SettingsScreen> {
  Map? _values;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final app = AppScope.read(context);
    app.backend.get(widget.path, {'organizationId': app.orgId}).then((d) {
      if (mounted) setState(() => _values = Map.from((d[widget.key_] as Map?) ?? const {}));
    }).catchError((e) {
      if (mounted) toast(context, plain(e));
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final d = await AppScope.read(context).ask(widget.path, {widget.key_: _values}, method: 'PUT');
      setState(() => _values = Map.from((d[widget.key_] as Map?) ?? _values!));
      if (mounted) toast(context, 'Saved.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = _values;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: v == null
          ? _loading()
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                if (widget.intro.isNotEmpty) Text(widget.intro, style: const TextStyle(color: Brand.muted, fontSize: 13.5)),
                const SizedBox(height: 8),
                ...widget.builder(v, setState),
                const SizedBox(height: 16),
                FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save')),
              ],
            ),
    );
  }
}

Widget returnsSettingsScreen() => _SettingsScreen(
  title: 'Returns',
  path: '/api/commerce/returns',
  intro: 'Customers ask in My orders on your store; you accept or decline on the order and refund from there. Online payments go back through your Razorpay.',
  builder: (v, update) => [
    SwitchListTile(contentPadding: EdgeInsets.zero, value: v['on'] == true, onChanged: (x) => update(() => v['on'] = x), title: const Text('Customers can ask for a return')),
    if (v['on'] == true) TextFormField(initialValue: '${v['days'] ?? 7}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Days after delivery'), onChanged: (x) => v['days'] = int.tryParse(x) ?? 7),
  ],
);

Widget invoiceSettingsScreen() => _SettingsScreen(
  title: 'GST invoices',
  path: '/api/commerce/invoices',
  intro: 'Every order gets an invoice when it is shipped or delivered. The customer sees it in My orders. Prices on your store include GST. Without a GSTIN the invoice is a plain bill.',
  builder: (v, update) => [
    TextFormField(initialValue: '${v['gstin'] ?? ''}', textCapitalization: TextCapitalization.characters, maxLength: 15, decoration: const InputDecoration(labelText: 'GSTIN (optional)', hintText: '36ABCDE1234F1Z5', counterText: ''), onChanged: (x) => v['gstin'] = x.trim().toUpperCase()),
    TextFormField(initialValue: '${v['legalName'] ?? ''}', decoration: const InputDecoration(labelText: 'Name on GST certificate (optional)'), onChanged: (x) => v['legalName'] = x),
    TextFormField(initialValue: '${v['address'] ?? ''}', minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Address on the invoice (optional)', hintText: "Uses the shop's contact address when empty"), onChanged: (x) => v['address'] = x),
    const SizedBox(height: 8),
    DropdownButtonFormField<String>(
      initialValue: '${num.tryParse('${v['defaultRate'] ?? 0}') ?? 0}'.replaceAll(RegExp(r'\.0$'), ''),
      decoration: const InputDecoration(labelText: 'Usual GST rate', helperText: 'For products without their own rate.'),
      items: [for (final r in {...gstRates, '${num.tryParse('${v['defaultRate'] ?? 0}') ?? 0}'.replaceAll(RegExp(r'\.0$'), '')}) DropdownMenuItem(value: r, child: Text('$r%'))],
      onChanged: (x) => update(() => v['defaultRate'] = num.tryParse(x ?? '0') ?? 0),
    ),
    TextFormField(initialValue: '${v['prefix'] ?? 'WEB'}', textCapitalization: TextCapitalization.characters, maxLength: 5, decoration: const InputDecoration(labelText: 'Invoice number starts with', helperText: 'Like WEB/26-27/0001. Numbers start again each April.', counterText: ''), onChanged: (x) => v['prefix'] = x),
  ],
);

const _messageInfo = {
  'cart_reminder': ('Cart reminder', 'An hour after a customer left items in the cart without ordering (once).'),
  'cod_confirm': ('Cash on Delivery check', 'Right after a Cash on Delivery order, before you ship it.'),
  'review_ask': ('"How was it?" review ask', 'When the order is delivered.'),
  'back_in_stock': ('Back in stock', 'When a product someone asked about is back in stock.'),
  'refund_update': ('Return and refund updates', 'When you accept or decline a return, and when you refund an order.'),
};

Widget shopMessagesScreen() => _SettingsScreen(
  title: 'WhatsApp messages',
  path: '/api/commerce/shop-messages',
  key_: 'messages',
  intro: 'Sent as a normal message when the customer wrote in the last 24 hours. Otherwise WhatsApp needs an approved template: make one in Templates (Utility), then type its name here.',
  builder: (v, update) => [
    for (final e in _messageInfo.entries)
      if (v[e.key] is Map)
        Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SwitchListTile(contentPadding: EdgeInsets.zero, value: (v[e.key] as Map)['on'] == true, onChanged: (x) => update(() => (v[e.key] as Map)['on'] = x), title: Text(e.value.$1, style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(e.value.$2)),
            if ((v[e.key] as Map)['on'] == true)
              Row(children: [
                Expanded(child: TextFormField(initialValue: '${(v[e.key] as Map)['template'] ?? ''}', decoration: const InputDecoration(labelText: 'Template name (optional)'), onChanged: (x) => (v[e.key] as Map)['template'] = x.trim())),
                const SizedBox(width: 8),
                SizedBox(width: 70, child: TextFormField(initialValue: '${(v[e.key] as Map)['language'] ?? 'en'}', decoration: const InputDecoration(labelText: 'Language'), onChanged: (x) => (v[e.key] as Map)['language'] = x.trim())),
              ]),
          ]),
        ),
  ],
);

/// Delivery partners: where each stands. Connecting a partner (keys, warehouse) is done on the web.
class DeliveryPartnersScreen extends StatefulWidget {
  const DeliveryPartnersScreen({super.key});
  @override
  State<DeliveryPartnersScreen> createState() => _DeliveryPartnersScreenState();
}

class _DeliveryPartnersScreenState extends State<DeliveryPartnersScreen> {
  Map? _data;
  @override
  void initState() {
    super.initState();
    final app = AppScope.read(context);
    app.backend.get('/api/commerce/shipping', {'organizationId': app.orgId}).then((d) {
      if (mounted) setState(() => _data = d);
    }).catchError((e) {
      if (mounted) { setState(() => _data = const {}); toast(context, plain(e)); }
    });
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final settings = (d?['settings'] as Map?) ?? d ?? const {};
    Widget row(String name, Map? p) => Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(p?['connected'] == true ? Icons.check_circle : Icons.radio_button_unchecked, color: p?['connected'] == true ? Brand.blue : Brand.muted),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(p?['connected'] == true ? 'Connected. Book a pickup from the order page on the web.' : 'Not connected'),
      ),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery partners')),
      body: d == null
          ? _loading()
          : ListView(padding: const EdgeInsets.all(12), children: [
              row('Shiprocket', settings['shiprocket'] as Map?),
              row('Delhivery', settings['delhivery'] as Map?),
              _hint('Connecting a partner needs its keys and pickup address: open WAMA CRM on a computer → E-commerce → Store settings → Delivery partners. Couriers update the order and tell the customer on WhatsApp by themselves.'),
            ]),
    );
  }
}

/// The Store tab's links to these screens: one card, a row each.
List<Widget> shopMoreTiles(BuildContext context, {required String currency, required bool manage}) {
  Widget row(IconData icon, String title, Widget Function() screen) => ListTile(
    dense: true,
    visualDensity: VisualDensity.compact,
    leading: Icon(icon, color: Brand.blue, size: 22),
    title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
    trailing: const Icon(Icons.chevron_right, size: 20),
    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => screen())),
  );
  return [
    Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(children: [
        row(Icons.bar_chart, 'Shop reports', () => ShopReportsScreen(currency: currency)),
        row(Icons.star_outline, 'Customer reviews', () => const ShopReviewsScreen()),
        if (manage) ...[
          row(Icons.local_offer_outlined, 'Offers and points', () => const ShopOffersScreen()),
          row(Icons.undo, 'Returns', returnsSettingsScreen),
          row(Icons.receipt_long_outlined, 'GST invoices', invoiceSettingsScreen),
          row(Icons.chat_outlined, 'WhatsApp messages', shopMessagesScreen),
          row(Icons.local_shipping_outlined, 'Delivery partners', () => const DeliveryPartnersScreen()),
        ],
      ]),
    ),
  ];
}
