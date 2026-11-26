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

/// Leave from one day to another for one person: one mark a day, days the business is closed (weekly closed days and
/// its holidays) left out. Returns the marks, or the reason it cannot be marked.
({List<Map<String, dynamic>> marks, String? error}) leaveDays({
  required String staffId,
  required String from,
  required String to,
  required String today,
  String status = 'leave',
  String? kind,
  String? note,
  List<int> closed = const [],
  Object? holidays,
}) {
  if (to.compareTo(from) < 0) return (marks: const [], error: 'The last day is before the first day.');
  if (daysBetween(from, to) + 1 > maxLeaveDays) return (marks: const [], error: 'Mark at most $maxLeaveDays days in one go.');
  final problem = dayProblem(from, today) ?? dayProblem(to, today);
  if (problem != null) return (marks: const [], error: problem);
  final off = holidayDays(holidays, from, to);
  final days = daysFrom(from, to).where((d) => !closed.contains(weekdayOf(d)) && !off.containsKey(d)).toList();
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
  Object? holidays,
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
        holidays: holidays,
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

/// A month for one person: counts, present days with a half day as 0.5, and working days up to today with no mark
/// (weekly closed days and holidays are not working days).
Map<String, num> personMonth(List<Map<String, dynamic>> marks, String staffId, String month, String today, {List<int> closed = const [], Object? holidays}) {
  final days = monthDays(month);
  final own = marks.where((m) => m['staff_id'] == staffId && '${m['day']}'.startsWith(month)).toList();
  int count(String s) => own.where((m) => m['status'] == s).length;
  final marked = {for (final m in own) '${m['day']}'};
  final upTo = today.compareTo(days.last) < 0 ? today : days.last;
  final off = holidayDays(holidays, days.first, days.last);
  final working = upTo.compareTo(days.first) < 0 ? <String>[] : daysFrom(days.first, upTo).where((d) => !closed.contains(weekdayOf(d)) && !off.containsKey(d));
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

/// A person's leave as ranges: next-door days of the same kind join, and so do days with only closed days (or
/// holidays) between.
List<Map<String, dynamic>> leaveSpans(List<Map<String, dynamic>> marks, String staffId, {List<int> closed = const [], Object? holidays}) {
  final list = marks.where((m) => m['staff_id'] == staffId && m['status'] == 'leave').toList()..sort((a, b) => '${a['day']}'.compareTo('${b['day']}'));
  final off = list.isEmpty ? const <String, String>{} : holidayDays(holidays, '${list.first['day']}', '${list.last['day']}');
  final spans = <Map<String, dynamic>>[];
  for (final m in list) {
    final day = '${m['day']}';
    if (spans.isNotEmpty && spans.last['leave_kind'] == m['leave_kind']) {
      var gap = addDay(spans.last['to'] as String, 1);
      while (gap.compareTo(day) < 0 && (closed.contains(weekdayOf(gap)) || off.containsKey(gap))) {
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


// ── Shop holidays (the same rules as the server's lib/salon/holidays.ts) ──────────────────────────────────────────
// Days the business is closed besides its weekly closed days: one-off (Diwali this year) or repeating every year on a
// date, every month on a date, or every month on a weekday (the 2nd Tuesday, the last Saturday). On a holiday no times
// are offered for bookings and attendance does not count it as a working day. A holiday is a map
// {id, name, start, days, repeat}; a time it falls ("span") is {id, name, start, end, days, repeat}.

const holidayRepeats = ['none', 'yearly', 'monthly', 'monthly_weekday', 'monthly_last_weekday'];
const maxHolidays = 60;
const holidayNameMax = 40;
const maxHolidayDays = 31;
const maxMonthlyHolidayDays = 7;
const maxHolidayDaysAhead = 730;

/// Fixed-date national holidays, offered as one-tap suggestions (each repeats every year).
const suggestedHolidays = [
  (name: 'Republic Day', monthDay: '01-26'),
  (name: 'Independence Day', monthDay: '08-15'),
  (name: 'Gandhi Jayanti', monthDay: '10-02'),
  (name: 'Christmas', monthDay: '12-25'),
  (name: "New Year's Day", monthDay: '01-01'),
];

/// Names to fill in with one tap (festivals that move every year are added once).
const holidayNameIdeas = ['Diwali', 'Holi', 'Sankranti', 'Ugadi', 'Dussehra', 'Eid', 'Christmas'];

final _dateShape = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// A real calendar day written "YYYY-MM-DD".
bool isCalendarDay(Object? value) {
  if (value is! String || !_dateShape.hasMatch(value)) return false;
  final parsed = DateTime.tryParse('${value}T00:00:00Z');
  return parsed != null && _iso(parsed) == value;
}

int _y(String d) => int.parse(d.substring(0, 4));
int _m(String d) => int.parse(d.substring(5, 7));
int _d(String d) => int.parse(d.substring(8, 10));
String _dayOf(int y, int m, int d) => '$y-${'$m'.padLeft(2, '0')}-${'$d'.padLeft(2, '0')}';
int _monthLength(int y, int m) => DateTime.utc(y, m + 1, 0).day;

/// 1 for the 1st to 7th of a month, 2 for the 8th to 14th … 5 for the 29th to 31st.
int weekOfMonth(String day) => (_d(day) / 7).ceil();

String _yearlyAnchor(String start, int year) => _dayOf(year, _m(start), _d(start).clamp(1, _monthLength(year, _m(start))));

String _monthlyAnchor(Map holiday, int y, int m) {
  final start = '${holiday['start']}';
  final length = _monthLength(y, m);
  if (holiday['repeat'] == 'monthly') return _dayOf(y, m, _d(start).clamp(1, length));
  final weekday = weekdayOf(start);
  final nth = weekOfMonth(start);
  if (holiday['repeat'] == 'monthly_weekday' && nth <= 4) {
    final first = 1 + (weekday - weekdayOf(_dayOf(y, m, 1)) + 7) % 7;
    return _dayOf(y, m, first + 7 * (nth - 1));
  }
  // The last one in the month (a "5th" weekday is the last one too)
  return _dayOf(y, m, length - (weekdayOf(_dayOf(y, m, length)) - weekday + 7) % 7);
}

List<String> _anchorsAround(Map holiday, String from, String to) {
  if (holiday['repeat'] == 'none') return ['${holiday['start']}'];
  final out = <String>[];
  if (holiday['repeat'] == 'yearly') {
    for (var year = _y(from) - 1; year <= _y(to) && out.length < 400; year++) {
      out.add(_yearlyAnchor('${holiday['start']}', year));
    }
    return out;
  }
  for (var index = _y(from) * 12 + _m(from) - 2; index <= _y(to) * 12 + _m(to) - 1 && out.length < 400; index++) {
    out.add(_monthlyAnchor(holiday, index ~/ 12, index % 12 + 1));
  }
  return out;
}

int _maxDaysFor(String repeat) => repeat == 'none' || repeat == 'yearly' ? maxHolidayDays : maxMonthlyHolidayDays;
String _cleanName(Object? value) => '${value ?? ''}'.replaceAll(RegExp(r'\s+'), ' ').trim();
final _idShape = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

/// The saved list, cleaned (anything broken left out), oldest first, at most [maxHolidays]. Never throws.
List<Map<String, dynamic>> readHolidays(Object? value) {
  if (value is! List) return const [];
  final out = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final item in value) {
    if (item is! Map) continue;
    final name = _cleanName(item['name']);
    final start = '${item['start'] ?? ''}';
    final repeat = holidayRepeats.contains(item['repeat']) ? '${item['repeat']}' : 'none';
    final days = ((num.tryParse('${item['days']}') ?? 1).round()).clamp(1, _maxDaysFor(repeat));
    final id = item['id'] is String && _idShape.hasMatch(item['id'] as String) ? item['id'] as String : 'h_${start.replaceAll('-', '')}_${out.length}';
    if (name.isEmpty || !isCalendarDay(start) || seen.contains(id)) continue;
    seen.add(id);
    out.add({'id': id, 'name': name.length > holidayNameMax ? name.substring(0, holidayNameMax) : name, 'start': start, 'days': days, 'repeat': repeat});
    if (out.length >= maxHolidays) break;
  }
  out.sort((a, b) {
    final byStart = '${a['start']}'.compareTo('${b['start']}');
    return byStart != 0 ? byStart : '${a['name']}'.compareTo('${b['name']}');
  });
  return out;
}

Map<String, dynamic> _spanOf(Map holiday, String anchor) => {
  'id': holiday['id'],
  'name': holiday['name'],
  'start': anchor,
  'end': addDay(anchor, (holiday['days'] as int) - 1),
  'days': holiday['days'],
  'repeat': holiday['repeat'],
};

/// The holiday on this day (as a span), or null.
Map<String, dynamic>? holidayOn(String date, Object? list) {
  if (!isCalendarDay(date)) return null;
  for (final holiday in readHolidays(list)) {
    final start = '${holiday['start']}';
    if (date.compareTo(start) < 0) continue;
    for (final anchor in _anchorsAround(holiday, date, date)) {
      if (anchor.compareTo(start) < 0 || anchor.compareTo(date) > 0) continue;
      if (daysBetween(anchor, date) < (holiday['days'] as int)) return _spanOf(holiday, anchor);
    }
  }
  return null;
}

/// Every time the holidays fall between two days (spans that overlap them), earliest first.
List<Map<String, dynamic>> holidaySpans(Object? list, String from, String to) {
  if (!isCalendarDay(from) || !isCalendarDay(to) || to.compareTo(from) < 0) return const [];
  final out = <Map<String, dynamic>>[];
  for (final holiday in readHolidays(list)) {
    for (final anchor in _anchorsAround(holiday, addDay(from, -maxHolidayDays), to)) {
      if (anchor.compareTo('${holiday['start']}') < 0 || anchor.compareTo(to) > 0) continue;
      final span = _spanOf(holiday, anchor);
      if ('${span['end']}'.compareTo(from) >= 0 && !out.any((s) => s['id'] == span['id'] && s['start'] == span['start'])) out.add(span);
    }
  }
  out.sort((a, b) {
    final byStart = '${a['start']}'.compareTo('${b['start']}');
    return byStart != 0 ? byStart : '${a['name']}'.compareTo('${b['name']}');
  });
  return out;
}

/// Each holiday day between two days (at most 400 days), with its name: {"2026-11-08": "Diwali"}.
Map<String, String> holidayDays(Object? list, String from, String to) {
  final out = <String, String>{};
  if (list == null || !isCalendarDay(from) || !isCalendarDay(to) || to.compareTo(from) < 0 || daysBetween(from, to) > 400) return out;
  for (final span in holidaySpans(list, from, to)) {
    for (var day = '${span['start']}'; day.compareTo('${span['end']}') <= 0; day = addDay(day, 1)) {
      if (day.compareTo(from) >= 0 && day.compareTo(to) <= 0) out.putIfAbsent(day, () => '${span['name']}');
    }
  }
  return out;
}

/// The next time each holiday falls (from today), soonest first.
List<Map<String, dynamic>> upcomingHolidays(Object? list, String today, {int withinDays = 400}) {
  final firstEach = <String, Map<String, dynamic>>{};
  for (final span in holidaySpans(list, today, addDay(today, withinDays))) {
    firstEach.putIfAbsent('${span['id']}', () => span);
  }
  return firstEach.values.toList()..sort((a, b) => '${a['start']}'.compareTo('${b['start']}'));
}

/// The next time this one holiday falls on or after today (null when a one-off has gone).
Map<String, dynamic>? nextTime(Map holiday, String today) {
  final spans = holidaySpans([holiday], today, addDay(today, 800));
  return spans.isEmpty ? null : spans.first;
}

/// A suggested holiday's next date (Republic Day → the coming 26 Jan).
String suggestedStart(String monthDay, String today) {
  final thisYear = '${_y(today)}-$monthDay';
  return thisYear.compareTo(today) >= 0 ? thisYear : '${_y(today) + 1}-$monthDay';
}

/// 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 31st
String ordinal(int n) {
  final tens = n % 100;
  if (tens >= 11 && tens <= 13) return '${n}th';
  return '$n${n % 10 == 1 ? 'st' : n % 10 == 2 ? 'nd' : n % 10 == 3 ? 'rd' : 'th'}';
}

const _monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/// "8 Nov", or "8 Nov 2026" with the year
String holidayDay(String date, {bool withYear = false}) => '${_d(date)} ${_monthShort[_m(date) - 1]}${withYear ? ' ${_y(date)}' : ''}';

/// "8 Nov", "8 to 10 Nov", "30 Dec to 2 Jan" (with the year when asked)
String spanLabel(Map span, {bool withYear = false}) {
  final start = '${span['start']}', end = '${span['end']}';
  if (start == end) return holidayDay(start, withYear: withYear);
  if (_y(start) == _y(end) && _m(start) == _m(end)) return '${_d(start)} to ${_d(end)} ${_monthShort[_m(end) - 1]}${withYear ? ' ${_y(end)}' : ''}';
  return '${holidayDay(start, withYear: withYear && _y(start) != _y(end))} to ${holidayDay(end, withYear: withYear)}';
}

/// "Only once", "Every year on 26 Jan", "Every month on the 1st", "Every month on the 2nd Tuesday", "… the last Saturday"
String repeatLabel(Map holiday) {
  final start = '${holiday['start']}';
  final days = (num.tryParse('${holiday['days']}') ?? 1).round();
  final length = days > 1 ? ', $days days' : '';
  switch (holiday['repeat']) {
    case 'yearly':
      return 'Every year on ${holidayDay(start)}$length';
    case 'monthly':
      return 'Every month on the ${ordinal(_d(start))}$length';
    case 'monthly_weekday' when weekOfMonth(start) <= 4:
      return 'Every month on the ${ordinal(weekOfMonth(start))} ${_weekdayNames[weekdayOf(start)]}$length';
    case 'monthly_weekday' || 'monthly_last_weekday':
      return 'Every month on the last ${_weekdayNames[weekdayOf(start)]}$length';
  }
  return days > 1 ? 'Only once, $days days' : 'Only once';
}

/// The ways a holiday starting on this day can repeat, with words for a picker.
List<({String value, String label})> repeatChoices(String start) {
  if (!isCalendarDay(start)) return const [(value: 'none', label: 'Only once')];
  return [
    (value: 'none', label: 'Only once'),
    (value: 'yearly', label: repeatLabel({'start': start, 'repeat': 'yearly', 'days': 1})),
    (value: 'monthly', label: repeatLabel({'start': start, 'repeat': 'monthly', 'days': 1})),
    if (weekOfMonth(start) <= 4) (value: 'monthly_weekday', label: repeatLabel({'start': start, 'repeat': 'monthly_weekday', 'days': 1})),
    // In the month's last week: "the last Saturday" too
    if (_d(start) > _monthLength(_y(start), _m(start)) - 7)
      (value: 'monthly_last_weekday', label: repeatLabel({'start': start, 'repeat': 'monthly_last_weekday', 'days': 1})),
  ];
}

/// One holiday as typed on the phone, checked with the server's words. The id is kept when given (a change).
({Map<String, dynamic>? value, String? error, String? field}) cleanHoliday(Map input, String today) {
  final name = _cleanName(input['name']);
  if (name.isEmpty) return (value: null, error: 'Give the holiday a name, like Diwali.', field: 'name');
  if (name.length > holidayNameMax) return (value: null, error: 'Keep the name under $holidayNameMax letters.', field: 'name');
  final start = '${input['start'] ?? ''}'.trim();
  if (!isCalendarDay(start)) return (value: null, error: 'Choose the day.', field: 'start');
  if (daysBetween(today, start) > maxHolidayDaysAhead) return (value: null, error: 'Holidays can be added up to two years ahead.', field: 'start');
  if (start.compareTo('2000-01-01') < 0) return (value: null, error: 'Choose a day from 2000 on.', field: 'start');
  final repeat = holidayRepeats.contains(input['repeat']) ? '${input['repeat']}' : 'none';
  final raw = input['days'];
  final days = raw == null || '$raw'.isEmpty ? 1 : num.tryParse('$raw');
  if (days == null || days != days.roundToDouble() || days < 1) return (value: null, error: 'Choose how many days.', field: 'days');
  if (days > _maxDaysFor(repeat)) {
    return (
      value: null,
      error: repeat == 'none' || repeat == 'yearly' ? 'A holiday can be at most $maxHolidayDays days.' : 'A monthly holiday can be at most $maxMonthlyHolidayDays days.',
      field: 'days',
    );
  }
  if (repeat == 'none' && addDay(start, days.toInt() - 1).compareTo(today) < 0) return (value: null, error: 'That day has already gone.', field: 'start');
  return (
    value: {
      if (input['id'] is String && _idShape.hasMatch(input['id'] as String)) 'id': input['id'],
      'name': name,
      'start': start,
      'days': days.toInt(),
      'repeat': repeat,
    },
    error: null,
    field: null,
  );
}
