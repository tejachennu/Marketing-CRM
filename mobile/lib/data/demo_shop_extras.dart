/// Demo answers for the shop's newer screens (reports, reviews, offers and points, returns, GST invoices,
/// WhatsApp messages, delivery partners), shaped like the real /api/commerce/* replies.
class DemoShopExtras {
  final Map<String, dynamic> _returns = {'on': true, 'days': 7};
  final Map<String, dynamic> _invoice = {'gstin': '36ABCDE1234F1Z5', 'legalName': '', 'address': '', 'prefix': 'WEB', 'defaultRate': 5};
  final Map<String, dynamic> _loyalty = {'on': true, 'percent': 2, 'minUse': 50, 'maxPercent': 50};
  final Map<String, dynamic> _messages = {
    for (final p in ['cart_reminder', 'cod_confirm', 'review_ask', 'back_in_stock', 'refund_update']) p: {'on': p != 'cart_reminder', 'template': '', 'language': 'en'},
  };
  final List<Map<String, dynamic>> _offers = [
    {'id': 'd1', 'title': '10% off', 'code': 'DIWALI10', 'kind': 'percent', 'value': 10, 'buy_qty': 0, 'get_qty': 0, 'min_order': 0, 'max_uses': null, 'uses': 14, 'once_per_phone': true, 'first_order_only': false, 'active': true, 'for_phone': null},
    {'id': 'd2', 'title': 'Free delivery on ₹999 or more', 'code': null, 'kind': 'free_delivery', 'value': 0, 'buy_qty': 0, 'get_qty': 0, 'min_order': 999, 'max_uses': null, 'uses': 31, 'once_per_phone': false, 'first_order_only': false, 'active': true, 'for_phone': null},
  ];
  final List<Map<String, dynamic>> _reviews = [
    {'id': 'r1', 'rating': 5, 'body': 'Lovely fabric and quick delivery.', 'photos': [], 'customer_name': 'Asha R.', 'published': true, 'product': {'title': 'Classic white linen shirt'}, 'order': {'order_number': 'W-1042'}},
    {'id': 'r2', 'rating': 3, 'body': 'Size runs a little small.', 'photos': [], 'customer_name': 'Ravi K.', 'published': true, 'product': {'title': 'Denim jacket'}, 'order': {'order_number': 'W-1038'}},
  ];

  Map<String, dynamic> _report(int days) {
    final today = DateTime.now();
    return {
      'days': days, 'visits': 420, 'productViews': 1310, 'orders': 37, 'sales': 48650, 'averageOrder': 1314.86, 'conversion': 4.5, 'cancelled': 2,
      'daily': [
        for (var i = days - 1; i >= 0; i--)
          {'day': today.subtract(Duration(days: i)).toIso8601String().substring(0, 10), 'visits': 10 + (i * 7) % 15, 'orders': (i * 3) % 4, 'sales': ((i * 37) % 9) * 450},
      ],
      'channels': [
        {'channel': 'website', 'label': 'Website', 'orders': 21, 'sales': 29800},
        {'channel': 'in_chat', 'label': 'WhatsApp', 'orders': 13, 'sales': 15350},
        {'channel': 'in_store', 'label': 'In the shop', 'orders': 3, 'sales': 3500},
      ],
      'topProducts': [
        {'productId': 'p1', 'title': 'Classic white linen shirt', 'quantity': 18, 'sales': 26982},
        {'productId': 'p2', 'title': 'Denim jacket', 'quantity': 6, 'sales': 14394},
      ],
      'carts': {'left': 9, 'reminded': 7, 'cameBack': 3, 'value': 11200},
      'customers': [
        {'name': 'Asha Reddy', 'phone': '+91 98765 43210', 'orders': 4, 'spent': 6120, 'last': today.toIso8601String()},
        {'name': 'Ravi Kumar', 'phone': '+91 90000 00001', 'orders': 2, 'spent': 2998, 'last': today.toIso8601String()},
      ],
      'newCustomers': 22, 'returningCustomers': 9,
    };
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/commerce/reports':
        return {'report': _report(int.tryParse(query?['days'] ?? '') ?? 30)};
      case '/api/commerce/reviews':
        return {'reviews': _reviews};
      case '/api/commerce/discounts':
        return {'discounts': _offers};
      case '/api/commerce/loyalty':
        return {'settings': _loyalty};
      case '/api/commerce/returns':
        if (query?['orderId'] != null) return {'return': null, 'refunds': [], 'paid': 0, 'refunded': 0, 'left': 0, 'viaRazorpay': false};
        return {'settings': _returns};
      case '/api/commerce/invoices':
        if (query?['orderId'] != null) return {'invoice': null, 'canIssue': true};
        return {'settings': _invoice};
      case '/api/commerce/shop-messages':
        return {'messages': _messages};
      case '/api/commerce/shipping':
        return {'shiprocket': {'connected': true}, 'delhivery': {'connected': false}};
      case '/api/commerce/shipping/ship':
        return {'ready': ['shiprocket'], 'blocker': null, 'shipments': [
          {'id': 's1', 'provider': 'shiprocket', 'awb': '1234567890', 'courier_name': 'Delhivery Surface', 'status': 'in_transit', 'status_text': 'Reached Hyderabad hub', 'label_url': 'https://example.com/label.pdf'},
        ]};
      case '/api/commerce/products/options':
        return {'options': [{'name': 'Size', 'values': ['S', 'M', 'L']}], 'variants': [
          for (final size in ['S', 'M', 'L']) {'id': 'v$size', 'options': {'Size': size}, 'name': size, 'price': null, 'stock': 5, 'active': true},
        ], 'productPrice': 1499};
      case '/api/instagram':
        return {'account': {'igUserId': '1784', 'username': 'glowstore', 'name': 'Glow Store', 'subscribed': true, 'lastError': null}, 'login': {'appId': '', 'configId': ''}};
      case '/api/instagram/comments':
        return {'comments': [
          {'id': 'ic1', 'comment_id': 'c1', 'from_username': 'asha.r', 'text': 'Price of the linen shirt?', 'hidden': false, 'reply_text': null, 'replied_at': null, 'private_reply_at': null, 'created_at': DateTime.now().toIso8601String()},
        ]};
      case '/api/instagram/posts':
        return {'posts': [], 'connected': true};
    }
    return null;
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    switch (path) {
      case '/api/commerce/returns' when method == 'PUT':
        _returns.addAll(Map<String, dynamic>.from(body['settings'] as Map));
        return {'success': true, 'settings': _returns};
      case '/api/commerce/invoices' when method == 'PUT':
        _invoice.addAll(Map<String, dynamic>.from(body['settings'] as Map));
        return {'success': true, 'settings': _invoice};
      case '/api/commerce/invoices':
        return {'success': true, 'invoice': {'number': 'WEB/26-27/0042', 'status': 'issued', 'total': 1499, 'url': 'https://wamacrm.magnetora.in/invoice/demo'}};
      case '/api/commerce/loyalty':
        _loyalty.addAll(Map<String, dynamic>.from(body['settings'] as Map));
        return {'success': true, 'settings': _loyalty};
      case '/api/commerce/shop-messages':
        _messages.addAll(Map<String, dynamic>.from(body['messages'] as Map));
        return {'success': true, 'messages': _messages};
      case '/api/commerce/reviews':
        final r = _reviews.firstWhere((x) => x['id'] == body['id'], orElse: () => {});
        r['published'] = body['published'];
        return {'success': true};
      case '/api/commerce/discounts':
        final d = Map<String, dynamic>.from(body['discount'] as Map);
        final i = _offers.indexWhere((x) => x['id'] == d['id']);
        final saved = {'uses': 0, 'title': d['title'] == '' ? 'New offer' : d['title'], ...d, 'id': d['id'] ?? 'd${_offers.length + 1}'};
        if (i >= 0) { _offers[i] = saved; } else { _offers.insert(0, saved); }
        return {'success': true, 'discount': saved};
      case '/api/commerce/products/options':
        return {'success': true, 'options': body['options'], 'variants': body['variants']};
      case '/api/commerce/products/import':
        return {'success': true, 'added': (body['rows'] as List).length - 1, 'updated': 0, 'errors': []};
      case '/api/commerce/shipping/ship':
        return {'success': true, 'rates': [{'provider': 'shiprocket', 'courierId': '10', 'courierName': 'Delhivery Surface', 'price': 72, 'days': 4, 'recommended': true}], 'shipments': []};
      case '/api/instagram/comments':
        return {'success': true};
      case '/api/commerce/products/describe':
        return {'success': true, 'title': 'Linen shirt', 'description': 'A soft, breathable linen shirt for warm days. Easy to wash and comfortable all day.', 'category': 'Shirts'};
    }
    if (path.startsWith('/api/commerce/discounts?') && method == 'DELETE') {
      _offers.removeWhere((x) => x['id'] == Uri.parse(path).queryParameters['id']);
      return {'success': true};
    }
    return null;
  }
}
