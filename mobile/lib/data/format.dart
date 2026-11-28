import 'package:intl/intl.dart';

/// The business runs on India time (UTC+5:30 all year), whatever the phone's own zone.
const istOffset = Duration(hours: 5, minutes: 30);

/// Now, as India wall-clock time (in a UTC DateTime, so it never shifts).
DateTime istNow() => DateTime.now().toUtc().add(istOffset);

/// A moment as India wall-clock time.
DateTime toIst(DateTime moment) => moment.toUtc().add(istOffset);

/// Today's India date, like 2026-11-09.
String istToday() => DateFormat('yyyy-MM-dd').format(istNow());

/// The India date of a moment, like 2026-11-09.
String istDateOf(DateTime moment) => DateFormat('yyyy-MM-dd').format(toIst(moment));

/// An India date and time as a real moment (UTC).
DateTime fromIst(DateTime date, int hour, int minute) => DateTime.utc(date.year, date.month, date.day, hour, minute).subtract(istOffset);

// ── Money ──────────────────────────────────────────────────────────────────
// One currency for the whole business (web Settings → Currency, app More → Currency), used by Front Desk, the shop
// and the sales pipeline. Same list as the server's lib/money.ts. WAMA's own plan prices stay in rupees (formatInr).

class CurrencyChoice {
  final String code, symbol, name, locale;
  const CurrencyChoice(this.code, this.symbol, this.name, this.locale);
}

const currencies = [
  CurrencyChoice('INR', '₹', 'Indian rupee', 'en_IN'),
  CurrencyChoice('USD', r'$', 'US dollar', 'en_US'),
  CurrencyChoice('AED', 'AED ', 'UAE dirham', 'en_US'),
  CurrencyChoice('SAR', 'SAR ', 'Saudi riyal', 'en_US'),
  CurrencyChoice('QAR', 'QAR ', 'Qatari riyal', 'en_US'),
  CurrencyChoice('GBP', '£', 'British pound', 'en_US'),
  CurrencyChoice('EUR', '€', 'Euro', 'en_US'),
  CurrencyChoice('SGD', r'S$', 'Singapore dollar', 'en_US'),
  CurrencyChoice('AUD', r'A$', 'Australian dollar', 'en_US'),
  CurrencyChoice('CAD', r'C$', 'Canadian dollar', 'en_US'),
];

/// Where the business's currency comes from: the app state points it at the signed-in workspace's profile.
String Function() businessCurrencySource = () => 'INR';

/// The currency's details; anything not on the list is INR.
CurrencyChoice currencyInfo(Object? code) {
  final wanted = '${code ?? ''}'.trim().toUpperCase();
  return currencies.firstWhere((c) => c.code == wanted, orElse: () => currencies.first);
}

/// The business's currency code ("INR" until it chooses another).
String get appCurrency => currencyInfo(businessCurrencySource()).code;

/// "₹", "\$", "AED": the sign alone, for a field's prefix or a label.
String currencySymbol([Object? code]) => currencyInfo(code ?? appCurrency).symbol.trim();

num _amount(Object? value) => value is num ? value : num.tryParse('$value') ?? 0;

/// An amount in a given currency: "₹1,50,000", "\$12.50", "AED 99"; decimals only when there are any.
String moneyIn(Object? value, Object? code) {
  final info = currencyInfo(code);
  final amount = _amount(value);
  final cents = amount != amount.roundToDouble();
  return NumberFormat.currency(locale: info.locale, symbol: info.symbol, decimalDigits: cents ? 2 : 0).format(amount);
}

/// An amount in the business's currency: ₹1,50,000 (Indian grouping for rupees); paise only when there are any.
String formatRupees(Object? value) => moneyIn(value, appCurrency);

/// WAMA's own prices (plans, AI credit, top-ups): always rupees.
String formatInr(Object? value) => moneyIn(value, 'INR');

/// Short money for tiles: ₹1.2L, ₹3.4Cr in rupees; \$1.2M in other currencies.
String shortRupees(num amount) {
  final code = appCurrency;
  final sign = currencyInfo(code).symbol;
  if (code == 'INR') {
    if (amount >= 1e7) return '$sign${(amount / 1e7).toStringAsFixed(amount >= 1e8 ? 0 : 1)}Cr';
    if (amount >= 1e5) return '$sign${(amount / 1e5).toStringAsFixed(amount >= 1e6 ? 0 : 1)}L';
  } else if (amount >= 1e6) {
    return '$sign${(amount / 1e6).toStringAsFixed(amount >= 1e7 ? 0 : 1)}M';
  }
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

/// "RK" for "Ravi Kumar". Whole letters, never half an emoji ("Ravi 🙏" is a WhatsApp name too), which would not draw.
String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  String first(String part) => String.fromCharCode(part.runes.first);
  return (first(parts.first) + (parts.length > 1 ? first(parts.last) : '')).toUpperCase();
}

String contactName(Map? contact) {
  if (contact == null) return 'Customer';
  final name = [contact['first_name'], contact['last_name']].where((p) => p != null && '$p'.trim().isNotEmpty).join(' ').trim();
  if (name.isEmpty && '${contact['phone_number'] ?? ''}'.startsWith('ig:')) return 'Instagram user';
  return name.isNotEmpty ? name : (contact['phone_number'] ?? contact['whatsapp_number'] ?? 'Customer').toString().replaceFirst('whatsapp:', '');
}

/// An Instagram customer (DMs; no phone number).
bool isInstagramContact(Map? contact) => '${contact?['phone_number'] ?? ''}'.startsWith('ig:');

/// A phone number the way people read it: "+91 99887 76655" (India), "+1 415 555 0199"; anything else as given.
String showPhone(Object? raw) {
  final text = '${raw ?? ''}'.trim();
  final digits = text.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 12 && digits.startsWith('91')) return '+91 ${digits.substring(2, 7)} ${digits.substring(7)}';
  if (digits.length == 10 && RegExp(r'^[6-9]').hasMatch(digits)) return '+91 ${digits.substring(0, 5)} ${digits.substring(5)}';
  if (digits.length == 11 && digits.startsWith('1')) return '+1 ${digits.substring(1, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}';
  return text;
}
