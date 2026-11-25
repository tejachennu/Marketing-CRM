import 'backend.dart';
import 'expenses_logic.dart';

/// Demo answers for Expenses, shaped like the real /api/expenses and /api/expenses/insight: last month's salaries and
/// rent repeat, this month has a few entries, sales are made-up sample numbers for the last six months.
class DemoExpenses {
  DemoExpenses() {
    final now = thisMonth();
    final last = addMonths(now, -1);
    // Older months: salaries, rent and stock, so the six-month bars have something to show
    for (final (back, stock) in [(5, 9800), (4, 12400), (3, 7600), (2, 15200)]) {
      final m = addMonths(now, -back);
      _expenses.addAll([
        {'id': 'old${back}a', 'spent_on': '$m-01', 'category': 'salaries', 'amount': 33000, 'paid_to': null, 'note': 'Salaries', 'method': 'bank', 'repeat_monthly': false, 'repeat_key': null},
        {'id': 'old${back}b', 'spent_on': '$m-02', 'category': 'rent', 'amount': 22000, 'paid_to': 'Landlord', 'note': null, 'method': 'bank', 'repeat_monthly': false, 'repeat_key': null},
        {'id': 'old${back}c', 'spent_on': '$m-15', 'category': 'stock', 'amount': stock, 'paid_to': 'Sri Ram Traders', 'note': null, 'method': 'upi', 'repeat_monthly': false, 'repeat_key': null},
      ]);
    }
    _expenses.addAll([
      {'id': 'e1', 'spent_on': '$last-01', 'category': 'salaries', 'amount': 18000, 'paid_to': 'Ravi Kumar', 'note': null, 'method': 'bank', 'repeat_monthly': true, 'repeat_key': 'e1'},
      {'id': 'e2', 'spent_on': '$last-01', 'category': 'salaries', 'amount': 15000, 'paid_to': 'Anitha', 'note': null, 'method': 'bank', 'repeat_monthly': true, 'repeat_key': 'e2'},
      {'id': 'e3', 'spent_on': '$last-02', 'category': 'rent', 'amount': 22000, 'paid_to': 'Landlord', 'note': null, 'method': 'bank', 'repeat_monthly': true, 'repeat_key': 'e3'},
      {'id': 'e4', 'spent_on': '$last-14', 'category': 'stock', 'amount': 8200, 'paid_to': 'Sri Ram Traders', 'note': 'Hair colour and shampoo', 'method': 'upi', 'repeat_monthly': false, 'repeat_key': null},
      {'id': 'e5', 'spent_on': '$now-01', 'category': 'salaries', 'amount': 18000, 'paid_to': 'Ravi Kumar', 'note': null, 'method': 'bank', 'repeat_monthly': true, 'repeat_key': 'e1'},
      {'id': 'e6', 'spent_on': '$now-05', 'category': 'bills', 'amount': 2600, 'paid_to': 'Electricity board', 'note': null, 'method': 'upi', 'repeat_monthly': false, 'repeat_key': null},
      {'id': 'e7', 'spent_on': '$now-09', 'category': 'stock', 'amount': 3400, 'paid_to': 'Sri Ram Traders', 'note': 'Hair colour, 12 boxes', 'method': 'upi', 'repeat_monthly': false, 'repeat_key': null},
      {'id': 'e8', 'spent_on': '$now-12', 'category': 'marketing', 'amount': 5000, 'paid_to': null, 'note': 'Instagram ads', 'method': 'card', 'repeat_monthly': false, 'repeat_key': null},
    ]);
  }

  final List<Map<String, dynamic>> _expenses = [];
  final Map<String, Map<String, dynamic>> _insights = {};
  var _seq = 20;

  /// Sample sales (amount, count, received) for the six months up to this one, oldest first.
  static const _sales = [(142000, 160, 140000), (128500, 150, 128500), (165200, 181, 160000), (94000, 120, 94000), (188400, 204, 181000), (151250, 166, 139800)];

  Map<String, dynamic> _overview(String month) {
    final current = thisMonth();
    final months = monthsUpTo(month);
    final totals = [
      for (final m in months)
        () {
          final back = monthsUpTo(current, 24).reversed.toList().indexOf(m);
          final sale = back >= 0 && back < _sales.length ? _sales[_sales.length - 1 - back] : (0, 0, 0);
          final spent = _expenses.where((e) => '${e['spent_on']}'.startsWith(m)).fold<num>(0, (sum, e) => sum + toNum(e['amount']));
          return {'month': m, 'sales': sale.$1, 'salesCount': sale.$2, 'received': sale.$3, 'expenses': spent, 'profit': sale.$1 - spent};
        }(),
    ];
    final inMonth = _expenses.where((e) => '${e['spent_on']}'.startsWith(month)).toList()
      ..sort((a, b) => '${b['spent_on']}'.compareTo('${a['spent_on']}'));
    final kind = month.compareTo(current) < 0 ? 'full' : 'so_far';
    final saved = _insights['$month:full'] ?? _insights['$month:$kind'];
    return {
      'month': month,
      'current': current,
      'months': totals,
      'categories': byCategory(inMonth),
      'expenses': inMonth,
      'repeatsDue': repeatsDue(month, _expenses).length,
      'insight': saved,
      'insightKind': kind,
      'canAskInsight': saved == null,
    };
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    if (path != '/api/expenses') return null;
    final asked = query?['month'] ?? '';
    final month = RegExp(r'^\d{4}-\d{2}$').hasMatch(asked) && asked.compareTo(thisMonth()) <= 0 ? asked : thisMonth();
    return _overview(month);
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    if (path.startsWith('/api/expenses?') && method == 'DELETE') {
      final id = Uri.parse(path).queryParameters['id'];
      final before = _expenses.length;
      _expenses.removeWhere((e) => e['id'] == id);
      return {'success': true, 'removed': _expenses.length < before};
    }
    if (path == '/api/expenses/insight') return _insight('${body['month'] ?? thisMonth()}');
    if (path != '/api/expenses') return null;
    if (body['action'] == 'copy_repeats') {
      final due = repeatsDue('${body['month']}', _expenses);
      for (final row in due) {
        _expenses.add({...row, 'id': 'e${++_seq}'});
      }
      return {'success': true, 'added': due.length};
    }
    final amount = toNum('${body['amount'] ?? ''}'.replaceAll(RegExp(r'[₹,\s]'), ''));
    if (amount <= 0) throw ApiException(400, 'Type how much was spent.');
    if (!expenseCategories.any((c) => c.$1 == body['category'])) throw ApiException(400, 'Pick what kind of expense it is.');
    String? text(Object? v) => '${v ?? ''}'.trim().isEmpty ? null : '$v'.trim();
    final values = {
      'spent_on': body['spent_on'] ?? '${thisMonth()}-01',
      'category': body['category'],
      'amount': amount,
      'paid_to': text(body['paid_to']),
      'note': text(body['note']),
      'method': payMethods.any((m) => m.$1 == body['method']) ? body['method'] : null,
      'repeat_monthly': body['repeat_monthly'] == true,
    };
    if (method == 'PUT') {
      final row = _expenses.firstWhere((e) => e['id'] == body['id'], orElse: () => throw ApiException(404, 'This expense was removed.'));
      row.addAll({...values, 'repeat_key': row['repeat_key'] ?? (values['repeat_monthly'] == true ? row['id'] : null)});
      return {'success': true, 'expense': row};
    }
    final id = 'e${++_seq}';
    final row = {'id': id, ...values, 'repeat_key': values['repeat_monthly'] == true ? id : null};
    _expenses.add(row);
    return {'success': true, 'expense': row};
  }

  Map<String, dynamic> _insight(String month) {
    final kind = month.compareTo(thisMonth()) < 0 ? 'full' : 'so_far';
    final saved = _insights['$month:full'] ?? _insights['$month:$kind'];
    if (saved != null) return {'success': true, 'insight': saved, 'already': true};
    final row = {
      'month': month,
      'kind': kind,
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'insight': {
        'summary': '${monthName(month, withYear: false)}${kind == 'so_far' ? ' so far' : ''} is going well: ₹1,51,250 in sales from 166 sales. Salaries and rent are more than three quarters of your costs.',
        'good': ['Saturdays bring the most sales', 'Haircut is your best seller', '44 of 120 customers came back'],
        'improve': ['₹11,450 is still to collect: send bill reminders on WhatsApp', 'Tuesdays are slow'],
        'ideas': ['Send a Tuesday offer to old customers on WhatsApp', 'Offer a hair spa with every colour', 'Ask happy customers for a Google review', 'Give a small gift for bringing a friend'],
        'focus': 'Collect the ₹11,450 still due before the month ends.',
      },
    };
    _insights['$month:$kind'] = row;
    return {'success': true, 'insight': row};
  }
}
