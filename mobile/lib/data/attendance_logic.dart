import 'package:intl/intl.dart';

/// Staff attendance rules on the phone, the same as the server's lib/salon/attendance.ts: one mark per person per
/// day (present, absent, leave, half day, week off). People absent, on leave or on a week off are not offered for
/// bookings that day; a half day stays bookable. India dates ("2026-11-25") throughout.

const attendanceStatuses = ['present', 'absent', 'leave', 'half_day', 'week_off'];
const attendanceLabels = {'present': 'Present', 'absent': 'Absent', 'leave': 'Leave', 'half_day': 'Half day', 'week_off': 'Week off'};
const attendanceLetters = {'present': 'P', 'absent': 'A', 'leave': 'L', 'half_day': 'H', 'week_off': 'W'};
const leaveKinds = ['casual', 'sick', 'other'];
const leaveKindLabels = {'casual': 'Casual', 'sick': 'Sick', 'other': 'Other'};

/// Marks go up to 62 days ahead (leave planned in advance), and leave is marked at most 62 days in one go.
const maxDaysAhead = 62;
const maxLeaveDays = 62;
const noteMax = 200;

bool isAwayStatus(Object? status) => status == 'absent' || status == 'leave' || status == 'week_off';

/// "On leave · Sick", "Week off", "Not marked"
String markLabel(Map? mark) {
  final status = mark?['status'];
  if (status == null || !attendanceLabels.containsKey(status)) return 'Not marked';
  if (status == 'leave') {
    final kind = leaveKindLabels[mark!['leave_kind']];
    return kind == null ? 'On leave' : 'On leave · $kind';
  }
  return attendanceLabels[status]!;
}

DateTime _day(String day) => DateTime.parse('${day}T00:00:00Z');
String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

String addDay(String day, int days) => _iso(_day(day).add(Duration(days: days)));

/// Sunday = 0 … Saturday = 6, like the server's closed_weekdays.
int weekdayOf(String day) => _day(day).weekday % 7;

int daysBetween(String from, String to) => _day(to).difference(_day(from)).inDays;

List<String> daysFrom(String from, String to) => [for (var d = from; d.compareTo(to) <= 0; d = addDay(d, 1)) d];

String addMonth(String month, int count) {
  final year = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7));
  final index = year * 12 + (m - 1) + count;
  return '${index ~/ 12}-${'${index % 12 + 1}'.padLeft(2, '0')}';
}

List<String> monthDays(String month) {
  final year = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7));
  final last = DateTime.utc(year, m + 1, 0).day;
  return [for (var d = 1; d <= last; d++) '$month-${'$d'.padLeft(2, '0')}'];
}

String monthTitle(String month) => DateFormat('MMMM yyyy').format(_day('$month-01'));

/// Mon, 25 Nov
String dayTitle(String day) => DateFormat('EEE, d MMM').format(_day(day));

/// 25 Nov
String shortDay(String day) => DateFormat('d MMM').format(_day(day));

/// Why a day cannot be marked, or null.
String? dayProblem(String day, String today) {
  if (daysBetween(today, day) > maxDaysAhead) return 'You can mark up to $maxDaysAhead days ahead.';
  if (daysBetween(day, today) > 366) return 'That day is more than a year ago.';
  return null;
}

/// Leave from one day to another for one person: one mark a day, days the business is closed left out.
/// Returns the marks, or the reason it cannot be marked.
({List<Map<String, dynamic>> marks, String? error}) leaveDays({
  required String staffId,
  required String from,
  required String to,
  required String today,
  String status = 'leave',
  String? kind,
  String? note,
  List<int> closed = const [],
}) {
  if (to.compareTo(from) < 0) return (marks: const [], error: 'The last day is before the first day.');
  if (daysBetween(from, to) + 1 > maxLeaveDays) return (marks: const [], error: 'Mark at most $maxLeaveDays days in one go.');
  final problem = dayProblem(from, today) ?? dayProblem(to, today);
  if (problem != null) return (marks: const [], error: problem);
  final days = daysFrom(from, to).where((d) => !closed.contains(weekdayOf(d))).toList();
  if (days.isEmpty) return (marks: const [], error: 'You are closed on all of those days.');
  final cleanNote = (note ?? '').trim();
  return (
    marks: [
      for (final d in days)
        {'staff_id': staffId, 'day': d, 'status': status, 'leave_kind': status == 'leave' ? kind : null, 'note': cleanNote.isEmpty ? null : cleanNote},
    ],
    error: null,
  );
}

/// The marks with changes still waiting to sync laid over them (bodies of PUT / DELETE /api/salon/attendance, oldest
/// first): one or many marks, "everyone present" on a day, leave from one day to another, a mark taken off.
List<Map<String, dynamic>> applyPending(
  List<Map<String, dynamic>> marks,
  Iterable<({String method, Map<String, dynamic> body})> changes, {
  List<String> staffIds = const [],
  List<int> closed = const [],
  required String today,
}) {
  final byKey = {for (final m in marks) '${m['staff_id']}|${m['day']}': Map<String, dynamic>.from(m)};
  void put(Map m) => byKey['${m['staff_id']}|${m['day']}'] = Map<String, dynamic>.from(m);
  for (final change in changes) {
    final body = change.body;
    if (change.method == 'DELETE') {
      final staffId = '${body['staffId'] ?? body['staff_id'] ?? ''}';
      final from = '${body['from'] ?? body['day'] ?? ''}';
      final to = '${body['to'] ?? from}';
      byKey.removeWhere((_, m) => m['staff_id'] == staffId && '${m['day']}'.compareTo(from) >= 0 && '${m['day']}'.compareTo(to) <= 0);
    } else if (body['leave'] is Map) {
      final l = body['leave'] as Map;
      final result = leaveDays(
        staffId: '${l['staff_id']}',
        from: '${l['from']}',
        to: '${l['to'] ?? l['from']}',
        today: today,
        status: '${l['status'] ?? 'leave'}',
        kind: l['leave_kind'] as String?,
        note: l['note'] as String?,
        closed: closed,
      );
      result.marks.forEach(put);
    } else if (body['all'] is Map) {
      final day = '${(body['all'] as Map)['day']}';
      for (final id in staffIds) {
        byKey.putIfAbsent('$id|$day', () => {'staff_id': id, 'day': day, 'status': 'present', 'leave_kind': null, 'note': null});
      }
    } else {
      for (final m in (body['marks'] as List? ?? const [])) {
        if (m is Map) put(m);
      }
    }
  }
  return byKey.values.toList();
}

/// A month for one person: counts, present days with a half day as 0.5, and working days up to today with no mark.
Map<String, num> personMonth(List<Map<String, dynamic>> marks, String staffId, String month, String today, {List<int> closed = const []}) {
  final days = monthDays(month);
  final own = marks.where((m) => m['staff_id'] == staffId && '${m['day']}'.startsWith(month)).toList();
  int count(String s) => own.where((m) => m['status'] == s).length;
  final marked = {for (final m in own) '${m['day']}'};
  final upTo = today.compareTo(days.last) < 0 ? today : days.last;
  final working = upTo.compareTo(days.first) < 0 ? <String>[] : daysFrom(days.first, upTo).where((d) => !closed.contains(weekdayOf(d)));
  return {
    'present': count('present'),
    'absent': count('absent'),
    'leave': count('leave'),
    'half_day': count('half_day'),
    'week_off': count('week_off'),
    'not_marked': working.where((d) => !marked.contains(d)).length,
    'worked': count('present') + count('half_day') * 0.5,
  };
}

/// A person's leave as ranges: next-door days of the same kind join, and so do days with only closed days between.
List<Map<String, dynamic>> leaveSpans(List<Map<String, dynamic>> marks, String staffId, {List<int> closed = const []}) {
  final list = marks.where((m) => m['staff_id'] == staffId && m['status'] == 'leave').toList()..sort((a, b) => '${a['day']}'.compareTo('${b['day']}'));
  final spans = <Map<String, dynamic>>[];
  for (final m in list) {
    final day = '${m['day']}';
    if (spans.isNotEmpty && spans.last['leave_kind'] == m['leave_kind']) {
      var gap = addDay(spans.last['to'] as String, 1);
      while (gap.compareTo(day) < 0 && closed.contains(weekdayOf(gap))) {
        gap = addDay(gap, 1);
      }
      if (gap == day) {
        spans.last['to'] = day;
        spans.last['days'] = (spans.last['days'] as int) + 1;
        spans.last['note'] ??= m['note'];
        continue;
      }
    }
    spans.add({'staff_id': staffId, 'from': day, 'to': day, 'days': 1, 'leave_kind': m['leave_kind'], 'note': m['note']});
  }
  return spans;
}

/// "18.5 days", "1 day"
String daysText(num n) => '${n == n.roundToDouble() ? n.round() : n.toStringAsFixed(1)} day${n == 1 ? '' : 's'}';
