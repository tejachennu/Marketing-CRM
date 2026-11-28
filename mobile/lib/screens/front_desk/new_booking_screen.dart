import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/attendance_logic.dart' show holidayOn;
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
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
  int? _dayOffset;
  String? _time;
  bool _tried = false;
  final _notes = TextEditingController();

  /// Today when the screen opened: the day chips and the picked day count from it, so a booking made just after
  /// midnight still lands on the day that was tapped.
  final DateTime _today = istNow();

  /// The business's hours and closed days (Setup), 10:00 am to 9:00 pm when not set.
  Map<String, dynamic> _settings = const {};
  int _minutes(Object? hhmm, int fallback) {
    final p = '${hhmm ?? ''}'.split(':');
    return p.length < 2 ? fallback : (int.tryParse(p[0]) ?? 0) * 60 + (int.tryParse(p[1]) ?? 0);
  }

  /// 0 = Sunday, as the server keeps closed days. A shop holiday (Attendance → Holidays) is closed too.
  bool _closedOn(int offset) {
    final closed = [for (final d in (_settings['closed_weekdays'] as List? ?? const [])) (d as num).toInt()];
    return closed.contains(_today.add(Duration(days: offset)).weekday % 7) || _holidayOn(offset) != null;
  }

  /// The shop's holiday on that day (its name), or null.
  String? _holidayOn(int offset) {
    final day = _today.add(Duration(days: offset));
    final date = '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
    final holiday = holidayOn(date, _settings['holidays']);
    return holiday == null ? null : '${holiday['name']}';
  }

  /// The picked day, or the first open day from today.
  int get _offset => _dayOffset ?? List.generate(14, (i) => i).firstWhere((i) => !_closedOn(i), orElse: () => 0);

  DateTime get _day => _today.add(Duration(days: _offset));

  List<String> get _times {
    final out = <String>[];
    final now = DateTime.now();
    final opens = _minutes(_settings['opens_at'], 10 * 60), closes = _minutes(_settings['closes_at'], 21 * 60);
    for (var minutes = opens; minutes + 30 <= closes; minutes += 30) {
      final h = minutes ~/ 60, m = minutes % 60;
      // Times already gone are left out (checked against the clock, so the list is right on any day)
      if (!fromIst(_day, h, m).isAfter(now)) continue;
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
    setState(() => _tried = true);
    if (name.isEmpty && '${_customer['phone'] ?? ''}'.isEmpty) return toast(context, 'Who is the booking for? Give a name or a mobile number.');
    if (phoneError('${_customer['phone'] ?? ''}') != null) return toast(context, 'Check the mobile number.');
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
    _settings = desk.settings;
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
                  child: CustomerPicker(
                    phoneError: _tried ? phoneError('${_customer['phone'] ?? ''}') : null,
                    nameError: _tried && '${_customer['name'] ?? ''}'.trim().isEmpty && '${_customer['phone'] ?? ''}'.isEmpty ? 'Give a name or a mobile number.' : null,
                    onChanged: (c) => setState(() => _customer = c),
                    onRepeat: (ids, staff) => setState(() {
                      _services = [
                        for (final id in ids)
                          if (desk.service(id) != null) id,
                      ];
                      final who = staff.whereType<String>().toSet();
                      _staff = who.length == 1 ? who.first : _staff;
                    }),
                  ),
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
                            day: _today.add(Duration(days: i)),
                            selected: _offset == i,
                            today: i == 0,
                            closed: _closedOn(i),
                            holiday: _holidayOn(i) != null,
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
                  child: _closedOn(_offset)
                      ? Text(
                          _holidayOn(_offset) != null
                              ? 'This day is a shop holiday (${_holidayOn(_offset)}). Pick another day.'
                              : 'You are closed on this day (Setup → Hours). Pick another day.',
                          style: const TextStyle(color: Brand.muted),
                        )
                      : times.isEmpty
                      ? Text(_offset == 0 ? 'No times left today. Pick another day.' : 'No times on this day. Pick another day.', style: const TextStyle(color: Brand.muted))
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
      bottomNavigationBar: KeyboardBar.wrap(SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(onPressed: () => _save(desk), icon: const Icon(Icons.event_available), label: Text(_time == null ? 'Book' : 'Book ${formatDay(_day)}, ${_label(_time!)}')),
        ),
      )),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({required this.day, required this.selected, required this.today, required this.onTap, this.closed = false, this.holiday = false});
  final DateTime day;
  final bool selected, today;

  /// The business is closed that day: greyed out, and it cannot be picked.
  final bool closed;

  /// Closed for a shop holiday: says "Holiday" instead of "Closed"
  final bool holiday;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: closed ? null : onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 56,
          decoration: BoxDecoration(
            color: selected ? Brand.blue : (closed ? Brand.page : Colors.white),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? Brand.blue : Brand.border),
          ),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  closed ? (holiday ? 'Holiday' : 'Closed') : (today ? 'Today' : names[day.weekday - 1]),
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: selected ? Colors.white70 : Brand.muted),
                ),
                Text(
                  '${day.day}',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: selected ? Colors.white : (closed ? Brand.faint : Brand.navy)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
