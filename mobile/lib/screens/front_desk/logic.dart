import '../../data/app_state.dart';
import '../../data/format.dart';

/// Front Desk data as the screens need it: the copy on the phone, with changes still waiting
/// in the outbox laid over it, so the counter always shows what was done.
class FrontDesk {
  FrontDesk(this.app, {String? date, this.invoicesKey = 'invoices'}) : date = date ?? istToday();
  final AppState app;

  /// The day shown (India date, like 2026-11-09).
  final String date;

  /// Which list of bills (a date range) is shown.
  final String invoicesKey;

  bool get isToday => date == istToday();

  /// What the bills list (for a range) is called on the phone.
  static String billsKey(String preset, {String? from, String? to}) => preset == 'week'
      ? 'invoices'
      : preset == 'custom'
      ? 'invoices:$from:$to'
      : 'invoices:$preset';

  Map<String, dynamic> get billsSummary => Map<String, dynamic>.from((app.cached(invoicesKey) ?? const {})['summary'] as Map? ?? const {});

  Map<String, dynamic> get _setup => app.cached('setup') ?? const {};
  Map<String, dynamic> get settings {
    final out = Map<String, dynamic>.from(_setup['settings'] ?? const {});
    for (final item in app.pending('settings')) {
      out.addAll({...item.body}..remove('organizationId'));
    }
    return out;
  }

  String get businessName => (settings['business_name'] ?? app.orgName).toString();

  /// The business takes appointments (Setup → Appointments); off: walk-in bills only.
  bool get takesAppointments => app.takesAppointments;
  bool get pricesIncludeTax => settings['prices_include_tax'] == true;
  bool get hasGst => (settings['gstin'] ?? '').toString().isNotEmpty;

  List<Map<String, dynamic>> get services => [for (final s in (_setup['services'] as List? ?? const [])) Map<String, dynamic>.from(s)].where((s) => s['active'] != false).toList();

  /// Services that can go on a bill (the business can keep some for bookings only).
  List<Map<String, dynamic>> get billServices => services.where((s) => s['billable'] != false).toList();
  List<Map<String, dynamic>> get staff => [for (final s in (_setup['staff'] as List? ?? const [])) Map<String, dynamic>.from(s)].where((s) => s['active'] != false).toList();

  /// Categories in the business's order (Setup → Categories), then any others a service uses.
  List<String> get categories {
    final out = <String>[];
    final seen = <String>{};
    void add(String name) {
      if (name.isNotEmpty && seen.add(name.toLowerCase())) out.add(name);
    }

    for (final c in (settings['service_categories'] as List? ?? const [])) {
      add('$c'.trim());
    }
    for (final s in services) {
      add((s['category'] ?? 'General').toString().trim());
    }
    return out.where((c) => services.any((s) => (s['category'] ?? 'General').toString().toLowerCase() == c.toLowerCase())).toList();
  }

  Map<String, dynamic>? service(String id) => services.cast<Map<String, dynamic>?>().firstWhere((s) => s!['id'] == id, orElse: () => null);
  String staffName(String? id) => (staff.cast<Map?>().firstWhere((s) => s!['id'] == id, orElse: () => null)?['name'] ?? '').toString();

  /// About what the bill comes to (the server works out the exact GST when it syncs).
  num estimate(List<String> serviceIds, {num discountPercent = 0, num discountAmount = 0}) =>
      estimateLines(serviceIds.map(service).whereType<Map<String, dynamic>>().toList(), discountPercent: discountPercent, discountAmount: discountAmount);

  /// The same, for lines already on a visit (each with its own price and GST rate).
  num estimateLines(List<Map<String, dynamic>> items, {num discountPercent = 0, num discountAmount = 0}) {
    final subtotal = items.fold<num>(0, (sum, s) => sum + (num.tryParse('${s['price']}') ?? 0));
    if (hasGst && pricesIncludeTax) return _includedGstTotal(items, discountPercent: discountPercent, discountAmount: discountAmount);
    final discount = discountPercent > 0 ? subtotal * discountPercent / 100 : discountAmount.clamp(0, subtotal);
    final taxable = subtotal - discount;
    if (!hasGst || subtotal == 0) return taxable;
    final tax = items.fold<num>(0, (sum, s) => sum + (num.tryParse('${s['price']}') ?? 0) * (taxable / subtotal) * (num.tryParse('${s['tax_rate']}') ?? 0) / 100);
    return ((taxable + tax) * 100).round() / 100;
  }

  /// The most a rupee discount can take off these lines: their prices before GST (the server never takes off more).
  num discountRoom(List<Map<String, dynamic>> items) => items.fold<num>(0, (sum, s) {
    final price = num.tryParse('${s['price']}') ?? 0;
    final rate = (num.tryParse('${s['tax_rate']}') ?? 0).clamp(0, 28);
    return sum + (hasGst && pricesIncludeTax ? ((price / (1 + rate / 100)) * 100).floor() / 100 : price);
  });

  /// Prices that include GST, worked out as the server does (computeInvoice): GST comes out of each price first,
  /// the discount comes off what is left (shared by price), then GST goes back on. So ₹100 off a ₹1,180 service at
  /// 18% comes to ₹1,062, not ₹1,080.
  num _includedGstTotal(List<Map<String, dynamic>> items, {num discountPercent = 0, num discountAmount = 0}) {
    num round2(num v) => (v * 100).round() / 100;
    num rate(Map s) => (num.tryParse('${s['tax_rate']}') ?? 0).clamp(0, 28);
    final bases = [for (final s in items) (num.tryParse('${s['price']}') ?? 0) / (1 + rate(s) / 100)];
    final base = bases.fold<num>(0, (sum, b) => sum + b);
    final discount = discountPercent > 0 ? base * discountPercent.clamp(0, 100) / 100 : discountAmount.clamp(0, base);
    num total = 0;
    for (var i = 0; i < items.length; i++) {
      final share = base > 0 ? discount * bases[i] / base : 0;
      final taxable = round2(bases[i] - share);
      total += taxable + round2(taxable * rate(items[i]) / 100);
    }
    return round2(total);
  }

  // ── Today ──

  Map<String, dynamic> get _day => app.cached(AppState.dayKey(date)) ?? const {};

  /// Who is not simply present on the day shown (attendance: on leave, absent, week off, half day), by staff id.
  Map<String, String> get attendance => {
    for (final m in (_day['attendance'] as List? ?? const []))
      if (m is Map && m['status'] != null && m['status'] != 'present') '${m['staff_id']}': '${m['status']}',
  };

  /// "Ravi on leave", "Lakshmi half day": for the people on a visit, when the day's attendance says so.
  List<({String text, bool away})> attendanceNotes(Map<String, dynamic> appointment) {
    final marks = attendance;
    final ids = {appointment['staff_id'], for (final s in (appointment['services'] as List? ?? const [])) if (s is Map) s['staff_id']}.whereType<String>();
    return [
      for (final id in ids)
        if (marks[id] != null && staffName(id).isNotEmpty)
          (
            text: '${staffName(id)} ${switch (marks[id]) {
              'leave' => 'on leave',
              'week_off' => 'on week off',
              'half_day' => 'half day',
              _ => 'absent',
            }}',
            away: marks[id] != 'half_day',
          ),
    ];
  }

  /// Made on this phone, sent, and already in the server's list: shown once, as the server's.
  bool _inList(String? localId, Set<String> serverIds) {
    final id = localId == null ? null : app.store.serverId(localId);
    return id != null && serverIds.contains(id);
  }

  /// Pending status changes, laid over the appointment they are about.
  Map<String, String> get _pendingStatus {
    final out = <String, String>{};
    for (final item in app.outbox.where((i) => i.path == '/api/salon/act')) {
      final action = item.body['action'] as Map? ?? const {};
      if (action['type'] == 'set_status') out['${action['appointment_id']}'] = '${action['status']}';
      if (action['type'] == 'complete_and_bill') out['${action['appointment_id']}'] = 'completed';
      if (action['type'] == 'approve_request') out['${action['appointment_id']}'] = 'booked';
      if (action['type'] == 'decline_request') out['${action['appointment_id']}'] = 'declined';
    }
    return out;
  }

  /// Today's appointments: the server's, plus bookings made on the phone, in time order.
  List<Map<String, dynamic>> get appointments {
    final status = _pendingStatus;
    final server = [for (final a in (_day['appointments'] as List? ?? const [])) Map<String, dynamic>.from(a)];
    final serverIds = {for (final a in server) '${a['id']}'};
    final list = <Map<String, dynamic>>[
      ...server,
      for (final item in app.pending('booking'))
        if (item.body['_preview'] is Map && '${item.body['_preview']['day']}' == date && !_inList(item.localId, serverIds))
          {...Map<String, dynamic>.from(item.body['_preview']), 'id': item.localId, '_outbox': item.id, '_failed': item.error != null && item.state.name == 'failed'},
    ];
    for (final a in list) {
      final changed = status['${a['id']}'];
      if (changed != null) a['status'] = changed;
      a['_changing'] = changed != null;
    }
    list.sort((a, b) => '${a['starts_at']}'.compareTo('${b['starts_at']}'));
    return list;
  }

  /// WhatsApp booking requests still waiting, from today on. Always read from today's list (the one kept up to date),
  /// whatever day is shown, so the Requests tab and the badge on the bottom bar agree.
  List<Map<String, dynamic>> get requests {
    // No appointments: no requests to answer (and no badge on the bottom bar)
    if (!app.takesAppointments) return <Map<String, dynamic>>[];
    final status = _pendingStatus;
    final today = app.cached(AppState.dayKey(istToday())) ?? const {};
    return [for (final r in (today['requests'] as List? ?? const [])) Map<String, dynamic>.from(r)].where((r) => !status.containsKey('${r['id']}')).toList();
  }

  /// Today's bills (India date), newest first, with the ones made on this phone still waiting to sync.
  List<Map<String, dynamic>> get billsToday {
    final today = istToday();
    return invoices.where((i) {
      if (i['_outbox'] != null) return true;
      final at = DateTime.tryParse('${i['issued_at'] ?? ''}');
      return at != null && istDateOf(at) == today;
    }).toList();
  }

  /// Bills: made on the phone first (waiting to sync), then the server's.
  List<Map<String, dynamic>> get invoices {
    // Payments and cancellations still waiting to sync (both go in the outbox as 'payment')
    final pendingPay = <String, String>{};
    final pendingVoid = <String>{};
    for (final item in app.pending('payment')) {
      final action = item.body['action'] as Map? ?? const {};
      if (action['type'] == 'pay_invoice') pendingPay['${action['invoice_id']}'] = '${action['payment_method']}';
      if (action['type'] == 'void_invoice') pendingVoid.add('${action['invoice_id']}');
    }
    final server = [for (final i in ((app.cached(invoicesKey) ?? const {})['invoices'] as List? ?? const [])) Map<String, dynamic>.from(i)];
    final serverIds = {for (final i in server) '${i['id']}'};
    final local = [
      for (final item in [...app.pending('bill'), ...app.pending('checkout')])
        if (item.body['_preview'] is Map && !_inList(item.localId, serverIds))
          {...Map<String, dynamic>.from(item.body['_preview']), 'id': item.localId ?? item.id, '_outbox': item.id, '_failed': item.state.name == 'failed'},
    ];
    for (final i in server) {
      final id = '${i['id']}';
      final method = pendingPay[id];
      if (pendingVoid.contains(id)) {
        i['status'] = 'void';
        i['_changing'] = true;
      } else if (method != null) {
        i['status'] = 'paid';
        i['payment_method'] = method;
        i['_changing'] = true;
      }
    }
    return [...local.reversed, ...server];
  }

  /// What a bill still asks the customer for: its total less what a membership card's credit or an online advance
  /// (paid when booking) already paid, as on the customer's bill page.
  static num dueOf(Map invoice) {
    num n(Object? v) => num.tryParse('${v ?? ''}') ?? 0;
    final due = n(invoice['total']) - n(invoice['membership_paid']) - n(invoice['advance_paid']);
    return due <= 0 ? 0 : (due * 100).round() / 100;
  }

  /// Still to collect in the shown dates (bills not paid yet). A long range lists only the latest bills (hidden > 0):
  /// then the server's total for the whole range is used, with the listed bills counted as the phone shows them.
  ({num amount, int count, int hidden}) get toCollect {
    final unpaid = invoices.where((i) => i['status'] == 'unpaid').toList();
    var amount = unpaid.fold<num>(0, (sum, i) => sum + dueOf(i));
    var count = unpaid.length;
    final saved = app.cached(invoicesKey) ?? const {};
    final hidden = (saved['more'] as num?)?.toInt() ?? 0;
    final summary = billsSummary;
    if (hidden > 0 && summary['unpaidAmount'] is num) {
      final listed = [
        for (final i in (saved['invoices'] as List? ?? const []))
          if ((i as Map)['status'] == 'unpaid') i,
      ];
      amount += (summary['unpaidAmount'] as num) - listed.fold<num>(0, (sum, i) => sum + (num.tryParse('${i['total']}') ?? 0));
      count += ((summary['unpaidCount'] as num?)?.toInt() ?? listed.length) - listed.length;
    }
    return (amount: amount < 0 ? 0 : amount, count: count < 0 ? 0 : count, hidden: hidden);
  }

  num get collectedToday {
    final today = istToday();
    return invoices
        .where((i) => i['status'] == 'paid' && i['issued_at'] != null && toIst(DateTime.parse(i['issued_at'])).toIso8601String().startsWith(today))
        .fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0));
  }
}

/// What switching appointments off hides, and what stays (the same words as the web's Setup → Appointments).
const appointmentsHidden = [
  'Appointments, the calendar and booking requests on the Front Desk',
  'The New booking and Book buttons',
  'Your booking page, and booking on your website',
  'Booking on WhatsApp: the booking flow, and the assistant offering times',
  'Appointment reminders',
];
const appointmentsKept = 'Walk-in bills, invoices, reviews, memberships, team and reports stay as they are. Bookings already made are kept.';

/// The automatic messages only bookings send (their templates are not needed without appointments).
const appointmentPurposes = ['booking', 'reminder'];

const statusLabels = {
  'booked': 'Booked',
  'arrived': 'Arrived',
  'in_service': 'In service',
  'completed': 'Done',
  'cancelled': 'Cancelled',
  'no_show': 'No-show',
  'requested': 'Request',
  'declined': 'Declined',
};

const paymentLabels = {'cash': 'Cash', 'upi': 'UPI', 'card': 'Card', 'online': 'Online', 'membership': 'Membership'};

/// What a membership card does to a bill's lines, as the server does it (applyCard): a service it has free sessions
/// left for costs nothing, then the card's discount comes off the rest. Its credit is used later, on the total.
({List<Map<String, dynamic>> lines, int free, num discount}) applyMemberCard(Map card, List<Map<String, dynamic>> lines) {
  num n(Object? v) => num.tryParse('${v ?? ''}') ?? 0;
  final left = <String, num>{
    for (final s in (card['sessions'] as List? ?? const [])) '${(s as Map)['service_id']}': n(s['total']) - n(s['used']),
  };
  final pct = n((card['plan'] as Map?)?['discount_percent']).clamp(0, 100);
  var free = 0;
  num discount = 0;
  final out = <Map<String, dynamic>>[];
  for (final line in lines) {
    final id = '${line['service_id'] ?? line['id'] ?? ''}';
    final price = n(line['price']);
    if (id.isNotEmpty && (left[id] ?? 0) > 0 && price > 0) {
      left[id] = left[id]! - 1;
      free++;
      out.add({...line, 'name': '${line['name']} (membership)', 'price': 0});
    } else if (pct > 0 && id.isNotEmpty && price > 0) {
      final cut = (price * (1 - pct / 100) * 100).round() / 100;
      discount += price - cut;
      out.add({...line, 'price': cut});
    } else {
      out.add(line);
    }
  }
  return (lines: out, free: free, discount: (discount * 100).round() / 100);
}
