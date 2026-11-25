/// Demo answers for the screens added for launch (memberships, the Front Desk website and booking payments, online
/// payment accounts, and the AI's unanswered questions, knowledge sources and reply style), shaped like the real
/// /api/salon/memberships, /api/salon/website, /api/commerce/storefront/payments, /api/knowledge/* and /api/ai/handoff.
class DemoLaunch {
  final List<Map<String, dynamic>> _plans = [
    {'id': 'p1', 'name': 'Silver', 'price': 2999, 'validity_days': 180, 'discount_percent': 10, 'credit': 0, 'sessions': [{'service_id': 's1', 'name': 'Haircut', 'count': 4}], 'active': true},
    {'id': 'p2', 'name': 'Gold', 'price': 5999, 'validity_days': 365, 'discount_percent': 15, 'credit': 1000, 'sessions': <Map<String, dynamic>>[], 'active': true},
  ];
  final List<Map<String, dynamic>> _cards = [
    {'id': 'c1', 'card_number': 'MB-0007', 'plan': {'name': 'Gold', 'price': 5999, 'discount_percent': 15, 'credit': 1000}, 'customer_name': 'Priya Sharma', 'customer_phone': '+919876543210', 'starts_at': '2026-06-01T00:00:00Z', 'expires_at': '2027-06-01T00:00:00Z', 'credit_balance': 640, 'sessions': <Map<String, dynamic>>[], 'status': 'active', 'public_token': 'demo1'},
    {'id': 'c2', 'card_number': 'MB-0006', 'plan': {'name': 'Silver', 'price': 2999, 'discount_percent': 10, 'credit': 0}, 'customer_name': 'Kiran Rao', 'customer_phone': '+919812345678', 'starts_at': '2026-06-10T00:00:00Z', 'expires_at': '2026-12-01T00:00:00Z', 'credit_balance': 0, 'sessions': [{'service_id': 's1', 'name': 'Haircut', 'total': 4, 'used': 3}], 'status': 'active', 'public_token': 'demo2'},
    {'id': 'c3', 'card_number': 'MB-0002', 'plan': {'name': 'Silver', 'price': 2999, 'discount_percent': 10, 'credit': 0}, 'customer_name': 'Meera Joshi', 'customer_phone': '+919988776655', 'starts_at': '2025-10-01T00:00:00Z', 'expires_at': '2026-03-30T00:00:00Z', 'credit_balance': 0, 'sessions': [{'service_id': 's1', 'name': 'Haircut', 'total': 4, 'used': 4}], 'status': 'active', 'public_token': 'demo3'},
  ];
  Map<String, dynamic> _site = {
    'enabled': true, 'tagline': 'Hair, skin and bridal studio in Banjara Hills', 'about': 'Trained stylists, clean tools and products you can trust.', 'cover': '', 'gallery': <String>[],
    'colour': '#7A2E4D', 'show': {'prices': true, 'team': true, 'memberships': true, 'reviews': true}, 'instagram': 'glowstudio', 'instagramLive': true, 'chat': true,
    'bookingPay': {'mode': 'choice', 'advance': 20}, 'domainShows': 'website',
    'buttons': {'call': true, 'whatsapp': true, 'book': true, 'shop': true, 'directions': true},
  };
  Map<String, dynamic> _payments = {
    'connected': true, 'keyId': 'rzp_live_Ab12Cd34Ef', 'live': true, 'webhook': true, 'webhookUrl': 'https://wamacrm.magnetora.in/api/public/store/glow/razorpay-webhook',
    'stripe': {'connected': false, 'key': null, 'live': false, 'webhook': false, 'webhookUrl': 'https://wamacrm.magnetora.in/api/public/store/glow/stripe-webhook'},
    'gateways': ['razorpay'], 'use': 'razorpay',
  };
  final List<Map<String, dynamic>> _gaps = [
    {'id': 'g1', 'question': 'Do you do keratin treatment for short hair?', 'asked_count': 4, 'status': 'open', 'last_asked_at': '2026-11-20T10:12:00Z'},
    {'id': 'g2', 'question': 'Is parking available near the shop?', 'asked_count': 2, 'status': 'open', 'last_asked_at': '2026-11-19T15:40:00Z'},
  ];
  final List<Map<String, dynamic>> _sources = [
    {'id': 'k1', 'kind': 'website', 'title': 'glowstudio.in', 'url': 'https://glowstudio.in', 'status': 'ready', 'chunk_count': 18, 'page_count': 6, 'error': null, 'created_at': '2026-11-18T09:00:00Z'},
    {'id': 'k2', 'kind': 'pdf', 'title': 'Price list 2026', 'file_name': 'price-list.pdf', 'status': 'ready', 'chunk_count': 7, 'page_count': 3, 'error': null, 'created_at': '2026-11-18T09:05:00Z'},
    {'id': 'k3', 'kind': 'text', 'title': 'Cancellation policy', 'status': 'processing', 'chunk_count': 0, 'error': null, 'created_at': '2026-11-21T08:00:00Z'},
  ];
  Map<String, dynamic> _handoff = {'pauseAi': true, 'resumeOnResolve': true, 'keepAiWhenUnsure': false, 'message': ''};
  Map<String, dynamic> _style = {'tone': 'friendly', 'emoji': true, 'buttons': true, 'typing': true};
  var _seq = 8;

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/salon/memberships':
        final view = query?['view'] ?? 'cards';
        if (view == 'plans') return {'plans': _plans};
        if (view == 'card') {
          final card = _cards.firstWhere((c) => c['id'] == query?['id'], orElse: () => _cards.first);
          return {
            'card': card,
            'link': 'https://wamacrm.magnetora.in/m/${card['public_token']}',
            'usage': [
              {'id': 'u1', 'kind': 'credit', 'amount': 360, 'sessions': 0, 'detail': 'Bill GLOW-0041', 'created_at': '2026-11-12T11:00:00Z'},
              {'id': 'u0', 'kind': 'sale', 'amount': 5999, 'sessions': 0, 'detail': 'Gold sold', 'created_at': '2026-06-01T10:00:00Z'},
            ],
          };
        }
        final q = (query?['q'] ?? '').toLowerCase();
        return {'cards': _cards.where((c) => q.isEmpty || '${c['customer_name']} ${c['card_number']} ${c['customer_phone']}'.toLowerCase().contains(q)).toList()};
      case '/api/salon/website':
        return {'site': _site, 'slug': 'glow', 'storeOn': true, 'domain': null, 'instagram': {'connected': true, 'username': 'glowstudio'}, 'chatProblem': null};
      case '/api/commerce/storefront/payments':
        return _payments;
      case '/api/knowledge/gaps':
        return {'gaps': _gaps.where((g) => g['status'] == (query?['status'] ?? 'open')).toList()};
      case '/api/knowledge/sources':
        return {'sources': _sources};
      case '/api/ai/handoff':
        return {'settings': _handoff, 'style': _style};
    }
    return null;
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    path = path.split('?').first;
    if (path == '/api/salon/memberships') {
      final action = Map<String, dynamic>.from(body['action'] as Map? ?? const {});
      switch (action['type']) {
        case 'save_plan':
          final plan = Map<String, dynamic>.from(action['plan'] as Map);
          plan['id'] ??= 'p${_seq++}';
          plan['active'] ??= true;
          _plans.removeWhere((p) => p['id'] == plan['id']);
          _plans.add(plan);
          return {'plan': plan};
        case 'plan_active':
          final plan = _plans.firstWhere((p) => p['id'] == action['plan_id']);
          plan['active'] = action['active'] != false;
          return {'plan': plan};
        case 'send_card':
          return {'whatsapp': {'sent': true}};
      }
      return {'error': 'Unknown action.'};
    }
    if (path == '/api/salon/act' && (body['action'] as Map?)?['type'] == 'sell_membership') {
      final action = Map<String, dynamic>.from(body['action'] as Map);
      final plan = _plans.firstWhere((p) => p['id'] == action['plan_id'], orElse: () => _plans.first);
      final customer = Map<String, dynamic>.from(action['customer'] as Map? ?? const {});
      final card = {
        'id': 'c${_seq++}', 'card_number': 'MB-00${_seq.toString().padLeft(2, '0')}', 'plan': {'name': plan['name'], 'price': plan['price'], 'discount_percent': plan['discount_percent'], 'credit': plan['credit']},
        'customer_name': customer['name'] ?? 'Customer', 'customer_phone': customer['phone'],
        'starts_at': DateTime.now().toUtc().toIso8601String(), 'expires_at': DateTime.now().toUtc().add(Duration(days: (plan['validity_days'] as num).toInt())).toIso8601String(),
        'credit_balance': plan['credit'], 'sessions': [for (final s in plan['sessions'] as List) {'service_id': (s as Map)['service_id'], 'name': s['name'], 'total': s['count'], 'used': 0}],
        'status': 'active', 'public_token': 'demo$_seq',
      };
      _cards.insert(0, card);
      return {'success': true, 'membership': card, 'message': 'Sold ${plan['name']} to ${card['customer_name']}'};
    }
    switch (path) {
      case '/api/salon/website':
        _site = Map<String, dynamic>.from(body['site'] as Map);
        return {'success': true, 'site': _site, 'slug': 'glow', 'storeOn': true, 'domain': null};
      case '/api/commerce/storefront/payments':
        if (body['use'] != null) _payments = {..._payments, 'use': body['use']};
        if (body['gateway'] == 'stripe') {
          _payments = {..._payments, 'stripe': {'connected': true, 'key': 'sk_test_…9f3a', 'live': false, 'webhook': body['webhookSecret'] != null, 'webhookUrl': (_payments['stripe'] as Map)['webhookUrl']}, 'gateways': ['razorpay', 'stripe']};
        }
        if (method == 'DELETE') return _payments;
        return {'success': true, ..._payments};
      case '/api/knowledge/gaps':
        final gap = _gaps.firstWhere((g) => g['id'] == body['id'], orElse: () => const {});
        if (body['action'] == 'draft') return {'draft': {'title': gap['question'], 'content': 'Yes, we do keratin for short hair. It takes about [time] and costs [price]. Book a visit on our website.'}, 'fromTeam': false};
        if (gap.isNotEmpty) gap['status'] = body['action'] == 'answered' ? 'answered' : 'ignored';
        return {'success': true};
      case '/api/knowledge/sources':
        if (method == 'DELETE') return {'success': true};
        final source = {
          'id': 'k${_seq++}', 'kind': body['kind'] == 'file' ? 'pdf' : body['kind'], 'title': body['title'] ?? body['url'] ?? body['fileName'] ?? 'New', 'url': body['url'],
          'status': 'processing', 'chunk_count': 0, 'error': null, 'created_at': DateTime.now().toUtc().toIso8601String(),
        };
        _sources.insert(0, source);
        return {'source': source};
      case '/api/knowledge/upload-url':
        return {'path': 'knowledge/demo/sources/${body['fileName']}', 'token': 'demo', 'bucket': 'media-attachments'};
      case '/api/ai/handoff':
        _handoff = Map<String, dynamic>.from(body['settings'] as Map? ?? _handoff);
        if (body['style'] != null) _style = Map<String, dynamic>.from(body['style'] as Map);
        return {'success': true, 'settings': _handoff, 'style': _style};
    }
    return null;
  }
}
