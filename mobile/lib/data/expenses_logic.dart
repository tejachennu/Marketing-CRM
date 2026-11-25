/// Expenses rules shared by the Expenses screen and the demo, the same as the server's lib/expenses/rules.ts:
/// the kinds of expense, payment methods, India-time months ("2026-11") and the monthly sums.
library;

import 'format.dart';

const expenseCategories = [
  ('salaries', 'Salaries'),
  ('rent', 'Rent'),
  ('bills', 'Electricity, water, internet'),
  ('stock', 'Stock and supplies'),
  ('marketing', 'Ads and marketing'),
  ('transport', 'Transport and delivery'),
  ('repairs', 'Repairs and upkeep'),
  ('tax', 'Taxes and fees'),
  ('loan', 'Loan and EMI'),
  ('other', 'Other'),
];

const payMethods = [('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank transfer'), ('card', 'Card')];

/// Salaries, rent and EMIs are usually the same every month.
const usuallyMonthly = {'salaries', 'rent', 'loan'};

String categoryLabel(String? key) {
  for (final (k, label) in expenseCategories) {
    if (k == key) return label;
  }
  return 'Other';
}

String methodLabel(String? key) {
  for (final (k, label) in payMethods) {
    if (k == key) return label;
  }
  return '';
}

const _monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

String thisMonth() => istToday().substring(0, 7);

String addMonths(String month, int count) {
  final parts = month.split('-');
  final index = int.parse(parts[0]) * 12 + int.parse(parts[1]) - 1 + count;
  return '${index ~/ 12}-${(index % 12 + 1).toString().padLeft(2, '0')}';
}

String monthName(String month, {bool withYear = true}) {
  final parts = month.split('-');
  final name = _monthNames[int.parse(parts[1]) - 1];
  return withYear ? '$name ${parts[0]}' : name;
}

String shortMonth(String month) => monthName(month, withYear: false).substring(0, 3);

int daysInMonth(String month) {
  final parts = month.split('-');
  return DateTime.utc(int.parse(parts[0]), int.parse(parts[1]) + 1, 0).day;
}

/// The months ending at [month], oldest first.
List<String> monthsUpTo(String month, [int count = 6]) => [for (var i = count - 1; i >= 0; i--) addMonths(month, -i)];

num toNum(Object? value) => value is num ? value : num.tryParse('$value') ?? 0;

/// Where the money went: biggest first, with whole-percent shares.
List<Map<String, dynamic>> byCategory(List<Map<String, dynamic>> expenses) {
  final totals = <String, (num, int)>{};
  for (final row in expenses) {
    final key = expenseCategories.any((c) => c.$1 == row['category']) ? '${row['category']}' : 'other';
    final (amount, count) = totals[key] ?? (0, 0);
    totals[key] = (amount + toNum(row['amount']), count + 1);
  }
  final all = totals.values.fold<num>(0, (sum, row) => sum + row.$1);
  final rows = [
    for (final MapEntry(:key, :value) in totals.entries)
      {'key': key, 'label': categoryLabel(key), 'amount': value.$1, 'count': value.$2, 'share': all > 0 ? (value.$1 / all * 100).round() : 0},
  ];
  rows.sort((a, b) => toNum(b['amount']).compareTo(toNum(a['amount'])));
  return rows;
}

/// Repeating expenses not yet in [month] (the latest earlier copy of each, if it still repeats), like the server.
List<Map<String, dynamic>> repeatsDue(String month, List<Map<String, dynamic>> all) {
  final latest = <String, Map<String, dynamic>>{};
  final present = <String>{};
  for (final row in all) {
    final key = '${row['repeat_key'] ?? ''}';
    if (key.isEmpty) continue;
    final rowMonth = '${row['spent_on']}'.substring(0, 7);
    if (rowMonth == month) present.add(key);
    if (rowMonth.compareTo(month) >= 0) continue;
    final seen = latest[key];
    if (seen == null || '${row['spent_on']}'.compareTo('${seen['spent_on']}') > 0) latest[key] = row;
  }
  return [
    for (final MapEntry(:key, :value) in latest.entries)
      if (value['repeat_monthly'] == true && !present.contains(key))
        {
          ...value,
          'spent_on': '$month-${(int.tryParse('${value['spent_on']}'.substring(8, 10)) ?? 1).clamp(1, daysInMonth(month)).toString().padLeft(2, '0')}',
        },
  ];
}
