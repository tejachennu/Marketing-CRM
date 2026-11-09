import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'appointment_screen.dart';
import 'bill_screen.dart';
import 'checkout_screen.dart';
import 'logic.dart';
import 'new_bill_screen.dart';
import 'new_booking_screen.dart';
import 'range_bar.dart';
import 'setup_screen.dart';

/// Front Desk: two tabs as in WhatsApp — Bookings (the day's visits) and Requests (WhatsApp bookings
/// waiting for a yes). Today first; the calendar opens any other day. Works offline.
class FrontDeskScreen extends StatefulWidget {
  const FrontDeskScreen({super.key, this.initialTab = 0});

  /// 0 Bookings, 1 Requests.
  final int initialTab;
  @override
  State<FrontDeskScreen> createState() => _FrontDeskScreenState();
}

class _FrontDeskScreenState extends State<FrontDeskScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 2, vsync: this, initialIndex: widget.initialTab.clamp(0, 1))..addListener(() => setState(() {}));
  String _date = istToday();

  void _showDay(String date) {
    setState(() => _date = date);
    AppScope.read(context).load(AppState.dayKey(date), '/api/salon/appointments', query: {'date': date}, force: true);
  }

  Future<void> _pickDay() async {
    final d = DateTime.parse(_date);
    final today = DateTime.parse(istToday());
    final picked = await showDatePicker(context: context, initialDate: d, firstDate: DateTime(today.year - 2), lastDate: DateTime(today.year + 1, 12, 31), helpText: 'Show bookings for');
    if (picked != null) _showDay(DateFormat('yyyy-MM-dd').format(picked));
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, date: _date);
    final manage = app.can('manage');
    if (!app.frontDeskOn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Front Desk')),
        body: const EmptyState(icon: Icons.storefront_outlined, title: 'Front Desk is off', text: 'An admin can switch it on in Connectors on the web. Then bookings and bills appear here.'),
      );
    }
    final requests = desk.requests.length;
    return Scaffold(
      appBar: AppBar(
        // Like WhatsApp's own name at the top of its home screen, in its green
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Front Desk',
              style: TextStyle(color: Color(0xFF1DAA61), fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4),
            ),
            Text(
              desk.businessName,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.muted),
            ),
          ],
        ),
        actions: [
          IconButton(tooltip: 'Pick a day', onPressed: _pickDay, icon: const Icon(Icons.calendar_month_outlined)),
          if (manage)
            IconButton(
              tooltip: 'Setup',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SetupScreen())),
              icon: const Icon(Icons.tune),
            ),
          IconButton(
            tooltip: 'Sync now',
            onPressed: () => app.syncNow(),
            icon: app.syncing || app.refreshing ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.sync),
          ),
        ],
        // Two clear tabs, as WhatsApp's tabs: a green line under the open one
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: Brand.blue,
          indicatorWeight: 3,
          indicatorSize: TabBarIndicatorSize.tab,
          labelColor: Brand.blue,
          unselectedLabelColor: Brand.muted,
          labelStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
          unselectedLabelStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
          dividerColor: Brand.line,
          tabs: [
            const Tab(text: 'Bookings'),
            Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Requests'),
                  if (requests > 0) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                      decoration: BoxDecoration(color: Brand.green, borderRadius: BorderRadius.circular(99)),
                      child: Text(
                        '$requests',
                        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          SyncBanner(cacheKey: AppState.dayKey(istToday())),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                RefreshIndicator(
                  onRefresh: app.syncNow,
                  child: app.isLoading(AppState.dayKey(_date)) || app.isLoading('setup') ? const SkeletonCards() : _Today(desk: desk, onDay: _showDay, onPick: _pickDay),
                ),
                RefreshIndicator(
                  onRefresh: app.syncNow,
                  child: _Requests(desk: desk),
                ),
              ],
            ),
          ),
        ],
      ),
      // The two counter actions, as WhatsApp's buttons in the corner
      floatingActionButton: app.can('write') && _tabs.index == 0
          ? Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                FloatingActionButton.extended(
                  heroTag: 'fab-book',
                  backgroundColor: Colors.white,
                  foregroundColor: Brand.navy,
                  elevation: 2,
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewBookingScreen())),
                  icon: const Icon(Icons.event_available_outlined),
                  label: const Text('Book'),
                ),
                const SizedBox(height: 12),
                FloatingActionButton.extended(
                  heroTag: 'fab-bill',
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewBillScreen())),
                  icon: const Icon(Icons.receipt_long),
                  label: const Text('New bill'),
                ),
              ],
            )
          : null,
    );
  }
}

/// WhatsApp booking requests: Approve or Decline each, Accept all, and the switch to accept them on their own.
class _Requests extends StatelessWidget {
  const _Requests({required this.desk});
  final FrontDesk desk;
  @override
  Widget build(BuildContext context) {
    final requests = desk.requests;
    return ColoredBox(
      color: Colors.white,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
        children: [
          if (requests.isEmpty) ...[
            const EmptyState(icon: Icons.mark_chat_read_outlined, title: 'No requests waiting', text: 'When customers book on WhatsApp, their requests wait here for you to approve.'),
            if (AppScope.of(context).can('manage')) _AutoAccept(desk: desk),
          ] else
            _WhatsAppBookings(desk: desk, requests: requests),
        ],
      ),
    );
  }
}

/// The bills, on their own tab at the bottom: a date range, what came in, what is still to collect.
class BillsScreen extends StatefulWidget {
  const BillsScreen({super.key});
  @override
  State<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends State<BillsScreen> {
  DateRangeChoice _range = const DateRangeChoice('week');
  String get _key => FrontDesk.billsKey(_range.preset, from: _range.from, to: _range.to);

  void _show(DateRangeChoice range) {
    setState(() => _range = range);
    AppScope.read(context).load(
      FrontDesk.billsKey(range.preset, from: range.from, to: range.to),
      '/api/salon/invoices',
      query: range.query,
      force: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, invoicesKey: _key);
    return Scaffold(
      appBar: AppBar(title: const Text('Bills')),
      body: Column(
        children: [
          SyncBanner(cacheKey: _key),
          Expanded(
            child: RefreshIndicator(
              onRefresh: app.syncNow,
              child: app.isLoading(_key) ? const SkeletonCards() : _Bills(desk: desk, range: _range, onRange: _show),
            ),
          ),
        ],
      ),
      floatingActionButton: app.can('write')
          ? FloatingActionButton.extended(
              heroTag: 'fab-bills-new',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewBillScreen())),
              icon: const Icon(Icons.receipt_long),
              label: const Text('New bill'),
            )
          : null,
    );
  }
}

class _Today extends StatelessWidget {
  const _Today({required this.desk, required this.onDay, required this.onPick});
  final FrontDesk desk;
  final ValueChanged<String> onDay;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final appointments = desk.appointments;
    final gone = ['cancelled', 'no_show', 'declined'];
    final visits = appointments.where((a) => !gone.contains(a['status'])).length;
    final waiting = appointments.where((a) => a['status'] == 'booked').length;
    final inNow = appointments.where((a) => a['status'] == 'arrived' || a['status'] == 'in_service').toList();
    final coming = appointments.where((a) => a['status'] == 'booked').toList();
    final done = appointments.where((a) => a['status'] == 'completed' || gone.contains(a['status'])).toList();
    Widget group(String title, List<Map<String, dynamic>> list) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Text(
            '$title · ${list.length}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.muted),
          ),
        ),
        for (var i = 0; i < list.length; i++) ...[if (i > 0) const Divider(indent: 78), _AppointmentRow(appointment: list[i], desk: desk)],
      ],
    );
    return ColoredBox(
      color: Colors.white,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 150),
        children: [
          _DayHeader(date: desk.date, onToday: () => onDay(istToday()), onPick: onPick),
          Container(
            margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                _Mini(value: '$visits', label: desk.isToday ? 'Visits today' : 'Visits'),
                _Mini(value: '$waiting', label: 'Still to come'),
                _Mini(value: shortRupees(desk.collectedToday), label: 'Collected'),
              ],
            ),
          ),
          if (appointments.isEmpty)
            EmptyState(icon: Icons.event_available_outlined, title: desk.isToday ? 'No visits today yet' : 'No visits this day', text: 'Tap Book to add one, or New bill for a walk-in.')
          else ...[
            if (inNow.isNotEmpty) group('In now', inNow),
            if (coming.isNotEmpty) group('Coming up', coming),
            if (done.isNotEmpty) group('Done', done),
          ],
        ],
      ),
    );
  }
}

/// Which day is shown: Today by default; the calendar picks another, and "Today" comes back.
class _DayHeader extends StatelessWidget {
  const _DayHeader({required this.date, required this.onToday, required this.onPick});
  final String date;
  final VoidCallback onToday, onPick;
  @override
  Widget build(BuildContext context) {
    final d = DateTime.parse(date);
    final diff = d.difference(DateTime.parse(istToday())).inDays;
    final name = diff == 0 ? 'Today' : (diff == 1 ? 'Tomorrow' : (diff == -1 ? 'Yesterday' : DateFormat('EEEE').format(d)));
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: onPick,
              borderRadius: BorderRadius.circular(10),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Flexible(
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: name,
                              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.navy),
                            ),
                            TextSpan(
                              text: '  ${DateFormat('d MMM').format(d)}',
                              style: const TextStyle(fontSize: 15, color: Brand.muted),
                            ),
                          ],
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.arrow_drop_down, color: Brand.muted),
                  ],
                ),
              ),
            ),
          ),
          if (diff != 0)
            TextButton.icon(onPressed: onToday, icon: const Icon(Icons.today, size: 18), label: const Text('Today'))
          else
            TextButton.icon(onPressed: onPick, icon: const Icon(Icons.calendar_month_outlined, size: 18), label: const Text('Other day')),
        ],
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.value, required this.label});
  final String value, label;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            value,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.navy),
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12.5, color: Brand.muted),
        ),
      ],
    ),
  );
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, required this.note});
  final String label, value, note;
  @override
  Widget build(BuildContext context) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.muted),
        ),
        const SizedBox(height: 6),
        Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
        const SizedBox(height: 2),
        Text(
          note,
          style: const TextStyle(fontSize: 12.5, color: Brand.muted),
          overflow: TextOverflow.ellipsis,
        ),
      ],
    ),
  );
}

class _AppointmentRow extends StatelessWidget {
  const _AppointmentRow({required this.appointment, required this.desk});
  final Map<String, dynamic> appointment;
  final FrontDesk desk;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final status = '${a['status']}';
    final services = (a['services'] as List? ?? const []).map((s) => s['name']).join(', ');
    final staff = desk.staffName(a['staff_id']);
    final done = ['completed', 'cancelled', 'no_show'].contains(status);
    final app = AppScope.read(context);
    void step(String label, String to) {
      app.counterAction(kind: 'appointment', label: '$label · ${a['customer_name']}', action: {'type': 'set_status', 'status': to, 'appointment_id': a['id']});
      toast(context, app.online ? '$label.' : '$label. It syncs when you are online.');
    }

    Widget small(String label, VoidCallback onPressed, {bool primary = false}) {
      final style = ButtonStyle(
        visualDensity: VisualDensity.compact,
        minimumSize: const WidgetStatePropertyAll(Size(0, 32)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 14)),
        shape: const WidgetStatePropertyAll(StadiumBorder()),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
      );
      return primary ? FilledButton(style: style, onPressed: onPressed, child: Text(label)) : OutlinedButton(style: style, onPressed: onPressed, child: Text(label));
    }

    // The next step, one tap from the list (today only; changes made on this phone wait to sync first)
    final canStep = desk.isToday && a['_outbox'] == null && a['_changing'] != true && app.can('write');
    final Widget? next = !canStep
        ? null
        : switch (status) {
            'booked' => small('Arrived', () => step('Marked arrived', 'arrived')),
            'arrived' => small('Start', () => step('Started', 'in_service')),
            'in_service' => small(
              'Bill',
              () => Navigator.push(
                context,
                MaterialPageRoute<bool>(
                  builder: (_) => CheckoutScreen(appointment: a, date: desk.date),
                ),
              ),
              primary: true,
            ),
            _ => null,
          };
    final tone = status == 'in_service' || status == 'arrived'
        ? PillTone.blue
        : status == 'no_show'
        ? PillTone.red
        : PillTone.grey;
    return InkWell(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => AppointmentScreen(appointmentId: '${a['id']}', date: desk.date),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Opacity(opacity: done ? 0.55 : 1, child: Avatar('${a['customer_name']}', size: 48)),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${a['customer_name']}',
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w600, color: done ? Brand.muted : Brand.text),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        formatTime(a['starts_at']),
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: status == 'in_service' || status == 'arrived' ? Brand.blue : Brand.muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [services, if (staff.isNotEmpty) 'with $staff'].join(' '),
                    style: const TextStyle(fontSize: 14, color: Brand.muted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            Pill(statusLabels[status] ?? status, tone: tone),
                            if (a['source'] == 'chat') const Pill('WhatsApp', icon: Icons.chat_bubble_outline),
                            if (a['_outbox'] != null || a['_changing'] == true) WaitingPill(failed: a['_failed'] == true),
                          ],
                        ),
                      ),
                      ?next,
                    ],
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

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request});
  final Map<String, dynamic> request;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    final r = request;
    final start = DateTime.tryParse('${r['starts_at']}');
    final services = (r['services'] as List? ?? const []).map((s) => s['name']).join(', ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Avatar('${r['customer_name']}', size: 38),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${r['customer_name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      Text('$services · ${start == null ? '' : '${formatDay(toIst(start))}, ${formatTime(r['starts_at'])}'}', style: const TextStyle(fontSize: 13, color: Brand.muted)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      app.counterAction(kind: 'appointment', label: 'Decline ${r['customer_name']}', action: {'type': 'decline_request', 'appointment_id': r['id']});
                      toast(context, app.online ? 'Request declined.' : 'Declined. It will sync when you are online.');
                    },
                    child: const Text('Decline'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      app.counterAction(kind: 'appointment', label: 'Approve ${r['customer_name']}', action: {'type': 'approve_request', 'appointment_id': r['id']});
                      toast(context, app.online ? 'Booking approved. The customer gets a WhatsApp.' : 'Approved. It will sync when you are online.');
                    },
                    child: const Text('Approve'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Bills extends StatelessWidget {
  const _Bills({required this.desk, required this.range, required this.onRange});
  final FrontDesk desk;
  final DateRangeChoice range;
  final ValueChanged<DateRangeChoice> onRange;

  @override
  Widget build(BuildContext context) {
    final invoices = desk.invoices;
    final paid = invoices.where((i) => i['status'] == 'paid');
    final unpaid = invoices.where((i) => i['status'] == 'unpaid');
    final summary = desk.billsSummary;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 150),
      children: [
        RangeBar(value: range, onChanged: onRange),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _Tile(
                label: 'Collected',
                value: shortRupees((summary['collected'] as num?) ?? paid.fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0))),
                note: '${summary['paidCount'] ?? paid.length} paid · ${range.label.toLowerCase()}',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _Tile(label: 'To collect', value: shortRupees(unpaid.fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0))), note: '${unpaid.length} unpaid'),
            ),
          ],
        ),
        const SectionLabel('Bills'),
        if (invoices.isEmpty)
          const Panel(
            child: EmptyState(icon: Icons.receipt_long_outlined, title: 'No bills yet', text: 'Bills you make here show up straight away, even offline.'),
          )
        else
          Card(
            child: Column(
              children: [
                for (var i = 0; i < invoices.length; i++) ...[if (i > 0) const Divider(indent: 16), _BillRow(invoice: invoices[i], invoicesKey: desk.invoicesKey)],
              ],
            ),
          ),
      ],
    );
  }
}

class _BillRow extends StatelessWidget {
  const _BillRow({required this.invoice, required this.invoicesKey});
  final Map<String, dynamic> invoice;
  final String invoicesKey;
  @override
  Widget build(BuildContext context) {
    final i = invoice;
    final status = '${i['status']}';
    final local = i['_outbox'] != null;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      onTap: local
          ? () => Navigator.pushNamed(context, '/sync')
          : () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => BillScreen(invoiceId: '${i['id']}', invoicesKey: invoicesKey),
              ),
            ),
      title: Text(
        '${i['customer_name']}',
        style: TextStyle(fontWeight: FontWeight.w700, color: status == 'void' ? Brand.faint : Brand.text, decoration: status == 'void' ? TextDecoration.lineThrough : null),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          spacing: 6,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(local ? 'New bill' : '${i['number']} · ${formatWhen(i['issued_at'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            if (local || i['_changing'] == true)
              WaitingPill(failed: i['_failed'] == true)
            else
              Pill(
                status == 'paid'
                    ? (paymentLabels[i['payment_method']] ?? 'Paid')
                    : status == 'void'
                    ? 'Cancelled'
                    : 'Unpaid',
                tone: status == 'unpaid' ? PillTone.red : PillTone.grey,
              ),
          ],
        ),
      ),
      trailing: Text('${local ? '≈ ' : ''}${formatRupees(i['total'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
    );
  }
}

/// Booking requests from WhatsApp in one card: each with Decline / Approve, Accept all, and (for
/// managers) the switch to accept them on their own from now on.
class _WhatsAppBookings extends StatelessWidget {
  const _WhatsAppBookings({required this.desk, required this.requests});
  final FrontDesk desk;
  final List<Map<String, dynamic>> requests;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 0, 6),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(color: Brand.red, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('${requests.length} booking request${requests.length == 1 ? '' : 's'} from WhatsApp', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
                ),
                if (requests.length > 1)
                  TextButton.icon(
                    onPressed: () async {
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: Text('Accept all ${requests.length}?'),
                          content: const Text('Each customer gets a WhatsApp confirmation.'),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Accept all')),
                          ],
                        ),
                      );
                      if (ok != true) return;
                      for (final r in requests) {
                        await app.counterAction(kind: 'appointment', label: 'Approve ${r['customer_name']}', action: {'type': 'approve_request', 'appointment_id': r['id']});
                      }
                      if (context.mounted) toast(context, app.online ? 'All accepted. Customers get a WhatsApp.' : 'All accepted. It syncs when you are online.');
                    },
                    icon: const Icon(Icons.done_all, size: 18),
                    label: const Text('Accept all'),
                  ),
              ],
            ),
          ),
          for (final r in requests) _RequestCard(request: r),
          if (app.can('manage')) _AutoAccept(desk: desk),
        ],
      ),
    );
  }
}

/// The switch to accept WhatsApp bookings on their own (managers).
class _AutoAccept extends StatelessWidget {
  const _AutoAccept({required this.desk});
  final FrontDesk desk;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final auto = desk.settings['auto_approve_bookings'] == true;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 0, 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Accept WhatsApp bookings on their own', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                Text(auto ? 'On: a free time a customer picks is booked at once.' : 'Off: each booking waits here for you.', style: const TextStyle(fontSize: 13, color: Brand.muted)),
              ],
            ),
          ),
          Switch(
            value: auto,
            onChanged: (on) {
              app.enqueue(
                kind: 'settings',
                label: on ? 'Accept bookings on their own' : 'Accept bookings by hand',
                method: 'PATCH',
                path: '/api/salon/settings',
                body: {'organizationId': app.orgId, 'auto_approve_bookings': on},
              );
              toast(context, on ? 'New WhatsApp bookings are accepted on their own.' : 'New WhatsApp bookings wait for you to accept.');
            },
          ),
        ],
      ),
    );
  }
}
