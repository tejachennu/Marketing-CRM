import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/attendance_logic.dart';
import 'package:wama_mobile/data/format.dart';

import 'release_helpers.dart';

/// Staff attendance: the rules (same as the server's), and the screen as an owner uses it: Front Desk shows who is
/// on leave on their bookings, More → Attendance marks a day, "Mark all present", Add leave, and the month view.
void main() {
  group('rules', () {
    const today = '2026-11-25'; // a Wednesday

    test('leave from one day to another skips closed days and refuses what cannot be', () {
      final r = leaveDays(staffId: 'a', from: '2026-11-23', to: '2026-11-27', today: today, kind: 'casual', note: ' Wedding ', closed: [2]);
      expect(r.error, isNull);
      expect([for (final m in r.marks) m['day']], ['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27']);
      expect(r.marks.first['note'], 'Wedding');
      expect(leaveDays(staffId: 'a', from: '2026-11-25', to: '2026-11-24', today: today).error, contains('before'));
      expect(leaveDays(staffId: 'a', from: '2026-11-25', to: '2027-02-10', today: today).error, isNotNull);
      expect(leaveDays(staffId: 'a', from: '2026-11-24', to: '2026-11-24', today: today, closed: [2]).error, contains('closed'));
      expect(leaveDays(staffId: 'a', from: '2026-11-25', to: '2026-11-25', today: today, status: 'week_off', kind: 'sick').marks.single['leave_kind'], isNull);
    });

    test('waiting changes are laid over the marks: marks, everyone present, leave, a mark taken off', () {
      final marks = [
        {'staff_id': 'a', 'day': today, 'status': 'leave', 'leave_kind': 'sick', 'note': null},
      ];
      final out = applyPending(
        marks,
        [
          (method: 'PUT', body: {'all': {'day': today}}),
          (
            method: 'PUT',
            body: {
              'marks': [
                {'staff_id': 'b', 'day': today, 'status': 'half_day'},
              ],
            },
          ),
          (method: 'PUT', body: {'leave': {'staff_id': 'c', 'from': '2026-11-26', 'to': '2026-11-27'}}),
          (method: 'DELETE', body: {'staffId': 'c', 'day': '2026-11-27'}),
        ],
        staffIds: ['a', 'b', 'c'],
        today: today,
      );
      String? statusOf(String id, String day) => out.cast<Map?>().firstWhere((m) => m!['staff_id'] == id && m['day'] == day, orElse: () => null)?['status'];
      expect(statusOf('a', today), 'leave', reason: 'everyone present never changes someone already marked');
      expect(statusOf('b', today), 'half_day');
      expect(statusOf('c', today), 'present');
      expect(statusOf('c', '2026-11-26'), 'leave');
      expect(statusOf('c', '2026-11-27'), isNull);
    });

    test('a month for a person: half days count 0.5; not marked counts working days up to today', () {
      final marks = [
        {'staff_id': 'a', 'day': '2026-11-02', 'status': 'present'},
        {'staff_id': 'a', 'day': '2026-11-04', 'status': 'half_day'},
        {'staff_id': 'a', 'day': '2026-11-05', 'status': 'leave', 'leave_kind': 'casual'},
        {'staff_id': 'a', 'day': '2026-11-06', 'status': 'leave', 'leave_kind': 'casual'},
        {'staff_id': 'a', 'day': '2026-11-07', 'status': 'absent'},
        {'staff_id': 'a', 'day': '2026-11-28', 'status': 'leave'},
      ];
      final sum = personMonth(marks, 'a', '2026-11', today, closed: [2]);
      expect(sum['worked'], 1.5);
      expect(sum['leave'], 3);
      expect(sum['absent'], 1);
      expect(sum['not_marked'], 16, reason: '21 working days so far, 5 of them marked');
      final spans = leaveSpans(marks, 'a');
      expect([for (final s in spans) '${s['from']}–${s['to']}:${s['days']}'], ['2026-11-05–2026-11-06:2', '2026-11-28–2026-11-28:1']);
      expect(markLabel({'status': 'leave', 'leave_kind': 'sick'}), 'On leave · Sick');
      expect(daysText(18.5), '18.5 days');
      expect(monthDays('2028-02').length, 29);
      expect(addMonth('2026-12', 1), '2027-01');
    });
  });

  final r = releaseApp(billing: 'paid');

  testWidgets('owner sees who is on leave, marks a day, marks all present, adds leave, looks at the month (320 × 1000)', (tester) async {
    // Back to the top of the list (long lists build only what is near the screen)
    Future<void> top() async {
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
      await settle(tester);
    }

    await useApp(tester, r.app, width: 320, height: 1000, () async {
      // Front Desk: Ravi is on sick leave today, and has a booking this evening
      expect(await reach(tester, find.text('Ravi on leave')), findsWidgets);

      await tester.tap(find.text('More').last);
      await settle(tester);
      await tapText(tester, 'Attendance');
      expect(find.text('Today'), findsOneWidget);
      expect(find.text('Present 1', findRichText: true), findsOneWidget);
      expect(find.text('Half day 1', findRichText: true), findsOneWidget);
      expect(await reach(tester, find.textContaining('On leave · Sick')), findsOneWidget);
      await top();

      // Tomorrow: Ravi is still on leave, the others are not marked yet
      await tester.tap(find.byTooltip('After').first);
      await settle(tester);
      expect(find.text('Tomorrow'), findsOneWidget);
      expect(find.text('Not marked 2', findRichText: true), findsOneWidget);
      await tapText(tester, 'Mark all present');
      await top();
      expect(find.text('Present 2', findRichText: true), findsOneWidget);
      expect(find.text('Not marked 0', findRichText: true), findsOneWidget);
      expect(await reach(tester, find.textContaining('On leave · Sick')), findsOneWidget, reason: 'Ravi stays on leave');

      // One tap changes a mark: Lakshmi is on a half day after all
      final lakshmi = find.ancestor(of: find.text('Lakshmi'), matching: find.byType(Card));
      final halfDay = find.descendant(of: lakshmi, matching: find.text('Half day'));
      await tester.ensureVisible(halfDay);
      await tester.pump();
      await tester.tap(halfDay);
      await settle(tester);
      await top();
      expect(find.text('Half day 1', findRichText: true), findsOneWidget);

      // Leave for Anitha tomorrow, from the Add leave sheet
      await tapText(tester, 'Add leave');
      expect(find.text('Mark days off in one go'), findsOneWidget);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Anitha').last);
      await settle(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Casual').last);
      await settle(tester);
      await tapText(tester, 'Save 1 day');
      expect(find.text('Leave marked.'), findsOneWidget);
      expect(await reach(tester, find.textContaining('On leave · Casual')), findsOneWidget);
      expect(r.app.pending('attendance'), isEmpty, reason: 'sent to the server');

      // The month: everyone, then Ravi's calendar and leave
      await tester.tap(find.text('Month'));
      await settle(tester);
      expect(find.text(monthTitle(istToday().substring(0, 7))), findsOneWidget);
      expect(find.textContaining('days in'), findsWidgets);
      final ravi = find.widgetWithText(ChoiceChip, 'Ravi');
      await tester.ensureVisible(ravi);
      await tester.pump();
      await tester.tap(ravi);
      await settle(tester);
      expect(await reach(tester, find.text('Leave this month')), findsOneWidget);
      expect(await reach(tester, find.text('Cancel leave')), findsWidgets);
    });
  });
}
