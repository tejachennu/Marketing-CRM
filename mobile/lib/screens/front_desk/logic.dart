import '../../data/app_state.dart';
import '../../data/format.dart';

/// Front Desk data as the screens need it: the copy on the phone, with changes still waiting
/// in the outbox laid over it, so the counter always shows what was done.
class FrontDesk {
  FrontDesk(this.app);
  final AppState app;

  Map<String, dynamic> get _setup => app.cached('setup') ?? const {};
  Map<String, dynamic> get settings => Map<String, dynamic>.from(_setup['settings'] ?? const {});
  String get businessName => (settings['business_name'] ?? app.orgName).toString();
  bool get pricesIncludeTax => settings['prices_include_tax'] == true;
  bool get hasGst => (settings['gstin'] ?? '').toString().isNotEmpty;

  List<Map<String, dynamic>> get services => [for (final s in (_setup['services'] as List? ?? const [])) Map<String, dynamic>.from(s)].where((s) => s['active'] != false).toList();
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
  num estimate(List<String> serviceIds, {num discountPercent = 0, num discountAmount = 0}) {
    final items = serviceIds.map(service).whereType<Map<String, dynamic>>().toList();
    final subtotal = items.fold<num>(0, (sum, s) => sum + (num.tryParse('${s['price']}') ?? 0));
    final discount = discountPercent > 0 ? subtotal * discountPercent / 100 : discountAmount.clamp(0, subtotal);
    final taxable = subtotal - discount;
    if (!hasGst || pricesIncludeTax || subtotal == 0) return taxable;
    final tax = items.fold<num>(0, (sum, s) => sum + (num.tryParse('${s['price']}') ?? 0) * (taxable / subtotal) * (num.tryParse('${s['tax_rate']}') ?? 0) / 100);
    return ((taxable + tax) * 100).round() / 100;
  }

  // ── Today ──

  Map<String, dynamic> get _day => app.cached(AppState.dayKey(istToday())) ?? const {};

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
    final list = <Map<String, dynamic>>[
      for (final a in (_day['appointments'] as List? ?? const [])) Map<String, dynamic>.from(a),
      for (final item in app.pending('booking'))
        if (item.body['_preview'] is Map && '${item.body['_preview']['day']}' == istToday())
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

  List<Map<String, dynamic>> get requests {
    final status = _pendingStatus;
    return [for (final r in (_day['requests'] as List? ?? const [])) Map<String, dynamic>.from(r)].where((r) => !status.containsKey('${r['id']}')).toList();
  }

  /// Bills: made on the phone first (waiting to sync), then the server's.
  List<Map<String, dynamic>> get invoices {
    final pendingPay = <String, String>{};
    for (final item in app.pending('payment')) {
      final action = item.body['action'] as Map? ?? const {};
      pendingPay['${action['invoice_id']}'] = '${action['payment_method']}';
    }
    final local = [
      for (final item in [...app.pending('bill'), ...app.pending('checkout')])
        if (item.body['_preview'] is Map) {...Map<String, dynamic>.from(item.body['_preview']), 'id': item.localId ?? item.id, '_outbox': item.id, '_failed': item.state.name == 'failed'},
    ];
    final server = [for (final i in ((app.cached('invoices') ?? const {})['invoices'] as List? ?? const [])) Map<String, dynamic>.from(i)];
    for (final i in server) {
      final method = pendingPay['${i['id']}'];
      if (method != null) {
        i['status'] = 'paid';
        i['payment_method'] = method;
        i['_changing'] = true;
      }
    }
    return [...local.reversed, ...server];
  }

  num get collectedToday {
    final today = istToday();
    return invoices.where((i) => i['status'] == 'paid' && i['issued_at'] != null && toIst(DateTime.parse(i['issued_at'])).toIso8601String().startsWith(today)).fold<num>(0, (s, i) => s + (num.tryParse('${i['total']}') ?? 0));
  }
}

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

const paymentLabels = {'cash': 'Cash', 'upi': 'UPI', 'card': 'Card'};
