import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../data/format.dart';
import '../../ui/theme.dart';

/// A date range, as the web uses: Today, Yesterday, Last 7 days, This month, Last month, or dates
/// picked (custom).
class DateRangeChoice {
  const DateRangeChoice(this.preset, {this.from, this.to});
  final String preset;
  final String? from;
  final String? to;

  Map<String, String> get query => {
    'preset': preset,
    if (preset == 'custom') ...{'from': from!, 'to': to!},
  };

  String get label => switch (preset) {
    'today' => 'Today',
    'yesterday' => 'Yesterday',
    'week' => 'Last 7 days',
    'month' => 'This month',
    'last_month' => 'Last month',
    _ => '${DateFormat('d MMM').format(DateTime.parse(from!))} – ${DateFormat('d MMM').format(DateTime.parse(to!))}',
  };
}

class RangeBar extends StatelessWidget {
  const RangeBar({super.key, required this.value, required this.onChanged});
  final DateRangeChoice value;
  final ValueChanged<DateRangeChoice> onChanged;

  @override
  Widget build(BuildContext context) {
    const presets = ['today', 'yesterday', 'week', 'month', 'last_month'];
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final p in presets)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(label: Text(DateRangeChoice(p).label), selected: value.preset == p, onSelected: (_) => onChanged(DateRangeChoice(p))),
            ),
          ChoiceChip(
            avatar: Icon(Icons.date_range, size: 18, color: value.preset == 'custom' ? Colors.white : Brand.textSoft),
            label: Text(value.preset == 'custom' ? value.label : 'Pick dates'),
            selected: value.preset == 'custom',
            onSelected: (_) async {
              final today = istNow();
              final picked = await showDateRangePicker(
                context: context,
                firstDate: DateTime(today.year - 2),
                lastDate: DateTime(today.year, today.month, today.day),
                initialDateRange: DateTimeRange(start: DateTime(today.year, today.month, today.day).subtract(const Duration(days: 6)), end: DateTime(today.year, today.month, today.day)),
              );
              if (picked == null) return;
              if (picked.end.difference(picked.start).inDays > 366) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pick up to one year at a time.')));
                return;
              }
              final f = DateFormat('yyyy-MM-dd');
              onChanged(DateRangeChoice('custom', from: f.format(picked.start), to: f.format(picked.end)));
            },
          ),
        ],
      ),
    );
  }
}

/// The day shown on the Front Desk: arrows to step a day, tap to pick one, and a way back to today.
class DayBar extends StatelessWidget {
  const DayBar({super.key, required this.date, required this.onChanged});
  final String date;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final d = DateTime.parse(date);
    final f = DateFormat('yyyy-MM-dd');
    final today = istToday();
    final diff = d.difference(DateTime.parse(today)).inDays;
    final label = diff == 0
        ? 'Today'
        : diff == 1
        ? 'Tomorrow'
        : diff == -1
        ? 'Yesterday'
        : DateFormat('EEE, d MMM').format(d);
    return Row(
      children: [
        IconButton.outlined(onPressed: () => onChanged(f.format(d.subtract(const Duration(days: 1)))), icon: const Icon(Icons.chevron_left), tooltip: 'Day before'),
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: d, firstDate: DateTime(d.year - 2), lastDate: DateTime(d.year + 1, 12, 31));
              if (picked != null) onChanged(f.format(picked));
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(
                children: [
                  Text(label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  Text(diff == 0 || diff.abs() == 1 ? DateFormat('EEE, d MMM').format(d) : 'Tap to pick a day', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ],
              ),
            ),
          ),
        ),
        if (diff != 0) TextButton(onPressed: () => onChanged(today), child: const Text('Today')),
        IconButton.outlined(onPressed: () => onChanged(f.format(d.add(const Duration(days: 1)))), icon: const Icon(Icons.chevron_right), tooltip: 'Next day'),
      ],
    );
  }
}
