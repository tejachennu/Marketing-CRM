import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/attendance_logic.dart';
import 'package:wama_mobile/data/format.dart';

import 'release_helpers.dart';

/// Shop holidays: the rules (the same dates and answers as the server's tests/holidays.test.cjs), attendance
/// skipping them, and the Holidays tab as an owner uses it in the demo: see them, add one, add a national holiday
/// with one tap, the Day view says the shop is closed, remove one.
void main() {
  Map<String, dynamic> once(String start, [int days = 1, String name = 'Diwali']) => {'id': 'h_$start', 'name': name, 'start': start, 'days': days, 'repeat': 'none'};
  Map<String, dynamic> every(String repeat, String start, [int days = 1, String name = 'Holiday']) => {'id': 'h_${repeat}_$start', 'name': name, 'start': start, 'days': days, 'repeat': repeat};
  const today = '2026-11-25'; // a Wednesday

  group('when a holiday falls', () {
    test('a one-off holiday covers its days only', () {
      final list = [once('2026-11-27', 3)];
      expect(holidayOn('2026-11-26', list), isNull);
      expect(holidayOn('2026-11-27', list)!['name'], 'Diwali');
      expect(holidayOn('2026-11-29', list)!['end'], '2026-11-29');
      expect(holidayOn('2026-11-30', list), isNull);
      expect(holidayOn('2027-11-27', list), isNull, reason: 'not next year');
    });

    test('every year on the same date; 29 Feb falls on 28 Feb in other years; spans cross the new year', () {
      final republic = [every('yearly', '2027-01-26', 1, 'Republic Day')];
      expect(holidayOn('2027-01-26', republic)!['name'], 'Republic Day');
      expect(holidayOn('2031-01-26', republic)!['name'], 'Republic Day');
      expect(holidayOn('2026-01-26', republic), isNull, reason: 'not before it was first set');
      final leap = [every('yearly', '2028-02-29')];
      expect(holidayOn('2028-02-29', leap), isNotNull);
      expect(holidayOn('2029-02-28', leap), isNotNull);
      expect(holidayOn('2029-03-01', leap), isNull);
      final newYear = [every('yearly', '2026-12-31', 3)];
      expect(holidayOn('2027-01-02', newYear), isNotNull, reason: 'the span runs into January');
      expect(holidayOn('2027-01-03', newYear), isNull);
      expect(holidayOn('2028-01-01', newYear), isNotNull);
    });

    test('every month on a date: the 31st falls on the last day of shorter months', () {
      final list = [every('monthly', '2026-10-31')];
      expect(holidayOn('2026-11-30', list), isNotNull);
      expect(holidayOn('2026-12-31', list), isNotNull);
      expect(holidayOn('2026-12-30', list), isNull);
      expect(holidayOn('2027-02-28', list), isNotNull);
      final first = [every('monthly', '2026-11-01', 2)];
      expect(holidayOn('2027-03-02', first), isNotNull);
      expect(holidayOn('2027-03-03', first), isNull);
    });

    test('every month on a weekday: the 2nd Tuesday, the last Saturday; a 5th weekday means the last one', () {
      final second = [every('monthly_weekday', '2026-11-10')];
      expect(holidayOn('2026-12-08', second), isNotNull);
      expect(holidayOn('2027-01-12', second), isNotNull);
      expect(holidayOn('2027-01-05', second), isNull);
      final last = [every('monthly_last_weekday', '2026-11-28')];
      expect(holidayOn('2026-12-26', last), isNotNull);
      expect(holidayOn('2027-02-27', last), isNotNull);
      expect(holidayOn('2027-02-20', last), isNull);
      final fifth = [every('monthly_weekday', '2026-11-30')];
      expect(holidayOn('2026-12-28', fifth), isNotNull);
    });

    test('spans, days and the next ones between two dates', () {
      final list = [once('2026-11-27', 2), every('yearly', '2027-01-26', 1, 'Republic Day'), every('monthly', '2026-12-01', 1, 'Stock day')];
      expect(holidayDays(list, '2026-11-25', '2026-12-02'), {'2026-11-27': 'Diwali', '2026-11-28': 'Diwali', '2026-12-01': 'Stock day'});
      final next = upcomingHolidays(list, today);
      expect([for (final s in next) '${s['name']}:${s['start']}'], ['Diwali:2026-11-27', 'Stock day:2026-12-01', 'Republic Day:2027-01-26']);
      expect(holidaySpans([once('2026-11-24', 3)], '2026-11-25', '2026-11-30').first['start'], '2026-11-24');
      expect(nextTime(once('2026-11-20'), today), isNull, reason: 'a one-off that has gone');
      expect(nextTime(every('yearly', '2026-01-26'), today)!['start'], '2027-01-26');
      expect(holidayOn('2026-11-27', 'broken'), isNull, reason: 'a broken saved list never closes the shop');
    });
  });

  group('checks and words', () {
    test('a holiday is checked: a name, a real day, how many days, how it repeats', () {
      final ok = cleanHoliday({'name': '  Diwali   holidays ', 'start': '2026-11-27', 'days': '2'}, today);
      expect(ok.value!['name'], 'Diwali holidays');
      expect(ok.value!['days'], 2);
      expect(ok.value!['repeat'], 'none');
      expect(cleanHoliday({'id': 'keep-me', 'name': 'Diwali', 'start': '2026-11-27'}, today).value!['id'], 'keep-me');
      expect(cleanHoliday({'start': '2026-11-27'}, today).field, 'name');
      expect(cleanHoliday({'name': 'x' * 41, 'start': '2026-11-27'}, today).field, 'name');
      expect(cleanHoliday({'name': 'Diwali', 'start': '2026-02-30'}, today).field, 'start');
      expect(cleanHoliday({'name': 'Old', 'start': '2026-11-20'}, today).error, contains('already gone'));
      expect(cleanHoliday({'name': 'Yearly from the past', 'start': '2026-01-26', 'repeat': 'yearly'}, today).value, isNotNull);
      expect(cleanHoliday({'name': 'Far', 'start': '2029-01-01'}, today).error, contains('two years'));
      expect(cleanHoliday({'name': 'Long', 'start': '2026-12-01', 'days': 32}, today).field, 'days');
      expect(cleanHoliday({'name': 'Monthly', 'start': '2026-12-01', 'days': 8, 'repeat': 'monthly'}, today).error, contains('7 days'));
      expect(cleanHoliday({'name': 'Odd', 'start': '2026-12-01', 'repeat': 'weekly'}, today).value!['repeat'], 'none');
    });

    test('the saved list is read forgivingly', () {
      expect(readHolidays(null), isEmpty);
      expect(readHolidays('not a list'), isEmpty);
      final list = readHolidays([
        once('2026-12-25', 1, 'Christmas'),
        {'name': '', 'start': '2026-12-01'},
        {'name': 'Bad day', 'start': 'soon'},
        once('2026-11-27'),
      ]);
      expect([for (final h in list) h['name']], ['Diwali', 'Christmas'], reason: 'broken ones dropped, oldest first');
    });

    test('words: how it repeats, the choices for a day, dates', () {
      expect(repeatLabel(every('yearly', '2027-01-26')), 'Every year on 26 Jan');
      expect(repeatLabel(every('monthly', '2026-11-01')), 'Every month on the 1st');
      expect(repeatLabel(every('monthly', '2026-11-22')), 'Every month on the 22nd');
      expect(repeatLabel(every('monthly_weekday', '2026-11-10')), 'Every month on the 2nd Tuesday');
      expect(repeatLabel(every('monthly_last_weekday', '2026-11-28')), 'Every month on the last Saturday');
      expect(repeatLabel(once('2026-11-27')), 'Only once');
      expect(repeatLabel(once('2026-11-27', 3)), 'Only once, 3 days');
      expect(repeatLabel(every('yearly', '2026-12-31', 3)), 'Every year on 31 Dec, 3 days');
      expect([for (final c in repeatChoices('2026-11-28')) c.value], ['none', 'yearly', 'monthly', 'monthly_weekday', 'monthly_last_weekday']);
      expect([for (final c in repeatChoices('2026-11-30')) c.value], ['none', 'yearly', 'monthly', 'monthly_last_weekday'], reason: 'no "5th Monday"');
      expect([for (final c in repeatChoices('2026-11-10')) c.value], ['none', 'yearly', 'monthly', 'monthly_weekday']);
      expect(spanLabel({'start': '2026-11-08', 'end': '2026-11-10'}), '8 to 10 Nov');
      expect(spanLabel({'start': '2026-12-30', 'end': '2027-01-02'}, withYear: true), '30 Dec 2026 to 2 Jan 2027');
      expect(ordinal(11), '11th');
      expect(ordinal(23), '23rd');
      expect(suggestedStart('01-26', today), '2027-01-26');
      expect(suggestedStart('12-25', today), '2026-12-25');
    });

    test('attendance: holidays are not working days (leave skips them, never "not marked", leave joins across them)', () {
      final holidays = [once('2026-11-27')];
      final leave = leaveDays(staffId: 'anu', from: '2026-11-26', to: '2026-11-28', today: today, holidays: holidays);
      expect([for (final m in leave.marks) m['day']], ['2026-11-26', '2026-11-28']);
      expect(leaveDays(staffId: 'anu', from: '2026-11-27', to: '2026-11-27', today: today, holidays: holidays).error, contains('closed'));
      // 1 to 25 Nov 2026 with a holiday on 10 and 11 Nov: 23 working days, none marked
      expect(personMonth(const [], 'anu', '2026-11', today, holidays: [once('2026-11-10', 2)])['not_marked'], 23);
      expect(personMonth(const [], 'anu', '2026-11', today)['not_marked'], 25);
      final marks = [
        {'staff_id': 'anu', 'day': '2026-11-26', 'status': 'leave'},
        {'staff_id': 'anu', 'day': '2026-11-28', 'status': 'leave'},
      ];
      expect(leaveSpans(marks, 'anu', holidays: holidays).length, 1, reason: 'one leave across the holiday');
      expect(leaveSpans(marks, 'anu').length, 2);
      final waiting = applyPending(
        const [],
        [
          (method: 'PUT', body: {'leave': {'staff_id': 'anu', 'from': '2026-11-26', 'to': '2026-11-28'}}),
        ],
        today: today,
        holidays: holidays,
      );
      expect(waiting.length, 2, reason: 'a leave waiting to sync also skips the holiday');
    });
  });

  final r = releaseApp(billing: 'paid');

  testWidgets('owner sees the holidays, adds one, adds Independence Day with one tap, the Day view says closed, removes one (320 × 1000)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 1000, () async {
      await tester.tap(find.text('More').last);
      await settle(tester);
      await tapText(tester, 'Attendance');
      await tester.tap(find.text('Holidays'));
      await settle(tester);

      // The demo's holidays: a family function next week and Republic Day every year
      expect(find.text('Shop holidays'), findsOneWidget);
      expect(await reach(tester, find.text('Family function')), findsWidgets);
      expect(await reach(tester, find.textContaining('Every year on 26 Jan')), findsOneWidget);

      // Add Diwali today with the name chip
      await tester.drag(find.byType(Scrollable).last, const Offset(0, 3000));
      await settle(tester);
      await tapText(tester, 'Add holiday');
      expect(find.text('Add a holiday'), findsOneWidget);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Diwali'));
      await settle(tester);
      expect(find.textContaining('On: ${spanLabel({'start': istToday(), 'end': istToday()}, withYear: true)}'), findsOneWidget);
      await tapText(tester, 'Save holiday');
      expect(find.text('Holiday added. No bookings will be taken that day.'), findsOneWidget);
      expect(await reach(tester, find.text('Diwali')), findsWidgets);

      // One tap: Independence Day, every year
      await tester.drag(find.byType(Scrollable).last, const Offset(0, 3000));
      await settle(tester);
      final independence = find.textContaining('Independence Day ·');
      await tester.ensureVisible(independence);
      await tester.pump();
      await tester.tap(independence);
      await settle(tester);
      expect(find.textContaining('Independence Day ·'), findsNothing, reason: 'an added suggestion is not offered again');
      expect(await reach(tester, find.textContaining('Every year on 15 Aug')), findsOneWidget);

      // The Day view: today is a holiday, so the shop is closed and nobody needs marking
      await tester.tap(find.text('Day'));
      await settle(tester);
      expect(find.textContaining('Shop holiday: Diwali'), findsOneWidget);
      expect(find.text('Mark all present'), findsNothing);
      expect(find.text('Add leave'), findsOneWidget);

      // Remove the family function
      await tester.tap(find.text('Holidays'));
      await settle(tester);
      final more = await reach(tester, find.byTooltip('More for Family function'));
      await tester.ensureVisible(more);
      await tester.pump();
      await tester.tap(more);
      await settle(tester);
      await tester.tap(find.text('Remove').last);
      await settle(tester);
      expect(find.text('Remove Family function?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
      await settle(tester);
      expect(find.text('Family function removed.'), findsOneWidget);
      expect(find.text('Family function'), findsNothing);
    });
  });
}
