import 'package:intl/intl.dart';

/// The store's rules, mirrored from the web (`lib/commerce/commerce-utils.ts`,
/// `lib/commerce/go-live-checks.ts`, `lib/commerce/catalog-items.ts`), so the app says the same
/// thing as the dashboard. The server still checks every change.

const orderStatusLabels = {
  'cart_submitted': 'Cart received',
  'awaiting_address': 'Awaiting address',
  'payment_pending': 'Payment pending',
  'paid': 'Paid',
  'cod_confirmed': 'COD confirmed',
  'shipped': 'Shipped',
  'delivered': 'Delivered',
  'canceled': 'Canceled',
};

String statusLabel(Object? status) => orderStatusLabels['$status'] ?? '$status';

const openCheckoutStatuses = ['cart_submitted', 'awaiting_address', 'payment_pending'];
const toShipStatuses = ['paid', 'cod_confirmed'];

/// The filters on the Orders list, with the summary count each one shows.
const orderViews = [
  ('all', 'All', 'total'),
  ('awaiting', 'Awaiting customer', 'awaiting'),
  ('to_ship', 'To ship', 'toShip'),
  ('shipped', 'Shipped', 'shipped'),
  ('delivered', 'Delivered', 'delivered'),
  ('canceled', 'Canceled', 'canceled'),
];

const _transitions = {
  'cart_submitted': ['paid', 'cod_confirmed', 'canceled'],
  'awaiting_address': ['paid', 'cod_confirmed', 'canceled'],
  'payment_pending': ['paid', 'cod_confirmed', 'canceled'],
  'paid': ['shipped', 'canceled'],
  'cod_confirmed': ['shipped', 'canceled'],
  'shipped': ['delivered', 'canceled'],
  'delivered': <String>[],
  'canceled': <String>[],
};

List<String> nextStatuses(Object? status) => _transitions['$status'] ?? const [];

bool needsRefund(Map order) => order['status'] == 'canceled' && order['payment_status'] == 'paid';

/// "₹1,050", "$12.50"; the currency's own sign, Indian grouping for rupees.
String formatMoney(Object? amount, [Object? currency]) {
  final value = amount is num ? amount : num.tryParse('$amount') ?? 0;
  final code = '${currency ?? 'INR'}'.toUpperCase();
  try {
    final format = NumberFormat.simpleCurrency(name: code, locale: code == 'INR' ? 'en_IN' : 'en_US', decimalDigits: value == value.roundToDouble() ? 0 : 2);
    return format.format(value);
  } catch (_) {
    return '$code ${value.toStringAsFixed(2)}';
  }
}

String customerName(Map order) {
  final contact = (order['contact'] as Map?) ?? const {};
  final name = [contact['first_name'], contact['last_name']].where((x) => '${x ?? ''}'.trim().isNotEmpty).join(' ');
  if (name.isNotEmpty) return name;
  final address = (order['shipping_address'] as Map?) ?? const {};
  return '${address['full_name'] ?? ''}'.trim().isNotEmpty ? '${address['full_name']}' : 'Customer';
}

String itemSummary(Map order) {
  final items = (order['items'] as List? ?? const []);
  return items.isEmpty ? '—' : items.map((i) => '${i['quantity']} × ${i['title']}').join(', ');
}

/// The order's payment, in words, and whether it needs attention.
(String, bool) paymentLabel(Map order) {
  if (needsRefund(order)) return ('Paid, then canceled: refund due', true);
  if (order['payment_status'] == 'paid') return ('Paid', false);
  if (order['payment_status'] == 'refunded') return ('Refunded', false);
  if (order['payment_status'] == 'failed') return ('Last payment attempt failed', true);
  if (order['payment_method'] == 'cod') return ('To be collected on delivery', false);
  return ('Not paid yet', false);
}

const paymentMethodLabels = {'whatsapp_pay': 'Paid in WhatsApp', 'cod': 'Cash on Delivery', 'manual': 'Marked as paid by your team', 'razorpay_link': 'Payment link'};

/// What a reminder sends, by the step the server reports.
const reminderSent = {
  'address': 'the delivery address form',
  'choice': 'the choice between paying online and Cash on Delivery',
  'payment': 'a new payment request',
  'cod': 'the Cash on Delivery confirmation',
  'acknowledged': 'a note that your team will be in touch',
};

/// A payment request was sent for this order (WhatsApp knows its reference).
bool hasPaymentRequest(Map order) {
  final reference = '${order['meta_payment_reference'] ?? ''}'.trim();
  if (reference.isEmpty) return false;
  if (RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-', caseSensitive: false).hasMatch(reference)) return true;
  final base = '${order['order_number'] ?? ''}'.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '');
  return reference == base || reference.startsWith('$base.');
}

String formatAddress(Map? address) {
  if (address == null || '${address['address_line_1'] ?? ''}'.trim().isEmpty) return '';
  return [
    address['address_line_1'],
    address['address_line_2'],
    address['city'],
    [address['state'], address['pincode']].where((x) => '${x ?? ''}'.trim().isNotEmpty).join(' '),
  ].map((x) => '${x ?? ''}'.trim()).where((x) => x.isNotEmpty).join(', ');
}

// ── Products in the WhatsApp catalog ──

const catalogStateLabels = {
  'in_catalog': 'In WhatsApp catalog',
  'in_review': 'In review by WhatsApp',
  'rejected': 'Rejected by WhatsApp',
  'sending': 'Sending to catalog',
  'error': 'Not accepted',
  'not_sent': 'Not in catalog',
};

Map? catalogSync(Map product) {
  final meta = (product['metadata'] as Map?) ?? const {};
  final sync = meta['catalog'];
  if (sync is Map && sync['state'] is String) return sync;
  return meta['source'] == 'meta' ? const {'state': 'synced'} : null;
}

String catalogState(Map product) {
  final sync = catalogSync(product);
  if (sync == null) return 'not_sent';
  if (sync['state'] == 'pending') return 'sending';
  if (sync['state'] == 'error') return 'error';
  if (sync['review_status'] == 'rejected') return 'rejected';
  if (sync['review_status'] == 'pending') return 'in_review';
  return 'in_catalog';
}

String catalogStateLabel(Map product) {
  final state = catalogState(product);
  return state == 'error' && ((product['metadata'] as Map?)?['source'] == 'meta') ? 'Update not accepted' : catalogStateLabels[state]!;
}

bool isInCatalog(Map product) {
  final state = catalogSync(product)?['state'];
  return (product['metadata'] as Map?)?['source'] == 'meta' || state == 'synced' || state == 'pending';
}

bool inStock(Map product) => product['is_available'] != false && ((product['inventory_count'] as num?) ?? 1) > 0;

Map productAttributes(Map product) {
  final attributes = (product['metadata'] as Map?)?['attributes'];
  return attributes is Map ? attributes : const {};
}

/// What to tell someone about to send a product WhatsApp cannot show as a card yet.
String catalogCaution(String state) => switch (state) {
  'sending' => 'This product is still being added to your WhatsApp catalog. If the card does not arrive, try again in a few minutes.',
  'in_review' => 'WhatsApp is still reviewing this product, so the card may not show until it is approved.',
  'rejected' => 'WhatsApp rejected this product, so it cannot be sent as a catalog card.',
  'error' || 'not_sent' => 'This product is not in your WhatsApp catalog, so WhatsApp cannot show it as a catalog card yet.',
  _ => '',
};

const originCountries = [
  ('IN', 'India'),
  ('CN', 'China'),
  ('US', 'United States'),
  ('GB', 'United Kingdom'),
  ('AE', 'United Arab Emirates'),
  ('BD', 'Bangladesh'),
  ('VN', 'Vietnam'),
  ('TH', 'Thailand'),
  ('ID', 'Indonesia'),
  ('MY', 'Malaysia'),
  ('SG', 'Singapore'),
  ('JP', 'Japan'),
  ('KR', 'South Korea'),
  ('TW', 'Taiwan'),
  ('DE', 'Germany'),
  ('FR', 'France'),
  ('IT', 'Italy'),
  ('TR', 'Türkiye'),
  ('LK', 'Sri Lanka'),
  ('NP', 'Nepal'),
];

// ── Store set-up ──

const supportedGateways = ['razorpay', 'payu', 'billdesk', 'zaakpay'];
const gatewayLabels = {'razorpay': 'Razorpay', 'payu': 'PayU', 'billdesk': 'BillDesk', 'zaakpay': 'Zaakpay'};
const defaultExpressFee = 50;

bool hasGateway(Map org) => '${org['commerce_gateway_config_name'] ?? ''}'.trim().isNotEmpty && supportedGateways.contains('${org['commerce_payment_gateway'] ?? 'razorpay'}');

num expressFee(Map org) {
  final raw = org['commerce_express_fee'];
  if (raw == null || raw == '') return defaultExpressFee;
  final fee = raw is num ? raw : num.tryParse('$raw');
  return fee != null && fee >= 0 ? fee : defaultExpressFee;
}

class StoreSetup {
  StoreSetup(Map org)
    : whatsappConnected = org['whatsapp_connected'] is bool ? org['whatsapp_connected'] as bool : false,
      catalogLinked = '${org['meta_catalog_id'] ?? ''}'.trim().isNotEmpty,
      addressFlow = '${org['commerce_address_flow_id'] ?? ''}'.trim().isNotEmpty,
      paymentGateway = hasGateway(org),
      cashOnDelivery = org['commerce_enable_cod'] != false;
  final bool whatsappConnected, catalogLinked, addressFlow, paymentGateway, cashOnDelivery;
  bool get canCheckout => whatsappConnected && (paymentGateway || cashOnDelivery);
  bool get complete => whatsappConnected && catalogLinked && canCheckout;
}

/// One go-live check: ok, warning, error, skipped or unknown.
class GoLiveCheck {
  const GoLiveCheck(this.id, this.title, this.state, this.detail, {this.required = true, this.fix});
  final String id, title, state, detail;
  final bool required;

  /// settings (web Settings), store_settings, enable_cart, whatsapp_manager
  final String? fix;
}

/// Mirrors getGoLiveChecks: [meta] is the meta-detect answer with `catalogStatus` added, or null while loading.
List<GoLiveCheck> goLiveChecks(Map org, Map? meta) {
  final setup = StoreSetup(org);
  final known = meta != null;
  final checks = <GoLiveCheck>[];

  if (!setup.whatsappConnected) {
    checks.add(
      const GoLiveCheck('whatsapp', 'WhatsApp connected', 'error', 'Connect your WhatsApp Business number in Settings on the web. Carts arrive and replies go out through it.', fix: 'settings'),
    );
  } else if (meta?['connectionError'] != null) {
    checks.add(GoLiveCheck('whatsapp', 'WhatsApp connected', 'error', '${meta!['connectionError']}', fix: 'settings'));
  } else {
    checks.add(GoLiveCheck('whatsapp', 'WhatsApp connected', known ? 'ok' : 'unknown', known ? 'Meta answered for your WhatsApp account.' : 'Checking with Meta…'));
  }

  checks.add(
    org['enable_commerce'] == false
        ? const GoLiveCheck('store', 'Store switched on', 'error', 'The store is off, so carts customers send are not turned into orders and nobody replies.', fix: 'store_settings')
        : const GoLiveCheck('store', 'Store switched on', 'ok', 'Carts customers send become orders.'),
  );

  final catalogId = '${org['meta_catalog_id'] ?? ''}'.trim();
  final status = meta?['catalogStatus'] as Map?;
  final catalogs = (meta?['catalogs'] as List? ?? const []);
  final listed = catalogs.cast<Map?>().firstWhere((c) => '${c!['id']}' == catalogId, orElse: () => null);
  final catalog = (status?['linked'] as Map?) ?? listed;
  final cartShowsCatalog = (meta?['commerceSettings'] as Map?)?['is_catalog_visible'] == true;
  const t = 'Catalog linked';
  if (catalogId.isEmpty) {
    checks.add(const GoLiveCheck('catalog', t, 'error', 'Link the Meta catalog customers shop from.', fix: 'store_settings'));
  } else if (!known) {
    checks.add(const GoLiveCheck('catalog', t, 'unknown', 'Checking with Meta…'));
  } else if (status != null) {
    final linked = status['linked'] as Map?;
    final name = '${linked?['name'] ?? catalogId}';
    final count = linked?['product_count'] as num?;
    if (linked == null) {
      checks.add(
        GoLiveCheck(
          'catalog',
          t,
          status['linkedError'] != null ? 'error' : 'warning',
          status['linkedError'] != null ? 'Meta could not read the linked catalog: ${status['linkedError']}' : 'Meta did not return the linked catalog.',
          fix: 'store_settings',
        ),
      );
    } else if (status['connected'] == false) {
      checks.add(GoLiveCheck('catalog', t, 'error', '“$name” is not the catalog connected to your WhatsApp account. Connect it in Store settings.', fix: 'store_settings'));
    } else if (count == 0) {
      checks.add(GoLiveCheck('catalog', t, 'error', '“$name” has no products yet. Add products in the Products tab.', fix: 'store_settings'));
    } else {
      checks.add(GoLiveCheck('catalog', t, 'ok', '$name${count != null ? ' · $count product${count == 1 ? '' : 's'}' : ''}'));
    }
  } else if (meta['catalogsError'] != null && !cartShowsCatalog) {
    checks.add(GoLiveCheck('catalog', t, 'warning', 'Meta did not list your catalogs: ${meta['catalogsError']}', fix: 'store_settings'));
  } else if (listed == null && catalogs.isEmpty) {
    checks.add(
      GoLiveCheck(
        'catalog',
        t,
        cartShowsCatalog ? 'ok' : 'warning',
        cartShowsCatalog
            ? 'Linked, and the catalog shows on your WhatsApp number.'
            : 'Meta did not list the catalog connected to your WhatsApp account, so this could not be confirmed. Check it in Store settings.',
        fix: cartShowsCatalog ? null : 'store_settings',
      ),
    );
  } else if (catalog == null) {
    checks.add(const GoLiveCheck('catalog', t, 'error', 'The linked catalog is not connected to this WhatsApp account. Pick another in Store settings.', fix: 'store_settings'));
  } else if (catalog['product_count'] == 0) {
    checks.add(GoLiveCheck('catalog', t, 'error', '“${catalog['name'] ?? catalogId}” has no products yet. Add products in the Products tab.', fix: 'store_settings'));
  } else {
    final count = catalog['product_count'] as num?;
    checks.add(GoLiveCheck('catalog', t, 'ok', '${catalog['name'] ?? catalogId}${count != null ? ' · $count product${count == 1 ? '' : 's'}' : ''}'));
  }

  final settings = meta?['commerceSettings'] as Map?;
  const c = 'Cart turned on for your number';
  if (!known) {
    checks.add(const GoLiveCheck('cart', c, 'unknown', 'Checking with Meta…'));
  } else if (meta['commerceSettingsError'] != null && settings == null) {
    checks.add(GoLiveCheck('cart', c, 'warning', 'Meta did not report the cart setting: ${meta['commerceSettingsError']}', fix: 'enable_cart'));
  } else if (settings?['is_cart_enabled'] == true && settings?['is_catalog_visible'] == true) {
    checks.add(const GoLiveCheck('cart', c, 'ok', 'Customers see the catalog in your chat and can send a cart.'));
  } else {
    final missing = [if (settings?['is_catalog_visible'] != true) 'the catalog is hidden', if (settings?['is_cart_enabled'] != true) 'the cart is off'].join(' and ');
    checks.add(GoLiveCheck('cart', c, 'error', 'On your WhatsApp number $missing, so customers cannot send an order.', fix: 'enable_cart'));
  }

  final flowId = '${org['commerce_address_flow_id'] ?? ''}'.trim();
  final flow = (meta?['flows'] as List? ?? const []).cast<Map?>().firstWhere((f) => '${f!['id']}' == flowId, orElse: () => null);
  const a = 'Delivery address form';
  if (flowId.isEmpty) {
    checks.add(const GoLiveCheck('address', a, 'skipped', 'Not used: customers are not asked for an address. Recommended for Cash on Delivery.', required: false, fix: 'store_settings'));
  } else if (!known) {
    checks.add(const GoLiveCheck('address', a, 'unknown', 'Checking with Meta…', required: false));
  } else if (flow != null && '${flow['status']}'.toUpperCase() == 'PUBLISHED') {
    checks.add(GoLiveCheck('address', a, 'ok', '${flow['name'] ?? 'Address form'} is published.', required: false));
  } else {
    checks.add(
      GoLiveCheck(
        'address',
        a,
        'warning',
        flow != null
            ? 'The form is ${'${flow['status'] ?? 'not published'}'.toLowerCase()} on Meta, so it cannot be sent. Use “Create the standard form” in Store settings.'
            : 'The saved form is not on this WhatsApp account. Use “Create the standard form” in Store settings.',
        required: false,
        fix: 'store_settings',
      ),
    );
  }

  final gateway = hasGateway(org);
  final cod = org['commerce_enable_cod'] != false;
  final configName = '${org['commerce_gateway_config_name'] ?? ''}'.trim();
  final config = gateway ? (meta?['paymentConfigs'] as List? ?? const []).cast<Map?>().firstWhere((x) => x!['configuration_name'] == configName, orElse: () => null) : null;
  final configStatus = '${config?['status'] ?? ''}';
  String? gatewayProblem;
  if (gateway && known && meta['paymentConfigsError'] == null) {
    if (config == null) {
      gatewayProblem = 'The payment setup “$configName” is not on your WhatsApp account.';
    } else if (configStatus.isNotEmpty && !RegExp('active', caseSensitive: false).hasMatch(configStatus)) {
      gatewayProblem = 'The payment setup “$configName” is ${configStatus.replaceAll('_', ' ').toLowerCase()} in WhatsApp Manager.';
    }
  }
  final ways = [if (gateway) 'online payment', if (cod) 'Cash on Delivery'].join(' and ');
  const p = 'A way to pay';
  if (!gateway && !cod) {
    checks.add(const GoLiveCheck('payment', p, 'error', 'No online payment and no Cash on Delivery: customers are only told your team will contact them.', fix: 'store_settings'));
  } else if (gatewayProblem != null) {
    checks.add(GoLiveCheck('payment', p, cod ? 'warning' : 'error', '$gatewayProblem${cod ? ' Customers can still choose Cash on Delivery.' : ''}', fix: 'whatsapp_manager'));
  } else {
    checks.add(GoLiveCheck('payment', p, gateway && !known ? 'unknown' : 'ok', 'Customers can pay by $ways.'));
  }
  return checks;
}

bool readyToSell(List<GoLiveCheck> checks) => checks.every((c) => !c.required || c.state == 'ok' || c.state == 'warning');

/// What the customer is told at each checkout step (the web's CHECKOUT_TEXT).
class CheckoutText {
  static String received(String order, int items, String total) => 'Thank you! We received your order #$order for $items item${items == 1 ? '' : 's'} (Total: $total).';
  static const askAddress = 'Where should we deliver it? Tap below to add your address.';
  static String askHowToPay(String total) => 'How would you like to pay $total?';
  static const payOnline = 'Review your order and pay securely below.';
  static String confirmCod(String total) => 'Pay $total in cash when your order arrives. Tap below to confirm it.';
  static const acknowledge = 'Our team will contact you shortly to confirm payment and delivery.';
  static String codConfirmed(String order, String total) => 'Order #$order is confirmed for Cash on Delivery. Please keep $total ready when it arrives.';
  static String paid(String amount, String order) => 'Payment of $amount received. Order #$order is confirmed and we are preparing it.';
}

/// choice, payment, cod or acknowledged (mirrors getPaymentStep).
String paymentStep(Map org) {
  final online = hasGateway(org);
  final cod = org['commerce_enable_cod'] != false;
  if (online && cod) return 'choice';
  if (online) return 'payment';
  if (cod) return 'cod';
  return 'acknowledged';
}
