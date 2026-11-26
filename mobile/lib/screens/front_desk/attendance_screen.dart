import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/attendance_logic.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// Staff attendance (Team → Attendance, More → Attendance): today's team with one-tap Present / Absent / Leave /
/// Half day / Week off, "Mark all present", notes, leave from one day to another, a month calendar per person, and
/// the shop's holidays (one-off or repeating: no bookings, not working days).
/// Marks work offline: they wait in the outbox (sent with PUT / DELETE, safe to send again) and show at once.
/// Holidays change what customers can book, so they are saved online only.
/// People absent, on leave or on a week off are not offered for bookings that day.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key, this.startOnMonth = false, this.startOnHolidays = false, this.person});

  /// Open on the month or the holidays (previews), and on one person's calendar.
  final bool startOnMonth;
  final bool startOnHolidays;
  final String? person;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

/// Colours per status: green for in (the app's action colour), red only for absent, greys for the rest.
const _tones = {
  'present': (Brand.blueSoft, Brand.blue),
  'absent': (Brand.redSoft, Brand.red),
  'leave': (Color(0xFFE9EDEF), Brand.navy),
  'half_day': (Color(0xFFFFF3CD), Color(0xFF6B5200)),
  'week_off': (Brand.page, Brand.muted),
};

class _AttendanceScreenState extends State<AttendanceScreen> {
  String _day = istToday();
  String _month = istToday().substring(0, 7);
  late String _person = widget.person ?? '';
  final Set<String> _tried = {};
  int _pendingSeen = 0;

  String get _dayKey => 'attendance:$_day';
  String get _monthKey => 'attendance:month:$_month';
  static const _holidaysKey = 'holidays';
  static const _holidaysPath = '/api/salon/holidays';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load(_dayKey, {'day': _day});
      _load(_monthKey, {'month': _month});
      _loadHolidays();
    });
  }

  Future<void> _loadHolidays() async {
    if (!mounted) return;
    setState(() => _tried.remove(_holidaysKey));
    await AppScope.read(context).load(_holidaysKey, _holidaysPath, force: true);
    if (mounted) setState(() => _tried.add(_holidaysKey));
  }

  /// The shop's holidays: the holidays list when it has been read, else the last attendance answer, else the Front
  /// Desk settings on the phone (so they work offline too).
  List<Map<String, dynamic>> _rules(AppState app) => readHolidays(
    app.cached(_holidaysKey)?['holidays'] ?? app.cached(_dayKey)?['holidayRules'] ?? app.cached(_monthKey)?['holidayRules'] ?? FrontDesk(app).settings['holidays'],
  );

  /// After a holiday is saved or removed: keep the server's list, and read again what depends on it.
  Future<void> _afterHolidays(AppState app, Map<String, dynamic> data) async {
    await app.store.write(_holidaysKey, data);
    if (mounted) setState(() {});
    app.load('setup', '/api/salon/setup', force: true).ignore();
    _reloadBoth();
  }

  /// Add or change a holiday (online only). Throws with the server's words when it is refused.
  Future<Map<String, dynamic>> _saveHoliday(AppState app, Map<String, dynamic> holiday) async {
    final data = await app.ask(_holidaysPath, {'holiday': holiday});
    await _afterHolidays(app, data);
    return data;
  }

  Future<void> _editHoliday(AppState app, [Map<String, dynamic>? holiday]) async {
    final message = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HolidaySheet(holiday: holiday, save: (h) => _saveHoliday(app, h)),
    );
    if (message != null && mounted) toast(context, message);
  }

  Future<void> _quickAdd(AppState app, Map suggestion) async {
    try {
      final data = await _saveHoliday(app, {'name': suggestion['name'], 'start': suggestion['start'], 'days': 1, 'repeat': 'yearly'});
      if (mounted) toast(context, '${data['message'] ?? 'Holiday added.'}');
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _removeHoliday(AppState app, Map<String, dynamic> holiday) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Remove ${holiday['name']}?'),
        content: Text(
          holiday['repeat'] == 'none' ? 'Bookings can be taken that day again.' : 'It goes every time it repeats. Bookings can be taken on those days again.',
          style: const TextStyle(height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Remove')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final data = await app.ask(_holidaysPath, {'id': holiday['id']}, method: 'DELETE');
      await _afterHolidays(app, data);
      if (mounted) toast(context, '${data['message'] ?? 'Removed.'}');
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _load(String key, Map<String, String> query) async {
    if (!mounted) return;
    setState(() => _tried.remove(key));
    await AppScope.read(context).load(key, '/api/salon/attendance', query: query, force: true);
    if (mounted) setState(() => _tried.add(key));
  }

  void _reloadBoth() {
    _load(_dayKey, {'day': _day});
    _load(_monthKey, {'month': _month});
  }


  /// The changes still waiting to sync, oldest first.
  List<({String method, Map<String, dynamic> body})> _pending(AppState app) => [for (final item in app.pending('attendance')) (method: item.method, body: item.body)];

  List<int> _closed(AppState app) => [for (final d in (FrontDesk(app).settings['closed_weekdays'] as List? ?? const [])) (d as num).toInt()];

  /// The active team, from the Front Desk setup on the phone (else from the last attendance answer).
  List<Map<String, dynamic>> _team(AppState app) {
    final setup = FrontDesk(app).staff;
    final list = setup.isNotEmpty ? setup : [for (final m in (app.cached(_dayKey)?['staff'] ?? app.cached(_monthKey)?['staff'] ?? const []) as List) Map<String, dynamic>.from(m as Map)];
    return [for (final m in list) {'id': '${m['id']}', 'name': '${m['name']}'}];
  }

  /// The server's marks for a list with the waiting changes laid over them.
  List<Map<String, dynamic>> _marks(AppState app, String key) => applyPending(
    [for (final m in (app.cached(key)?['marks'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)],
    _pending(app),
    staffIds: [for (final m in _team(app)) '${m['id']}'],
    closed: _closed(app),
    holidays: _rules(app),
    today: istToday(),
  );

  /// Queue a change, and put it in the phone's copies at once (so it stays put when the queue empties).
  Future<void> _send(AppState app, String label, String method, Map<String, dynamic> body) async {
    await app.enqueue(kind: 'attendance', label: label, method: method, path: '/api/salon/attendance', body: body);
    for (final key in {_dayKey, _monthKey}) {
      final data = app.cached(key);
      if (data == null) continue;
      final marks = applyPending(
        [for (final m in (data['marks'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)],
        [(method: method, body: body)],
        staffIds: [for (final m in _team(app)) '${m['id']}'],
        closed: _closed(app),
        holidays: _rules(app),
        today: istToday(),
      );
      await app.store.write(key, {...data, 'marks': marks});
    }
    if (mounted) setState(() {});
  }

  /// Mark a person for the day shown. The kind of leave and the note stay as they were unless given ([setKind] to
  /// change the kind, null included).
  void _mark(AppState app, Map<String, dynamic> person, String status, {Map<String, dynamic>? before, bool setKind = false, String? kind, String? note}) {
    final oldKind = before?['status'] == 'leave' ? (before?['leave_kind']) : null;
    final mark = {
      'staff_id': person['id'],
      'day': _day,
      'status': status,
      'leave_kind': status == 'leave' ? (setKind ? kind : oldKind) : null,
      'note': note ?? (before?['note']),
    };
    _send(app, '${person['name']}: ${attendanceLabels[status]}', 'PUT', {
      'organizationId': app.orgId,
      'marks': [mark],
      'client_ref': '${DateTime.now().microsecondsSinceEpoch}',
    });
  }

  void _clear(AppState app, Map<String, dynamic> person) =>
      _send(app, '${person['name']}: mark taken off', 'DELETE', {'organizationId': app.orgId, 'staffId': person['id'], 'day': _day});

  Future<void> _editNote(AppState app, Map<String, dynamic> person, Map<String, dynamic> mark) async {
    final controller = TextEditingController(text: '${mark['note'] ?? ''}');
    final saved = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Note for ${person['name']}'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: noteMax,
          decoration: const InputDecoration(hintText: 'Like “back on Friday”'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (saved == null || !mounted) return;
    _mark(app, person, '${mark['status']}', before: {...mark, 'note': null}, note: saved.isEmpty ? null : saved);
  }

  Future<void> _addLeave(AppState app, {String? staffId}) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _LeaveSheet(
        team: _team(app),
        staffId: staffId,
        start: _day.compareTo(istToday()) >= 0 ? _day : istToday(),
        closed: _closed(app),
        holidays: _rules(app),
        onSave: (leave) => _send(app, 'Leave for ${_team(app).firstWhere((m) => m['id'] == leave['staff_id'])['name']}', 'PUT', {
          'organizationId': app.orgId,
          'leave': leave,
          'client_ref': '${DateTime.now().microsecondsSinceEpoch}',
        }),
      ),
    );
    if (done == true && mounted) toast(context, app.online ? 'Leave marked.' : 'Leave marked. It syncs when you are online.');
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    // The queue emptied (sent): fetch the server's copy again
    final waiting = app.pending('attendance').length;
    if (waiting < _pendingSeen) WidgetsBinding.instance.addPostFrameCallback((_) => _reloadBoth());
    _pendingSeen = waiting;
    return DefaultTabController(
      length: 3,
      initialIndex: widget.startOnHolidays ? 2 : (widget.startOnMonth ? 1 : 0),
      child: Scaffold(
        backgroundColor: Brand.page,
        appBar: AppBar(
          title: const Text('Attendance'),
          bottom: const TabBar(tabs: [Tab(text: 'Day'), Tab(text: 'Month'), Tab(text: 'Holidays')]),
        ),
        // A context under the tab controller, so a day tapped on the calendar can open the Day tab
        body: Builder(builder: (tabs) => TabBarView(children: [_dayView(app), _monthView(app, tabs), _holidaysView(app)])),
      ),
    );
  }

  // ── Day ──

  Widget _dayView(AppState app) {
    final manage = app.can('manage');
    final data = app.cached(_dayKey);
    final team = _team(app);
    final marks = _marks(app, _dayKey).where((m) => m['day'] == _day).toList();
    final byPerson = {for (final m in marks) '${m['staff_id']}': m};
    final counts = {for (final s in attendanceStatuses) s: marks.where((m) => m['status'] == s && team.any((p) => p['id'] == m['staff_id'])).length};
    final notMarked = team.where((p) => !byPerson.containsKey(p['id'])).length;
    final today = istToday();
    // A shop holiday: closed, so nobody needs marking (someone who came in can still be marked)
    final holiday = holidayOn(_day, _rules(app));
    return RefreshIndicator(
      onRefresh: () => _load(_dayKey, {'day': _day}),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          _DateBar(
            title: _day == today ? 'Today' : (_day == addDay(today, 1) ? 'Tomorrow' : (_day == addDay(today, -1) ? 'Yesterday' : dayTitle(_day))),
            subtitle: [today, addDay(today, 1), addDay(today, -1)].contains(_day) ? dayTitle(_day) : null,
            onPrevious: () {
              setState(() => _day = addDay(_day, -1));
              _load(_dayKey, {'day': _day});
            },
            onNext: () {
              setState(() => _day = addDay(_day, 1));
              _load(_dayKey, {'day': _day});
            },
            onPick: () async {
              final now = istNow();
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.parse(_day),
                firstDate: DateTime(now.year - 1),
                lastDate: DateTime(now.year, now.month, now.day).add(const Duration(days: maxDaysAhead)),
              );
              if (picked == null || !mounted) return;
              setState(() => _day = picked.toIso8601String().substring(0, 10));
              _load(_dayKey, {'day': _day});
            },
          ),
          if (holiday != null) ...[const SizedBox(height: 10), _HolidayBanner(holiday: holiday)],
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final s in attendanceStatuses) _CountChip(label: attendanceLabels[s]!, count: counts[s]!, status: s),
              _CountChip(label: 'Not marked', count: notMarked),
            ],
          ),
          if (manage && team.isNotEmpty) ...[
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, box) {
                final all = FilledButton.icon(
                  onPressed: notMarked == 0
                      ? null
                      : () {
                          _send(app, 'Everyone present', 'PUT', {
                            'organizationId': app.orgId,
                            'all': {'day': _day},
                            'client_ref': '${DateTime.now().microsecondsSinceEpoch}',
                          });
                          toast(context, '$notMarked marked present.');
                        },
                  icon: const Icon(Icons.done_all, size: 18),
                  label: const Text('Mark all present'),
                );
                final leave = OutlinedButton.icon(onPressed: () => _addLeave(app), icon: const Icon(Icons.event_busy_outlined, size: 18), label: const Text('Add leave'));
                if (holiday != null) return leave;
                if (box.maxWidth < 340) return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [all, const SizedBox(height: 8), leave]);
                return Row(
                  children: [
                    Expanded(child: all),
                    const SizedBox(width: 8),
                    Expanded(child: leave),
                  ],
                );
              },
            ),
          ],
          const SizedBox(height: 12),
          if (team.isEmpty)
            const EmptyState(icon: Icons.groups_outlined, title: 'No team yet', text: 'Add your team in Front Desk setup → Team, then mark who came in each day.')
          else if (data == null && !_tried.contains(_dayKey))
            const SizedBox(height: 360, child: SkeletonCards(cards: 3))
          else
            for (final person in team) ...[
              _PersonDay(
                person: person,
                mark: byPerson[person['id']],
                manage: manage,
                onMark: (status) {
                  final before = byPerson[person['id']];
                  before?['status'] == status ? _clear(app, person) : _mark(app, person, status, before: before);
                },
                onKind: (kind) => _mark(app, person, 'leave', before: byPerson[person['id']], setKind: true, kind: kind),
                onNote: () => _editNote(app, person, byPerson[person['id']]!),
                onClear: () => _clear(app, person),
              ),
              const SizedBox(height: 8),
            ],
          if (marks.any((m) => isAwayStatus(m['status'])))
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 6, 4, 0),
              child: Text(
                'People absent, on leave or on a week off are not offered for bookings that day. Bookings already made stay, with a note on the Front Desk.',
                style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35),
              ),
            ),
        ],
      ),
    );
  }

  // ── Month ──

  Widget _monthView(AppState app, BuildContext tabs) {
    final data = app.cached(_monthKey);
    final team = _team(app);
    final marks = _marks(app, _monthKey).where((m) => '${m['day']}'.startsWith(_month)).toList();
    final closed = _closed(app);
    final rules = _rules(app);
    final off = holidayDays(rules, '$_month-01', monthDays(_month).last);
    final today = istToday();
    final person = team.cast<Map<String, dynamic>?>().firstWhere((m) => m!['id'] == _person, orElse: () => null);
    void moveMonth(int by) {
      final next = addMonth(_month, by);
      if (next.compareTo(addMonth(today.substring(0, 7), 3)) > 0) return;
      setState(() => _month = next);
      _load(_monthKey, {'month': _month});
    }

    return RefreshIndicator(
      onRefresh: () => _load(_monthKey, {'month': _month}),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          _DateBar(title: monthTitle(_month), onPrevious: () => moveMonth(-1), onNext: () => moveMonth(1)),
          const SizedBox(height: 10),
          // Every name is built (a small team), so the one picked can be scrolled to
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final m in [
                  {'id': '', 'name': 'Everyone'},
                  ...team,
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(label: Text('${m['name']}'), selected: _person == m['id'], onSelected: (_) => setState(() => _person = '${m['id']}')),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (team.isEmpty)
            const EmptyState(icon: Icons.groups_outlined, title: 'No team yet', text: 'Add your team in Front Desk setup → Team.')
          else if (data == null && !_tried.contains(_monthKey))
            const SizedBox(height: 360, child: SkeletonCards(cards: 3))
          else if (person == null)
            for (final p in team) ...[
              _PersonMonthCard(
                person: p,
                month: _month,
                marks: marks,
                closed: closed,
                holidays: rules,
                today: today,
                onTap: () => setState(() => _person = '${p['id']}'),
              ),
              const SizedBox(height: 8),
            ]
          else ...[
            _Calendar(
              person: person,
              month: _month,
              marks: marks,
              closed: closed,
              holidays: rules,
              today: today,
              onDay: (day) {
                if (daysBetween(today, day) > maxDaysAhead) return;
                setState(() => _day = day);
                _load(_dayKey, {'day': _day});
                DefaultTabController.of(tabs).animateTo(0);
              },
            ),
            SectionLabel(
              'Leave this month',
              trailing: app.can('manage') ? TextButton.icon(onPressed: () => _addLeave(app, staffId: '${person['id']}'), icon: const Icon(Icons.add, size: 18), label: const Text('Add')) : null,
            ),
            Builder(
              builder: (context) {
                final spans = leaveSpans(marks, '${person['id']}', closed: closed, holidays: rules);
                if (spans.isEmpty) {
                  return const Panel(
                    child: Text('No leave this month.', style: TextStyle(color: Brand.muted)),
                  );
                }
                return Card(
                  child: Column(
                    children: [
                      for (final span in spans)
                        ListTile(
                          title: Text(span['from'] == span['to'] ? shortDay('${span['from']}') : '${shortDay('${span['from']}')} to ${shortDay('${span['to']}')}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                            [daysText(span['days'] as int), if (leaveKindLabels[span['leave_kind']] != null) leaveKindLabels[span['leave_kind']]!, if (span['note'] != null) '${span['note']}'].join(' · '),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: app.can('manage')
                              ? TextButton(
                                  onPressed: () {
                                    _send(app, 'Leave taken off for ${person['name']}', 'DELETE', {'organizationId': app.orgId, 'staffId': person['id'], 'from': span['from'], 'to': span['to']});
                                    toast(context, 'Leave taken off.');
                                  },
                                  child: const Text('Cancel leave'),
                                )
                              : null,
                        ),
                    ],
                  ),
                );
              },
            ),
          ],
          if (off.isNotEmpty) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.beach_access_outlined, size: 18, color: Brand.blue),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Holidays this month: ${[for (final span in holidaySpans(rules, '$_month-01', monthDays(_month).last)) '${span['name']} (${spanLabel(span)})'].join(', ')}',
                    style: const TextStyle(fontSize: 13, color: Brand.textSoft, height: 1.35),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const _Legend(),
        ],
      ),
    );
  }

  // ── Holidays ──

  Widget _holidaysView(AppState app) {
    final data = app.cached(_holidaysKey);
    final manage = (data?['canChange'] as bool?) ?? app.can('manage');
    final today = istToday();
    final rules = _rules(app);
    final coming = upcomingHolidays(rules, today).take(6).toList();
    final suggestions = [
      for (final s in suggestedHolidays)
        if (!rules.any((h) => h['repeat'] == 'yearly' && '${h['start']}'.substring(5) == s.monthDay)) {'name': s.name, 'start': suggestedStart(s.monthDay, today)},
    ];
    return RefreshIndicator(
      onRefresh: _loadHolidays,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(12)),
                      child: const Icon(Icons.beach_access_outlined, color: Brand.blue),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(child: Text('Shop holidays', style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700))),
                  ],
                ),
                const SizedBox(height: 10),
                const Text(
                  'Days the shop is closed. No bookings are taken on them (WhatsApp, booking page and website), your website says Closed, and attendance skips them. Bills can still be made.',
                  style: TextStyle(fontSize: 13.5, color: Brand.textSoft, height: 1.4),
                ),
                const SizedBox(height: 8),
                const Text('Closed on the same day every week? Set it in Setup → WhatsApp → Closed on.', style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35)),
              ],
            ),
          ),
          if (manage) ...[
            const SizedBox(height: 12),
            FilledButton.icon(onPressed: () => _editHoliday(app), icon: const Icon(Icons.add, size: 20), label: const Text('Add holiday')),
          ],
          if (manage && suggestions.isNotEmpty) ...[
            const SectionLabel('Add with one tap'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final s in suggestions)
                  ActionChip(
                    avatar: const Icon(Icons.add, size: 16, color: Brand.blue),
                    label: Text('${s['name']} · ${holidayDay(s['start']!)}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    onPressed: () => _quickAdd(app, s),
                  ),
              ],
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Each one repeats every year.', style: TextStyle(fontSize: 12, color: Brand.muted)),
            ),
          ],
          if (rules.isEmpty && data == null && !_tried.contains(_holidaysKey))
            const SizedBox(height: 240, child: SkeletonCards(cards: 2))
          else if (rules.isEmpty) ...[
            const SizedBox(height: 12),
            EmptyState(
              icon: Icons.beach_access_outlined,
              title: 'No holidays yet',
              text: manage
                  ? 'Add the days your shop is closed, like Diwali or a family function. Repeating ones, like Republic Day, are added once.'
                  : 'Your manager adds the days the shop is closed.',
            ),
          ] else ...[
            const SectionLabel('Coming up'),
            if (coming.isEmpty)
              const Panel(
                child: Text('No holidays in the next year.', style: TextStyle(color: Brand.muted)),
              )
            else
              Card(
                child: Column(children: [for (final span in coming) _ComingHoliday(span: span, today: today)]),
              ),
            const SectionLabel('All holidays'),
            Card(
              child: Column(
                children: [
                  for (final h in rules)
                    _HolidayRow(
                      holiday: h,
                      today: today,
                      manage: manage,
                      onEdit: () => _editHoliday(app, h),
                      onRemove: () => _removeHoliday(app, h),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Shop holiday: Diwali (8 to 10 Nov)" on the Day view.
class _HolidayBanner extends StatelessWidget {
  const _HolidayBanner({required this.holiday});
  final Map<String, dynamic> holiday;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.blue.withValues(alpha: 0.25))),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.beach_access_outlined, color: Brand.blue, size: 22),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Shop holiday: ${holiday['name']} (${spanLabel(holiday)})', style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: Brand.navy)),
              const SizedBox(height: 2),
              const Text('The shop is closed: no bookings; nobody needs marking.', style: TextStyle(fontSize: 13, color: Brand.textSoft, height: 1.35)),
            ],
          ),
        ),
      ],
    ),
  );
}

/// The next time a holiday falls: the date as a small calendar leaf, its name, and how soon.
class _ComingHoliday extends StatelessWidget {
  const _ComingHoliday({required this.span, required this.today});
  final Map<String, dynamic> span;
  final String today;

  @override
  Widget build(BuildContext context) {
    final start = '${span['start']}';
    final away = daysBetween(today, start);
    final soon = start.compareTo(today) <= 0 ? 'Today' : (away == 1 ? 'Tomorrow' : 'In $away days');
    return ListTile(
      leading: Container(
        width: 46,
        padding: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.line)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(holidayDay(start).split(' ').last.toUpperCase(), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Brand.blue)),
            Text('${int.parse(start.substring(8))}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Brand.navy, height: 1.1)),
          ],
        ),
      ),
      title: Text('${span['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(
        [dayTitle(start).split(',').first, if ((span['days'] as int) > 1) spanLabel(span), soon].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

/// One saved holiday: name, how it repeats and when it falls next. Managers can change or remove it.
class _HolidayRow extends StatelessWidget {
  const _HolidayRow({required this.holiday, required this.today, required this.manage, required this.onEdit, required this.onRemove});
  final Map<String, dynamic> holiday;
  final String today;
  final bool manage;
  final VoidCallback onEdit, onRemove;

  @override
  Widget build(BuildContext context) {
    final next = nextTime(holiday, today);
    return ListTile(
      onTap: manage ? onEdit : null,
      title: Text('${holiday['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(
        '${repeatLabel(holiday)}\n${next == null ? 'Already gone' : '${holiday['repeat'] == 'none' ? 'On' : 'Next'}: ${spanLabel(next, withYear: true)}'}',
        style: const TextStyle(height: 1.35),
      ),
      isThreeLine: true,
      trailing: manage
          ? PopupMenuButton<String>(
              tooltip: 'More for ${holiday['name']}',
              onSelected: (v) => v == 'edit' ? onEdit() : onRemove(),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'edit', child: Text('Change')),
                PopupMenuItem(value: 'remove', child: Text('Remove')),
              ],
            )
          : null,
    );
  }
}

/// Add or change a holiday: name (or a tap on a festival), the day, how many days, and how it repeats.
class _HolidaySheet extends StatefulWidget {
  const _HolidaySheet({this.holiday, required this.save});
  final Map<String, dynamic>? holiday;
  final Future<Map<String, dynamic>> Function(Map<String, dynamic> holiday) save;

  @override
  State<_HolidaySheet> createState() => _HolidaySheetState();
}

class _HolidaySheetState extends State<_HolidaySheet> {
  late final _name = TextEditingController(text: '${widget.holiday?['name'] ?? ''}');
  late String _start = '${widget.holiday?['start'] ?? istToday()}';
  late int _days = (widget.holiday?['days'] as int?) ?? 1;
  late String _repeat = '${widget.holiday?['repeat'] ?? 'none'}';
  bool _tried = false;
  bool _saving = false;
  String? _error;

  int get _maxDays => _repeat == 'none' || _repeat == 'yearly' ? maxHolidayDays : maxMonthlyHolidayDays;

  void _setStart(String day) {
    _start = day;
    final choices = [for (final c in repeatChoices(day)) c.value];
    if (!choices.contains(_repeat)) {
      _repeat = _repeat == 'monthly_weekday' && choices.contains('monthly_last_weekday')
          ? 'monthly_last_weekday'
          : (_repeat == 'monthly_last_weekday' && choices.contains('monthly_weekday') ? 'monthly_weekday' : 'none');
    }
  }

  Future<void> _pickDay() async {
    final now = istNow();
    final today = DateTime(now.year, now.month, now.day);
    final current = DateTime.parse(_start);
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: current.isBefore(today) ? current : today,
      lastDate: today.add(const Duration(days: maxHolidayDaysAhead)),
    );
    if (picked == null || !mounted) return;
    setState(() => _setStart(picked.toIso8601String().substring(0, 10)));
  }

  Future<void> _save(Map<String, dynamic> holiday) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final data = await widget.save(holiday);
      if (mounted) Navigator.pop(context, '${data['message'] ?? 'Saved.'}');
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = istToday();
    final input = {if (widget.holiday?['id'] != null) 'id': widget.holiday!['id'], 'name': _name.text, 'start': _start, 'days': _days, 'repeat': _repeat};
    final checked = cleanHoliday(input, today);
    // Before the first Save, a missing name is not an error yet: the preview still shows the dates
    final preview = checked.value ?? (checked.field == 'name' && !_tried ? cleanHoliday({...input, 'name': 'Holiday'}, today).value : null);
    final next = preview == null ? null : nextTime({...preview, 'id': 'preview'}, today);
    final problem = checked.value == null && (checked.field != 'name' || _tried) ? checked.error : null;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.holiday == null ? 'Add a holiday' : 'Change holiday', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            const Text('The shop is closed: no bookings that day', style: TextStyle(color: Brand.muted)),
            const SizedBox(height: 16),
            TextField(
              controller: _name,
              maxLength: holidayNameMax,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Name', hintText: 'Like Diwali or Family function'),
              onChanged: (_) => setState(() {}),
            ),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final idea in holidayNameIdeas)
                  ChoiceChip(
                    visualDensity: VisualDensity.compact,
                    label: Text(idea),
                    selected: _name.text.trim() == idea,
                    onSelected: (_) => setState(() => _name.text = idea),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            _DateField(label: 'Day', day: _start, withYear: true, onTap: _pickDay),
            const SizedBox(height: 14),
            Row(
              children: [
                const Expanded(child: Text('How many days', style: TextStyle(fontWeight: FontWeight.w700))),
                IconButton.outlined(onPressed: _days > 1 ? () => setState(() => _days--) : null, icon: const Icon(Icons.remove, size: 18), tooltip: 'One day less'),
                SizedBox(
                  width: 64,
                  child: Text(_days == 1 ? '1 day' : '$_days days', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                IconButton.outlined(onPressed: _days < _maxDays ? () => setState(() => _days++) : null, icon: const Icon(Icons.add, size: 18), tooltip: 'One day more'),
              ],
            ),
            const SizedBox(height: 10),
            const Text('Repeats', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            for (final choice in repeatChoices(_start))
              _RepeatOption(
                label: choice.label,
                selected: _repeat == choice.value,
                onTap: () => setState(() {
                  _repeat = choice.value;
                  if (_days > _maxDays) _days = _maxDays;
                }),
              ),
            const SizedBox(height: 8),
            Text(
              problem ??
                  (next == null
                      ? ''
                      : '${_repeat == 'none' ? 'On' : 'Next'}: ${spanLabel(next, withYear: true)}. No bookings are taken ${(next['days'] as int) > 1 ? 'on those days' : 'that day'}.'),
              style: TextStyle(fontSize: 13, color: problem != null ? Brand.red : Brand.textSoft, height: 1.35),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(fontSize: 13.5, color: Brand.red, fontWeight: FontWeight.w600)),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _saving
                    ? null
                    : () {
                        setState(() => _tried = true);
                        if (checked.value != null) _save(checked.value!);
                      },
                child: Text(_saving ? 'Saving…' : 'Save holiday'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One way to repeat, as a row with a round tick (long words wrap on small phones).
class _RepeatOption extends StatelessWidget {
  const _RepeatOption({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
        child: Row(
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: selected ? Brand.blue : Brand.faint, size: 22),
            const SizedBox(width: 10),
            Expanded(child: Text(label, style: TextStyle(fontSize: 14.5, fontWeight: selected ? FontWeight.w700 : FontWeight.w500))),
          ],
        ),
      ),
    ),
  );
}

/// ‹ Today, Wed 25 Nov ›: tap the middle to pick a day (when [onPick] is given).
class _DateBar extends StatelessWidget {
  const _DateBar({required this.title, this.subtitle, required this.onPrevious, required this.onNext, this.onPick});
  final String title;
  final String? subtitle;
  final VoidCallback onPrevious, onNext;
  final VoidCallback? onPick;

  @override
  Widget build(BuildContext context) => Card(
    child: Row(
      children: [
        IconButton(onPressed: onPrevious, icon: const Icon(Icons.chevron_left), tooltip: 'Before'),
        Expanded(
          child: InkWell(
            onTap: onPick,
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  if (subtitle != null) Text(subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ),
          ),
        ),
        IconButton(onPressed: onNext, icon: const Icon(Icons.chevron_right), tooltip: 'After'),
      ],
    ),
  );
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.label, required this.count, this.status});
  final String label;
  final int count;
  final String? status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = status == null || count == 0 ? (Colors.white, count == 0 ? Brand.faint : Brand.textSoft) : _tones[status]!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8), border: Border.all(color: status == null ? Brand.border : bg)),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: '$label '),
            TextSpan(text: '$count', style: const TextStyle(fontWeight: FontWeight.w800)),
          ],
        ),
        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

/// One person on the day: their mark, and the five buttons (managers).
class _PersonDay extends StatelessWidget {
  const _PersonDay({required this.person, required this.mark, required this.manage, required this.onMark, required this.onKind, required this.onNote, required this.onClear});
  final Map<String, dynamic> person;
  final Map<String, dynamic>? mark;
  final bool manage;
  final ValueChanged<String> onMark;
  final ValueChanged<String?> onKind;
  final VoidCallback onNote, onClear;

  @override
  Widget build(BuildContext context) {
    final status = mark?['status'] as String?;
    return Panel(
      padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar('${person['name']}', size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${person['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                    Text(
                      [markLabel(mark), if ((mark?['note'] ?? '').toString().isNotEmpty) '${mark!['note']}'].join(' · '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.5, color: status == 'absent' ? Brand.red : Brand.muted),
                    ),
                  ],
                ),
              ),
              if (manage && mark != null) ...[
                IconButton(onPressed: onNote, icon: const Icon(Icons.edit_note, size: 22), tooltip: 'Note', color: Brand.muted),
                IconButton(onPressed: onClear, icon: const Icon(Icons.close, size: 20), tooltip: 'Clear', color: Brand.muted),
              ],
            ],
          ),
          if (manage) ...[
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [for (final s in attendanceStatuses) _StatusButton(status: s, selected: status == s, onTap: () => onMark(s))],
              ),
            ),
            if (status == 'leave') ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('Kind:', style: TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w600)),
                  for (final k in leaveKinds)
                    ChoiceChip(
                      visualDensity: VisualDensity.compact,
                      label: Text(leaveKindLabels[k]!),
                      selected: mark?['leave_kind'] == k,
                      onSelected: (_) => onKind(mark?['leave_kind'] == k ? null : k),
                    ),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _StatusButton extends StatelessWidget {
  const _StatusButton({required this.status, required this.selected, required this.onTap});
  final String status;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _tones[status]!;
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? bg : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: selected ? fg : Brand.border, width: selected ? 1.5 : 1)),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 38),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (selected) ...[Icon(Icons.check, size: 15, color: fg), const SizedBox(width: 4)],
                  Text(
                    attendanceLabels[status]!,
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: selected ? fg : Brand.text),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Everyone's month: days in, a strip of the month's days, and the totals. Tap for the calendar.
class _PersonMonthCard extends StatelessWidget {
  const _PersonMonthCard({required this.person, required this.month, required this.marks, required this.closed, this.holidays = const [], required this.today, required this.onTap});
  final Map<String, dynamic> person;
  final String month;
  final List<Map<String, dynamic>> marks;
  final List<int> closed;
  final List<Map<String, dynamic>> holidays;
  final String today;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final id = '${person['id']}';
    final sum = personMonth(marks, id, month, today, closed: closed, holidays: holidays);
    final off = holidayDays(holidays, '$month-01', monthDays(month).last);
    bool isOff(String d) => closed.contains(weekdayOf(d)) || off.containsKey(d);
    final own = {for (final m in marks.where((m) => m['staff_id'] == id)) '${m['day']}': '${m['status']}'};
    return Panel(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar('${person['name']}', size: 38),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${person['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                    Text('${daysText(sum['worked']!)} in', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Brand.faint),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 3,
            runSpacing: 3,
            children: [
              for (final d in monthDays(month))
                Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: own[d] != null ? _tones[own[d]]!.$2 : (isOff(d) || d.compareTo(today) > 0 ? Brand.lineSoft : Colors.white),
                    borderRadius: BorderRadius.circular(3),
                    border: own[d] == null && !isOff(d) && d.compareTo(today) <= 0 ? Border.all(color: Brand.border) : null,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          _Totals(sum: sum),
        ],
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.sum});
  final Map<String, num> sum;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: [
      Pill('Present ${sum['present']}', tone: PillTone.blue),
      if (sum['half_day']! > 0) Pill('Half days ${sum['half_day']}'),
      Pill('Leave ${sum['leave']}'),
      if (sum['absent']! > 0) Pill('Absent ${sum['absent']}', tone: PillTone.red),
      Pill('Week off ${sum['week_off']}'),
      if (sum['not_marked']! > 0) Pill('Not marked ${sum['not_marked']}'),
    ],
  );
}

/// One person's month as a calendar (Monday first). Tap a day to mark it.
class _Calendar extends StatelessWidget {
  const _Calendar({required this.person, required this.month, required this.marks, required this.closed, this.holidays = const [], required this.today, required this.onDay});
  final Map<String, dynamic> person;
  final String month;
  final List<Map<String, dynamic>> marks;
  final List<int> closed;
  final List<Map<String, dynamic>> holidays;
  final String today;
  final ValueChanged<String> onDay;

  @override
  Widget build(BuildContext context) {
    final id = '${person['id']}';
    final days = monthDays(month);
    final lead = (weekdayOf(days.first) + 6) % 7;
    final own = {for (final m in marks.where((m) => m['staff_id'] == id)) '${m['day']}': m};
    final sum = personMonth(marks, id, month, today, closed: closed, holidays: holidays);
    final off = holidayDays(holidays, days.first, days.last);
    return Panel(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar('${person['name']}', size: 38),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${person['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                    Text('${daysText(sum['worked']!)} in · ${monthTitle(month)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              for (final w in const ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
                Expanded(
                  child: Center(
                    child: Text(w, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.faint)),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
            childAspectRatio: 0.82,
            children: [
              for (var i = 0; i < lead; i++) const SizedBox.shrink(),
              for (final d in days) _DayCell(day: d, mark: own[d], closed: closed.contains(weekdayOf(d)), holiday: off[d], today: today, onTap: () => onDay(d)),
            ],
          ),
          const SizedBox(height: 10),
          _Totals(sum: sum),
        ],
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({required this.day, required this.mark, required this.closed, this.holiday, required this.today, required this.onTap});
  final String day;
  final Map<String, dynamic>? mark;
  final bool closed;

  /// The shop's holiday that day (its name), shaded like a closed day and marked "Hol"
  final String? holiday;
  final String today;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = mark?['status'] as String?;
    final tone = status == null ? null : _tones[status];
    final off = closed || holiday != null;
    return Semantics(
      label: '${shortDay(day)}: ${status != null ? markLabel(mark) : holiday != null ? 'holiday, $holiday' : closed ? 'closed' : 'not marked'}',
      button: true,
      child: Material(
        color: off && status == null ? Brand.lineSoft : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: BorderSide(color: day == today ? Brand.blue : Brand.line, width: day == today ? 1.5 : 1)),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Padding(
              padding: const EdgeInsets.all(3),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${int.parse(day.substring(8))}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: day.compareTo(today) > 0 ? Brand.faint : Brand.text)),
                  const SizedBox(height: 2),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(color: tone?.$1 ?? Colors.transparent, borderRadius: BorderRadius.circular(4)),
                    child: Text(
                      status == null ? (holiday != null ? 'Hol' : ' ') : attendanceLetters[status]!,
                      style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: tone?.$2 ?? (holiday != null ? Brand.muted : Colors.transparent)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend();
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 12,
    runSpacing: 6,
    children: [
      for (final s in attendanceStatuses)
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(color: _tones[s]!.$2, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 4),
            Text('${attendanceLetters[s]} = ${s == 'leave' ? 'On leave' : attendanceLabels[s]}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ],
        ),
      Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: Brand.lineSoft, borderRadius: BorderRadius.circular(3), border: Border.all(color: Brand.border)),
          ),
          const SizedBox(width: 4),
          const Text('Grey = closed or holiday (Hol)', style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ),
    ],
  );
}

/// Leave from one day to another for one person: who, from, to, leave or week off, kind, note.
class _LeaveSheet extends StatefulWidget {
  const _LeaveSheet({required this.team, required this.staffId, required this.start, required this.closed, this.holidays = const [], required this.onSave});
  final List<Map<String, dynamic>> team;
  final String? staffId;
  final String start;
  final List<int> closed;

  /// The shop's holidays: left out of the leave, like closed days
  final List<Map<String, dynamic>> holidays;
  final void Function(Map<String, dynamic> leave) onSave;

  @override
  State<_LeaveSheet> createState() => _LeaveSheetState();
}

class _LeaveSheetState extends State<_LeaveSheet> {
  late String _who = widget.staffId ?? (widget.team.length == 1 ? '${widget.team.first['id']}' : '');
  late String _from = widget.start;
  late String _to = widget.start;
  String _status = 'leave';
  String? _kind;
  final _note = TextEditingController();

  Future<String?> _pick(String initial, String first) async {
    final now = istNow();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(initial),
      firstDate: DateTime.parse(first),
      lastDate: DateTime(now.year, now.month, now.day).add(const Duration(days: maxDaysAhead)),
    );
    return picked?.toIso8601String().substring(0, 10);
  }

  @override
  Widget build(BuildContext context) {
    final result = _who.isEmpty
        ? null
        : leaveDays(staffId: _who, from: _from, to: _to, today: istToday(), status: _status, kind: _kind, note: _note.text, closed: widget.closed, holidays: widget.holidays);
    final count = result?.marks.length ?? 0;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Add leave', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            const Text('Mark days off in one go', style: TextStyle(color: Brand.muted)),
            const SizedBox(height: 16),
            const Text('Who', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [for (final m in widget.team) ChoiceChip(label: Text('${m['name']}'), selected: _who == m['id'], onSelected: (_) => setState(() => _who = '${m['id']}'))],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _DateField(
                    label: 'From',
                    day: _from,
                    onTap: () async {
                      final v = await _pick(_from, istToday());
                      if (v == null) return;
                      setState(() {
                        _from = v;
                        if (_to.compareTo(v) < 0) _to = v;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _DateField(
                    label: 'To',
                    day: _to,
                    onTap: () async {
                      final v = await _pick(_to, _from);
                      if (v != null) setState(() => _to = v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Text('Mark as', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(label: const Text('Leave'), selected: _status == 'leave', onSelected: (_) => setState(() => _status = 'leave')),
                ChoiceChip(label: const Text('Week off'), selected: _status == 'week_off', onSelected: (_) => setState(() => _status = 'week_off')),
              ],
            ),
            if (_status == 'leave') ...[
              const SizedBox(height: 14),
              const Text('Kind of leave (if you like)', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                children: [
                  for (final k in leaveKinds) ChoiceChip(label: Text(leaveKindLabels[k]!), selected: _kind == k, onSelected: (_) => setState(() => _kind = _kind == k ? null : k)),
                ],
              ),
            ],
            const SizedBox(height: 14),
            TextField(
              controller: _note,
              maxLength: noteMax,
              decoration: const InputDecoration(labelText: 'Note (if you like)', hintText: 'Like “sister’s wedding”'),
              onChanged: (_) => setState(() {}),
            ),
            Text(
              result == null
                  ? 'Choose who, and the days.'
                  : result.error ??
                        '${daysText(count)} will be marked${widget.closed.isNotEmpty || widget.holidays.isNotEmpty ? ' (days you are closed and holidays are left out)' : ''}. Not offered for bookings on those days.',
              style: TextStyle(fontSize: 13, color: result?.error != null ? Brand.red : Brand.textSoft, height: 1.35),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: result == null || result.error != null
                    ? null
                    : () {
                        widget.onSave({'staff_id': _who, 'from': _from, 'to': _to, 'status': _status, 'leave_kind': _status == 'leave' ? _kind : null, 'note': _note.text.trim().isEmpty ? null : _note.text.trim()});
                        Navigator.pop(context, true);
                      },
                child: Text(count > 0 ? 'Save ${daysText(count)}' : 'Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.day, required this.onTap, this.withYear = false});
  final String label, day;
  final VoidCallback onTap;

  /// "Fri, 27 Nov 2026" (a holiday can be far ahead) instead of "27 Nov"
  final bool withYear;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(10),
    child: InputDecorator(
      decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18)),
      // "26 Nov": fits two side by side on a 320px phone
      child: Text(withYear ? '${dayTitle(day)} ${day.substring(0, 4)}' : shortDay(day), maxLines: 1, overflow: TextOverflow.ellipsis),
    ),
  );
}
