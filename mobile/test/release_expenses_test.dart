import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/expenses_logic.dart';

import 'release_helpers.dart';

/// More → Expenses and profit: add an expense, copy last month's salaries and rent, get the AI review once,
/// change and remove an expense. Staff never see it.
void main() {
  final r = releaseApp();

  testWidgets('owner adds expenses, copies the monthly ones, gets the AI review (320 × 640)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      await tester.tap(find.text('More').last);
      await settle(tester);
      await tapText(tester, 'Expenses and profit');
      expect(find.text(monthName(thisMonth())), findsOneWidget);
      expect(find.text('Profit'), findsOneWidget);

      // Last month had two salaries and rent; one salary is already in this month
      await tapText(tester, 'Add them');
      expect(find.text('Add them'), findsNothing, reason: 'the monthly ones are copied once');

      // A new expense: amount and kind are needed
      await tapText(tester, 'Add expense');
      await tester.enterText(find.widgetWithText(TextField, 'How much'), '1250');
      await tester.pump();
      await tapText(tester, 'Repairs and upkeep');
      await tapText(tester, 'Cash');
      final save = await reach(tester, find.widgetWithText(FilledButton, 'Add expense'));
      expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
      await tester.ensureVisible(save);
      await tester.pump();
      await tester.tap(save);
      await settle(tester);
      expect(find.text('Expense added'), findsOneWidget);
      // The new row in the month's list (tap it later to change it)
      // (every box is an InkWell without a tap, and the kind filter chips also show the name: the row is the last tappable one)
      final rows = find.descendant(of: find.byWidgetPredicate((w) => w is InkWell && w.onTap != null), matching: find.text('Repairs and upkeep'));
      expect(await reach(tester, rows), findsWidgets);

      // The AI review, once a month (near the top: scroll back up)
      await tester.drag(find.descendant(of: find.byType(RefreshIndicator), matching: find.byType(Scrollable)).first, const Offset(0, 3000));
      await settle(tester);
      await tapText(tester, 'Review this month so far');
      expect(find.text('Sales ideas'), findsOneWidget);
      expect(find.text('Review this month so far'), findsNothing, reason: 'one review while the month is going on');

      // Change it, then remove it
      await reach(tester, rows);
      final row = rows.last;
      await tester.ensureVisible(row);
      await tester.pump();
      await tester.tap(row);
      await settle(tester);
      expect(find.text('Change expense'), findsOneWidget);
      await tester.tap(find.byTooltip('Remove'));
      await settle(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
      await settle(tester);
      expect(find.text('Expense removed'), findsOneWidget);

      // Months before: the next-month arrow comes back
      await tester.drag(find.descendant(of: find.byType(RefreshIndicator), matching: find.byType(Scrollable)).first, const Offset(0, 3000));
      await settle(tester);
      await tester.tap(find.byTooltip('Month before'));
      await settle(tester);
      expect(find.text(monthName(addMonths(thisMonth(), -1))), findsOneWidget);
    });
  });

  test('repeating expenses are copied on the same day, the 31st becomes the month end', () {
    final due = repeatsDue('2026-11', [
      {'spent_on': '2026-10-31', 'category': 'rent', 'amount': 15000, 'repeat_monthly': true, 'repeat_key': 'a'},
      {'spent_on': '2026-10-01', 'category': 'salaries', 'amount': 9000, 'repeat_monthly': false, 'repeat_key': 'b'},
      {'spent_on': '2026-10-01', 'category': 'loan', 'amount': 4000, 'repeat_monthly': true, 'repeat_key': 'c'},
      {'spent_on': '2026-11-02', 'category': 'loan', 'amount': 4000, 'repeat_monthly': true, 'repeat_key': 'c'},
    ]);
    expect(due.map((e) => e['spent_on']), ['2026-11-30']);
    expect(byCategory([{'category': 'rent', 'amount': 300}, {'category': 'x', 'amount': 100}]).map((c) => '${c['key']} ${c['share']}'), ['rent 75', 'other 25']);
  });
}
