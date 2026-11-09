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
import 'reviews_team.dart';
import 'setup_screen.dart';

/// Front Desk: today's visits and the bills, with New bill and Book at hand. Works offline.
class FrontDeskScreen extends StatefulWidget {
  const FrontDeskScreen({super.key, this.initialTab = 0});
  final int initialTab;
  @override
  State<FrontDeskScreen> createState() => _FrontDeskScreenState();
}

class _FrontDeskScreenState extends State<FrontDeskScreen> {
  late int _tab = widget.initialTab;
  String _date = istToday();
  DateRangeChoice _bills = const DateRangeChoice('week');

  String get _billsKey => FrontDesk.billsKey(_bills.preset, from: _bills.from, to: _bills.to);

  void _showDay(String date) {
    setState(() => _date = date);
    AppScope.read(context).load(AppState.dayKey(date), '/api/salon/appointments', query: {'date': date}, force: true);
  }

  void _showBills(DateRangeChoice range) {
    setState(() => _bills = range);
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
    final desk = FrontDesk(app, date: _date, invoicesKey: _billsKey);
    final manage = app.can('manage');
    if (!manage && _tab > 1) _tab = 0;
    if (!app.frontDeskOn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Front Desk')),
        body: const EmptyState(icon: Icons.storefront_outlined, title: 'Front Desk is off', text: 'An admin can switch it on in Connectors on the web. Then bookings and bills appear here.'),
      );
    }
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
              '${desk.businessName} · ${formatDay(istNow())}',
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.muted),
            ),
          ],
        ),
        actions: [
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
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(50),
          child: FilterChips(
            padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
            children: [
              for (final (i, label) in [
                (0, 'Visits'),
                (1, 'Bills'),
                if (manage) ...[(2, 'Reviews'), (3, 'Team')],
              ])
                ChoiceChip(label: Text(label), selected: _tab == i, onSelected: (_) => setState(() => _tab = i)),
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          SyncBanner(cacheKey: AppState.dayKey(istToday())),
          Expanded(
            child: RefreshIndicator(
              onRefresh: app.syncNow,
              child: _tab == 2
                  ? const ReviewsTab()
                  : _tab == 3
                  ? const TeamTab()
                  : app.isLoading(_tab == 0 ? AppState.dayKey(_date) : _billsKey) || app.isLoading('setup')
                  ? const SkeletonCards()
                  : _tab == 0
                  ? _Today(desk: desk, onDay: _showDay)
                  : _Bills(desk: desk, range: _bills, onRange: _showBills),
            ),
          ),
        ],
      ),
      // The two counter actions, as WhatsApp's buttons in the corner
      floatingActionButton: app.can('write') && _tab < 2
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

class _Today extends StatelessWidget {
  const _Today({required this.desk, required this.onDay});
  final FrontDesk desk;
  final ValueChanged<String> onDay;

  @override
  Widget build(BuildContext context) {
    final appointments = desk.appointments;
    final requests = desk.requests;
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
          _DayStrip(date: desk.date, onChanged: onDay),
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
          if (requests.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _WhatsAppBookings(desk: desk, requests: requests),
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

/// Days as round bubbles in a row, like WhatsApp's status bar: swipe to another day, or pick one.
class _DayStrip extends StatefulWidget {
  const _DayStrip({required this.date, required this.onChanged});
  final String date;
  final ValueChanged<String> onChanged;
  @override
  State<_DayStrip> createState() => _DayStripState();
}

class _DayStripState extends State<_DayStrip> {
  static const _before = 3, _after = 13;
  final _scroll = ScrollController(initialScrollOffset: (_DayStripState._before - 0.6) * 68);

  @override
  Widget build(BuildContext context) {
    final picked = DateTime.parse(widget.date);
    final today = DateTime.parse(istToday());
    final f = DateFormat('yyyy-MM-dd');
    // Around the picked day, but always with today in it
    final start = (picked.isBefore(today) ? picked : today).subtract(const Duration(days: _before));
    final days = [for (var i = 0; i <= _before + _after + picked.difference(today).inDays.abs(); i++) start.add(Duration(days: i))];
    return SizedBox(
      height: 96,
      child: ListView(
        controller: _scroll,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
        children: [
          _Bubble(
            top: Icons.calendar_month_outlined,
            label: 'Pick day',
            selected: false,
            onTap: () async {
              final day = await showDatePicker(context: context, initialDate: picked, firstDate: DateTime(today.year - 2), lastDate: DateTime(today.year + 1, 12, 31));
              if (day != null) widget.onChanged(f.format(day));
            },
          ),
          for (final d in days)
            _Bubble(
              number: '${d.day}',
              label: d == today ? 'Today' : (d.difference(today).inDays == 1 ? 'Tomorrow' : DateFormat('EEE').format(d)),
              selected: f.format(d) == widget.date,
              today: d == today,
              onTap: () => widget.onChanged(f.format(d)),
            ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({this.number, this.top, required this.label, required this.selected, this.today = false, required this.onTap});
  final String? number;
  final IconData? top;
  final String label;
  final bool selected, today;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: SizedBox(
      width: 68,
      child: Column(
        children: [
          // The ring shows the picked day, as WhatsApp's ring shows a new status
          Container(
            width: 54,
            height: 54,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: selected ? Brand.green : (today ? Brand.border : Colors.transparent), width: 2.5),
            ),
            child: Container(
              alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: selected ? Brand.blue : Brand.page),
              child: top != null
                  ? Icon(top, color: Brand.textSoft, size: 22)
                  : Text(
                      number!,
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: selected ? Colors.white : Brand.text),
                    ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, fontWeight: selected ? FontWeight.w700 : FontWeight.w500, color: selected ? Brand.navy : Brand.muted),
          ),
        ],
      ),
    ),
  );
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
        Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
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
      trailing: Text('${local ? '≈ ' : ''}${formatRupees(i['total'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
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
    final auto = desk.settings['auto_approve_bookings'] == true;
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
                  child: Text('${requests.length} booking request${requests.length == 1 ? '' : 's'} from WhatsApp', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
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
          if (app.can('manage'))
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 0, 4),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Accept new WhatsApp bookings on their own',
                      style: TextStyle(fontSize: 13, color: Brand.textSoft, fontWeight: FontWeight.w600),
                    ),
                  ),
                  Transform.scale(
                    scale: 0.85,
                    child: Switch(
                      value: auto,
                      activeThumbColor: Colors.white,
                      activeTrackColor: Brand.blue,
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
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
