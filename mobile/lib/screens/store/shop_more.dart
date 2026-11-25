import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../data/format.dart' show istNow, shortRupees, showPhone;
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../templates/auto_messages_screen.dart';
import 'store_logic.dart';
import 'store_screen.dart' show NoteBox, confirmAction, openLink, plain;

/// The shop's newer parts, as on the web: GST invoice and returns on the order page, and Reports,
/// Reviews, Offers and loyalty points, Returns, GST invoices, WhatsApp messages and Delivery partners
/// from the Store tab. Same /api/commerce/* calls as the web.

Widget _title(String text) => Padding(
  padding: const EdgeInsets.only(bottom: 6),
  child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
);
/// A box on the order page: titled like the order's own boxes (Customer, Items, Payment), not in bold black.
Widget _boxTitle(String text) => Padding(
  padding: const EdgeInsets.only(bottom: 6),
  child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.muted)),
);
Widget _hint(String text) => Padding(
  padding: const EdgeInsets.only(top: 4),
  child: Text(text, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
);
Widget _loading() => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));

/// Could not load: what went wrong, and Try again (in a list, so it scrolls with large text).
Widget _failed(String error, VoidCallback retry) => ListView(
  children: [
    EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: error, action: FilledButton(onPressed: retry, child: const Text('Try again'))),
  ],
);

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
            _boxTitle('Invoice'),
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
                  const SizedBox(width: 8),
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

  /// Returns the server's answer, or null when it did not work (already told in a toast).
  Future<Map<String, dynamic>?> _post(Map<String, dynamic> body, [String? done]) async {
    setState(() => _busy = '${body['action']}');
    try {
      final d = await AppScope.read(context).ask('/api/commerce/returns', {'orderId': widget.order['id'], ...body});
      if (mounted && done != null) toast(context, done);
      await _load();
      widget.onChanged();
      return d;
    } catch (e) {
      if (mounted) toast(context, plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// How a refund goes: 'razorpay' or 'stripe' (the money goes back by itself), or 'manual' (the owner pays it back).
  /// Same checks as the server's refundOrder.
  String _via(Map s) {
    final via = '${s['via'] ?? ''}';
    if (const ['razorpay', 'stripe', 'manual'].contains(via)) return via;
    if (s['viaRazorpay'] == true) return 'razorpay';
    final payment = ((widget.order['shipping_address'] as Map?)?['payment'] as Map?) ?? const {};
    if (widget.order['payment_method'] == 'stripe' && '${payment['payment_intent'] ?? ''}'.isNotEmpty) return 'stripe';
    return 'manual';
  }

  Future<void> _refund() async {
    final s = _state!;
    final left = (s['left'] as num?) ?? 0;
    final amount = TextEditingController(text: '$left');
    final reason = TextEditingController(text: '${(s['return'] as Map?)?['reason'] ?? ''}');
    var restock = s['return'] != null;
    final via = _via(s);
    final gateway = via == 'stripe' ? 'Stripe' : 'Razorpay';
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
                Text(switch (via) {
                  'razorpay' => 'The customer paid online, so the money goes back through your Razorpay to the same card, UPI or bank account (5–7 working days).',
                  'stripe' => 'The customer paid online, so the money goes back through your Stripe to the same card (5–10 working days). Do not pay them back yourself.',
                  _ => 'The money does not go back by itself for this order. Pay the customer back yourself (UPI, cash, bank), then record it here.',
                }),
                const SizedBox(height: 12),
                TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Amount (at most ${formatMoney(left, widget.order['currency'])})')),
                const SizedBox(height: 14),
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
            FilledButton(onPressed: () => Navigator.pop(dialog, true), child: Text(via == 'manual' ? 'Record refund' : 'Refund through $gateway')),
          ],
        ),
      ),
    );
    if (go != true) return;
    final d = await _post({'action': 'refund', 'amount': num.tryParse(amount.text.trim()) ?? 0, 'reason': reason.text.trim(), 'restock': restock});
    if (d == null || !mounted) return;
    // The server says how it really went (a payment account may have been disconnected since)
    toast(context, switch ('${d['method'] ?? via}') {
      'razorpay' => 'Refund sent through Razorpay.',
      'stripe' => 'Refund sent through Stripe.',
      _ => via == 'manual' ? 'Refund recorded.' : 'Refund recorded, but $gateway is not connected, so no money was sent. Pay the customer back yourself.',
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = _state;
    if (s == null) return const SizedBox.shrink();
    final ask = s['return'] as Map?;
    final refunds = (s['refunds'] as List? ?? const []);
    final paid = (s['paid'] as num?) ?? 0;
    // Marked as refunded before refunds were recorded here: nothing is left to refund
    final markedRefunded = widget.order['payment_status'] == 'refunded' && refunds.isEmpty;
    final left = markedRefunded ? 0 : (s['left'] as num?) ?? 0;
    if (ask == null && paid <= 0 && refunds.isEmpty) return const SizedBox.shrink();
    final canEdit = AppScope.of(context).can('write');
    final currency = widget.order['currency'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _boxTitle('Returns and refunds'),
            if (ask != null) ...[
              Text('${returnLabels[ask['status']] ?? 'Return'}: ${ask['reason']}${'${ask['note'] ?? ''}'.isNotEmpty ? ' — “${ask['note']}”' : ''}', style: TextStyle(color: ask['status'] == 'asked' ? Brand.red : Brand.text, fontWeight: FontWeight.w600)),
              // A little room between the ask and its buttons (they touched)
              if (ask['status'] == 'asked' && canEdit) const SizedBox(height: 8),
              if (ask['status'] == 'asked' && canEdit)
                Wrap(spacing: 8, runSpacing: 8, children: [
                  OutlinedButton(onPressed: _busy != null ? null : () => _post({'action': 'accept'}, 'Return accepted. The customer was told on WhatsApp.'), child: const Text('Accept')),
                  OutlinedButton(onPressed: _busy != null ? null : () => _post({'action': 'decline'}, 'Return declined. The customer was told on WhatsApp.'), child: const Text('Decline')),
                ]),
              const SizedBox(height: 10),
            ],
            for (final r in refunds.cast<Map>())
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(children: [
                  Expanded(
                    child: Text(
                      '${switch (r['method']) {
                        'razorpay' => 'Through Razorpay',
                        'stripe' => 'Through Stripe',
                        _ => 'Paid back by hand',
                      }}${r['method'] != 'manual' && r['status'] == 'pending' ? ' (on its way)' : ''}${'${r['reason'] ?? ''}'.isNotEmpty ? ' · ${r['reason']}' : ''}',
                      style: const TextStyle(color: Brand.textSoft, fontSize: 13),
                    ),
                  ),
                  Text('− ${formatMoney(r['amount'], currency)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                ]),
              ),
            if (markedRefunded) const Text('Marked as refunded.', style: TextStyle(color: Brand.textSoft, fontSize: 13)),
            if (left > 0 && canEdit)
              Row(children: [
                Expanded(child: Text(((s['refunded'] as num?) ?? 0) > 0 ? '${formatMoney(left, currency)} of ${formatMoney(paid, currency)} can still be refunded.' : 'Paid ${formatMoney(paid, currency)}.', style: const TextStyle(color: Brand.muted, fontSize: 13))),
                const SizedBox(width: 8),
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

/// The same choices as the web report: a period, and where the orders came from.
const _periods = [(1, 'Today'), (7, '7 days'), (30, '30 days'), (90, '90 days')];
const _channels = [('', 'All'), ('website', 'Website'), ('in_chat', 'WhatsApp'), ('in_store', 'In the shop'), ('phone', 'Phone call')];

class _ShopReportsScreenState extends State<ShopReportsScreen> {
  int _days = 30;
  /// Dates the owner picked ("YYYY-MM-DD", both included); used instead of the ready periods when set.
  DateTimeRange? _range;
  String _channel = '';
  bool _showOrders = false;
  int? _picked;
  Map? _report;
  String _error = '';
  /// Only the latest chip's answer is shown (an older, slower one is dropped).
  int _ask = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    setState(() {
      _report = null;
      _error = '';
      _picked = null;
    });
    try {
      final range = _range;
      final d = await app.backend.get('/api/commerce/reports', {
        'organizationId': app.orgId,
        if (range == null) 'days': '$_days' else ...{'from': _ymd(range.start), 'to': _ymd(range.end)},
        if (_channel.isNotEmpty) 'channel': _channel,
      });
      if (mounted && ask == _ask) setState(() => _report = d['report'] as Map?);
    } catch (e) {
      if (mounted && ask == _ask) setState(() => _error = plain(e));
    }
  }

  num _n(Object? v) => v is num ? v : num.tryParse('$v') ?? 0;

  static String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// The phone's calendar: pick a from date and a to date (today at most, up to 366 days).
  Future<void> _pickDates() async {
    final today = istNow();
    final last = DateTime(today.year, today.month, today.day);
    final picked = await showDateRangePicker(
      context: context,
      firstDate: last.subtract(const Duration(days: 365 * 3)),
      lastDate: last,
      initialDateRange: _range ?? DateTimeRange(start: last.subtract(const Duration(days: 6)), end: last),
      helpText: 'Pick the dates',
      saveText: 'Show report',
    );
    if (picked == null) return;
    if (picked.end.difference(picked.start).inDays + 1 > 366) {
      if (mounted) toast(context, 'Pick at most 366 days.');
      return;
    }
    setState(() => _range = picked);
    _load();
  }

  /// "the 7 days before" / "the day before"
  int get _shownDays => (_report?['daily'] as List?)?.length ?? _days;

  /// "▲ 20% vs the 7 days before"; null when there is nothing to compare.
  (String, bool)? _change(num now, num before) {
    final n = _shownDays;
    final when = n == 1 ? 'the day before' : 'the $n days before';
    if (now == 0 && before == 0) return null;
    if (before == 0) return ('New vs $when', false);
    final pct = ((now - before) / before * 100).round();
    if (pct == 0) return ('Same as $when', false);
    return ('${pct > 0 ? '▲' : '▼'} ${pct.abs()}% vs $when', pct < 0);
  }

  /// A round top for the chart's scale: 4,500 → 5,000; 17,200 → 20,000.
  static num _niceTop(num peak) {
    if (peak <= 0) return 1;
    final step = math.pow(10, (math.log(peak) / math.ln10).floor());
    for (final m in const [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      if (m * step >= peak) return m * step;
    }
    return 10 * step;
  }

  String _dayLabel(String day, {bool short = false}) {
    final d = DateTime.tryParse(day);
    if (d == null) return day;
    const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return short ? week[d.weekday - 1] : '${d.day} ${months[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final r = _report;
    String money(Object? n) => formatMoney(n, widget.currency);
    final website = _channel.isEmpty || _channel == 'website';
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Shop reports')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            Container(
              color: Colors.white,
              child: Column(
                // From the left edge, in line with the chips below (the period chips sat centred)
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Wraps on small phones, so "Pick dates" is always in sight
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 6),
                    child: Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      for (final (days, label) in _periods)
                        ChoiceChip(label: Text(label), selected: _range == null && _days == days, onSelected: (_) {
                          setState(() {
                            _days = days;
                            _range = null;
                          });
                          _load();
                        }),
                      ChoiceChip(
                        avatar: Icon(Icons.date_range, size: 17, color: _range == null ? Brand.textSoft : Brand.blue),
                        label: Text(_range == null ? 'Pick dates' : '${_dayLabel(_ymd(_range!.start))} – ${_dayLabel(_ymd(_range!.end))}'),
                        selected: _range != null,
                        onSelected: (_) => _pickDates(),
                      ),
                    ],
                  ),
                  ),
                  FilterChips(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    children: [
                      for (final (key, label) in _channels)
                        ChoiceChip(label: Text(label), selected: _channel == key, onSelected: (_) {
                          setState(() => _channel = key);
                          _load();
                        }),
                    ],
                  ),
                ],
              ),
            ),
            if (_error.isNotEmpty) Padding(padding: const EdgeInsets.all(12), child: NoteBox(attention: true, icon: Icons.error_outline, text: _error)),
            if (r == null && _error.isEmpty) _loading(),
            if (r != null) ..._body(r, money, website),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(Map r, String Function(Object?) money, bool website) {
    final sales = _n(r['sales']);
    final received = _n(r['received']);
    final before = (r['before'] as Map?) ?? const {};
    final salesChange = _change(sales, _n(before['sales']));
    final ordersChange = _change(_n(r['orders']), _n(before['orders']));
    final daily = (r['daily'] as List? ?? const []).cast<Map>();
    num value(Map d) => _showOrders ? _n(d['orders']) : _n(d['sales']);
    final peak = daily.fold<num>(0, (m, d) => value(d) > m ? value(d) : m);
    final channels = (r['channels'] as List? ?? const []).cast<Map>();
    final channelTotal = channels.fold<num>(0, (s, c) => s + _n(c['sales']));
    final products = (r['topProducts'] as List? ?? const []).cast<Map>();
    final topQty = products.fold<num>(1, (m, p) => _n(p['quantity']) > m ? _n(p['quantity']) : m);
    final carts = (r['carts'] as Map?) ?? const {};
    final labelEvery = (daily.length / 7).ceil().clamp(1, 99);
    // The chart's scale (the bars had no numbers beside them): a round top, its half and 0
    final axisTop = _showOrders ? math.max(2, (peak / 2).ceil() * 2) : _niceTop(peak);
    String axisLabel(num n) => _showOrders ? '${n.round()}' : (widget.currency.toUpperCase() == 'INR' ? shortRupees(n) : formatMoney(n.round(), widget.currency));
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    // A picked period that ends before today has no "Today"
    final endsToday = daily.isEmpty || '${daily.last['day']}' == _ymd(istNow());

    Widget change((String, bool)? c) => c == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(c.$1, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c.$2 ? Brand.red : Brand.blue)),
          );
    Widget tile(String label, String value, String note, [(String, bool)? delta]) => Expanded(
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
            const SizedBox(height: 4),
            FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 22))),
            Text(note, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 11.5)),
            change(delta),
          ],
        ),
      ),
    );

    return [
      // The money, first and big
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Sales', style: TextStyle(color: Brand.muted, fontSize: 13)),
              const SizedBox(height: 2),
              FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(money(sales), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 30))),
              change(salesChange),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(value: sales > 0 ? (received / sales).clamp(0, 1).toDouble() : 0, minHeight: 8, backgroundColor: Brand.line, color: Brand.blue),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(child: Text('${money(received)} received', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                  Text('${money((sales - received).clamp(0, sales))} to collect', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ],
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: IntrinsicHeight(
          child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            tile('Orders', '${r['orders'] ?? 0}', _n(r['orders']) > 0 ? 'About ${money(_n(r['averageOrder']).round())} each${_n(r['cancelled']) > 0 ? ' · ${r['cancelled']} cancelled' : ''}' : 'No orders yet', ordersChange),
            const SizedBox(width: 8),
            tile(
              'Customers',
              '${_n(r['newCustomers']) + _n(r['returningCustomers'])}',
              '${r['newCustomers'] ?? 0} new · ${r['returningCustomers'] ?? 0} returning${_n(r['repeatCustomers']) > 0 ? ' · ${r['repeatCustomers']} ordered again' : ''}',
            ),
          ],
        ),
        ),
      ),
      if (website)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: IntrinsicHeight(
            child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              tile('Store visits', '${r['visits'] ?? 0}', r['conversion'] == null ? 'Counted when people open your store page' : '${_n(r['conversion']).round()}% of visits ordered', _change(_n(r['visits']), _n(before['visits']))),
              const SizedBox(width: 8),
              tile('Product views', '${r['productViews'] ?? 0}', 'Product pages opened'),
            ],
          ),
          ),
        ),
      // Each day
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title and the Sales | Orders switch; the switch goes under the title on small phones and
              // with large text (the title was squeezed to one word a line)
              LayoutBuilder(
                builder: (context, box) {
                  final title = _title(_showOrders ? 'Orders each day' : 'Sales each day');
                  final toggle = SegmentedButton<bool>(
                    showSelectedIcon: false,
                    style: const ButtonStyle(visualDensity: VisualDensity.compact),
                    segments: const [ButtonSegment(value: false, label: Text('Sales')), ButtonSegment(value: true, label: Text('Orders'))],
                    selected: {_showOrders},
                    onSelectionChanged: (v) => setState(() => _showOrders = v.first),
                  );
                  if (box.maxWidth < 260 * textScale) {
                    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [title, toggle, const SizedBox(height: 8)]);
                  }
                  return Row(children: [Expanded(child: title), toggle]);
                },
              ),
              if (daily.length == 1)
                Text('${endsToday ? 'Today' : _dayLabel('${daily.last['day']}')}: ${money(daily.last['sales'])} from ${daily.last['orders']} ${_n(daily.last['orders']) == 1 ? 'order' : 'orders'}.', style: const TextStyle(color: Brand.textSoft))
              else if (daily.isNotEmpty) ...[
                // What the tapped bar is (or the latest day)
                Builder(builder: (context) {
                  final d = daily[(_picked ?? daily.length - 1).clamp(0, daily.length - 1)];
                  return Text(
                    '${_picked == null && endsToday ? 'Today' : _dayLabel('${d['day']}')}: ${money(d['sales'])} · ${d['orders']} ${_n(d['orders']) == 1 ? 'order' : 'orders'}${website ? ' · ${d['visits']} visits' : ''}',
                    style: const TextStyle(fontSize: 12.5, color: Brand.textSoft),
                  );
                }),
                const SizedBox(height: 10),
                SizedBox(
                  height: 120,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // The scale
                      SizedBox(
                        width: 44 * textScale,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            for (final n in [axisTop, axisTop / 2, 0])
                              Text(axisLabel(n), maxLines: 1, style: const TextStyle(fontSize: 10, height: 1, color: Brand.faint)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Stack(
                          children: [
                            // Lines at the top, the middle and 0
                            Positioned.fill(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  for (var k = 0; k < 3; k++) Container(height: 1, color: k == 2 ? Brand.border : Brand.lineSoft),
                                ],
                              ),
                            ),
                            Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      for (var i = 0; i < daily.length; i++)
                        Expanded(
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => setState(() => _picked = _picked == i ? null : i),
                            child: Padding(
                              padding: EdgeInsets.symmetric(horizontal: daily.length > 40 ? 0.5 : 1.5),
                              child: Align(
                                alignment: Alignment.bottomCenter,
                                child: FractionallySizedBox(
                                  heightFactor: value(daily[i]) > 0 ? (value(daily[i]) / axisTop).clamp(0.03, 1.0).toDouble() : 0.02,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: value(daily[i]) == 0 ? Brand.line : (_picked == i ? Brand.navy : Brand.blue),
                                      borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                // Dates under the bars, placed by position: "Today" on the same line as the others (it
                // dropped to a line of its own), every other date left out when they would touch
                Padding(
                  padding: EdgeInsets.only(left: 44 * textScale + 6),
                  child: SizedBox(
                    height: 14 * textScale,
                    child: LayoutBuilder(
                      builder: (context, box) {
                        final gap = box.maxWidth * labelEvery / daily.length;
                        final skipOdd = gap < 40 * textScale;
                        return Stack(
                          clipBehavior: Clip.none,
                          children: [
                            for (var i = 0; i < daily.length; i++)
                              if ((daily.length - 1 - i) % labelEvery == 0 && !(skipOdd && ((daily.length - 1 - i) ~/ labelEvery).isOdd))
                                if (i == daily.length - 1)
                                  Positioned(
                                    right: 0,
                                    top: 0,
                                    child: Text(endsToday ? 'Today' : _dayLabel('${daily.last['day']}'), style: const TextStyle(fontSize: 10, color: Brand.muted)),
                                  )
                                else
                                  Positioned(
                                    left: (i + 0.5) / daily.length * box.maxWidth,
                                    top: 0,
                                    child: FractionalTranslation(
                                      translation: const Offset(-0.5, 0),
                                      child: Text(_dayLabel('${daily[i]['day']}', short: daily.length <= 7), maxLines: 1, softWrap: false, style: const TextStyle(fontSize: 10, color: Brand.muted)),
                                    ),
                                  ),
                          ],
                        );
                      },
                    ),
                  ),
                ),
                _hint('Tap a bar to see that day.'),
              ],
            ],
          ),
        ),
      ),
      // What sells
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _title('What sells'),
              if (products.isEmpty) const Text('No orders in this period yet.', style: TextStyle(color: Brand.muted)),
              for (var i = 0; i < products.length; i++)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          SizedBox(width: 22, child: Text('${i + 1}', style: const TextStyle(color: Brand.faint, fontWeight: FontWeight.w600))),
                          Expanded(child: Text('${products[i]['title']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w500))),
                          const SizedBox(width: 8),
                          Text(money(products[i]['sales']), style: const TextStyle(fontWeight: FontWeight.w700)),
                        ],
                      ),
                      Padding(
                        padding: const EdgeInsets.only(left: 22, top: 3),
                        child: Row(
                          children: [
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(99),
                                child: LinearProgressIndicator(value: (_n(products[i]['quantity']) / topQty).clamp(0, 1).toDouble(), minHeight: 5, backgroundColor: Brand.lineSoft, color: Brand.blue),
                              ),
                            ),
                            const SizedBox(width: 8),
                            // A fixed width, so every bar is measured against the same length
                            SizedBox(
                              width: 58 * textScale,
                              child: Text('${products[i]['quantity']} sold', textAlign: TextAlign.right, maxLines: 1, style: const TextStyle(color: Brand.muted, fontSize: 12)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      // Best customers
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _title('Best customers'),
              if ((r['customers'] as List? ?? const []).isEmpty) const Text('No customers in this period yet.', style: TextStyle(color: Brand.muted)),
              for (final c in (r['customers'] as List? ?? const []).cast<Map>())
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    children: [
                      Avatar('${c['name']}', size: 36),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${c['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text('${'${c['phone'] ?? ''}'.isEmpty ? 'No phone' : showPhone(c['phone'])} · ${c['orders']} ${_n(c['orders']) == 1 ? 'order' : 'orders'}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                          ],
                        ),
                      ),
                      Text(money(c['spent']), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      // Where orders came from (tap one to see only it)
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _title('Where orders came from'),
              if (channels.isEmpty) const Text('No orders in this period yet.', style: TextStyle(color: Brand.muted)),
              for (final c in channels)
                InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () {
                    setState(() => _channel = _channel == '${c['channel']}' ? '' : '${c['channel']}');
                    _load();
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text('${c['label']}', style: TextStyle(fontWeight: FontWeight.w600, color: _channel == '${c['channel']}' ? Brand.blue : Brand.text))),
                            Text('${c['orders']} · ${money(c['sales'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(99),
                          child: LinearProgressIndicator(value: channelTotal > 0 ? (_n(c['sales']) / channelTotal).clamp(0.02, 1).toDouble() : 0, minHeight: 6, backgroundColor: Brand.lineSoft, color: Brand.blue),
                        ),
                      ],
                    ),
                  ),
                ),
              if (channels.isNotEmpty) _hint('Tap one to see only its numbers.'),
            ],
          ),
        ),
      ),
      if (website)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _title('Carts left at checkout'),
                Row(
                  children: [
                    for (final (label, key) in [('Left', 'left'), ('Reminded', 'reminded'), ('Came back', 'cameBack')])
                      Expanded(
                        child: Column(
                          children: [
                            Text('${carts[key] ?? 0}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                            Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                          ],
                        ),
                      ),
                  ],
                ),
                _hint('${_n(carts['value']) > 0 ? '${money(carts['value'])} still sitting in carts. ' : ''}People who typed their phone at checkout but did not order get one WhatsApp reminder an hour later.'),
              ],
            ),
          ),
        ),
    ];
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
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/reviews', {'organizationId': app.orgId});
      if (mounted) setState(() { _reviews = (d['reviews'] as List? ?? const []).cast<Map>(); _error = ''; });
    } catch (e) {
      if (!mounted) return;
      // Nothing shown yet: say so (not "No reviews yet"); a failed refresh keeps the list
      if (_reviews == null) {
        setState(() => _error = plain(e));
      } else {
        toast(context, plain(e));
      }
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
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
          ? (_error.isNotEmpty ? _failed(_error, _retry) : _loading())
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
  String _error = '';

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
      if (mounted) setState(() { _offers = (results[0]['discounts'] as List? ?? const []).cast<Map>(); _loyalty = results[1]['settings'] as Map?; _error = ''; });
    } catch (e) {
      if (!mounted) return;
      // Nothing shown yet: say so (not "No offers yet"); a failed refresh keeps the list
      if (_offers == null) {
        setState(() => _error = plain(e));
      } else {
        toast(context, plain(e));
      }
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
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
      floatingActionButton: list == null ? null : FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('New offer')),
      body: list == null
          ? (_error.isNotEmpty ? _failed(_error, _retry) : _loading())
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
                        // Three boxes side by side only when their names fit ("Points…", "Use fr…" on phones)
                        if (l['on'] == true) const SizedBox(height: 8),
                        if (l['on'] == true)
                          LayoutBuilder(builder: (context, box) {
                            final fields = [
                              TextFormField(initialValue: '${l['percent']}', keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Points back (%)'), onChanged: (v) => l['percent'] = num.tryParse(v) ?? 0),
                              TextFormField(initialValue: '${l['minUse']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Use from'), onChanged: (v) => l['minUse'] = int.tryParse(v) ?? 0),
                              TextFormField(initialValue: '${l['maxPercent']}', keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'At most %'), onChanged: (v) => l['maxPercent'] = int.tryParse(v) ?? 0),
                            ];
                            if (box.maxWidth >= MediaQuery.textScalerOf(context).scale(440)) {
                              return Row(children: [for (final (i, f) in fields.indexed) ...[if (i > 0) const SizedBox(width: 8), Expanded(child: f)]]);
                            }
                            return Column(children: [for (final (i, f) in fields.indexed) ...[if (i > 0) const SizedBox(height: 10), f]]);
                          }),
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
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Only for one customer (optional)', hintText: 'Their phone number', helperMaxLines: 3, helperText: 'Only orders with this phone can use the code.')),
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

/// One settings screen that loads from `path` and saves `{settings}` with PUT.
class _SettingsScreen extends StatefulWidget {
  const _SettingsScreen({required this.title, required this.path, required this.builder, this.intro = ''});
  final String title;
  final String path;
  final String intro;
  final List<Widget> Function(Map values, void Function(VoidCallback) update) builder;
  @override
  State<_SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<_SettingsScreen> {
  Map? _values;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get(widget.path, {'organizationId': app.orgId});
      if (mounted) setState(() => _values = Map.from((d['settings'] as Map?) ?? const {}));
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final d = await AppScope.read(context).ask(widget.path, {'settings': _values}, method: 'PUT');
      setState(() => _values = Map.from((d['settings'] as Map?) ?? _values!));
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
          ? (_error.isNotEmpty ? _failed(_error, _retry) : _loading())
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
  intro: 'Customers ask in My orders on your store; you accept or decline on the order and refund from there. Online payments go back through your Razorpay or Stripe.',
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
    const SizedBox(height: 14),
    TextFormField(initialValue: '${v['legalName'] ?? ''}', decoration: const InputDecoration(labelText: 'Name on GST certificate (optional)'), onChanged: (x) => v['legalName'] = x),
    const SizedBox(height: 14),
    TextFormField(initialValue: '${v['address'] ?? ''}', minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Address on the invoice (optional)', hintText: "Uses the shop's contact address when empty"), onChanged: (x) => v['address'] = x),
    const SizedBox(height: 14),
    DropdownButtonFormField<String>(
      initialValue: '${num.tryParse('${v['defaultRate'] ?? 0}') ?? 0}'.replaceAll(RegExp(r'\.0$'), ''),
      decoration: const InputDecoration(labelText: 'Usual GST rate', helperMaxLines: 3, helperText: 'For products without their own rate.'),
      items: [for (final r in {...gstRates, '${num.tryParse('${v['defaultRate'] ?? 0}') ?? 0}'.replaceAll(RegExp(r'\.0$'), '')}) DropdownMenuItem(value: r, child: Text('$r%'))],
      onChanged: (x) => update(() => v['defaultRate'] = num.tryParse(x ?? '0') ?? 0),
    ),
    const SizedBox(height: 14),
    TextFormField(initialValue: '${v['prefix'] ?? 'WEB'}', textCapitalization: TextCapitalization.characters, maxLength: 5, decoration: const InputDecoration(labelText: 'Invoice number starts with', helperMaxLines: 3, helperText: 'Like WEB/26-27/0001. Numbers start again each April.', counterText: ''), onChanged: (x) => v['prefix'] = x),
  ],
);

/// The WhatsApp messages the shop sends by itself: each on / off, with its template (send the suggested wording for
/// approval, edit it, see where it stands), as on the web.
Widget shopMessagesScreen() => const AutoMessagesScreen(
  title: 'WhatsApp messages',
  path: '/api/commerce/shop-messages',
  shop: true,
  intro: 'Sent as a normal message when the customer wrote to you in the last 24 hours. After that WhatsApp needs an approved template: send the suggested wording for approval, or change it first.',
);

/// Delivery partners: where each stands. Connecting a partner (keys, warehouse) is done on the web.
class DeliveryPartnersScreen extends StatefulWidget {
  const DeliveryPartnersScreen({super.key});
  @override
  State<DeliveryPartnersScreen> createState() => _DeliveryPartnersScreenState();
}

class _DeliveryPartnersScreenState extends State<DeliveryPartnersScreen> {
  Map? _data;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// A failed load says so, not "Not connected" for partners that may well be connected.
  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final d = await app.backend.get('/api/commerce/shipping', {'organizationId': app.orgId});
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
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
        subtitle: Text(p?['connected'] == true ? 'Connected. Book a pickup from the order page.' : 'Not connected'),
      ),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery partners')),
      body: d == null
          ? (_error.isNotEmpty ? _failed(_error, _retry) : _loading())
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
