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
    'plan': {
      'name': 'WAMA CRM Pro',
      'price': 3000,
      'interval': 'month',
      'features': ['Shared WhatsApp inbox', 'AI replies', 'Campaigns', 'Front Desk', 'Sales Pipeline'],
    },
    'payments': [
      {'purpose': 'AI credit', 'amount': 1000, 'date': _now.subtract(const Duration(days: 3)).toIso8601String()},
    ],
    'topupOptions': [500, 1000, 2000, 5000],
    'minTopup': 100,
    'maxTopup': 50000,
    'razorpayKeyId': 'rzp_test_demo',
  };

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
        _state['aiPercentLeft'] = 100;
        (_state['payments'] as List).insert(0, {'purpose': 'AI credit', 'amount': 1000, 'date': DateTime.now().toUtc().toIso8601String()});
        return {'success': true};
    }
    return null;
  }
}
