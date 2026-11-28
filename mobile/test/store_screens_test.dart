import 'package:flutter/painting.dart' show Color;
import 'package:flutter_test/flutter_test.dart';

import 'package:wama_mobile/data/format.dart' show businessCurrencySource;
import 'package:wama_mobile/screens/store/store_logic.dart';

import 'screen_check.dart';

/// E-commerce in the app: every tab and the screens behind a tap, at small and normal phone sizes and
/// with large text; and the store rules mirrored from the web.
void main() {
  screenChecks(
    screens: ['store', 'store_products', 'store_flow', 'store_settings', 'new_order', 'chat_tickets', 'store_website'],
    flows: [
      ('store', ['#ORD-241114-0007']),
      ('store', ['#ORD-241114-0006']),
      ('store', ['#ORD-241112-0002']),
      ('store', ['To ship']),
      ('store', ['#ORD-241114-0009']),
      ('new_order', ['Phone call', 'Delivery']),
      ('new_order', ['Picks up later', 'Pays at pick up']),
      ('store_products', ['Classic white linen shirt']),
      ('store_products', ['Classic white linen shirt', 'Send to a customer']),
      ('store_products', ['Classic white linen shirt', 'Edit']),
      ('store_products', ['Add product']),
      ('store_products', ['Send catalog']),
      // Store address: going back to our address asks first
      ('store_website', ['Our address (free)']),
      // The newer shop screens behind the Store tab
      ('store_settings', ['Shop reports']),
      ('store_settings', ['Customer reviews']),
      ('store_settings', ['Offers and points']),
      ('store_settings', ['Offers and points', 'New offer']),
      ('store_settings', ['Returns']),
      ('store_settings', ['GST invoices']),
      ('store_settings', ['WhatsApp messages']),
      ('store_settings', ['Delivery partners']),
    ],
  );

  test('Order moves follow the web rules', () {
    expect(nextStatuses('payment_pending'), ['paid', 'cod_confirmed', 'canceled']);
    expect(nextStatuses('shipped'), ['delivered', 'canceled']);
    expect(nextStatuses('cod_confirmed'), ['shipped', 'delivered', 'canceled']);
    expect(channelLabel({'checkout_type': 'phone'}), 'Phone call');
    expect(channelLabel({'checkout_type': 'in_chat'}), isNull);
    expect(nextStatuses('delivered'), isEmpty);
    expect(needsRefund({'status': 'canceled', 'payment_status': 'paid'}), isTrue);
  });

  test('Made store pictures are recognised by their address and keep their colour', () {
    expect(madePicture('https://wamacrm.magnetora.in/api/public/store-art?kind=banner&c=0E1B3D&name=X'), const Color(0xFF0E1B3D));
    expect(madePicture('https://wamacrm.magnetora.in/api/public/store-art?kind=logo&name=X'), const Color(0xFF1D5BEA));
    expect(madePicture('https://cdn.example.com/photo.jpg'), isNull);
  });

  test('Shop extras mirror the web rules', () {
    expect(codCheckLabel({'shipping_address': {'cod_check': {'answer': 'yes'}}})!.$1, 'The customer said yes on WhatsApp');
    expect(codCheckLabel({'shipping_address': {'cod_check': {'answer': 'cancel'}}})!.$2, isTrue);
    expect(codCheckLabel({'shipping_address': {}}), isNull);
    expect(instagramPost('https://www.instagram.com/p/Cx1aB2cd/?igsh=abc'), 'p/Cx1aB2cd');
    expect(instagramPost('https://instagram.com/asha/reel/AbCdE12/'), 'reel/AbCdE12');
    expect(instagramPost('https://evil.com/p/Cx1aB2cd'), isNull);
    expect(storeLayouts.keys, ['grid', 'big', 'list', 'compact']);
    expect(storeInfoPages.map((p) => p.$1), ['about', 'shipping', 'returns', 'terms', 'privacy', 'contact']);
  });

  test('Money is shown in the order currency', () {
    // One currency for the whole business: an order's own (older, often USD) currency is not used
    expect(formatMoney(150000, 'USD'), '₹1,50,000');
    final before = businessCurrencySource;
    businessCurrencySource = () => 'USD';
    expect(formatMoney(12.5, 'INR'), r'$12.50');
    businessCurrencySource = before;
  });

  test('Go-live checks: a store with no catalog and no way to pay is not ready', () {
    final checks = goLiveChecks(
      {'whatsapp_connected': true, 'commerce_enable_cod': false},
      {
        'commerceSettings': {'is_cart_enabled': true, 'is_catalog_visible': true},
      },
    );
    expect(checks.firstWhere((c) => c.id == 'catalog').state, 'error');
    expect(checks.firstWhere((c) => c.id == 'payment').state, 'error');
    expect(readyToSell(checks), isFalse);
  });

  test('Go-live checks: a set-up store is ready', () {
    final org = {'whatsapp_connected': true, 'meta_catalog_id': '1', 'commerce_enable_cod': true};
    final meta = {
      'catalogStatus': {
        'linked': {'name': 'Main', 'product_count': 4},
        'connected': true,
      },
      'commerceSettings': {'is_cart_enabled': true, 'is_catalog_visible': true},
    };
    expect(readyToSell(goLiveChecks(org, meta)), isTrue);
  });

  test('Catalog state of a product', () {
    expect(catalogState({'metadata': {}}), 'not_sent');
    expect(
      catalogState({
        'metadata': {
          'catalog': {'state': 'pending'},
        },
      }),
      'sending',
    );
    expect(
      catalogState({
        'metadata': {
          'catalog': {'state': 'synced', 'review_status': 'rejected'},
        },
      }),
      'rejected',
    );
    expect(
      catalogStateLabel({
        'metadata': {
          'source': 'meta',
          'catalog': {'state': 'error'},
        },
      }),
      'Update not accepted',
    );
  });
}
