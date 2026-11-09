import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'appointment_screen.dart';
import 'bill_screen.dart';
import 'logic.dart';
import 'new_bill_screen.dart';
import 'new_booking_screen.dart';

/// Front Desk: today's visits and the bills, with New bill and Book at hand. Works offline.
class FrontDeskScreen extends StatefulWidget {
  const FrontDeskScreen({super.key, this.initialTab = 0});
  final int initialTab;
  @override
  State<FrontDeskScreen> createState() => _FrontDeskScreenState();
}

class _FrontDeskScreenState extends State<FrontDeskScreen> {
  late int _tab = widget.initialTab;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app);
    if (!app.frontDeskOn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Front Desk')),
        body: const EmptyState(icon: Icons.storefront_outlined, title: 'Front Desk is off', text: 'An admin can switch it on in Connectors on the web. Then bookings and bills appear here.'),
      );
    }
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(11)),
            child: const Center(child: FrontDeskIcon(size: 24, color: Colors.white)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(desk.businessName, overflow: TextOverflow.ellipsis),
              Text('Front Desk · ${formatDay(istNow())}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: Brand.muted)),
            ]),
          ),
        ]),
        actions: [
          IconButton(tooltip: 'Sync now', onPressed: () => app.syncNow(), icon: app.syncing || app.refreshing ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.sync)),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: SegmentedButton<int>(
              showSelectedIcon: false,
              style: SegmentedButton.styleFrom(selectedBackgroundColor: Brand.navy, selectedForegroundColor: Colors.white, side: const BorderSide(color: Brand.border)),
              segments: const [
                ButtonSegment(value: 0, label: Text('Today'), icon: Icon(Icons.event_note_outlined, size: 18)),
                ButtonSegment(value: 1, label: Text('Bills'), icon: Icon(Icons.receipt_long_outlined, size: 18)),
              ],
              selected: {_tab},
              onSelectionChanged: (s) => setState(() => _tab = s.first),
            ),
          ),
        ),
      ),
      body: Column(children: [
        SyncBanner(cacheKey: AppState.dayKey(istToday())),
        Expanded(child: RefreshIndicator(onRefresh: app.syncNow, child: _tab == 0 ? _Today(desk: desk) : _Bills(desk: desk))),
      ]),
      bottomNavigationBar: app.can('write')
          ? SafeArea(
              top: false,
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
                child: Row(children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewBookingScreen())), icon: const Icon(Icons.event_available_outlined), label: const Text('Book'))),
                  const SizedBox(width: 10),
                  Expanded(child: FilledButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewBillScreen())), icon: const Icon(Icons.receipt_long), label: const Text('New bill'))),
                ]),
              ),
            )
          : null,
    );
  }
}

class _Today extends StatelessWidget {
  const _Today({required this.desk});
  final FrontDesk desk;

  @override
  Widget build(BuildContext context) {
    final appointments = desk.appointments;
    final requests = desk.requests;
    final visits = appointments.where((a) => !['cancelled', 'no_show', 'declined'].contains(a['status'])).length;
    final waiting = appointments.where((a) => a['status'] == 'booked').length;
    return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: [
      Row(children: [
        Expanded(child: _Tile(label: 'Visits today', value: '$visits', note: '$waiting still to come')),
        const SizedBox(width: 10),
        Expanded(child: _Tile(label: 'Collected', value: shortRupees(desk.collectedToday), note: 'Paid bills today')),
      ]),
      if (requests.isNotEmpty) ...[
        SectionLabel('Booking requests · ${requests.length}'),
        for (final r in requests) _RequestCard(request: r),
      ],
      SectionLabel('Today · ${appointments.length}'),
      if (appointments.isEmpty)
        const Panel(child: EmptyState(icon: Icons.event_busy_outlined, title: 'No bookings today', text: 'Tap Book to add one, or New bill for a walk-in.'))
      else
        Card(
          child: Column(children: [
            for (var i = 0; i < appointments.length; i++) ...[
              if (i > 0) const Divider(indent: 72),
              _AppointmentRow(appointment: appointments[i], desk: desk),
            ],
          ]),
        ),
    ]);
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, required this.note});
  final String label, value, note;
  @override
  Widget build(BuildContext context) => Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.muted)),
          const SizedBox(height: 6),
          Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
          const SizedBox(height: 2),
          Text(note, style: const TextStyle(fontSize: 12.5, color: Brand.muted), overflow: TextOverflow.ellipsis),
        ]),
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
    return InkWell(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AppointmentScreen(appointmentId: '${a['id']}'))),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 50,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(formatTime(a['starts_at']).replaceAll(' ', '\n'), style: TextStyle(fontSize: 14, height: 1.15, fontWeight: FontWeight.w800, color: done ? Brand.faint : Brand.navy)),
            ]),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${a['customer_name']}', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: done ? Brand.muted : Brand.text)),
              const SizedBox(height: 2),
              Text([services, if (staff.isNotEmpty) 'with $staff'].join(' '), style: const TextStyle(fontSize: 13, color: Brand.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 4, children: [
                Pill(statusLabels[status] ?? status, tone: status == 'in_service' || status == 'arrived' ? PillTone.blue : status == 'no_show' ? PillTone.red : PillTone.grey),
                if (a['source'] == 'chat') const Pill('From WhatsApp', icon: Icons.chat_bubble_outline),
                if (a['_outbox'] != null || a['_changing'] == true) WaitingPill(failed: a['_failed'] == true),
              ]),
            ]),
          ),
          const Icon(Icons.chevron_right, color: Brand.faint),
        ]),
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
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Avatar('${r['customer_name']}', size: 38),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${r['customer_name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                Text('$services · ${start == null ? '' : '${formatDay(toIst(start))}, ${formatTime(r['starts_at'])}'}', style: const TextStyle(fontSize: 13, color: Brand.muted)),
              ]),
            ),
          ]),
          const SizedBox(height: 12),
          Row(children: [
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
          ]),
        ]),
      ),
    );
  }
}

class _Bills extends StatelessWidget {
  const _Bills({required this.desk});
  final FrontDesk desk;

  @override
  Widget build(BuildContext context) {
    final invoices = desk.invoices;
    final paid = invoices.where((i) => i['status'] == 'paid');
    final unpaid = invoices.where((i) => i['status'] == 'unpaid');
    return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: [
      Row(children: [
        Expanded(child: _Tile(label: 'Collected', value: shortRupees(paid.fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0))), note: '${paid.length} paid · last 7 days')),
        const SizedBox(width: 10),
        Expanded(child: _Tile(label: 'To collect', value: shortRupees(unpaid.fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0))), note: '${unpaid.length} unpaid')),
      ]),
      const SectionLabel('Bills'),
      if (invoices.isEmpty)
        const Panel(child: EmptyState(icon: Icons.receipt_long_outlined, title: 'No bills yet', text: 'Bills you make here show up straight away, even offline.'))
      else
        Card(
          child: Column(children: [
            for (var i = 0; i < invoices.length; i++) ...[
              if (i > 0) const Divider(indent: 16),
              _BillRow(invoice: invoices[i]),
            ],
          ]),
        ),
    ]);
  }
}

class _BillRow extends StatelessWidget {
  const _BillRow({required this.invoice});
  final Map<String, dynamic> invoice;
  @override
  Widget build(BuildContext context) {
    final i = invoice;
    final status = '${i['status']}';
    final local = i['_outbox'] != null;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      onTap: local ? () => Navigator.pushNamed(context, '/sync') : () => Navigator.push(context, MaterialPageRoute(builder: (_) => BillScreen(invoiceId: '${i['id']}'))),
      title: Text('${i['customer_name']}', style: TextStyle(fontWeight: FontWeight.w700, color: status == 'void' ? Brand.faint : Brand.text, decoration: status == 'void' ? TextDecoration.lineThrough : null)),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(local ? 'New bill' : '${i['number']} · ${formatWhen(i['issued_at'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          if (local || i['_changing'] == true)
            WaitingPill(failed: i['_failed'] == true)
          else
            Pill(status == 'paid' ? (paymentLabels[i['payment_method']] ?? 'Paid') : status == 'void' ? 'Cancelled' : 'Unpaid', tone: status == 'unpaid' ? PillTone.red : PillTone.grey),
        ]),
      ),
      trailing: Text('${local ? '≈ ' : ''}${formatRupees(i['total'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
    );
  }
}
