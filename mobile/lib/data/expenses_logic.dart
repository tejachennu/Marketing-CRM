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

/// Longest name of a kind the business types itself ("Tea and snacks").
const maxCategoryName = 40;

bool isBuiltInCategory(Object? value) => expenseCategories.any((c) => c.$1 == value);

final _hasLetter = RegExp(r'[\p{L}\p{N}]', unicode: true);

/// A kind of expense the business typed: tidied, 2 to 40 characters with a letter or digit; null when not usable.
String? cleanCategoryName(Object? value) {
  final name = '${value ?? ''}'.replaceAll(RegExp(r'[\x00-\x1f\x7f<>]'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (name.length < 2 || name.length > maxCategoryName || !_hasLetter.hasMatch(name)) return null;
  return name;
}

/// What a picked or typed kind is saved as: a built-in key (also when its name is typed), one of the business's own in
/// the spelling it already has (any letter case), or the new name as typed. The same as the server.
String? resolveCategory(Object? value, [List<String> own = const []]) {
  if (isBuiltInCategory(value)) return '$value';
  final name = cleanCategoryName(value);
  if (name == null) return null;
  final lower = name.toLowerCase();
  for (final (key, label) in expenseCategories) {
    if (key == lower || label.toLowerCase() == lower) return key;
  }
  for (final o in own) {
    if (o.toLowerCase() == lower) return o;
  }
  return name;
}

/// The name to show: a built-in label, or the business's own name.
String categoryLabel(String? key) {
  for (final (k, label) in expenseCategories) {
    if (k == key) return label;
  }
  return cleanCategoryName(key) ?? 'Other';
}

/// The business's own kinds (not the built-in ones), each once whatever its letter case, in the order given
/// (the server's list is most used first; the phone's own list goes after it).
List<String> mergeOwnCategories(Iterable<Object?> names, [int limit = 60]) {
  final seen = <String>{};
  final out = <String>[];
  for (final value in names) {
    if (isBuiltInCategory(value)) continue;
    final name = cleanCategoryName(value);
    if (name == null || !seen.add(name.toLowerCase())) continue;
    out.add(name);
    if (out.length >= limit) break;
  }
  return out;
}

/// The category picker's list for what is typed: built-in and own kinds that have every typed word, built-in ones
/// first; `add` is the typed name when it is new (offered as "Add …"). The same as the server's categoryChoices.
({List<({String key, String label, bool own})> choices, String? add}) categoryChoices(String query, [List<String> own = const []]) {
  final all = [
    for (final (key, label) in expenseCategories) (key: key, label: label, own: false),
    for (final o in mergeOwnCategories(own)) (key: o, label: o, own: true),
  ];
  final words = query.toLowerCase().split(RegExp(r'[^\p{L}\p{N}]+', unicode: true)).where((w) => w.isNotEmpty).toList();
  final choices = words.isEmpty
      ? all
      : all.where((c) => words.every((w) => c.label.toLowerCase().contains(w) || c.key.toLowerCase().contains(w))).toList();
  final name = cleanCategoryName(query);
  final lower = name?.toLowerCase();
  final exists = name == null || all.any((c) => c.label.toLowerCase() == lower || c.key.toLowerCase() == lower);
  return (choices: choices, add: exists ? null : name);
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
  // Own kinds are one group whatever their letter case, shown in the spelling seen first
  final totals = <String, (String, num, int)>{};
  for (final row in expenses) {
    final key = isBuiltInCategory(row['category']) ? '${row['category']}' : cleanCategoryName(row['category']) ?? 'other';
    final group = isBuiltInCategory(key) ? key : key.toLowerCase();
    final (first, amount, count) = totals[group] ?? (key, 0, 0);
    totals[group] = (first, amount + toNum(row['amount']), count + 1);
  }
  final all = totals.values.fold<num>(0, (sum, row) => sum + row.$2);
  final rows = [
    for (final (key, amount, count) in totals.values)
      {'key': key, 'label': categoryLabel(key), 'amount': amount, 'count': count, 'share': all > 0 ? (amount / all * 100).round() : 0},
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
