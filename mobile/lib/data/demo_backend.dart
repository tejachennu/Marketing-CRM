import 'dart:async';

import 'backend.dart';
import 'format.dart';

/// Sample data that answers like the real server, so every screen can be tried and shown
/// without an account. Changes made in the demo stay until the app is closed.
class DemoBackend implements Backend {
  DemoBackend({this.offline = false}) {
    _seed();
    _seedMore();
  }

  /// Pretend there is no internet (to show the offline screens).
  bool offline;
  bool _signedIn = true;
  int _seq = 100;

  late Map<String, dynamic> _setup;
  late List<Map<String, dynamic>> _appointments;
  late List<Map<String, dynamic>> _requests;
  late List<Map<String, dynamic>> _invoices;
  late List<Map<String, dynamic>> _contacts;
  late List<Map<String, dynamic>> _conversations;
  late Map<String, List<Map<String, dynamic>>> _messages;
  late List<Map<String, dynamic>> _templates;
  late List<Map<String, dynamic>> _campaigns;
  late List<Map<String, dynamic>> _articles;
  late List<Map<String, dynamic>> _tickets;
  final List<Map<String, dynamic>> _playground = [];
  final Map<String, String> _codes = {};

  String _id() => '00000000-0000-4000-8000-${(++_seq).toString().padLeft(12, '0')}';

  void _seed() {
    final now = DateTime.now();
    String at(int hour, int minute, [int dayOffset = 0]) {
      final ist = istNow().add(Duration(days: dayOffset));
      return DateTime.utc(ist.year, ist.month, ist.day, hour, minute).subtract(const Duration(hours: 5, minutes: 30)).toIso8601String();
    }

    final services = [
      {'id': 's-haircut', 'category': 'Hair', 'name': 'Haircut (Women)', 'price': 600, 'duration_minutes': 45, 'tax_rate': 18, 'active': true},
      {'id': 's-menscut', 'category': 'Hair', 'name': 'Haircut (Men)', 'price': 300, 'duration_minutes': 30, 'tax_rate': 18, 'active': true},
      {'id': 's-colour', 'category': 'Hair', 'name': 'Global hair colour', 'price': 2500, 'duration_minutes': 120, 'tax_rate': 18, 'active': true},
      {'id': 's-spa', 'category': 'Hair', 'name': 'Hair spa', 'price': 1200, 'duration_minutes': 60, 'tax_rate': 18, 'active': true},
      {'id': 's-facial', 'category': 'Skin', 'name': 'Gold facial', 'price': 1500, 'duration_minutes': 60, 'tax_rate': 18, 'active': true},
      {'id': 's-cleanup', 'category': 'Skin', 'name': 'Clean-up', 'price': 700, 'duration_minutes': 40, 'tax_rate': 18, 'active': true},
      {'id': 's-threading', 'category': 'Skin', 'name': 'Threading', 'price': 80, 'duration_minutes': 15, 'tax_rate': 18, 'active': true},
      {'id': 's-mani', 'category': 'Nails', 'name': 'Manicure', 'price': 500, 'duration_minutes': 40, 'tax_rate': 18, 'active': true},
      {'id': 's-pedi', 'category': 'Nails', 'name': 'Pedicure', 'price': 650, 'duration_minutes': 45, 'tax_rate': 18, 'active': true},
    ];
    _setup = {
      'settings': {
        'business_name': 'Glow Salon',
        'gstin': '36ABCDE1234F1Z5',
        'prices_include_tax': true,
        'invoice_prefix': 'GLOW',
        'service_categories': ['Hair', 'Skin', 'Nails'],
        'phone': '+919876500000',
        'booking_flow': {
          'enabled': true,
          'multi_select': true,
          'steps': [
            {'id': 's1', 'type': 'choice', 'text': 'Is this your first visit?', 'label': 'First visit', 'options': ['Yes', 'No']},
            {'id': 's2', 'type': 'services'},
            {'id': 's3', 'type': 'text', 'text': 'Any allergies we should know about?', 'label': 'Allergies'},
            {'id': 's4', 'type': 'staff'},
            {'id': 's5', 'type': 'message', 'text': 'Please come 10 minutes early.'},
            {'id': 's6', 'type': 'datetime'},
          ],
        },
      },
      'services': services,
      'staff': [
        {'id': 'st-anitha', 'name': 'Anitha', 'active': true, 'service_ids': []},
        {'id': 'st-lakshmi', 'name': 'Lakshmi', 'active': true, 'service_ids': []},
        {
          'id': 'st-ravi',
          'name': 'Ravi',
          'active': true,
          'service_ids': ['s-menscut', 's-colour', 's-spa'],
        },
      ],
    };
    Map<String, dynamic> line(String id, String staff) {
      final s = services.firstWhere((x) => x['id'] == id);
      return {
        'service_id': id,
        'name': s['name'],
        'price': s['price'],
        'duration_minutes': s['duration_minutes'],
        'tax_rate': 18,
        'staff_id': staff,
        'staff_name': staff == 'st-anitha'
            ? 'Anitha'
            : staff == 'st-ravi'
            ? 'Ravi'
            : 'Lakshmi',
      };
    }

    _appointments = [
      {
        'id': _id(),
        'customer_name': 'Priya Sharma',
        'customer_phone': '+919876543210',
        'staff_id': 'st-anitha',
        'starts_at': at(10, 30),
        'ends_at': at(11, 30),
        'status': 'completed',
        'services': [line('s-facial', 'st-anitha')],
        'invoice_id': 'inv-1',
        'source': 'counter',
      },
      {
        'id': _id(),
        'customer_name': 'Rahul Verma',
        'customer_phone': '+919812345678',
        'staff_id': 'st-ravi',
        'starts_at': at(12, 0),
        'ends_at': at(12, 30),
        'status': 'in_service',
        'services': [line('s-menscut', 'st-ravi')],
        'source': 'counter',
      },
      {
        'id': _id(),
        'customer_name': 'Sneha Reddy',
        'customer_phone': '+919900112233',
        'staff_id': 'st-lakshmi',
        'starts_at': at(13, 30),
        'ends_at': at(14, 25),
        'status': 'arrived',
        'services': [line('s-mani', 'st-lakshmi'), line('s-threading', 'st-lakshmi')],
        'source': 'chat',
      },
      {
        'id': _id(),
        'customer_name': 'Kavya Iyer',
        'customer_phone': '+919845098450',
        'staff_id': 'st-anitha',
        'starts_at': at(16, 0),
        'ends_at': at(18, 0),
        'status': 'booked',
        'services': [line('s-colour', 'st-anitha')],
        'source': 'chat',
      },
      {
        'id': _id(),
        'customer_name': 'Arjun Nair',
        'customer_phone': '+971501234567',
        'staff_id': 'st-ravi',
        'starts_at': at(18, 30),
        'ends_at': at(19, 30),
        'status': 'booked',
        'services': [line('s-spa', 'st-ravi')],
        'source': 'counter',
      },
    ];
    _requests = [
      {
        'id': _id(),
        'customer_name': 'Meera Joshi',
        'customer_phone': '+919988776655',
        'starts_at': at(11, 0, 1),
        'ends_at': at(12, 0, 1),
        'status': 'requested',
        'services': [line('s-facial', 'st-lakshmi')],
        'source': 'chat',
      },
    ];
    _invoices = [
      {
        'id': 'inv-1',
        'number': 'GLOW-0042',
        'customer_name': 'Priya Sharma',
        'customer_phone': '+919876543210',
        'total': 1500,
        'status': 'paid',
        'payment_method': 'upi',
        'issued_at': at(11, 32),
        'items': [line('s-facial', 'st-anitha')],
      },
      {
        'id': 'inv-2',
        'number': 'GLOW-0041',
        'customer_name': 'Walk-in customer',
        'customer_phone': null,
        'total': 380,
        'status': 'paid',
        'payment_method': 'cash',
        'issued_at': at(10, 5),
        'items': [line('s-menscut', 'st-ravi'), line('s-threading', 'st-lakshmi')],
      },
      {
        'id': 'inv-3',
        'number': 'GLOW-0040',
        'customer_name': 'Divya Menon',
        'customer_phone': '+919123456780',
        'total': 3200,
        'status': 'unpaid',
        'payment_method': null,
        'issued_at': at(19, 40, -1),
        'items': [line('s-colour', 'st-anitha'), line('s-cleanup', 'st-lakshmi')],
      },
      {
        'id': 'inv-4',
        'number': 'GLOW-0039',
        'customer_name': 'Farhan Ali',
        'customer_phone': '+919000011111',
        'total': 650,
        'status': 'void',
        'payment_method': null,
        'issued_at': at(17, 10, -1),
        'items': [line('s-pedi', 'st-lakshmi')],
      },
    ];
    final people = [
      ['Priya', 'Sharma', '+919876543210', 'VIP'],
      ['Rahul', 'Verma', '+919812345678', ''],
      ['Sneha', 'Reddy', '+919900112233', 'Regular'],
      ['Kavya', 'Iyer', '+919845098450', 'VIP'],
      ['Arjun', 'Nair', '+971501234567', 'NRI'],
      ['Meera', 'Joshi', '+919988776655', 'New'],
      ['Divya', 'Menon', '+919123456780', 'Regular'],
      ['Farhan', 'Ali', '+919000011111', ''],
      ['Ananya', 'Rao', '+919555512345', 'Regular'],
      ['Vikram', 'Singh', '+919444455555', ''],
      ['Lakshmi', 'Prasad', '+919333344444', 'Regular'],
      ['Sameer', 'Khan', '+14155550123', 'NRI'],
    ];
    _contacts = [
      for (final p in people)
        {
          'id': _id(),
          'first_name': p[0],
          'last_name': p[1],
          'phone_number': p[2],
          'email': '${p[0].toLowerCase()}@mail.com',
          'tags': p[3].isEmpty ? [] : [p[3]],
          'created_at': now.subtract(Duration(days: people.indexOf(p) * 3)).toIso8601String(),
        },
    ];
    Map<String, dynamic> conv(int i, String last, int minutesAgo, int unread, {bool fromCustomer = true}) {
      final c = _contacts[i];
      return {
        'id': 'conv-$i',
        'contact': c,
        'unread_count': unread,
        'auto_reply_enabled': i != 3,
        'last_message_at': now.subtract(Duration(minutes: minutesAgo)).toIso8601String(),
        'last_message': {'body': last, 'sender_type': fromCustomer ? 'contact' : 'user', 'created_at': now.subtract(Duration(minutes: minutesAgo)).toIso8601String()},
      };
    }

    _conversations = [
      conv(5, 'Can I book a facial tomorrow at 11?', 4, 2),
      conv(0, 'Thank you! Loved the facial 😊', 38, 0),
      conv(3, 'Is 4 pm still fine for my colour?', 95, 1),
      conv(4, 'Booked for 6:30 pm. See you!', 180, 0, fromCustomer: false),
      conv(2, 'What are your timings on Sunday?', 60 * 26, 0),
      conv(6, 'Please send my bill again', 60 * 50, 0),
    ];
    List<Map<String, dynamic>> thread(List<List<dynamic>> rows) => [
      for (final r in rows) {'id': _id(), 'body': r[1], 'sender_type': r[0], 'created_at': now.subtract(Duration(minutes: r[2] as int)).toIso8601String(), 'status': r[0] == 'user' ? 'read' : null},
    ];
    _messages = {
      'conv-5': thread([
        ['contact', 'Hi, do you have a gold facial?', 30],
        ['user', 'Yes! Gold facial is ₹1,500 and takes about an hour. Which day suits you?', 28],
        ['contact', 'Can I book a facial tomorrow at 11?', 4],
      ]),
      'conv-0': thread([
        ['user', 'Hi Priya, thank you for visiting Glow Salon! 🙏 Your bill GLOW-0042: ₹1,500 (paid, thank you!)', 45],
        ['contact', 'Thank you! Loved the facial 😊', 38],
      ]),
      'conv-2': thread([
        ['contact', 'What are your timings on Sunday?', 60 * 26],
      ]),
    };
    String body(String text) => text;
    _templates = [
      {
        'id': 't1',
        'name': 'bill_ready',
        'status': 'APPROVED',
        'category': 'UTILITY',
        'language': 'en',
        'components': [
          {'type': 'BODY', 'text': body('Hi {{1}}, thank you for visiting {{2}}! Your bill {{3}} is {{4}}. Tap below to view or download it.')},
          {
            'type': 'BUTTONS',
            'buttons': [
              {'type': 'URL', 'text': 'View bill'},
            ],
          },
        ],
      },
      {
        'id': 't2',
        'name': 'booking_confirmed',
        'status': 'APPROVED',
        'category': 'UTILITY',
        'language': 'en',
        'components': [
          {'type': 'BODY', 'text': 'Hi {{1}}, your appointment at {{2}} is booked for {{3}}. See you soon!'},
        ],
      },
      {
        'id': 't3',
        'name': 'visit_reminder_te',
        'status': 'APPROVED',
        'category': 'UTILITY',
        'language': 'te',
        'components': [
          {'type': 'BODY', 'text': 'నమస్తే {{1}}, ఈరోజు {{2}} కి మీ అపాయింట్‌మెంట్ ఉంది. త్వరలో కలుద్దాం!'},
        ],
      },
      {
        'id': 't4',
        'name': 'diwali_offer',
        'status': 'APPROVED',
        'category': 'MARKETING',
        'language': 'en',
        'components': [
          {'type': 'HEADER', 'format': 'TEXT', 'text': 'Diwali glow offer ✨'},
          {'type': 'BODY', 'text': 'Hi {{1}}, get 20% off on all facials and hair spa till 15 Nov. Book on WhatsApp now!'},
          {'type': 'FOOTER', 'text': 'Reply STOP to opt out'},
        ],
      },
      {
        'id': 't5',
        'name': 'feedback_request',
        'status': 'PENDING',
        'category': 'UTILITY',
        'language': 'en',
        'components': [
          {'type': 'BODY', 'text': 'Hi {{1}}, how was your visit to {{2}}? Tap below to rate us. It takes less than a minute.'},
        ],
      },
      {
        'id': 't6',
        'name': 'flash_sale',
        'status': 'REJECTED',
        'category': 'MARKETING',
        'language': 'en',
        'rejected_reason': 'The message looks like spam. Add your business name and a clear offer.',
        'components': [
          {'type': 'BODY', 'text': 'HURRY!!! Sale today only!!!'},
        ],
      },
    ];
    _campaigns = [
      {
        'id': 'c1',
        'name': 'Diwali glow offer',
        'channel': 'whatsapp',
        'status': 'COMPLETED',
        'template_name': 'diwali_offer',
        'total_contacts': 250,
        'sent_count': 246,
        'delivered_count': 238,
        'read_count': 171,
        'failed_count': 4,
        'created_at': now.subtract(const Duration(days: 6)).toIso8601String(),
      },
      {
        'id': 'c2',
        'name': 'Sunday hair spa',
        'channel': 'whatsapp',
        'status': 'SCHEDULED',
        'template_name': 'diwali_offer',
        'total_contacts': 120,
        'sent_count': 0,
        'scheduled_at': now.add(const Duration(days: 2)).toIso8601String(),
        'created_at': now.subtract(const Duration(hours: 5)).toIso8601String(),
      },
      {
        'id': 'c3',
        'name': 'VIP thank you',
        'channel': 'whatsapp',
        'status': 'RUNNING',
        'template_name': 'bill_ready',
        'total_contacts': 40,
        'sent_count': 26,
        'delivered_count': 24,
        'read_count': 12,
        'failed_count': 0,
        'created_at': now.subtract(const Duration(minutes: 20)).toIso8601String(),
      },
      {
        'id': 'c4',
        'name': 'Monsoon special',
        'channel': 'whatsapp',
        'status': 'FAILED',
        'template_name': 'flash_sale',
        'total_contacts': 90,
        'sent_count': 0,
        'failed_count': 90,
        'created_at': now.subtract(const Duration(days: 21)).toIso8601String(),
      },
    ];
  }

  void _seedMore() {
    final now = DateTime.now();
    _articles = [
      {
        'id': 'kb1',
        'type': 'manual',
        'title': 'Timings',
        'content': 'We are open 10 am to 9 pm, Monday to Saturday. Closed on Sundays.',
        'created_at': now.subtract(const Duration(days: 20)).toIso8601String(),
      },
      {
        'id': 'kb2',
        'type': 'manual',
        'title': 'Parking',
        'content': 'Free parking for two-wheelers in front. Car parking in the basement of the same building.',
        'created_at': now.subtract(const Duration(days: 14)).toIso8601String(),
      },
      {
        'id': 'kb3',
        'type': 'manual',
        'title': 'Gold facial',
        'content': 'Gold facial costs ₹1,500 and takes about 60 minutes. Good for dull skin. Not advised for very sensitive skin.',
        'created_at': now.subtract(const Duration(days: 9)).toIso8601String(),
      },
      {
        'id': 'kb4',
        'type': 'manual',
        'title': 'Cancellation',
        'content': 'Please tell us 2 hours before if you cannot come. No charge for cancelling.',
        'created_at': now.subtract(const Duration(days: 3)).toIso8601String(),
      },
      {
        'id': 'kb5',
        'type': 'manual',
        'title': 'Payment',
        'content': 'We take UPI, cards and cash. GST bill is sent on WhatsApp after every visit.',
        'created_at': now.subtract(const Duration(days: 1)).toIso8601String(),
      },
    ];
    _tickets = [
      {
        'id': 'tk1',
        'conversation_id': 'conv-6',
        'status': 'open',
        'title': 'Bill not received',
        'description': 'Customer says the bill did not come on WhatsApp.',
        'priority': 'medium',
        'created_at': now.subtract(const Duration(hours: 30)).toIso8601String(),
      },
    ];
  }

  Future<void> _wait() async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (offline) throw OfflineException();
  }

  @override
  bool get signedIn => _signedIn;

  @override
  Future<void> signIn(String email, String password) async {
    await _wait();
    _signedIn = true;
  }

  @override
  Future<void> signOut() async => _signedIn = false;

  @override
  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) async {
    await _wait();
    switch (path) {
      case '/api/mobile/me':
        return {
          'user': {'id': 'u1', 'name': 'Teja', 'email': 'owner@glowsalon.in', 'role': 'Admin'},
          'organization': {'id': 'org-demo', 'name': 'Glow Salon', 'currency': 'INR'},
          'can': {'write': true, 'manage': true, 'campaigns': true, 'seeAll': true},
          'connectors': {'frontDesk': true},
        };
      case '/api/salon/setup':
        return {'success': true, ..._setup};
      case '/api/salon/appointments':
        return {'success': true, 'appointments': _appointments, 'requests': _requests, 'invoices': _invoices.where((i) => _appointments.any((a) => a['invoice_id'] == i['id'])).toList()};
      case '/api/salon/invoices':
        final paid = _invoices.where((i) => i['status'] == 'paid');
        return {
          'success': true,
          'invoices': _invoices,
          'summary': {
            'collected': paid.fold<num>(0, (s, i) => s + (i['total'] as num)),
            'billed': _invoices.where((i) => i['status'] != 'void').fold<num>(0, (s, i) => s + (i['total'] as num)),
            'bills': _invoices.where((i) => i['status'] != 'void').length,
            'paidCount': paid.length,
          },
        };
      case '/api/contacts':
        return {'success': true, 'contacts': _contacts, 'count': _contacts.length};
      case '/api/conversations':
        return {'success': true, 'conversations': _conversations};
      case '/api/messages':
        return {'success': true, 'messages': _messages[query?['conversationId']] ?? []};
      case '/api/whatsapp-templates':
        return {'templates': _templates};
      case '/api/campaigns':
        return {'success': true, 'campaigns': _campaigns};
      case '/api/knowledge':
        return {'articles': _articles};
      case '/api/tickets':
        return {'success': true, 'tickets': _tickets.where((t) => t['status'] == 'open').toList()};
    }
    throw ApiException(404, 'Not in the demo: $path');
  }

  @override
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename) async {
    await _wait();
    return {'success': true, 'url': 'https://example.com/demo/$filename', 'filename': filename};
  }

  @override
  Future<Map<String, dynamic>> send(String method, String path, Map<String, dynamic> body) async {
    await _wait();
    if (path.startsWith('/api/knowledge?id=')) {
      _articles.removeWhere((a) => a['id'] == Uri.parse(path).queryParameters['id']);
      return {'success': true};
    }
    switch (path) {
      case '/api/salon/act':
        return _act(Map<String, dynamic>.from(body['action'] as Map));
      case '/api/contacts':
        final contact = {
          'id': _id(),
          'first_name': body['firstName'],
          'last_name': body['lastName'],
          'phone_number': body['phoneNumber'],
          'email': body['email'],
          'tags': body['tags'] ?? [],
          'created_at': DateTime.now().toIso8601String(),
        };
        _contacts.insert(0, contact);
        return {'success': true, 'contact': contact};
      case '/api/messages/send':
        final list = _messages.putIfAbsent(body['conversationId'], () => []);
        final message = {'id': _id(), 'body': body['message'], 'sender_type': 'user', 'created_at': DateTime.now().toIso8601String(), 'status': 'sent'};
        list.add(message);
        return {'success': true, 'message': message};
      case '/api/campaigns':
        final campaign = {
          'id': _id(),
          'name': body['name'],
          'channel': 'whatsapp',
          'status': body['scheduledAt'] != null ? 'SCHEDULED' : 'PENDING',
          'template_name': body['templateName'],
          'total_contacts': (body['audience'] as List).length,
          'sent_count': 0,
          'created_at': DateTime.now().toIso8601String(),
          'scheduled_at': body['scheduledAt'],
        };
        _campaigns.insert(0, campaign);
        return {'success': true, 'campaign': campaign};
      case '/api/conversations':
        final conv = _conversations.firstWhere((c) => c['id'] == body['conversationId'], orElse: () => throw ApiException(404, 'That chat is not there any more.'));
        if (body['autoReply'] is bool) conv['auto_reply_enabled'] = body['autoReply'];
        if (body['read'] == true) conv['unread_count'] = 0;
        return {
          'success': true,
          'conversation': {'id': conv['id'], 'auto_reply_enabled': conv['auto_reply_enabled'], 'unread_count': conv['unread_count']},
        };
      case '/api/ai/copilot':
        return {
          'suggestions': [
            {'text': 'Yes, tomorrow at 11 am is free for a gold facial (₹1,500, about an hour). Shall I book it for you?', 'article_title': 'Gold facial'},
            {'text': 'Sure! Tomorrow we have 11:00 am and 11:30 am free. Which one suits you?', 'article_title': null},
            {'text': 'Happy to help! Could you share your name so I can book the facial for tomorrow at 11?', 'article_title': null},
          ],
        };
      case '/api/ai/rephrase':
        final text = '${body['text']}'.trim();
        return {
          'rephrased': switch (body['tone']) {
            'professional' => 'Thank you for reaching out. ${text[0].toUpperCase()}${text.substring(1)}${text.endsWith('.') ? '' : '.'} Please let us know if you need anything else.',
            'friendly' => 'Hi! 😊 $text Happy to help!',
            'short' => text.split(RegExp(r'[.!?]')).first.trim(),
            _ => '${text[0].toUpperCase()}${text.substring(1)}${RegExp(r'[.!?]$').hasMatch(text) ? '' : '.'}',
          },
          'tone': body['tone'],
        };
      case '/api/tickets':
        final ticket = _tickets.firstWhere((t) => t['id'] == body['ticketId'], orElse: () => throw ApiException(404, 'That ticket is not there any more.'));
        if (body['status'] != null) ticket['status'] = body['status'];
        return {'success': true, 'ticket': ticket};
      case '/api/knowledge':
        if (method == 'POST') {
          final article = {'id': _id(), 'type': 'manual', 'title': body['title'], 'content': body['content'], 'created_at': DateTime.now().toIso8601String()};
          _articles.insert(0, article);
          return {'success': true, 'article': article};
        }
        final article = _articles.firstWhere((a) => a['id'] == body['id'], orElse: () => throw ApiException(404, 'That answer is not there any more.'));
        article['title'] = body['title'];
        article['content'] = body['content'];
        return {'success': true, 'article': article};
      case '/api/ai/playground-chat':
        final question = '${body['message']}'.toLowerCase();
        final match = _articles.cast<Map<String, dynamic>?>().firstWhere(
          (a) => question.split(RegExp(r'\W+')).any((w) => w.length > 3 && '${a!['title']} ${a['content']}'.toLowerCase().contains(w)),
          orElse: () => null,
        );
        final reply = match == null ? "I'm not sure about that. Let me connect you with our team, they will reply shortly." : '${match['content']}';
        _playground.addAll([
          {'role': 'user', 'content': body['message']},
          {'role': 'assistant', 'content': reply},
        ]);
        return {
          'sessionId': 'demo-session',
          'reply': reply,
          'isRiseTicket': match == null,
          'matchedFaqs': match == null ? [] : [match],
        };
      case '/api/salon/booking-flow/draft':
        return {
          'success': true,
          'notes': [],
          'draft': {
            'welcome': "Hi {name}! Welcome to {business}. Let's book your visit.",
            'steps': [
              {
                'id': 's1',
                'type': 'choice',
                'text': 'Is this your first visit?',
                'label': 'First visit',
                'options': ['Yes', 'No'],
              },
              {'id': 's2', 'type': 'services'},
              {'id': 's3', 'type': 'text', 'text': 'Any allergies we should know about?', 'label': 'Allergies'},
              {'id': 's4', 'type': 'staff'},
              {'id': 's5', 'type': 'message', 'text': 'Please come 10 minutes early.'},
              {'id': 's6', 'type': 'datetime'},
            ],
          },
        };
      case '/api/salon/settings':
        final settings = Map<String, dynamic>.from(_setup['settings']);
        for (final key in ['booking_flow', 'auto_approve_bookings', 'chat_assistant']) {
          if (body.containsKey(key)) settings[key] = body[key];
        }
        _setup['settings'] = settings;
        return {'success': true, 'settings': settings};
      case '/api/auth/signup/send-code':
        if ('${body['email']}'.isEmpty || !'${body['email']}'.contains('@')) throw ApiException(400, 'Please enter a valid email address');
        if ('${body['password']}'.length < 6) throw ApiException(400, 'Password must be at least 6 characters long');
        _codes['${body['email']}'] = '123456';
        return {'success': true, 'sentTo': body['email'], 'expiresInMinutes': 10, 'resendAfterSeconds': 60};
      case '/api/auth/signup':
        if (_codes['${body['email']}'] != body['code']) throw ApiException(400, 'That code is not right. 4 tries left.');
        _codes.remove('${body['email']}');
        return {'success': true, 'message': 'Account created successfully'};
      case '/api/campaigns/run':
        final c = _campaigns.firstWhere((c) => c['id'] == body['campaignId'], orElse: () => {});
        if (c.isNotEmpty) c['status'] = 'RUNNING';
        return {'success': true};
    }
    throw ApiException(404, 'Not in the demo: $path');
  }

  Map<String, dynamic> _act(Map<String, dynamic> action) {
    final services = List<Map<String, dynamic>>.from(_setup['services']);
    List<Map<String, dynamic>> lines(List ids) => [for (final id in ids) Map<String, dynamic>.from(services.firstWhere((s) => s['id'] == id))];
    Map<String, dynamic> apptById(String id) => [..._appointments, ..._requests].firstWhere((a) => a['id'] == id, orElse: () => throw ApiException(404, 'That appointment is not there any more.'));
    Map<String, dynamic> bill(String name, String? phone, List<Map<String, dynamic>> items, String? method) {
      final total = items.fold<num>(0, (s, i) => s + (i['price'] as num));
      final invoice = {
        'id': _id(),
        'number': 'GLOW-${(_invoices.length + 39).toString().padLeft(4, '0')}',
        'customer_name': name,
        'customer_phone': phone,
        'total': total,
        'status': method == null ? 'unpaid' : 'paid',
        'payment_method': method,
        'issued_at': DateTime.now().toUtc().toIso8601String(),
        'items': items,
      };
      _invoices.insert(0, invoice);
      return invoice;
    }

    switch (action['type']) {
      case 'walk_in_bill':
        final c = Map<String, dynamic>.from(action['customer'] ?? {});
        final invoice = bill(c['name'] ?? 'Walk-in customer', c['phone'], lines(action['service_ids']), action['payment_method']);
        return {'success': true, 'invoice': invoice, 'message': 'Billed ${invoice['customer_name']}: ${formatRupees(invoice['total'])}'};
      case 'create_appointment':
        final c = Map<String, dynamic>.from(action['customer'] ?? {});
        final items = lines(action['service_ids']);
        final start = DateTime.parse(action['starts_at']);
        final minutes = items.fold<int>(0, (s, i) => s + (i['duration_minutes'] as int));
        final appt = {
          'id': _id(),
          'customer_name': c['name'],
          'customer_phone': c['phone'],
          'staff_id': action['staff_id'],
          'starts_at': start.toUtc().toIso8601String(),
          'ends_at': start.add(Duration(minutes: minutes)).toUtc().toIso8601String(),
          'status': 'booked',
          'services': items,
          'source': 'counter',
        };
        _appointments.add(appt);
        _appointments.sort((a, b) => a['starts_at'].compareTo(b['starts_at']));
        return {'success': true, 'appointment': appt, 'message': 'Booked ${c['name']}'};
      case 'set_status':
        final appt = apptById(action['appointment_id']);
        appt['status'] = action['status'];
        return {'success': true, 'appointment': appt, 'message': 'Updated'};
      case 'complete_and_bill':
        final appt = apptById(action['appointment_id']);
        final invoice = bill(appt['customer_name'], appt['customer_phone'], List<Map<String, dynamic>>.from(appt['services']), action['payment_method']);
        appt['status'] = 'completed';
        appt['invoice_id'] = invoice['id'];
        return {'success': true, 'appointment': appt, 'invoice': invoice, 'message': 'Billed ${appt['customer_name']}'};
      case 'approve_request':
        final appt = apptById(action['appointment_id']);
        appt['status'] = 'booked';
        _requests.remove(appt);
        return {'success': true, 'appointment': appt, 'message': 'Booking approved'};
      case 'decline_request':
        final appt = apptById(action['appointment_id']);
        _requests.remove(appt);
        return {'success': true, 'message': 'Request declined'};
      case 'pay_invoice':
        final invoice = _invoices.firstWhere((i) => i['id'] == action['invoice_id']);
        invoice['status'] = 'paid';
        invoice['payment_method'] = action['payment_method'];
        return {'success': true, 'invoice': invoice, 'message': 'Marked paid'};
      case 'send_invoice':
        return {'success': true, 'message': 'Bill sent on WhatsApp'};
    }
    throw ApiException(400, 'Unknown action.');
  }
}
