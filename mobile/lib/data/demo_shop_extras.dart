import 'demo_auto_messages.dart';

/// Demo answers for the shop's newer screens (reports, reviews, offers and points, returns, GST invoices,
/// WhatsApp messages, delivery partners), shaped like the real /api/commerce/* replies.
class DemoShopExtras {
  Map<String, dynamic> _igAutomation = {
    'dmAi': true,
    'commentAi': false,
    'rules': [
      {'keywords': ['price', 'cost', 'how much'], 'reply': 'Sent you the price in a message, {name}! 💛', 'dm': 'Hi {name}, the linen shirt is ₹1,499. Sizes S, M and L. Order here: glowstore.in'},
    ],
    'everyComment': {'on': false, 'reply': '', 'dm': ''},
    'hideWords': ['spam'],
  };
  final List<Map<String, dynamic>> _igComments = [
    {'id': 'ic1', 'comment_id': 'c1', 'media_id': 'm1', 'from_username': 'asha.r', 'text': 'Price of the linen shirt?', 'hidden': false, 'reply_text': null, 'replied_at': null, 'private_reply_at': null, 'created_at': DateTime.now().subtract(const Duration(minutes: 25)).toIso8601String()},
    {'id': 'ic2', 'comment_id': 'c2', 'media_id': 'm1', 'from_username': 'kavya.designs', 'text': 'Do you ship to Bengaluru?', 'hidden': false, 'reply_text': null, 'replied_at': null, 'private_reply_at': null, 'created_at': DateTime.now().subtract(const Duration(hours: 3)).toIso8601String()},
    {'id': 'ic3', 'comment_id': 'c3', 'media_id': 'm2', 'from_username': 'ravi_k', 'text': 'Lovely colours 😍', 'hidden': false, 'reply_text': 'Thank you Ravi! 💛', 'replied_at': DateTime.now().subtract(const Duration(days: 1)).toIso8601String(), 'private_reply_at': null, 'created_at': DateTime.now().subtract(const Duration(days: 1, hours: 2)).toIso8601String()},
  ];

  final Map<String, dynamic> _returns = {'on': true, 'days': 7};
  final Map<String, dynamic> _invoice = {'gstin': '36ABCDE1234F1Z5', 'legalName': '', 'address': '', 'prefix': 'WEB', 'defaultRate': 5};
  final Map<String, dynamic> _loyalty = {'on': true, 'percent': 2, 'minUse': 50, 'maxPercent': 50};
  final Map<String, dynamic> _messages = {
    for (final p in ['cart_reminder', 'cod_confirm', 'review_ask', 'back_in_stock', 'refund_update', 'order_update']) p: {'on': p != 'cart_reminder', 'template': '', 'language': 'en'},
    // Approved, and in review: the demo shows both
    'cod_confirm': {
      'on': true,
      'template': 'cod_order_check',
      'language': 'en',
      'fields': ['first_name', 'order_number', 'shop', 'amount'],
    },
    'review_ask': {
      'on': true,
      'template': 'order_review_request',
      'language': 'en',
      'fields': ['first_name', 'order_number', 'review_link'],
    },
  };

  /// The shop's own templates on WhatsApp (for its messages' templates).
  final List<Map<String, dynamic>> _shopTemplates = [
    {
      'id': 'st1',
      'name': 'cod_order_check',
      'status': 'APPROVED',
      'category': 'UTILITY',
      'language': 'en',
      'components': [
        {'type': 'BODY', 'text': 'Hi {{1}}, thank you for your order {{2}} at {{3}}. You will pay {{4}} in cash when it arrives. Please confirm so we can send it.'},
        {
          'type': 'BUTTONS',
          'buttons': [
            {'type': 'QUICK_REPLY', 'text': 'Yes, send it'},
            {'type': 'QUICK_REPLY', 'text': 'Cancel order'},
          ],
        },
      ],
    },
    {
      'id': 'st2',
      'name': 'order_review_request',
      'status': 'PENDING',
      'category': 'UTILITY',
      'language': 'en',
      'components': [
        {'type': 'BODY', 'text': 'Hi {{1}}, your order {{2}} was delivered. Please tell us how it was at {{3}} so we can serve you better.'},
      ],
    },
  ];
  int _ids = 0;

  Map<String, dynamic> _shopMessagesAnswer() => {
    'messages': _messages,
    'connected': true,
    'ownWhatsApp': true,
    'languages': autoLanguages,
    'account': accountList(_shopTemplates),
    'autoMessages': [
      for (final def in shopAutoDefs)
        {
          ...autoView(def, {
            'name': (_messages[def.purpose] as Map)['template'],
            'language': (_messages[def.purpose] as Map)['language'],
            'fields': (_messages[def.purpose] as Map)['fields'],
            if ((_messages[def.purpose] as Map)['previous'] is Map)
              'previous': {
                'name': ((_messages[def.purpose] as Map)['previous'] as Map)['template'],
                'language': ((_messages[def.purpose] as Map)['previous'] as Map)['language'],
              },
          }, _shopTemplates),
          'on': (_messages[def.purpose] as Map)['on'] != false,
          'switchable': def.purpose != 'order_update',
        },
    ],
  };
  final List<Map<String, dynamic>> _offers = [
    {'id': 'd1', 'title': '10% off', 'code': 'DIWALI10', 'kind': 'percent', 'value': 10, 'buy_qty': 0, 'get_qty': 0, 'min_order': 0, 'max_uses': null, 'uses': 14, 'once_per_phone': true, 'first_order_only': false, 'active': true, 'for_phone': null},
    {'id': 'd2', 'title': 'Free delivery on ₹999 or more', 'code': null, 'kind': 'free_delivery', 'value': 0, 'buy_qty': 0, 'get_qty': 0, 'min_order': 999, 'max_uses': null, 'uses': 31, 'once_per_phone': false, 'first_order_only': false, 'active': true, 'for_phone': null},
  ];
  final List<Map<String, dynamic>> _reviews = [
    {'id': 'r1', 'rating': 5, 'body': 'Lovely fabric and quick delivery.', 'photos': [], 'customer_name': 'Asha R.', 'published': true, 'product': {'title': 'Classic white linen shirt'}, 'order': {'order_number': 'W-1042'}},
    {'id': 'r2', 'rating': 3, 'body': 'Size runs a little small.', 'photos': [], 'customer_name': 'Ravi K.', 'published': true, 'product': {'title': 'Denim jacket'}, 'order': {'order_number': 'W-1038'}},
  ];

  Map<String, dynamic> _report(int days, String? channel, {DateTime? end}) {
    final today = end ?? DateTime.now();
    // A share of the numbers for one channel, so the filter visibly changes them
    final share = switch (channel) { 'website' => 0.6, 'in_chat' => 0.3, 'in_store' => 0.07, 'phone' => 0.03, _ => 1.0 };
    final scale = days == 1 ? 0.04 : days == 7 ? 0.25 : days == 90 ? 2.8 : 1.0;
    int n(num v) => (v * share * scale).round();
    final website = channel == null || channel == 'website';
    return {
      'days': days, 'channel': channel, 'visits': website ? n(420 / share) : 0, 'productViews': website ? n(1310 / share) : 0,
      'orders': n(37), 'sales': n(48650), 'received': n(31200), 'averageOrder': 1314.86, 'conversion': website ? 4.5 : null, 'cancelled': n(2),
      'before': {'orders': n(31), 'sales': n(41200), 'visits': website ? n(380 / share) : 0},
      'daily': [
        for (var i = days - 1; i >= 0; i--)
          {'day': today.subtract(Duration(days: i)).toIso8601String().substring(0, 10), 'visits': website ? 10 + (i * 7) % 15 : 0, 'orders': ((i * 3) % 4 * share).round(), 'sales': (((i * 37) % 9) * 450 * share).round()},
      ],
      'channels': [
        {'channel': 'website', 'label': 'Website', 'orders': (21 * scale).round(), 'sales': (29800 * scale).round()},
        {'channel': 'in_chat', 'label': 'WhatsApp', 'orders': (13 * scale).round(), 'sales': (15350 * scale).round()},
        {'channel': 'in_store', 'label': 'In the shop', 'orders': (3 * scale).round(), 'sales': (3500 * scale).round()},
      ],
      'topProducts': [
        {'productId': 'p1', 'title': 'Classic white linen shirt', 'quantity': n(18), 'sales': n(26982)},
        {'productId': 'p2', 'title': 'Denim jacket', 'quantity': n(6), 'sales': n(14394)},
        {'productId': 'p3', 'title': 'Cotton kurta, indigo', 'quantity': n(5), 'sales': n(6495)},
      ],
      'carts': website ? {'left': 9, 'reminded': 7, 'cameBack': 3, 'value': 11200} : {'left': 0, 'reminded': 0, 'cameBack': 0, 'value': 0},
      'customers': [
        {'name': 'Asha Reddy', 'phone': '+919876543210', 'orders': 4, 'spent': 6120, 'last': today.toIso8601String()},
        {'name': 'Ravi Kumar', 'phone': '+919000000001', 'orders': 2, 'spent': 2998, 'last': today.toIso8601String()},
      ],
      'newCustomers': n(22), 'returningCustomers': n(9), 'repeatCustomers': n(4),
    };
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/commerce/reports':
        final from = DateTime.tryParse(query?['from'] ?? ''), to = DateTime.tryParse(query?['to'] ?? '');
        final picked = from != null && to != null ? to.difference(from).inDays + 1 : null;
        return {'report': _report(picked ?? int.tryParse(query?['days'] ?? '') ?? 30, query?['channel'], end: to)};
      case '/api/commerce/reviews':
        return {'reviews': _reviews};
      case '/api/commerce/discounts':
        return {'discounts': _offers};
      case '/api/commerce/loyalty':
        return {'settings': _loyalty};
      case '/api/commerce/returns':
        if (query?['orderId'] == 'o1') {
          return {'return': {'status': 'asked', 'reason': 'Wrong size or fit', 'note': 'Need a size L instead', 'asked_at': DateTime.now().toIso8601String()}, 'refunds': [], 'paid': 2998, 'refunded': 0, 'left': 2998, 'viaRazorpay': true};
        }
        if (query?['orderId'] != null) return {'return': null, 'refunds': [], 'paid': 0, 'refunded': 0, 'left': 0, 'viaRazorpay': false};
        return {'settings': _returns};
      case '/api/commerce/invoices':
        if (query?['orderId'] != null) return {'invoice': null, 'canIssue': true};
        return {'settings': _invoice};
      case '/api/commerce/shop-messages':
        return _shopMessagesAnswer();
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
        return {
          'account': {'igUserId': '1784', 'username': 'glowstore', 'name': 'Glow Store', 'subscribed': true, 'lastError': null},
          'automation': _igAutomation,
          'summary': {'unreadChats': 1, 'openComments': _igComments.where((c) => c['replied_at'] == null && c['private_reply_at'] == null).length},
          'login': {'appId': '', 'configId': ''},
        };
      case '/api/instagram/messages':
        return {'chats': [], 'added': 0, 'messagesOff': false, 'waitMinutes': 0, 'syncError': null};
      case '/api/instagram/comments':
        final open = query?['filter'] != 'all';
        return {'comments': _igComments.where((c) => !open || (c['replied_at'] == null && c['private_reply_at'] == null)).toList()};
      case '/api/instagram/posts':
        return {'posts': [for (var i = 1; i <= 7; i++) {'id': 'm$i', 'type': i == 2 ? 'VIDEO' : i == 4 ? 'CAROUSEL_ALBUM' : 'IMAGE', 'image': '', 'link': 'https://www.instagram.com/p/demo$i/', 'caption': 'Post $i', 'at': DateTime.now().subtract(Duration(days: i * 2)).toIso8601String()}], 'connected': true};
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
      case '/api/commerce/shop-messages' when method == 'POST':
        final def = shopAutoDefs.firstWhere((d) => d.purpose == body['purpose']);
        final m = _messages[def.purpose] as Map;
        final old = '${m['template'] ?? ''}'.isEmpty
            ? null
            : {
                'name': m['template'],
                'language': m['language'],
                'fields': m['fields'],
                if (m['previous'] is Map) 'previous': {'name': (m['previous'] as Map)['template'], 'language': (m['previous'] as Map)['language']},
              };
        final choice = submitAuto(def, body, old, _shopTemplates, () => 'st-new-${_ids++}');
        final previous = choice['previous'] as Map?;
        _messages[def.purpose] = {
          'on': m['on'],
          'template': choice['name'],
          'language': choice['language'],
          'fields': choice['fields'],
          if (previous != null) 'previous': {'template': previous['name'], 'language': previous['language']},
        };
        return {'success': true, 'setting': _messages[def.purpose], 'status': 'PENDING'};
      case '/api/commerce/shop-messages' when body.containsKey('pick'):
        final m = _messages['${body['purpose']}'] as Map;
        final pick = body['pick'] as Map?;
        _messages['${body['purpose']}'] = pick == null ? {'on': m['on'], 'template': '', 'language': 'en'} : {'on': m['on'], 'template': pick['template'], 'language': pick['language'], 'fields': pick['fields']};
        return {'success': true, 'messages': _messages};
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
        final c = _igComments.firstWhere((c) => c['comment_id'] == body['commentId'], orElse: () => <String, dynamic>{});
        if (c.isEmpty) return {'error': 'That comment is not there any more.'};
        final now = DateTime.now().toIso8601String();
        switch (body['action']) {
          case 'reply':
            c.addAll({'reply_text': body['text'], 'replied_at': now});
          case 'private':
            c.addAll({'reply_text': body['text'], 'private_reply_at': now});
          case 'hide' || 'unhide':
            c['hidden'] = body['action'] == 'hide';
          case 'delete':
            _igComments.remove(c);
        }
        return {'success': true};
      case '/api/instagram' when method == 'PUT':
        _igAutomation = Map<String, dynamic>.from(body['automation'] as Map);
        return {'success': true, 'automation': _igAutomation};
      case '/api/instagram/posts':
        return {'success': true, 'mediaId': 'm-new'};
      case '/api/instagram/photos':
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
