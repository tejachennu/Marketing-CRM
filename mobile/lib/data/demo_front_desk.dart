import 'demo_auto_messages.dart';
import 'format.dart';

/// The demo's answers for the rest of the Front Desk (setup, reviews, team, templates, customers),
/// working on the demo's own lists so changes show straight away.
class DemoFrontDesk {
  bool _demoSamplesGone = false;

  DemoFrontDesk({required this.setup, required this.invoices, required this.contacts, required this.templates, required this.id}) {
    choices; // seeds the saved choices so Setup counts them
    // Lists that can take any row the app sends
    for (final key in ['services', 'staff']) {
      setup[key] = <Map<String, dynamic>>[for (final row in setup[key] as List) Map<String, dynamic>.from(row as Map)];
    }
  }
  final Map<String, dynamic> setup;
  final List<Map<String, dynamic>> invoices;
  final List<Map<String, dynamic>> contacts;
  final List<Map<String, dynamic>> templates;
  final String Function() id;

  Map<String, dynamic> get settings => setup['settings'] as Map<String, dynamic>;
  List<Map<String, dynamic>> get services => List<Map<String, dynamic>>.from(setup['services']);
  List<Map<String, dynamic>> get staff => List<Map<String, dynamic>>.from(setup['staff']);

  late final List<Map<String, dynamic>> reviews = _seedReviews();

  /// The store's product catalog (E-commerce), for "Add from catalog".
  late final List<Map<String, dynamic>> products = [
    for (final (i, name, price, category) in [
      (1, 'Keratin hair serum', 899, 'Hair care'),
      (2, 'Argan oil shampoo', 649, 'Hair care'),
      (3, 'Vitamin C face wash', 399, 'Skin care'),
      (4, 'Sunscreen SPF 50', 549, 'Skin care'),
      (5, 'Gift card', 1000, 'Gifts'),
      (6, 'Bridal makeup trial', 2500, 'Services'),
      (7, 'Nail art kit', 1299, 'Nails'),
    ])
      {'id': 'p$i', 'name': name, 'price': price, 'currency': 'INR', 'category': category, 'image_url': null, 'description': '', 'available': i != 7},
  ];

  /// What changed in Setup, newest first.
  late final List<Map<String, dynamic>> history = () {
    final now = DateTime.now().toUtc();
    Map<String, dynamic> h(int minutes, String who, String area, String action, String? target, Map<String, dynamic>? details) => {
      'id': id(),
      'user_name': who,
      'area': area,
      'action': action,
      'target': target,
      'details': details,
      'created_at': now.subtract(Duration(minutes: minutes)).toIso8601String(),
    };
    return [
      h(35, 'Teja', 'service', 'changed', 'Hair spa', {
        'price': {'from': 1200, 'to': 1400},
      }),
      h(80, 'Anitha', 'service', 'billing off', 'Free consultation', {
        'billable': {'from': true, 'to': false},
      }),
      h(60 * 5, 'Teja', 'team', 'changed', 'Ravi', {
        'commission_percent': {'from': 10, 'to': 15},
      }),
      h(60 * 26, 'Teja', 'category', 'renamed', 'Hair', {
        'name': {'from': 'Haircut', 'to': 'Hair'},
        'services': 3,
      }),
      h(60 * 30, 'Teja', 'whatsapp', 'changed', null, {
        'reminders_enabled': {'from': false, 'to': true},
      }),
      h(60 * 50, 'Teja', 'business', 'changed', null, {
        'invoice_note': {'from': null, 'to': 'Thank you! See you again soon.'},
      }),
    ];
  }();

  void log(String area, String action, String? target, [Map<String, dynamic>? details]) =>
      history.insert(0, {'id': id(), 'user_name': 'Teja', 'area': area, 'action': action, 'target': target, 'details': details, 'created_at': DateTime.now().toUtc().toIso8601String()});
  Map<String, dynamic> get choices => settings['message_templates'] ??= <String, dynamic>{
    'bill': {
      'name': 'bill_ready',
      'language': 'en',
      'fields': ['first_name', 'business', 'bill_number', 'amount'],
      'url_field': 'link',
    },
    // In review, and rejected by Meta: the demo shows every state
    'feedback': {
      'name': 'feedback_request',
      'language': 'en',
      'fields': ['first_name', 'business'],
      'url_field': 'link',
    },
    'reminder': {
      'name': 'appointment_reminder',
      'language': 'en',
      'fields': ['first_name', 'business', 'time'],
    },
  };

  List<Map<String, dynamic>> _seedReviews() {
    final now = DateTime.now().toUtc();
    Map<String, dynamic> r(int days, int rating, String name, String? comment, List<String> tags, List<String> people, {bool followed = false}) => {
      'id': id(),
      'rating': rating,
      'comment': comment,
      'tags': tags,
      'source': 'form',
      'created_at': now.subtract(Duration(days: days, hours: rating)).toIso8601String(),
      'followed_up_at': followed ? now.toIso8601String() : null,
      'customer_name': name,
      'customer_phone': '+9198${(days * 7919 + rating * 131).toString().padLeft(8, '0')}',
      'people': [
        for (final p in people) {'name': p, 'rating': rating},
      ],
    };
    return [
      r(0, 5, 'Priya Sharma', 'Loved the gold facial. Anitha was so gentle!', ['Friendly staff', 'Clean place'], ['Anitha']),
      r(1, 4, 'Rahul Verma', 'Good haircut, had to wait 10 minutes.', ['Good work'], ['Ravi']),
      r(2, 2, 'Divya Menon', 'Hair colour came out darker than I asked.', ['Waiting time'], ['Anitha']),
      r(3, 5, 'Kavya Iyer', null, ['Value for money'], ['Lakshmi']),
      r(5, 1, 'Farhan Ali', 'Booked for 5 pm, started at 5:40. Not happy.', ['Waiting time'], ['Lakshmi'], followed: true),
      r(6, 5, 'Ananya Rao', 'Best pedicure in town', ['Good work', 'Friendly staff'], ['Lakshmi']),
    ];
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/salon/catalog':
        return {
          'success': true,
          'products': [
            for (final p in products)
              () {
                final linked = services.cast<Map<String, dynamic>?>().firstWhere((s) => s!['catalog_product_id'] == p['id'], orElse: () => null);
                return {...p, 'service_id': linked?['id'], 'billable': linked == null ? null : linked['billable'] != false};
              }(),
          ],
        };
      case '/api/salon/history':
        final area = query?['area'] ?? '';
        final before = query?['before'];
        final limit = int.tryParse(query?['limit'] ?? '') ?? 50;
        return {'success': true, 'entries': history.where((e) => (area.isEmpty || e['area'] == area) && (before == null || '${e['created_at']}'.compareTo(before) < 0)).take(limit).toList()};
      case '/api/salon/customers':
        final q = (query?['q'] ?? '').toLowerCase();
        final digits = q.replaceAll(RegExp(r'\D'), '');
        final found = contacts.where((c) => digits.length >= 4 ? '${c['phone_number']}'.contains(digits) : contactName(c).toLowerCase().contains(q)).take(6);
        return {
          'success': true,
          'customers': [
            for (final c in found)
              () {
                final bills = invoices.where((i) => i['customer_name'] == contactName(c) && i['status'] != 'void').toList();
                final last = bills.isEmpty ? null : bills.first;
                return {
                  'contact_id': c['id'],
                  'name': contactName(c),
                  'phone': c['phone_number'],
                  'visits': bills.length,
                  'exact': digits.length >= 10 && '${c['phone_number']}'.endsWith(digits.substring(digits.length - 10)),
                  'last_visit': last == null
                      ? null
                      : {
                          'date': toIst(DateTime.parse(last['issued_at'])).toIso8601String().substring(0, 10),
                          'services': [for (final x in last['items']) x['name']],
                          'service_ids': [for (final x in last['items']) x['service_id'] ?? x['id']],
                          'staff_ids': [for (final x in last['items']) x['staff_id']],
                          'total': last['total'],
                        },
                };
              }(),
          ],
        };
      case '/api/salon/reviews':
        final count = reviews.length;
        final sum = reviews.fold<num>(0, (s, r) => s + (r['rating'] as num));
        final unhappy = reviews.where((r) => (r['rating'] as num) <= 2).toList();
        return {
          'success': true,
          'reviews': reviews,
          'summary': {
            'count': count,
            'average': count == 0 ? null : (sum / count * 10).round() / 10,
            'distribution': [
              for (var s = 5; s >= 1; s--) {'stars': s, 'count': reviews.where((r) => r['rating'] == s).length},
            ],
            'happyPercent': count == 0 ? null : (reviews.where((r) => (r['rating'] as num) >= 4).length * 100 / count).round(),
            'unhappy': unhappy.length,
            'toCall': unhappy.where((r) => r['followed_up_at'] == null).length,
            'comments': reviews.where((r) => r['comment'] != null).length,
            'tags': [
              {'tag': 'Friendly staff', 'count': 2},
              {'tag': 'Waiting time', 'count': 2},
              {'tag': 'Good work', 'count': 2},
            ],
          },
        };
      case '/api/salon/performance':
        final people = [
          {
            'id': 'st-anitha',
            'name': 'Anitha',
            'commissionPercent': 20,
            'services': 34,
            'visits': 29,
            'revenue': 48600,
            'commission': 9720,
            'ratings': 12,
            'averageRating': 4.6,
            'topServices': [
              {'name': 'Gold facial', 'count': 14},
              {'name': 'Haircut (Women)', 'count': 9},
            ],
          },
          {
            'id': 'st-lakshmi',
            'name': 'Lakshmi',
            'commissionPercent': 15,
            'services': 41,
            'visits': 33,
            'revenue': 27350,
            'commission': 4102.5,
            'ratings': 15,
            'averageRating': 4.1,
            'topServices': [
              {'name': 'Manicure', 'count': 16},
              {'name': 'Pedicure', 'count': 12},
            ],
          },
          {
            'id': 'st-ravi',
            'name': 'Ravi',
            'commissionPercent': 10,
            'services': 27,
            'visits': 25,
            'revenue': 18900,
            'commission': 1890,
            'ratings': 8,
            'averageRating': 4.4,
            'topServices': [
              {'name': 'Haircut (Men)', 'count': 19},
            ],
          },
        ];
        return {
          'success': true,
          'staff': people,
          'totals': {'revenue': 94850, 'services': 102, 'visits': 87, 'commission': 15712.5, 'ratings': 35, 'averageRating': 4.4},
        };
      case '/api/salon/templates':
        final all = [...templates, ..._metaOnly];
        return {
          'success': true,
          'connected': true,
          'ownWhatsApp': true,
          'languages': autoLanguages,
          'account': accountList(templates),
          'choices': choices,
          // Like the server: without appointments, the booking and reminder messages are left out
          'autoMessages': [
            for (final def in deskAutoDefs)
              if (settings['takes_appointments'] != false || !['booking', 'reminder'].contains(def.purpose)) autoView(def, choices[def.purpose] as Map?, all),
          ],
        };
    }
    return null;
  }

  /// A reminder wording Meta rejected (only here, so the Templates list stays as it was), to show that state.
  final List<Map<String, dynamic>> _metaOnly = [
    {
      'id': 't-rem',
      'name': 'appointment_reminder',
      'status': 'REJECTED',
      'rejected_reason': 'PROMOTIONAL',
      'category': 'UTILITY',
      'language': 'en',
      'components': [
        {'type': 'BODY', 'text': 'Hi {{1}}, your appointment at {{2}} is today at {{3}}. Book your next visit now and get 10% off!'},
      ],
    },
  ];

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    final uri = Uri.parse(path);
    final params = uri.queryParameters;
    List list(String key) => setup[key] as List;
    switch (uri.path) {
      case '/api/salon/feedback':
        final r = reviews.firstWhere((r) => r['id'] == body['id']);
        r['followed_up_at'] = DateTime.now().toUtc().toIso8601String();
        return {'success': true, 'feedback': r};
      case '/api/salon/templates' when method == 'POST':
        final def = deskAutoDefs.firstWhere((d) => d.purpose == body['purpose']);
        final choice = submitAuto(def, body, choices[def.purpose] as Map?, templates, id, others: _metaOnly);
        choices[def.purpose] = {...choice, 'url_field': def.buttons.isEmpty ? null : 'link'};
        return {'success': true, 'choice': choices[def.purpose], 'status': 'PENDING'};
      case '/api/salon/templates':
        settings['message_templates'] = Map<String, dynamic>.from(body['choices'] as Map);
        return {'success': true, 'choices': choices};
      case '/api/whatsapp-templates':
        final draft = Map<String, dynamic>.from(body['draft'] as Map);
        templates.add({
          'id': id(),
          'name': draft['name'],
          'status': 'PENDING',
          'category': 'UTILITY',
          'language': draft['language'],
          'components': [
            {'type': 'BODY', 'text': draft['body']},
          ],
        });
        return {'success': true, 'status': 'PENDING'};
      case '/api/salon/booking-flow/try-question':
        final q = '${body['message']}'.toLowerCase();
        final service = services.cast<Map<String, dynamic>?>().firstWhere((s) => q.contains('${s!['name']}'.toLowerCase().split(' ').first), orElse: () => null);
        if (service != null) return {'success': true, 'reply': '${service['name']} is ${formatRupees(service['price'])} and takes about ${service['duration_minutes']} minutes.'};
        if (q.contains('open') || q.contains('time') || q.contains('timing')) return {'success': true, 'reply': 'We are open 10 am to 9 pm, Monday to Saturday.'};
        return {'success': true, 'reply': null};
      case '/api/salon/catalog':
        if (body['action'] == 'refresh') return {'success': true, 'changed': []};
        final ids = List<String>.from(body['product_ids'] as List? ?? const []);
        if (ids.isEmpty) throw Exception('Tick at least one item from the catalog.');
        final created = <Map<String, dynamic>>[];
        for (final p in products.where((p) => ids.contains(p['id']))) {
          if (services.any((s) => s['catalog_product_id'] == p['id'])) continue;
          final service = <String, dynamic>{
            'id': id(),
            'name': p['name'],
            'category': body['category'] ?? p['category'],
            'price': p['price'],
            'duration_minutes': body['duration_minutes'] ?? 30,
            'tax_rate': body['tax_rate'] ?? 18,
            'sac_code': null,
            'active': true,
            'billable': body['billable'] != false,
            'source': 'catalog',
            'catalog_product_id': p['id'],
            'image_url': p['image_url'],
          };
          list('services').add(service);
          created.add(service);
        }
        if (created.isNotEmpty) {
          log('catalog', 'imported', '${created.length} item${created.length == 1 ? '' : 's'}', {'items': created.map((c) => c['name']).toList(), 'billable': body['billable'] != false});
        }
        return {'success': true, 'services': created, 'skipped': ids.length - created.length};
      case '/api/salon/services':
        if (method == 'DELETE') {
          final gone = list('services').cast<Map?>().firstWhere((s) => s!['id'] == params['id'], orElse: () => null);
          list('services').removeWhere((s) => s['id'] == params['id']);
          log('service', 'removed', '${gone?['name'] ?? 'A service'}');
          return {'success': true};
        }
        if (method == 'POST') {
          final service = {'id': id(), 'active': true, 'billable': true, 'tax_rate': 18, 'duration_minutes': 30, ...body}..remove('organizationId');
          list('services').add(service);
          log('service', 'added', '${service['name']}', {'price': service['price']});
          return {'success': true, 'service': service};
        }
        final s = list('services').firstWhere((s) => s['id'] == body['id']) as Map;
        final changes = <String, dynamic>{
          for (final k in ['name', 'category', 'price', 'duration_minutes', 'tax_rate', 'active', 'billable'])
            if (body.containsKey(k) && '${s[k] ?? (k == 'billable' ? true : null)}' != '${body[k]}') k: {'from': s[k] ?? (k == 'billable' ? true : null), 'to': body[k]},
        };
        s.addAll(Map.from(body)..remove('organizationId'));
        if (changes.isNotEmpty) {
          final onlyBills = changes.length == 1 && changes.containsKey('billable');
          log('service', onlyBills ? (body['billable'] == true ? 'billing on' : 'billing off') : 'changed', '${s['name']}', changes);
        }
        return {'success': true, 'service': s};
      case '/api/salon/staff':
        if (method == 'DELETE') {
          list('staff').removeWhere((s) => s['id'] == params['id']);
          return {'success': true};
        }
        if (method == 'POST') {
          final member = {'id': id(), 'active': true, 'service_ids': [], ...body}..remove('organizationId');
          list('staff').add(member);
          return {'success': true, 'member': member};
        }
        final m = list('staff').firstWhere((s) => s['id'] == body['id']) as Map;
        m.addAll(Map.from(body)..remove('organizationId'));
        return {'success': true, 'member': m};
      case '/api/salon/categories':
        final cats = List<String>.from(settings['service_categories'] ?? []);
        if (method == 'POST') cats.add('${body['name']}');
        if (method == 'PUT') {
          cats
            ..clear()
            ..addAll(List<String>.from(body['categories']));
        }
        if (method == 'PATCH') {
          final i = cats.indexOf('${body['from']}');
          if (i >= 0) cats[i] = '${body['to']}';
          for (final s in list('services')) {
            if (s['category'] == body['from']) s['category'] = body['to'];
          }
        }
        if (method == 'DELETE') {
          cats.remove(params['name']);
          for (final s in list('services')) {
            if (s['category'] == params['name']) s['category'] = params['moveTo'] ?? 'General';
          }
        }
        settings['service_categories'] = cats;
        return {'success': true, 'categories': cats, 'services': list('services')};
      case '/api/salon/settings':
        settings.addAll(Map<String, dynamic>.from(body)..remove('organizationId'));
        return {'success': true, 'settings': settings};
      case '/api/salon/logo':
        if (method == 'DELETE') settings['logo_url'] = null;
        return {'success': true, 'settings': settings};
      case '/api/salon/tick':
        return {'success': true, 'feedbackSent': 0, 'remindersSent': 0};
      case '/api/salon/sample':
        if (body['action'] == 'preview') return {'services': _demoSamplesGone ? <String>[] : ['Beard trim', 'Head massage'], 'staff': <String>[]};
        if (body['action'] == 'remove') {
          _demoSamplesGone = true;
          return {'success': true, 'removed': {'services': 2, 'staff': 0}, 'switchedOff': {'services': 0, 'staff': 0}, ...setup};
        }
        settings['business_type'] = body['business_type'];
        return {
          'success': true,
          'added': {'services': 0, 'staff': 0},
          ...setup,
        };
    }
    return null;
  }
}
