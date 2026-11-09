import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'checkout_screen.dart';
import 'logic.dart';

/// One visit: who, what, when, and the next step (arrived, started, done and billed).
class AppointmentScreen extends StatelessWidget {
  const AppointmentScreen({super.key, required this.appointmentId, this.date});
  final String appointmentId;

  /// The day it is on (today when not given).
  final String? date;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app, date: date);
    final a = desk.appointments.cast<Map<String, dynamic>?>().firstWhere((x) => '${x!['id']}' == appointmentId, orElse: () => null);
    if (a == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(icon: Icons.event_busy_outlined, title: 'Not found', text: 'This booking is not on today\'s list any more.'),
      );
    }
    final status = '${a['status']}';
    final services = [for (final s in (a['services'] as List? ?? const [])) Map<String, dynamic>.from(s ?? const {})];
    final total = services.fold<num>(0, (s, x) => s + (num.tryParse('${x['price']}') ?? 0));
    final staff = desk.staffName(a['staff_id']);

    void act(String label, Map<String, dynamic> action, {String kind = 'appointment', Map<String, dynamic>? preview, String? localId}) {
      app.counterAction(
        kind: kind,
        label: '$label · ${a['customer_name']}',
        action: {...action, 'appointment_id': a['id']},
        preview: preview,
        localId: localId,
        resultIdPath: localId == null ? null : 'invoice.id',
      );
      toast(context, app.online ? '$label.' : '$label. It syncs when you are online.');
    }

    Future<void> checkout() async {
      final billed = await Navigator.push(
        context,
        MaterialPageRoute<bool>(
          builder: (_) => CheckoutScreen(appointment: a, date: date),
        ),
      );
      if (billed == true && context.mounted) Navigator.pop(context);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Visit')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Panel(
                  child: Row(
                    children: [
                      Avatar('${a['customer_name']}', size: 52),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${a['customer_name']}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                            const SizedBox(height: 2),
                            Text('${a['customer_phone'] ?? 'No mobile number'}', style: const TextStyle(color: Brand.muted)),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              children: [
                                Pill(statusLabels[status] ?? status, tone: status == 'arrived' || status == 'in_service' ? PillTone.blue : PillTone.grey),
                                if (a['_outbox'] != null || a['_changing'] == true) WaitingPill(failed: a['_failed'] == true),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Panel(
                  child: Column(
                    children: [
                      _Line(icon: Icons.schedule, label: 'When', value: '${formatTime(a['starts_at'])} – ${formatTime(a['ends_at'])}'),
                      _Line(icon: Icons.person_outline, label: 'With', value: staff.isEmpty ? 'Anyone' : staff),
                      if ('${a['notes'] ?? ''}'.isNotEmpty) _Line(icon: Icons.notes, label: 'Note', value: '${a['notes']}'),
                    ],
                  ),
                ),
                const SectionLabel('Services'),
                Card(
                  child: Column(
                    children: [
                      for (final s in services)
                        ListTile(
                          title: Text('${s['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text('${s['duration_minutes']} min'),
                          trailing: Text(
                            formatRupees(s['price']),
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Brand.text),
                          ),
                        ),
                      const Divider(),
                      ListTile(
                        title: const Text('Total', style: TextStyle(fontWeight: FontWeight.w800)),
                        trailing: Text(
                          formatRupees(total),
                          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Brand.text),
                        ),
                      ),
                    ],
                  ),
                ),
                if (status == 'booked' || status == 'arrived' || status == 'in_service') ...[
                  const SizedBox(height: 18),
                  if (status == 'booked')
                    FilledButton.icon(onPressed: () => act('Marked arrived', {'type': 'set_status', 'status': 'arrived'}), icon: const Icon(Icons.how_to_reg), label: const Text('Arrived')),
                  if (status == 'arrived')
                    FilledButton.icon(onPressed: () => act('Started', {'type': 'set_status', 'status': 'in_service'}), icon: const Icon(Icons.play_arrow), label: const Text('Start service')),
                  if (status == 'in_service') FilledButton.icon(onPressed: checkout, icon: const Icon(Icons.receipt_long), label: const Text('Done · make the bill')),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(onPressed: () => act('Marked no-show', {'type': 'set_status', 'status': 'no_show'}), child: const Text('No-show')),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Brand.red,
                            side: const BorderSide(color: Color(0xFFF3C7C7)),
                          ),
                          onPressed: () => act('Cancelled', {'type': 'set_status', 'status': 'cancelled'}),
                          child: const Text('Cancel visit'),
                        ),
                      ),
                    ],
                  ),
                ],
                if (a['_outbox'] != null)
                  const Padding(
                    padding: EdgeInsets.only(top: 14),
                    child: Text('Made on this phone. Changes to it wait until the booking itself has synced.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label, value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 19, color: Brand.muted),
        const SizedBox(width: 10),
        SizedBox(
          width: 56,
          child: Text(label, style: const TextStyle(color: Brand.muted)),
        ),
        Expanded(
          child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
      ],
    ),
  );
}
