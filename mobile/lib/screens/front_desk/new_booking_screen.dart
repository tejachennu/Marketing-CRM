import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';
import 'pickers.dart';

/// Book a visit: customer, services, who, day and time. Offline, it is kept on the phone and
/// shown on Today straight away; the server confirms it (and messages the customer) on sync.
class NewBookingScreen extends StatefulWidget {
  const NewBookingScreen({super.key});
  @override
  State<NewBookingScreen> createState() => _NewBookingScreenState();
}

class _NewBookingScreenState extends State<NewBookingScreen> {
  Map<String, dynamic> _customer = const {};
  List<String> _services = [];
  String? _staff;
  int _dayOffset = 0;
  String? _time;
  final _notes = TextEditingController();

  DateTime get _day => istNow().add(Duration(days: _dayOffset));

  List<String> get _times {
    final out = <String>[];
    final now = istNow();
    for (var minutes = 10 * 60; minutes <= 20 * 60 + 30; minutes += 30) {
      final h = minutes ~/ 60, m = minutes % 60;
      if (_dayOffset == 0 && (h < now.hour || (h == now.hour && m <= now.minute))) continue;
      out.add('${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}');
    }
    return out;
  }

  String _label(String time) {
    final parts = time.split(':').map(int.parse).toList();
    final h = parts[0] % 12 == 0 ? 12 : parts[0] % 12;
    return '$h:${parts[1].toString().padLeft(2, '0')} ${parts[0] < 12 ? 'am' : 'pm'}';
  }

  Future<void> _save(FrontDesk desk) async {
    final app = AppScope.read(context);
    final name = '${_customer['name'] ?? ''}'.trim();
    if (name.isEmpty && '${_customer['phone'] ?? ''}'.isEmpty) return toast(context, 'Who is the booking for? Give a name or a mobile number.');
    if (_services.isEmpty) return toast(context, 'Choose at least one service.');
    if (_time == null) return toast(context, 'Choose a time.');
    final parts = _time!.split(':').map(int.parse).toList();
    final start = fromIst(_day, parts[0], parts[1]);
    final minutes = _services.map(desk.service).fold<int>(0, (s, x) => s + ((x?['duration_minutes'] as num?)?.toInt() ?? 30));
    final localId = AppState.newLocalId();
    final day = '${_day.year}-${_day.month.toString().padLeft(2, '0')}-${_day.day.toString().padLeft(2, '0')}';
    await app.counterAction(
      kind: 'booking',
      label: 'Booking for ${name.isEmpty ? _customer['phone'] : name} · ${formatDay(_day)}, ${_label(_time!)}',
      localId: localId,
      resultIdPath: 'appointment.id',
      action: {
        'type': 'create_appointment',
        'customer': {'contact_id': _customer['contact_id'], 'name': name, 'phone': _customer['phone']},
        'service_ids': _services,
        'staff_id': _staff,
        'starts_at': start.toIso8601String(),
        'notes': _notes.text.trim(),
        'send_whatsapp': true,
      },
      preview: {
        'day': day,
        'customer_name': name.isEmpty ? '${_customer['phone']}' : name,
        'customer_phone': _customer['phone'],
        'staff_id': _staff,
        'starts_at': start.toIso8601String(),
        'ends_at': start.add(Duration(minutes: minutes)).toIso8601String(),
        'status': 'booked',
        'services': [for (final id in _services) desk.service(id)],
        'notes': _notes.text.trim(),
      },
    );
    if (!mounted) return;
    toast(context, app.online ? 'Booked. The customer gets a WhatsApp confirmation.' : 'Booked on the phone. It syncs when you are online.');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final desk = FrontDesk(AppScope.of(context));
    final times = _times;
    return Scaffold(
      appBar: AppBar(title: const Text('Book a visit')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                FormSection(
                  title: 'Customer',
                  child: CustomerPicker(onChanged: (c) => _customer = c),
                ),
                FormSection(
                  title: 'Services',
                  child: ServicePicker(desk: desk, selected: _services, onChanged: (v) => setState(() => _services = v)),
                ),
                FormSection(
                  title: 'With',
                  child: StaffPicker(desk: desk, value: _staff, onChanged: (v) => setState(() => _staff = v)),
                ),
                FormSection(
                  title: 'Day',
                  child: SizedBox(
                    height: 64,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (var i = 0; i < 14; i++)
                          _DayChip(
                            day: istNow().add(Duration(days: i)),
                            selected: _dayOffset == i,
                            today: i == 0,
                            onTap: () => setState(() {
                              _dayOffset = i;
                              _time = null;
                            }),
                          ),
                      ],
                    ),
                  ),
                ),
                FormSection(
                  title: 'Time',
                  child: times.isEmpty
                      ? const Text('No times left today. Pick another day.', style: TextStyle(color: Brand.muted))
                      : Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [for (final t in times) ChoiceChip(label: Text(_label(t)), selected: _time == t, onSelected: (_) => setState(() => _time = t))],
                        ),
                ),
                FormSection(
                  title: 'Note (optional)',
                  child: TextField(
                    controller: _notes,
                    maxLines: 2,
                    decoration: const InputDecoration(hintText: 'Prefers Anitha, allergic to…'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(onPressed: () => _save(desk), icon: const Icon(Icons.event_available), label: Text(_time == null ? 'Book' : 'Book ${formatDay(_day)}, ${_label(_time!)}')),
        ),
      ),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({required this.day, required this.selected, required this.today, required this.onTap});
  final DateTime day;
  final bool selected, today;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 56,
          decoration: BoxDecoration(
            color: selected ? Brand.navy : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? Brand.navy : Brand.border),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                today ? 'Today' : names[day.weekday - 1],
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: selected ? Colors.white70 : Brand.muted),
              ),
              Text(
                '${day.day}',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: selected ? Colors.white : Brand.navy),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
