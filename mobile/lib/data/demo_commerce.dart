import 'backend.dart';

/// Demo answers for the E-commerce screens (orders, products, store settings, Meta checks).
class DemoCommerce {
  DemoCommerce() {
    final now = DateTime.now().toUtc();
    String ago(int minutes) => now.subtract(Duration(minutes: minutes)).toIso8601String();
    Map<String, dynamic> product(String id, String title, String sku, num price, String image, {String category = 'Shirts', bool available = true, Map? catalog}) => {
      'id': id,
      'title': title,
      'retailer_id': sku,
      'price': price,
      'currency': 'INR',
      'category': category,
      'description': '',
      'image_url': image,
      'website_url': 'https://glowstore.in/p/$sku',
      'is_available': available,
      'inventory_count': available ? 25 : 0,
      'metadata': {
        'catalog': catalog ?? {'state': 'synced', 'review_status': 'approved'},
      },
    };
    _products = [
      product('p1', 'Classic white linen shirt', 'SHIRT-001', 1499, ''),
      product('p2', 'Indigo kurta, cotton', 'KURTA-014', 1899, '', category: 'Kurtas'),
      product('p3', 'Handloom saree, maroon', 'SAREE-007', 4299, '', category: 'Sarees', catalog: {'state': 'synced', 'review_status': 'pending'}),
      product('p4', 'Leather sandals', 'SAND-002', 999, '', category: 'Footwear', available: false),
      product(
        'p5',
        'Silk dupatta',
        'DUP-031',
        799,
        '',
        category: 'Accessories',
        catalog: {
          'state': 'error',
          'errors': ['The photo is smaller than 500 × 500 pixels.'],
        },
      ),
      {...product('p6', 'Gift wrap', 'GIFT-01', 49, '', category: 'Extras'), 'metadata': <String, dynamic>{}},
    ];
    Map<String, dynamic> item(String title, String sku, int qty, num price) => {
      'id': sku,
      'title': title,
      'retailer_id': sku,
      'quantity': qty,
      'unit_price': price,
      'total_price': price * qty,
      'image_url': '',
    };
    Map<String, dynamic> order(
      String id,
      String number,
      String status,
      String payment,
      String? method,
      List<Map<String, dynamic>> items,
      String first,
      String phone,
      int minutes, {
      Map? address,
      String? reference,
    }) {
      final subtotal = items.fold<num>(0, (s, i) => s + (i['total_price'] as num));
      return {
        'id': id,
        'order_number': number,
        'status': status,
        'payment_status': payment,
        'payment_method': method,
        'currency': 'INR',
        'subtotal': subtotal,
        'shipping_fee': subtotal >= 1500 ? 0 : 60,
        'tax_amount': 0,
        'total_amount': subtotal + (subtotal >= 1500 ? 0 : 60),
        'items': items,
        'contact_id': 'c-$id',
        'contact': {'first_name': first, 'last_name': '', 'phone_number': phone},
        'conversation_id': 'conv-1',
        'shipping_address': address ?? {},
        'meta_payment_reference': reference,
        'created_at': ago(minutes),
      };
    }

    const home = {
      'full_name': 'Priya Sharma',
      'address_line_1': 'Flat 302, Lake View Apartments',
      'address_line_2': 'Road No. 12, Banjara Hills',
      'city': 'Hyderabad',
      'state': 'Telangana',
      'pincode': '500034',
      'phone_number': '+919876543210',
      'delivery_speed': 'standard',
    };
    _orders = [
      order('o1', 'ORD-241114-0007', 'paid', 'paid', 'whatsapp_pay', [item('Classic white linen shirt', 'SHIRT-001', 2, 1499)], 'Priya Sharma', '+919876543210', 12, address: home),
      order(
        'o2',
        'ORD-241114-0006',
        'payment_pending',
        'pending',
        null,
        [item('Indigo kurta, cotton', 'KURTA-014', 1, 1899)],
        'Rahul Verma',
        '+919812345678',
        48,
        address: {...home, 'full_name': 'Rahul Verma'},
        reference: 'ORD-241114-0006',
      ),
      order(
        'o3',
        'ORD-241114-0005',
        'cod_confirmed',
        'pending',
        'cod',
        [item('Silk dupatta', 'DUP-031', 1, 799)],
        'Anjali Reddy',
        '+919900112233',
        130,
        address: {...home, 'full_name': 'Anjali Reddy', 'delivery_speed': 'express'},
      ),
      order('o4', 'ORD-241113-0004', 'awaiting_address', 'pending', null, [item('Handloom saree, maroon', 'SAREE-007', 1, 4299)], 'Kavya Nair', '+919845012345', 600),
      order(
        'o5',
        'ORD-241113-0003',
        'shipped',
        'paid',
        'whatsapp_pay',
        [item('Leather sandals', 'SAND-002', 1, 999)],
        'Vikram Singh',
        '+919444455555',
        1500,
        address: {...home, 'full_name': 'Vikram Singh', 'carrier': 'Delhivery', 'tracking_number': 'DL123456789IN'},
      ),
      order(
        'o6',
        'ORD-241112-0002',
        'canceled',
        'paid',
        'whatsapp_pay',
        [item('Indigo kurta, cotton', 'KURTA-014', 1, 1899)],
        'Meera Joshi',
        '+919811122233',
        3000,
        address: {...home, 'full_name': 'Meera Joshi'},
      ),
      order(
        'o7',
        'ORD-241111-0001',
        'delivered',
        'paid',
        'cod',
        [item('Classic white linen shirt', 'SHIRT-001', 1, 1499)],
        'Arjun Rao',
        '+919555512345',
        5000,
        address: {...home, 'full_name': 'Arjun Rao'},
      ),
    ];
  }

  late final List<Map<String, dynamic>> _products;
  late final List<Map<String, dynamic>> _orders;
  final Map<String, dynamic> org = {
    'id': 'org-demo',
    'name': 'Glow Store',
    'currency': 'INR',
    'whatsapp_connected': true,
    'enable_commerce': true,
    'meta_catalog_id': '1234567890',
    'commerce_payment_gateway': 'razorpay',
    'commerce_gateway_config_name': 'glow-razorpay',
    'commerce_enable_cod': true,
    'commerce_address_flow_id': 'flow-1',
    'commerce_default_shipping_fee': 60,
    'commerce_free_shipping_threshold': 1500,
    'commerce_express_fee': 50,
    'commerce_ai_assistant': true,
  };
  bool _cartOn = true;

  static const _views = {
    'awaiting': ['cart_submitted', 'awaiting_address', 'payment_pending'],
    'to_ship': ['paid', 'cod_confirmed'],
    'shipped': ['shipped'],
    'delivered': ['delivered'],
    'canceled': ['canceled'],
  };

  Map<String, dynamic> get _summary {
    int count(List<String> statuses) => _orders.where((o) => statuses.contains(o['status'])).length;
    final revenue = _orders.where((o) => o['payment_status'] == 'paid' && o['status'] != 'canceled').fold<num>(0, (s, o) => s + (o['total_amount'] as num));
    return {
      'total': _orders.length,
      'awaiting': count(_views['awaiting']!),
      'toShip': count(_views['to_ship']!),
      'shipped': count(['shipped']),
      'delivered': count(['delivered']),
      'canceled': count(['canceled']),
      'refundDue': _orders.where((o) => o['status'] == 'canceled' && o['payment_status'] == 'paid').length,
      'revenue': [
        {'currency': 'INR', 'amount': revenue},
      ],
    };
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/organization':
        return {'organization': org};
      case '/api/commerce/orders':
        final view = query?['view'] ?? 'all';
        final search = (query?['search'] ?? '').toLowerCase();
        final list = _orders.where((o) {
          if (view != 'all' && !(_views[view] ?? const []).contains(o['status'])) return false;
          return search.isEmpty || '${o['order_number']} ${(o['contact'] as Map)['first_name']} ${(o['contact'] as Map)['phone_number']}'.toLowerCase().contains(search);
        }).toList();
        return {
          'orders': list,
          'summary': _summary,
          'pagination': {'page': 1, 'limit': 25, 'total': list.length, 'pages': 1},
        };
      case '/api/commerce/products':
        final search = (query?['search'] ?? '').toLowerCase();
        final availability = query?['availability'] ?? 'all';
        final list = _products.where((p) {
          if (availability == 'available' && p['is_available'] != true) return false;
          if (availability == 'unavailable' && p['is_available'] != false) return false;
          final state = (p['metadata'] as Map)['catalog'] as Map?;
          if (query?['catalog'] == 'attention' && state?['state'] != 'error' && state?['review_status'] != 'rejected') return false;
          if (query?['catalog'] == 'not_sent' && state != null) return false;
          return search.isEmpty || '${p['title']} ${p['retailer_id']}'.toLowerCase().contains(search);
        }).toList();
        final limit = int.tryParse(query?['limit'] ?? '') ?? 24;
        return {
          'products': list.take(limit).toList(),
          'pagination': {'page': 1, 'limit': limit, 'total': list.length, 'pages': 1},
          'catalog': {'sending': 0, 'attention': 1, 'notSent': 1},
        };
      case '/api/commerce/meta-detect':
        return {
          'success': true,
          'businessId': 'b1',
          'businessName': 'Glow Store',
          'catalogs': [
            {'id': '1234567890', 'name': 'Glow Store catalog', 'product_count': 5},
          ],
          'paymentConfigs': [
            {'configuration_name': 'glow-razorpay', 'provider_name': 'razorpay', 'status': 'Active'},
          ],
          'flows': [
            {'id': 'flow-1', 'name': 'Delivery address', 'status': 'PUBLISHED'},
          ],
          'commerceSettings': {'is_cart_enabled': _cartOn, 'is_catalog_visible': true},
        };
      case '/api/commerce/catalog':
        return {
          'linkedCatalogId': org['meta_catalog_id'],
          'linked': org['meta_catalog_id'] == null || org['meta_catalog_id'] == '' ? null : {'id': '1234567890', 'name': 'Glow Store catalog', 'product_count': 5},
          'connected': true,
          'connectionKnown': true,
          'catalogs': [
            {'id': '1234567890', 'name': 'Glow Store catalog', 'product_count': 5, 'connected': true},
          ],
          'businessId': 'b1',
          'canEdit': true,
          'canCreate': true,
          'catalogConnection': true,
        };
      case '/api/commerce/order-flow':
        return {
          'orders': [
            for (final o in _orders.take(3))
              {
                ...o,
                'trail': [
                  {'body': '🛒 Cart: ${(o['items'] as List).length} item', 'status': null, 'error_message': null, 'sender_type': 'contact', 'created_at': o['created_at']},
                  {'body': '[Order #${o['order_number']} received; asked how to pay]', 'status': 'read', 'error_message': null, 'sender_type': 'user', 'created_at': o['created_at']},
                ],
              },
          ],
        };
    }
    return null;
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    if (path.startsWith('/api/commerce/products?') && method == 'DELETE') {
      _products.removeWhere((p) => p['id'] == Uri.parse(path).queryParameters['id']);
      return {'success': true, 'inCatalog': true, 'catalogRemoved': true};
    }
    switch (path) {
      case '/api/commerce/orders':
        final order = _orders.firstWhere((o) => o['id'] == body['orderId']);
        if (method == 'POST') return {'success': true, 'step': 'payment', 'order': order};
        if (body['status'] != null) {
          order['status'] = body['status'];
          if (body['status'] == 'paid') order['payment_status'] = 'paid';
        }
        if (body['paymentStatus'] != null) order['payment_status'] = body['paymentStatus'];
        if (body['trackingNumber'] != null) order['shipping_address'] = {...(order['shipping_address'] as Map), 'tracking_number': body['trackingNumber'], 'carrier': body['carrier']};
        return {'order': order, 'notified': body['notifyCustomer'] == true, 'notifyError': null};
      case '/api/commerce/products':
        final action = body['action'];
        if (action == 'sync_meta') return {'success': true, 'synced': _products.length, 'total': _products.length};
        if (action == 'refresh_catalog') return {'success': true};
        if (action == 'push_meta') return {'success': true, 'sent': 1, 'rejected': 0, 'problems': []};
        final input = Map<String, dynamic>.from(body['product'] as Map);
        final price = num.tryParse('${input['price']}');
        if ('${input['title']}'.trim().isEmpty) throw ApiException(400, 'Enter a product title');
        if (price == null) throw ApiException(400, 'Enter a valid price (0 or more)');
        final existing = _products.where((p) => p['id'] == input['id']).firstOrNull;
        final saved = {
          ...?existing,
          ...input,
          'price': price,
          'id': input['id'] ?? 'p${_products.length + 1}',
          'metadata':
              existing?['metadata'] ??
              {
                'catalog': {'state': 'pending'},
              },
        };
        if (existing != null) {
          _products[_products.indexOf(existing)] = saved;
        } else {
          _products.add(saved);
        }
        return {
          'product': saved,
          'catalog': {'state': 'pending'},
        };
      case '/api/commerce/send':
        return {'success': true};
      case '/api/commerce/meta-detect':
        if (body['action'] == 'enable_cart') _cartOn = true;
        if (body['action'] == 'disable_cart') _cartOn = false;
        return {'success': true, 'flowId': 'flow-1'};
      case '/api/commerce/catalog':
        return {'success': true, 'catalogId': '1234567890', 'connected': true};
      case '/api/organization':
        org.addAll(Map<String, dynamic>.from(body['updates'] as Map));
        return {'success': true, 'organization': org};
      case '/api/mobile/push-test':
        return {'sent': 1, 'message': 'Sent. It should pop up in a few seconds (even with the app closed).'};
    }
    return null;
  }
}
