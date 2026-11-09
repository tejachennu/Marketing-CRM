import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'range_bar.dart';

String _key(String what, DateRangeChoice r) => '$what:${r.preset}${r.preset == 'custom' ? ':${r.from}:${r.to}' : ''}';

Widget _stars(num rating, {double size = 16}) => Row(
  mainAxisSize: MainAxisSize.min,
  children: [for (var i = 1; i <= 5; i++) Icon(i <= rating.round() ? Icons.star_rounded : Icons.star_outline_rounded, size: size, color: i <= rating.round() ? Brand.navy : Brand.border)],
);

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, {this.attention = false});
  final String label, value;
  final bool attention;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Text(
          value,
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: attention ? Brand.red : Brand.text),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, color: Brand.muted, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
}

/// Reviews from customers after their visit: the summary, who to call back, and every review.
class ReviewsTab extends StatefulWidget {
  const ReviewsTab({super.key});
  @override
  State<ReviewsTab> createState() => _ReviewsTabState();
}

class _ReviewsTabState extends State<ReviewsTab> {
  DateRangeChoice _range = const DateRangeChoice('month');
  bool _toCallOnly = false;

  void _load() => AppScope.read(context).load(_key('reviews', _range), '/api/salon/reviews', query: _range.query, force: true);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final key = _key('reviews', _range);
    final data = app.cached(key);
    final summary = Map<String, dynamic>.from(data?['summary'] as Map? ?? const {});
    final followed = {for (final item in app.pending('review')) '${item.body['id']}'};
    final reviews = [
      for (final r in (data?['reviews'] as List? ?? const [])) {...Map<String, dynamic>.from(r), if (followed.contains('${r['id']}')) 'followed_up_at': 'now'},
    ].where((r) => !_toCallOnly || ((r['rating'] as num) <= 2 && r['followed_up_at'] == null)).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        RangeBar(
          value: _range,
          onChanged: (r) => setState(() {
            _range = r;
            _load();
          }),
        ),
        const SizedBox(height: 10),
        if (data == null)
          const SizedBox(height: 420, child: SkeletonCards(cards: 3))
        else ...[
          Panel(
            child: Column(
              children: [
                Row(
                  children: [
                    _Stat('Average', summary['average'] == null ? '—' : '${summary['average']}★'),
                    _Stat('Reviews', '${summary['count'] ?? 0}'),
                    _Stat('Happy', summary['happyPercent'] == null ? '—' : '${summary['happyPercent']}%'),
                    _Stat('To call back', '${summary['toCall'] ?? 0}', attention: (summary['toCall'] ?? 0) > 0),
                  ],
                ),
                const SizedBox(height: 12),
                for (final d in (summary['distribution'] as List? ?? const []))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 26,
                          child: Text('${d['stars']}★', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                        ),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(99),
                            child: LinearProgressIndicator(
                              minHeight: 7,
                              value: (summary['count'] ?? 0) == 0 ? 0 : (d['count'] as num) / (summary['count'] as num),
                              backgroundColor: Brand.lineSoft,
                              color: (d['stars'] as num) <= 2 ? Brand.red : Brand.blue,
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 30,
                          child: Text(
                            '${d['count']}',
                            textAlign: TextAlign.right,
                            style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              ChoiceChip(label: const Text('All reviews'), selected: !_toCallOnly, onSelected: (_) => setState(() => _toCallOnly = false)),
              const SizedBox(width: 8),
              ChoiceChip(label: Text('To call back · ${summary['toCall'] ?? 0}'), selected: _toCallOnly, onSelected: (_) => setState(() => _toCallOnly = true)),
            ],
          ),
          const SizedBox(height: 10),
          if (reviews.isEmpty)
            EmptyState(
              icon: Icons.star_outline_rounded,
              title: _toCallOnly ? 'Nobody to call back' : 'No reviews in these dates',
              text: _toCallOnly ? 'Unhappy customers you have not called show here.' : 'Customers rate their visit from the feedback message after their bill.',
            ),
          for (final r in reviews) ...[
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('${r['customer_name'] ?? 'Customer'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      ),
                      _stars(r['rating'] as num),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text([formatWhen(r['created_at']), for (final p in (r['people'] as List? ?? const [])) p['name']].join(' · '), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  if ('${r['comment'] ?? ''}'.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('“${r['comment']}”', style: const TextStyle(height: 1.35)),
                    ),
                  if ((r['tags'] as List? ?? const []).isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Wrap(spacing: 6, runSpacing: 4, children: [for (final t in r['tags']) Pill('$t')]),
                    ),
                  if ((r['rating'] as num) <= 2) ...[
                    const SizedBox(height: 10),
                    r['followed_up_at'] != null
                        ? const Pill('Called back', icon: Icons.check)
                        : Row(
                            children: [
                              if (r['customer_phone'] != null)
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: () {
                                      Clipboard.setData(ClipboardData(text: '${r['customer_phone']}'));
                                      toast(context, 'Number copied: ${r['customer_phone']}');
                                    },
                                    icon: const Icon(Icons.call_outlined, size: 18),
                                    label: const Text('Copy number'),
                                  ),
                                ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: FilledButton(
                                  onPressed: () {
                                    app.enqueue(
                                      kind: 'review',
                                      label: 'Called back ${r['customer_name'] ?? ''}',
                                      method: 'PATCH',
                                      path: '/api/salon/feedback',
                                      body: {'organizationId': app.orgId, 'id': r['id']},
                                    );
                                    toast(context, 'Marked as called back.');
                                  },
                                  child: const Text('Called back'),
                                ),
                              ),
                            ],
                          ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }
}

/// Each team member's work: services done, visits, sales, commission earned and rating.
class TeamTab extends StatefulWidget {
  const TeamTab({super.key});
  @override
  State<TeamTab> createState() => _TeamTabState();
}

class _TeamTabState extends State<TeamTab> {
  DateRangeChoice _range = const DateRangeChoice('month');

  void _load() => AppScope.read(context).load(_key('team', _range), '/api/salon/performance', query: _range.query, force: true);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final data = app.cached(_key('team', _range));
    final totals = Map<String, dynamic>.from(data?['totals'] as Map? ?? const {});
    final staff = [for (final s in (data?['staff'] as List? ?? const [])) Map<String, dynamic>.from(s)]..sort((a, b) => ((b['revenue'] as num?) ?? 0).compareTo((a['revenue'] as num?) ?? 0));
    final top = staff.isEmpty ? 1 : ((staff.first['revenue'] as num?) ?? 1).clamp(1, double.infinity);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        RangeBar(
          value: _range,
          onChanged: (r) => setState(() {
            _range = r;
            _load();
          }),
        ),
        const SizedBox(height: 10),
        if (data == null)
          const SizedBox(height: 420, child: SkeletonCards(cards: 3))
        else ...[
          Panel(
            child: Row(
              children: [
                _Stat('Sales', shortRupees((totals['revenue'] as num?) ?? 0)),
                _Stat('Services', '${totals['services'] ?? 0}'),
                _Stat('Commission', shortRupees((totals['commission'] as num?) ?? 0)),
                _Stat('Rating', totals['averageRating'] == null ? '—' : '${totals['averageRating']}★'),
              ],
            ),
          ),
          const SizedBox(height: 10),
          if (staff.isEmpty) const EmptyState(icon: Icons.groups_outlined, title: 'No work in these dates', text: 'When bills name who did each service, their work shows here.'),
          for (final m in staff) ...[
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Avatar('${m['name']}', size: 40),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${m['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                            Text(
                              '${m['services']} services · ${m['visits']} visits${m['averageRating'] != null ? ' · ${m['averageRating']}★ (${m['ratings']})' : ''}',
                              style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(formatRupees(m['revenue']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                          Text('Commission ${formatRupees(((m['commission'] as num?) ?? 0).round())}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(minHeight: 7, value: ((m['revenue'] as num?) ?? 0) / top, backgroundColor: Brand.lineSoft, color: Brand.blue),
                  ),
                  if ((m['topServices'] as List? ?? const []).isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text('Most done: ${(m['topServices'] as List).map((t) => '${t['name']} (${t['count']})').join(', ')}', style: const TextStyle(fontSize: 12.5, color: Brand.textSoft)),
                  ],
                  if (((m['commissionPercent'] as num?) ?? 0) > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('${m['commissionPercent']}% commission on services, before GST', style: const TextStyle(fontSize: 12, color: Brand.faint)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }
}
