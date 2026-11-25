import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/expenses_logic.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../store/store_screen.dart' show plain;

/// Expenses: salaries, rent, stock and everything the business spends, next to its sales (the last six months as
/// bars), where the money went, and the once-a-month AI review of sales. Owners and admins only; the same
/// /api/expenses as the website. Needs the internet (like Setup).
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});
  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

const _salesColour = Brand.blue;
const _spentColour = Color(0xFF8696A0);

class _ExpensesScreenState extends State<ExpensesScreen> {
  String _month = thisMonth();
  Map<String, dynamic>? _view;
  String _error = '';
  bool _loading = true;
  bool _copying = false;
  bool _asking = false;
  String _filter = 'all';
  int? _picked;
  int _ask = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final view = await app.backend.get('/api/expenses', {'organizationId': app.orgId, 'month': _month});
      if (mounted && ask == _ask) setState(() => _view = view);
    } catch (e) {
      if (mounted && ask == _ask) setState(() => _error = plain(e));
    } finally {
      if (mounted && ask == _ask) setState(() => _loading = false);
    }
  }

  void _goTo(String month) {
    setState(() {
      _month = month;
      _filter = 'all';
      _picked = null;
      _view = null;
    });
    _load();
  }

  Future<void> _copyRepeats() async {
    setState(() => _copying = true);
    try {
      final r = await AppScope.read(context).ask('/api/expenses', {'action': 'copy_repeats', 'month': _month});
      final added = toNum(r['added']).toInt();
      if (mounted) toast(context, added == 0 ? 'They are already added' : 'Added $added monthly ${added == 1 ? 'expense' : 'expenses'}');
      await _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _copying = false);
    }
  }

  Future<void> _askInsight() async {
    setState(() => _asking = true);
    try {
      await AppScope.read(context).ask('/api/expenses/insight', {'month': _month}, timeout: const Duration(seconds: 60));
      await _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? expense]) async {
    // A message still showing would sit over the form's Save button
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    final saved = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => ExpenseFormScreen(month: _month, expense: expense)));
    if (saved != null && mounted) {
      toast(context, saved);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (!app.can('settings')) {
      return Scaffold(
        appBar: AppBar(title: const Text('Expenses')),
        body: const EmptyState(icon: Icons.lock_outline, title: 'For owners and admins', text: 'Only the owner and admins can see expenses.'),
      );
    }
    final view = _view;
    final months = (view?['months'] as List? ?? const []).cast<Map>();
    final totals = months.isEmpty ? null : months.last;
    final current = '${view?['current'] ?? thisMonth()}';
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: view == null
          ? null
          : FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('Add expense')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
          children: [
            _MonthBar(month: _month, canGoNext: _month.compareTo(current) < 0, onChange: _goTo),
            if (_error.isNotEmpty)
              Panel(
                child: Column(
                  children: [
                    Text(_error, textAlign: TextAlign.center, style: const TextStyle(color: Brand.red)),
                    const SizedBox(height: 8),
                    OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  ],
                ),
              ),
            if (view == null && _loading) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
            if (view != null && totals != null) ...[
              _Tiles(totals: totals, entries: (view['expenses'] as List? ?? const []).length),
              if (toNum(view['repeatsDue']) > 0) _repeatsCard(toNum(view['repeatsDue']).toInt()),
              _InsightCard(view: view, asking: _asking, onAsk: _askInsight),
              _chartCard(months),
              _whereItWent((view['categories'] as List? ?? const []).cast<Map>()),
              _listCard((view['expenses'] as List? ?? const []).cast<Map<String, dynamic>>()),
            ],
          ],
        ),
      ),
    );
  }

  Widget _repeatsCard(int due) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.repeat, color: Brand.blue, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '$due monthly ${due == 1 ? 'expense' : 'expenses'} (like salaries or rent) ${due == 1 ? 'is' : 'are'} not added for ${monthName(_month, withYear: false)} yet.',
                style: const TextStyle(fontSize: 14.5, height: 1.35),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: _copying ? null : _copyRepeats,
          icon: _copying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.add),
          label: const Text('Add them'),
        ),
      ],
    ),
  );

  Widget _chartCard(List<Map> months) {
    final top = _niceTop(months.fold<num>(1, (m, row) => [m, toNum(row['sales']), toNum(row['expenses'])].reduce((a, b) => a > b ? a : b)));
    final pickedIndex = _picked ?? months.indexWhere((m) => m['month'] == _month);
    final shown = pickedIndex >= 0 && pickedIndex < months.length ? months[pickedIndex] : null;
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Sales and expenses, last 6 months', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          const Wrap(spacing: 14, children: [_Legend(colour: _salesColour, label: 'Sales'), _Legend(colour: _spentColour, label: 'Expenses')]),
          if (shown != null) ...[
            const SizedBox(height: 8),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '${monthName('${shown['month']}', withYear: false)}: ', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.text)),
                  TextSpan(text: 'sales ${formatRupees(toNum(shown['sales']).round())} · expenses ${formatRupees(toNum(shown['expenses']).round())} · '),
                  toNum(shown['profit']) < 0
                      ? TextSpan(text: 'loss ${formatRupees(-toNum(shown['profit']).round())}', style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600))
                      : TextSpan(text: 'profit ${formatRupees(toNum(shown['profit']).round())}'),
                ],
              ),
              style: const TextStyle(fontSize: 13.5, color: Brand.textSoft, height: 1.35),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            height: 170,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 42,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      for (final v in [top, top / 2, 0]) Text(v == 0 ? '0' : shortRupees(v), style: const TextStyle(fontSize: 11, color: Brand.faint)),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                for (var i = 0; i < months.length; i++)
                  Expanded(
                    child: Semantics(
                      button: true,
                      label: '${monthName('${months[i]['month']}')}: sales ${formatRupees(toNum(months[i]['sales']).round())}, expenses ${formatRupees(toNum(months[i]['expenses']).round())}',
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => setState(() => _picked = i),
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          decoration: BoxDecoration(color: i == pickedIndex ? Brand.lineSoft : null, borderRadius: const BorderRadius.vertical(top: Radius.circular(8))),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _Bar(fraction: toNum(months[i]['sales']) / top, colour: _salesColour),
                              const SizedBox(width: 2),
                              _Bar(fraction: toNum(months[i]['expenses']) / top, colour: _spentColour),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: Brand.border),
          const SizedBox(height: 4),
          Row(
            children: [
              const SizedBox(width: 48),
              for (final m in months)
                Expanded(
                  child: Text(
                    shortMonth('${m['month']}'),
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, fontWeight: m['month'] == _month ? FontWeight.w700 : FontWeight.w500, color: m['month'] == _month ? Brand.text : Brand.faint),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _whereItWent(List<Map> categories) {
    final biggest = categories.fold<num>(1, (m, c) => toNum(c['amount']) > m ? toNum(c['amount']) : m);
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Where the money went', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          if (categories.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Nothing spent yet this month.', style: TextStyle(color: Brand.muted)))
          else
            for (final c in categories) ...[
              Row(
                children: [
                  Expanded(child: Text('${c['label']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))),
                  Text(formatRupees(toNum(c['amount'])), style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(' · ${c['share']}%', style: const TextStyle(color: Brand.muted)),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(value: (toNum(c['amount']) / biggest).clamp(0.02, 1).toDouble(), minHeight: 8, color: _salesColour, backgroundColor: Brand.lineSoft),
              ),
              const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }

  Widget _listCard(List<Map<String, dynamic>> expenses) {
    final kinds = [for (final c in expenseCategories) if (expenses.any((e) => e['category'] == c.$1)) c];
    final shown = expenses.where((e) => _filter == 'all' || e['category'] == _filter).toList();
    final total = shown.fold<num>(0, (sum, e) => sum + toNum(e['amount']));
    return Panel(
      padding: const EdgeInsets.fromLTRB(0, 14, 0, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(child: Text('Expenses in ${monthName(_month, withYear: false)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
                Text(formatRupees(total), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.textSoft)),
              ],
            ),
          ),
          if (kinds.length > 1)
            FilterChips(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              children: [
                ChoiceChip(label: const Text('All'), selected: _filter == 'all', onSelected: (_) => setState(() => _filter = 'all')),
                for (final (key, label) in kinds) ChoiceChip(label: Text(label), selected: _filter == key, onSelected: (_) => setState(() => _filter = key)),
              ],
            ),
          if (expenses.isEmpty)
            EmptyState(
              icon: Icons.account_balance_wallet_outlined,
              title: 'No expenses for ${monthName(_month, withYear: false)}',
              text: 'Add salaries, rent, stock, bills, ads: anything you pay for.',
              action: FilledButton.icon(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('Add the first one')),
            )
          else
            for (final e in shown)
              InkWell(
                onTap: () => _edit(e),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 40,
                        child: Column(
                          children: [
                            Text('${int.tryParse('${e['spent_on']}'.substring(8, 10)) ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.1)),
                            Text(shortMonth('${e['spent_on']}'.substring(0, 7)).toUpperCase(), style: const TextStyle(fontSize: 11, color: Brand.faint, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(child: Text(categoryLabel('${e['category']}'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
                                if (e['repeat_monthly'] == true) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.repeat, size: 14, color: Brand.muted, semanticLabel: 'Every month')),
                              ],
                            ),
                            Text(
                              [e['paid_to'], e['note'], methodLabel('${e['method']}')].where((v) => v != null && '$v'.isNotEmpty).join(' · ').ifEmpty('Tap to add details'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13, color: Brand.muted),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(formatRupees(toNum(e['amount'])), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// A round top for the axis: 1, 2 or 5 × a power of ten, at or above the biggest bar.
num _niceTop(num max) {
  var power = 1.0;
  while (power * 10 <= max) {
    power *= 10;
  }
  for (final step in [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return max;
}

class _Bar extends StatelessWidget {
  const _Bar({required this.fraction, required this.colour});
  final num fraction;
  final Color colour;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) => Container(
      width: 10,
      height: fraction <= 0 ? 0 : (box.maxHeight * fraction.clamp(0, 1)).clamp(2, box.maxHeight).toDouble(),
      decoration: BoxDecoration(color: colour, borderRadius: const BorderRadius.vertical(top: Radius.circular(3))),
    ),
  );
}

class _Legend extends StatelessWidget {
  const _Legend({required this.colour, required this.label});
  final Color colour;
  final String label;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(width: 10, height: 10, decoration: BoxDecoration(color: colour, borderRadius: BorderRadius.circular(2))),
      const SizedBox(width: 6),
      Text(label, style: const TextStyle(fontSize: 13, color: Brand.textSoft, fontWeight: FontWeight.w500)),
    ],
  );
}

class _MonthBar extends StatelessWidget {
  const _MonthBar({required this.month, required this.canGoNext, required this.onChange});
  final String month;
  final bool canGoNext;
  final ValueChanged<String> onChange;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Row(
      children: [
        IconButton(tooltip: 'Month before', onPressed: () => onChange(addMonths(month, -1)), icon: const Icon(Icons.chevron_left)),
        Expanded(child: Text(monthName(month), textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
        IconButton(tooltip: 'Next month', onPressed: canGoNext ? () => onChange(addMonths(month, 1)) : null, icon: const Icon(Icons.chevron_right)),
      ],
    ),
  );
}

class _Tiles extends StatelessWidget {
  const _Tiles({required this.totals, required this.entries});
  final Map totals;
  final int entries;
  @override
  Widget build(BuildContext context) {
    final sales = toNum(totals['sales']);
    final spent = toNum(totals['expenses']);
    final profit = toNum(totals['profit']);
    final received = toNum(totals['received']);
    final count = toNum(totals['salesCount']).toInt();
    Widget tile(String label, String value, String hint, IconData icon, {bool warn = false}) => Expanded(
      child: Card(
        margin: const EdgeInsets.all(4),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: warn ? Brand.red : Brand.blue),
              const SizedBox(height: 6),
              Text(label, style: const TextStyle(fontSize: 13, color: Brand.muted, fontWeight: FontWeight.w600)),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: warn ? Brand.red : Brand.text)),
              ),
              Text(hint, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.faint)),
            ],
          ),
        ),
      ),
    );
    return Column(
      children: [
        Row(
          children: [
            tile('Sales', formatRupees(sales.round()), '$count ${count == 1 ? 'sale' : 'sales'}', Icons.trending_up),
            tile('Expenses', formatRupees(spent.round()), '$entries ${entries == 1 ? 'entry' : 'entries'}', Icons.account_balance_wallet_outlined),
          ],
        ),
        Row(
          children: [
            tile(profit < 0 ? 'Loss' : 'Profit', formatRupees(profit.abs().round()), sales > 0 ? '${(profit / sales * 100).round()}% of sales' : 'No sales yet', profit < 0 ? Icons.trending_down : Icons.savings_outlined, warn: profit < 0),
            tile('Money received', formatRupees(received.round()), sales > received ? '${formatRupees((sales - received).round())} to collect' : 'All collected', Icons.receipt_long_outlined),
          ],
        ),
      ],
    );
  }
}

class _InsightCard extends StatelessWidget {
  const _InsightCard({required this.view, required this.asking, required this.onAsk});
  final Map<String, dynamic> view;
  final bool asking;
  final VoidCallback onAsk;
  @override
  Widget build(BuildContext context) {
    final saved = view['insight'] as Map?;
    final insight = saved?['insight'] as Map?;
    final months = (view['months'] as List? ?? const []).cast<Map>();
    final totals = months.isEmpty ? const {} : months.last;
    final empty = toNum(totals['salesCount']) == 0 && toNum(totals['expenses']) == 0;
    final soFar = view['insightKind'] == 'so_far';
    final month = '${view['month']}';
    final written = saved == null ? '' : formatDay(toIst(DateTime.tryParse('${saved['created_at']}') ?? DateTime.now()));
    List<String> list(Object? v) => (v as List? ?? const []).map((e) => '$e').where((e) => e.isNotEmpty).toList();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(14)),
                child: const Icon(Icons.auto_awesome, color: Brand.blue, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('AI review of your sales', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(
                      saved == null
                          ? 'How the month went, what to fix, and sales ideas. Once a month.'
                          : saved['kind'] == 'full'
                          ? 'For all of ${monthName('${saved['month']}')} · $written'
                          : '${monthName('${saved['month']}')} so far · $written',
                      style: const TextStyle(fontSize: 13, color: Brand.muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (view['canAskInsight'] == true) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: asking || empty ? null : onAsk,
                icon: asking ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.auto_awesome),
                label: Text(asking ? 'Writing…' : soFar ? 'Review this month so far' : 'Get the review'),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              empty
                  ? 'Add sales or expenses for this month first.'
                  : soFar
                  ? 'One review while the month is going on, and the full review after it ends. It uses a little AI credit.'
                  : 'One review per month. It uses a little AI credit.',
              style: const TextStyle(fontSize: 12.5, color: Brand.faint),
            ),
          ],
          if (insight != null) ...[
            const SizedBox(height: 12),
            Text('${insight['summary'] ?? ''}', style: const TextStyle(fontSize: 15, height: 1.45)),
            _InsightList(title: 'What went well', icon: Icons.thumb_up_alt_outlined, items: list(insight['good'])),
            _InsightList(title: 'What to fix', icon: Icons.build_outlined, items: list(insight['improve'])),
            _InsightList(title: 'Sales ideas', icon: Icons.lightbulb_outline, items: list(insight['ideas'])),
            if ('${insight['focus'] ?? ''}'.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(12)),
                child: Text.rich(
                  TextSpan(children: [const TextSpan(text: 'Do this first: ', style: TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: '${insight['focus']}')]),
                  style: const TextStyle(color: Colors.white, fontSize: 14.5, height: 1.35),
                ),
              ),
            ],
            if (saved?['kind'] == 'so_far' && month == view['current']) ...[
              const SizedBox(height: 8),
              Text('After ${monthName(month, withYear: false)} ends you can get the full review.', style: const TextStyle(fontSize: 12.5, color: Brand.faint)),
            ],
          ],
        ],
      ),
    );
  }
}

class _InsightList extends StatelessWidget {
  const _InsightList({required this.title, required this.icon, required this.items});
  final String title;
  final IconData icon;
  final List<String> items;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 17, color: Brand.blue),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 6),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(padding: EdgeInsets.only(top: 7, right: 8), child: CircleAvatar(radius: 2.5, backgroundColor: Brand.faint)),
                  Expanded(child: Text(item, style: const TextStyle(fontSize: 14, color: Brand.textSoft, height: 1.35))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Add or change one expense; returns the words for the toast when saved or removed.
class ExpenseFormScreen extends StatefulWidget {
  const ExpenseFormScreen({super.key, required this.month, this.expense});
  final String month;
  final Map<String, dynamic>? expense;
  @override
  State<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends State<ExpenseFormScreen> {
  late final _amount = TextEditingController(text: widget.expense == null ? '' : _plainAmount(widget.expense!['amount']));
  late final _paidTo = TextEditingController(text: '${widget.expense?['paid_to'] ?? ''}');
  late final _note = TextEditingController(text: '${widget.expense?['note'] ?? ''}');
  late String _category = '${widget.expense?['category'] ?? ''}';
  late String _method = '${widget.expense?['method'] ?? ''}';
  late bool _repeat = widget.expense?['repeat_monthly'] == true;
  late String _day = '${widget.expense?['spent_on'] ?? (istToday().startsWith(widget.month) ? istToday() : '${widget.month}-01')}';
  bool _saving = false;
  String _error = '';

  static String _plainAmount(Object? v) {
    final n = toNum(v);
    return n == n.roundToDouble() ? '${n.round()}' : '$n';
  }

  @override
  void dispose() {
    _amount.dispose();
    _paidTo.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDay() async {
    final parts = _day.split('-').map(int.parse).toList();
    final today = istNow();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(parts[0], parts[1], parts[2]),
      firstDate: DateTime(2000),
      lastDate: DateTime(today.year, today.month, today.day).add(const Duration(days: 62)),
    );
    if (picked != null) setState(() => _day = '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = '';
    });
    try {
      final e = widget.expense;
      await AppScope.read(context).ask('/api/expenses', {
        'id': ?e?['id'],
        'amount': _amount.text.trim(),
        'category': _category,
        'spent_on': _day,
        'paid_to': _paidTo.text.trim(),
        'note': _note.text.trim(),
        'method': _method.isEmpty ? null : _method,
        'repeat_monthly': _repeat,
      }, method: e == null ? 'POST' : 'PUT');
      if (mounted) Navigator.pop(context, e == null ? 'Expense added' : 'Expense saved');
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _remove() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this expense?'),
        content: Text('${categoryLabel(_category)} · ${formatRupees(toNum(widget.expense?['amount']))}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(context, true), style: TextButton.styleFrom(foregroundColor: Brand.red), child: const Text('Remove')),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _saving = true);
    try {
      final app = AppScope.read(context);
      await app.ask('/api/expenses?organizationId=${app.orgId}&id=${widget.expense!['id']}', const {}, method: 'DELETE');
      if (mounted) Navigator.pop(context, 'Expense removed');
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final parts = _day.split('-');
    final dayText = formatDay(DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2])));
    final ready = _amount.text.trim().isNotEmpty && _category.isNotEmpty && !_saving;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.expense == null ? 'Add expense' : 'Change expense'),
        actions: [if (widget.expense != null) IconButton(tooltip: 'Remove', onPressed: _saving ? null : _remove, icon: const Icon(Icons.delete_outline))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          TextField(
            controller: _amount,
            autofocus: widget.expense == null,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(labelText: 'How much', prefixText: '₹ ', hintText: '0'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 18),
          const Text('What for', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (key, label) in expenseCategories)
                ChoiceChip(
                  label: Text(label),
                  selected: _category == key,
                  onSelected: (_) => setState(() {
                    _category = key;
                    if (widget.expense == null && usuallyMonthly.contains(key)) _repeat = true;
                  }),
                ),
            ],
          ),
          const SizedBox(height: 18),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event_outlined),
            title: const Text('Date'),
            subtitle: Text(dayText),
            trailing: const Icon(Icons.edit_calendar_outlined),
            onTap: _pickDay,
          ),
          TextField(
            controller: _paidTo,
            maxLength: 80,
            decoration: InputDecoration(labelText: 'Paid to (optional)', hintText: _category == 'salaries' ? 'Name of the person' : 'Shop, landlord, company…', counterText: ''),
          ),
          const SizedBox(height: 18),
          const Text('How you paid (optional)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (key, label) in payMethods) ChoiceChip(label: Text(label), selected: _method == key, onSelected: (on) => setState(() => _method = on ? key : '')),
            ],
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _note,
            maxLength: 200,
            decoration: const InputDecoration(labelText: 'Note (optional)', hintText: 'e.g. November salary, 10 kg stock', counterText: ''),
          ),
          const SizedBox(height: 10),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _repeat,
            onChanged: (v) => setState(() => _repeat = v),
            title: const Text('Same every month'),
            subtitle: const Text('For salaries, rent or EMIs: add it again next month with one tap.'),
          ),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error, style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600))),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: ready ? _save : null,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(widget.expense == null ? 'Add expense' : 'Save'),
          ),
        ],
      ),
    );
  }
}
