import 'attendance_logic.dart';
import 'format.dart';

/// Demo answers for staff attendance, shaped like the real GET / PUT / DELETE /api/salon/attendance: this month
/// marked so far (a few leaves, a half day, week offs), Lakshmi on a half day today and Ravi on sick leave until
/// the day after tomorrow.
class DemoAttendance {
  DemoAttendance({required this.staff, required this.closed}) {
    final today = istToday();
    final month = today.substring(0, 7);
    final people = staff();
    for (final day in monthDays(month).where((d) => d.compareTo(today) < 0)) {
      if (closed().contains(weekdayOf(day))) continue;
      final n = int.parse(day.substring(8));
      for (var i = 0; i < people.length; i++) {
        final status = (n + i) % 9 == 0
            ? 'leave'
            : (n + i) % 13 == 0
            ? 'absent'
            : (n * (i + 1)) % 11 == 0
            ? 'half_day'
            : (n + i) % 7 == 0
            ? 'week_off'
            : 'present';
        _put({'staff_id': '${people[i]['id']}', 'day': day, 'status': status, 'leave_kind': status == 'leave' ? 'casual' : null, 'note': null});
      }
    }
    if (people.length >= 3) {
      _put({'staff_id': '${people[0]['id']}', 'day': today, 'status': 'present', 'leave_kind': null, 'note': null});
      _put({'staff_id': '${people[1]['id']}', 'day': today, 'status': 'half_day', 'leave_kind': null, 'note': 'Leaves at 2 pm'});
      for (final d in [0, 1, 2]) {
        _put({'staff_id': '${people[2]['id']}', 'day': addDay(today, d), 'status': 'leave', 'leave_kind': 'sick', 'note': 'Fever, back on ${dayTitle(addDay(today, 3)).split(',').first}'});
      }
    }
  }

  /// The team and the weekly closed days, read from the demo's Front Desk setup.
  final List<Map<String, dynamic>> Function() staff;
  final List<int> Function() closed;

  final Map<String, Map<String, dynamic>> _marks = {};
  void _put(Map<String, dynamic> m) => _marks['${m['staff_id']}|${m['day']}'] = m;
  List<Map<String, dynamic>> get _all => _marks.values.toList();

  List<Map<String, dynamic>> get _team => staff().where((m) => m['active'] != false).map((m) => {'id': m['id'], 'name': m['name'], 'active': true}).toList();

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    if (path != '/api/salon/attendance') return null;
    final today = istToday();
    final team = _team;
    final month = query?['month'];
    if (month != null || query?['staffId'] != null) {
      final m = month ?? today.substring(0, 7);
      final staffId = query?['staffId'];
      final marks = _all.where((x) => '${x['day']}'.startsWith(m) && (staffId == null || x['staff_id'] == staffId)).toList();
      final people = team.where((p) => staffId == null || p['id'] == staffId).toList();
      return {
        'success': true,
        'month': m,
        'today': today,
        'canMark': true,
        'closedWeekdays': closed(),
        'staff': people,
        'marks': marks,
        'summary': [
          for (final p in people) {'staff_id': p['id'], 'name': p['name'], ...personMonth(marks, '${p['id']}', m, today, closed: closed())},
        ],
        'leave': [for (final p in people) ...leaveSpans(marks, '${p['id']}', closed: closed())],
      };
    }
    final day = query?['day'] ?? today;
    final marks = _all.where((x) => x['day'] == day).toList();
    return {
      'success': true,
      'day': day,
      'today': today,
      'canMark': true,
      'closedWeekdays': closed(),
      'staff': team,
      'marks': marks,
      'rows': [
        for (final p in team) {'staff_id': p['id'], 'name': p['name'], 'mark': marks.cast<Map?>().firstWhere((x) => x!['staff_id'] == p['id'], orElse: () => null)},
      ],
    };
  }

  /// Everyone not simply present on a day, as /api/salon/appointments?date= returns it for the counter.
  List<Map<String, dynamic>> notices(String day) => [
    for (final m in _all)
      if (m['day'] == day && m['status'] != 'present') {'staff_id': m['staff_id'], 'status': m['status'], 'leave_kind': m['leave_kind']},
  ];

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    if (path != '/api/salon/attendance') return null;
    final before = _marks.length;
    final saved = applyPending(_all, [(method: method, body: body)], staffIds: [for (final p in _team) '${p['id']}'], closed: closed(), today: istToday());
    _marks
      ..clear()
      ..addEntries(saved.map((m) => MapEntry('${m['staff_id']}|${m['day']}', m)));
    if (method == 'DELETE') return {'success': true, 'removed': before - _marks.length};
    return {'success': true, 'message': 'Marked.'};
  }
}
