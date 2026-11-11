/// The demo's billing: a free trial with 9 days left, AI credit at 72%, and payments that go
/// through without Razorpay (the screen skips the payment window in the demo).
class DemoBilling {
  final DateTime _now = DateTime.now().toUtc();
  late final Map<String, dynamic> _state = {
    'configured': true,
    'exempt': false,
    'status': 'trialing',
    'hasAccess': true,
    'hasSubscription': false,
    'autoPayPending': false,
    'onTrial': true,
    'trialDays': 14,
    'trialDaysLeft': 9,
    'trialEndsAt': _now.add(const Duration(days: 9)).toIso8601String(),
    'accessUntil': _now.add(const Duration(days: 9)).toIso8601String(),
    'cancelAtPeriodEnd': false,
    'aiPercentLeft': 72,
    'aiPaused': false,
    'plan': _plans[1],
    'plans': _plans,
    'pendingPlan': null,
    'allows': {'inbox': true, 'ai_replies': true, 'tickets': true, 'campaigns': true, 'templates': true, 'flows': true, 'api': true},
    'whatsappMode': 'own',
    'messageBalance': 145.5,
    'messagePrices': {'utility': 0.115, 'authentication': 0.115, 'marketing': 0.7846, 'service': 0},
    'messageTopupOptions': [200, 500, 1000, 2000],
    'messages': [
      {'kind': 'usage', 'amount': -0.115, 'category': 'utility', 'date': _now.subtract(const Duration(hours: 2)).toIso8601String()},
      {'kind': 'topup', 'amount': 200, 'category': null, 'date': _now.subtract(const Duration(days: 4)).toIso8601String()},
    ],
    'payments': [
      {'purpose': 'ai_topup', 'amount': 1000, 'date': _now.subtract(const Duration(days: 3)).toIso8601String()},
    ],
    'topupOptions': [500, 1000, 2000, 5000],
    'minTopup': 100,
    'maxTopup': 50000,
    'razorpayKeyId': 'rzp_test_demo',
  };

  /// The same plans as lib/plans.ts on the server.
  static const _messaging = [
    'Your own WhatsApp number',
    'Team inbox with AI replies in English, Telugu and Hindi',
    'Campaigns with every Meta template type',
    'Tickets, flow builder and WhatsApp forms',
  ];
  static const _plans = [
    {
      'id': 'starter',
      'name': 'Starter',
      'tagline': 'Bookings and bills, with WhatsApp messages from our number',
      'price': 999,
      'interval': 'monthly',
      'whatsapp': 'shared',
      'features': [
        'Front Desk: bookings, walk-ins and GST bills',
        'Your own booking page with a link and QR code',
        "Booking confirmations and reminders on WhatsApp from WAMA's number",
        "WhatsApp messages at Meta's price, no extra charge",
        'Up to 3 team members',
      ],
    },
    {
      'id': 'growth',
      'name': 'Growth',
      'tagline': 'Your own WhatsApp with AI, campaigns and one connector',
      'price': 2500,
      'interval': 'monthly',
      'whatsapp': 'own',
      'features': [..._messaging, 'One connector: Front Desk, E-commerce or Sales Pipeline', '₹300 of AI credit every month', 'Ads support from our team (Google and Meta)', 'Up to 5 team members'],
    },
    {
      'id': 'pro_1',
      'name': 'Pro 1',
      'tagline': 'Everything, with ads and 2 video campaigns a month',
      'price': 6000,
      'interval': 'monthly',
      'whatsapp': 'own',
      'features': [..._messaging, 'All connectors', '₹500 of AI credit every month', 'Ads support from our team', '2 video campaigns a month made by our team', 'Up to 10 team members'],
    },
    {
      'id': 'pro_2',
      'name': 'Pro 2',
      'tagline': 'Everything, with ads and 4 video campaigns a month',
      'price': 9000,
      'interval': 'monthly',
      'whatsapp': 'own',
      'features': [..._messaging, 'All connectors', '₹1,000 of AI credit every month', 'Ads support from our team', '4 video campaigns a month made by our team', 'Up to 20 team members'],
    },
    {
      'id': 'pro_3',
      'name': 'Pro 3',
      'tagline': 'Everything, with ads and 8 video campaigns a month',
      'price': 12000,
      'interval': 'monthly',
      'whatsapp': 'own',
      'features': [..._messaging, 'All connectors', '₹1,500 of AI credit every month', 'Ads support from our team', '8 video campaigns a month made by our team', 'Unlimited team members'],
    },
  ];

  static const _groups = [
    {
      'id': 'inbox',
      'title': 'Shared WhatsApp inbox',
      'summary': 'Every customer chat in one place, answered by the right person.',
      'points': ['One WhatsApp Business number for your whole team', 'Assign chats, add notes and tickets', 'Templates, files and quick replies'],
    },
    {
      'id': 'ai',
      'title': 'AI that replies for you',
      'summary': 'Answers in English, Telugu and Hindi from your own knowledge base.',
      'points': ['Replies day and night', 'Hands over to your team when needed', 'Reply suggestions and writing help'],
    },
    {
      'id': 'campaigns',
      'title': 'Campaigns',
      'summary': 'Send approved templates to many customers and see who read them.',
      'points': ['Choose people by tags', 'Schedule for later', 'Delivered, read and replies'],
    },
  ];
  static const _useCases = [
    {
      'id': 'retail',
      'business': 'Shops and bookstores',
      'headline': '"Me daggara ee book unnaya?" answered in seconds',
      'steps': ['AI finds the product in your catalog and sends it with the price', 'Customer adds to cart and pays by UPI in the chat', 'Order updates go out on their own'],
    },
    {
      'id': 'clinics',
      'business': 'Clinics and salons',
      'headline': 'Bookings on WhatsApp, reminders on their own',
      'steps': ['Customer books in a few taps', 'A reminder goes the day of the visit', 'The bill and a feedback request after'],
    },
  ];

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    if (path != '/api/billing') return null;
    return {
      ..._state,
      if (query?['extras'] == '1') ...{'featureGroups': _groups, 'useCases': _useCases},
    };
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    switch (path) {
      case '/api/billing/subscribe':
        if (body['razorpay_payment_id'] == null) {
          return {'keyId': 'rzp_test_demo', 'subscriptionId': 'sub_demo', 'startsAt': _state['accessUntil']};
        }
        _state
          ..['status'] = 'active'
          ..['autoPayPending'] = true
          ..['hasSubscription'] = true
          ..['cancelAtPeriodEnd'] = false;
        return {'success': true};
      case '/api/billing/cancel':
        final trial = _state['autoPayPending'] == true;
        _state
          ..['status'] = trial ? 'trialing' : 'active'
          ..['autoPayPending'] = false
          ..['cancelAtPeriodEnd'] = !trial;
        return {'success': true, 'trial': trial, 'accessUntil': _state['accessUntil']};
      case '/api/billing/topup':
        if (body['razorpay_payment_id'] == null) {
          return {'keyId': 'rzp_test_demo', 'orderId': 'order_demo', 'amount': ((body['amount'] as num?) ?? 0) * 100, 'currency': 'INR'};
        }
        final amount = (body['amount'] as num?) ?? 500;
        if (body['wallet'] == 'messages') {
          _state['messageBalance'] = ((_state['messageBalance'] as num?) ?? 0) + amount;
          (_state['messages'] as List).insert(0, {'kind': 'topup', 'amount': amount, 'category': null, 'date': DateTime.now().toUtc().toIso8601String()});
          (_state['payments'] as List).insert(0, {'purpose': 'message_topup', 'amount': amount, 'date': DateTime.now().toUtc().toIso8601String()});
        } else {
          _state['aiPercentLeft'] = 100;
          (_state['payments'] as List).insert(0, {'purpose': 'ai_topup', 'amount': amount, 'date': DateTime.now().toUtc().toIso8601String()});
        }
        return {'success': true};
      case '/api/billing/change-plan':
        // The demo is on its free trial: the plan switches at once
        final plan = _plans.where((p) => p['id'] == body['plan']).firstOrNull;
        if (plan == null) return {'success': true};
        _state['plan'] = plan;
        _state['whatsappMode'] = plan['whatsapp'];
        return {'kind': 'switched', 'plan': plan['id'], 'autoPayCleared': false, 'keyId': 'rzp_test_demo'};
    }
    return null;
  }
}
