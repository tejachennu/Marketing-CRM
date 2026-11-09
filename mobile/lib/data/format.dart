import 'package:intl/intl.dart';

/// The business runs on India time (UTC+5:30 all year), whatever the phone's own zone.
const istOffset = Duration(hours: 5, minutes: 30);

/// Now, as India wall-clock time (in a UTC DateTime, so it never shifts).
DateTime istNow() => DateTime.now().toUtc().add(istOffset);

/// A moment as India wall-clock time.
DateTime toIst(DateTime moment) => moment.toUtc().add(istOffset);

/// Today's India date, like 2026-11-09.
String istToday() => DateFormat('yyyy-MM-dd').format(istNow());

/// An India date and time as a real moment (UTC).
DateTime fromIst(DateTime date, int hour, int minute) => DateTime.utc(date.year, date.month, date.day, hour, minute).subtract(istOffset);

final _rupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _rupeesPaise = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

/// ₹1,50,000 (Indian grouping); paise only when there are any.
String formatRupees(Object? value) {
  final amount = value is num ? value : num.tryParse('$value') ?? 0;
  return amount == amount.roundToDouble() ? _rupees.format(amount) : _rupeesPaise.format(amount);
}

/// Short money for tiles: ₹1.2L, ₹3.4Cr.
String shortRupees(num amount) {
  if (amount >= 1e7) return '₹${(amount / 1e7).toStringAsFixed(amount >= 1e8 ? 0 : 1)}Cr';
  if (amount >= 1e5) return '₹${(amount / 1e5).toStringAsFixed(amount >= 1e6 ? 0 : 1)}L';
  return formatRupees(amount.round());
}

/// 4:30 pm, in India time.
String formatTime(String? iso) {
  final at = DateTime.tryParse(iso ?? '');
  if (at == null) return '';
  return DateFormat('h:mm a').format(toIst(at)).toLowerCase();
}

/// Mon, 9 Nov
String formatDay(DateTime istDate) => DateFormat('EEE, d MMM').format(istDate);

/// "Today 4:30 pm", "Yesterday", "Mon", "12 Oct": for lists.
String formatWhen(String? iso) {
  final at = DateTime.tryParse(iso ?? '');
  if (at == null) return '';
  final ist = toIst(at);
  final today = istNow();
  final days = DateTime.utc(today.year, today.month, today.day).difference(DateTime.utc(ist.year, ist.month, ist.day)).inDays;
  if (days == 0) return DateFormat('h:mm a').format(ist).toLowerCase();
  if (days == 1) return 'Yesterday';
  if (days < 7) return DateFormat('EEE').format(ist);
  return DateFormat('d MMM').format(ist);
}

/// "just now", "5 min ago", "2 h ago", "3 days ago"
String formatAgo(DateTime? at) {
  if (at == null) return 'never';
  final gap = DateTime.now().difference(at);
  if (gap.inMinutes < 1) return 'just now';
  if (gap.inMinutes < 60) return '${gap.inMinutes} min ago';
  if (gap.inHours < 24) return '${gap.inHours} h ago';
  return '${gap.inDays} day${gap.inDays == 1 ? '' : 's'} ago';
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}

String contactName(Map? contact) {
  if (contact == null) return 'Customer';
  final name = [contact['first_name'], contact['last_name']].where((p) => p != null && '$p'.trim().isNotEmpty).join(' ').trim();
  return name.isNotEmpty ? name : (contact['phone_number'] ?? contact['whatsapp_number'] ?? 'Customer').toString().replaceFirst('whatsapp:', '');
}
