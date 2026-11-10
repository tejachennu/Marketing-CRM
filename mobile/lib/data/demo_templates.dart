import '../screens/templates/template_model.dart';
import 'backend.dart';

/// The demo's answers for message templates: the list (with drafts), create, check, edit, delete,
/// Meta's library, insights and the AI writer. Works on the demo's own list.
class DemoTemplates {
  DemoTemplates({required this.templates, required this.id});
  final List<Map<String, dynamic>> templates;
  final String Function() id;

  /// A template's editor draft, read from its parts (the server does this for real).
  static Draft draftOf(Map t) {
    final parts = ((t['components'] as List?) ?? const []).cast<Map>();
    Map? part(String type) => parts.where((c) => '${c['type']}'.toUpperCase() == type).firstOrNull;
    final header = part('HEADER');
    final buttons = ((part('BUTTONS')?['buttons'] as List?) ?? const []).cast<Map>();
    final category = '${t['category'] ?? 'MARKETING'}';
    final d = emptyDraft(category, category == 'AUTHENTICATION' ? 'otp' : (buttons.any((b) => b['type'] == 'COPY_CODE') ? 'coupon' : 'custom'));
    d['name'] = t['name'];
    d['language'] = t['language'];
    d['headerFormat'] = header == null ? 'NONE' : '${header['format'] ?? 'TEXT'}';
    d['headerText'] = header?['text'] ?? '';
    d['body'] = part('BODY')?['text'] ?? '';
    d['footer'] = part('FOOTER')?['text'] ?? '';
    d['buttons'] = [
      for (final b in buttons)
        switch ('${b['type']}') {
          'URL' => {'type': 'URL', 'text': b['text'] ?? '', 'url': b['url'] ?? 'https://glowsalon.in/bill/{{1}}', 'example': 'https://glowsalon.in/bill/GLOW-0042'},
          'PHONE_NUMBER' => {'type': 'PHONE_NUMBER', 'text': b['text'] ?? '', 'phone_number': b['phone_number'] ?? ''},
          'COPY_CODE' => {'type': 'COPY_CODE', 'example': b['example'] ?? 'GLOW20'},
          _ => {'type': 'QUICK_REPLY', 'text': b['text'] ?? ''},
        },
    ];
    final samples = <String, dynamic>{};
    const examples = ['Priya', 'Glow Salon', 'GLOW-0042', '₹1,500', 'Thu 12 Nov, 11:30 am'];
    for (final (i, name) in extractVariables('${d['body']}').indexed) {
      samples[name] = examples[i % examples.length];
    }
    for (final name in extractVariables('${d['headerText']}')) {
      samples['header:$name'] = 'Priya';
    }
    d['samples'] = samples;
    return d;
  }

  /// A template's parts from a draft, the way Meta would list it.
  static List<Map<String, dynamic>> partsOf(Map d) => [
    if (d['headerFormat'] == 'TEXT') {'type': 'HEADER', 'format': 'TEXT', 'text': d['headerText']},
    if (['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].contains(d['headerFormat'])) {'type': 'HEADER', 'format': d['headerFormat']},
    {'type': 'BODY', 'text': d['type'] == 'otp' ? null : d['body']},
    if ('${d['footer'] ?? ''}'.isNotEmpty) {'type': 'FOOTER', 'text': d['footer']},
    if ((d['buttons'] as List? ?? const []).isNotEmpty) {'type': 'BUTTONS', 'buttons': d['buttons']},
  ];

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/whatsapp-templates':
        return {
          'templates': [
            for (final t in templates) {...t, if (query?['drafts'] == '1') 'draft': t['draft'] ?? draftOf(t)},
          ],
          'syncedAt': DateTime.now().toUtc().toIso8601String(),
        };
      case '/api/whatsapp-templates/library':
        final q = (query?['search'] ?? '').toLowerCase();
        final topic = query?['topic'] ?? '';
        return {'templates': _library.where((t) => (topic.isEmpty || t['topic'] == topic) && (q.isEmpty || '${t['name']} ${t['body']}'.toLowerCase().contains(q))).toList()};
      case '/api/whatsapp-templates/insights':
        final days = int.tryParse(query?['days'] ?? '') ?? 7;
        final now = DateTime.now().toUtc();
        final list = [
          for (var i = days - 1; i >= 0; i--)
            {'start': now.subtract(Duration(days: i)).millisecondsSinceEpoch ~/ 1000, 'sent': 20 + (i * 7) % 15, 'delivered': 18 + (i * 7) % 13, 'read': 12 + (i * 5) % 9},
        ];
        num sum(String k) => list.fold<num>(0, (s, d) => s + (d[k] as num));
        return {
          'totals': {'sent': sum('sent'), 'delivered': sum('delivered'), 'read': sum('read'), 'clicked': (sum('read') * 0.3).round()},
          'days': list,
          'buttons': [
            {'type': 'URL', 'text': 'View bill', 'count': (sum('read') * 0.3).round()},
          ],
        };
      case '/api/commerce/meta-detect':
        return {
          'flows': [
            {'id': '1234567890', 'name': 'Book an appointment', 'status': 'PUBLISHED'},
          ],
        };
    }
    return null;
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/api/whatsapp-templates/ai-draft':
        final draft = emptyDraft('${body['category'] ?? 'MARKETING'}', 'custom');
        draft['name'] = 'festival_offer';
        draft['language'] = body['language'] ?? 'en';
        draft['body'] = 'Hi {{1}}, happy festival from {{2}}! ✨ Enjoy 20% off on all services this week. Reply to book your visit.';
        draft['footer'] = 'Reply STOP to opt out';
        draft['samples'] = {'1': 'Priya', '2': 'Glow Salon'};
        draft['buttons'] = [
          {'type': 'QUICK_REPLY', 'text': 'Book now'},
        ];
        return {'success': true, 'draft': draft, 'problems': []};
      case '/api/whatsapp-templates/library':
        final from = _library.firstWhere((t) => t['name'] == body['libraryName']);
        templates.add({
          'id': id(),
          'name': body['name'],
          'status': 'APPROVED',
          'category': 'UTILITY',
          'language': body['language'],
          'components': [
            {'type': 'BODY', 'text': from['body']},
          ],
        });
        return {'success': true, 'status': 'APPROVED'};
      case '/api/whatsapp-templates':
        if (method == 'DELETE') {
          final p = uri.queryParameters;
          templates.removeWhere((t) => p['templateId'] != null ? t['id'] == p['templateId'] : t['name'] == p['name']);
          return {'success': true};
        }
        final draft = body['draft'];
        if (draft is! Map) return null;
        // The salon's suggested templates send a short draft; the editor sends a full one
        if (!draft.containsKey('type')) return null;
        if (body['check'] == true) {
          return {
            'success': true,
            'problems': [
              if ('${draft['name']}'.isEmpty) {'field': 'name', 'message': 'Enter a template name.'},
              if (draft['type'] != 'otp' && '${draft['body']}'.trim().isEmpty) {'field': 'body', 'message': 'Enter the message body.'},
              for (final v in extractVariables('${draft['body']}'))
                if ('${(draft['samples'] as Map?)?[v] ?? ''}'.trim().isEmpty) {'field': 'samples', 'message': 'Add a sample for {{$v}}.'},
            ],
          };
        }
        if (method == 'PATCH') {
          final t = templates.firstWhere((t) => t['id'] == body['templateId'], orElse: () => throw ApiException(404, 'That template is not there any more.'));
          t['components'] = partsOf(draft);
          t['draft'] = copyDraft(draft);
          t['status'] = 'PENDING';
          return {'success': true};
        }
        templates.add({'id': id(), 'name': draft['name'], 'status': 'PENDING', 'category': draft['category'], 'language': draft['language'], 'components': partsOf(draft), 'draft': copyDraft(draft)});
        return {'success': true, 'status': 'PENDING'};
    }
    return null;
  }

  static final _library = <Map<String, dynamic>>[
    {
      'name': 'order_delivered',
      'language': 'en_US',
      'category': 'UTILITY',
      'topic': 'ORDER_MANAGEMENT',
      'body': 'Your order {{1}} has been delivered. Thank you for shopping with us!',
      'body_params': ['#12345'],
      'buttons': [
        {'type': 'URL', 'text': 'Track order'},
      ],
    },
    {
      'name': 'payment_reminder',
      'language': 'en_US',
      'category': 'UTILITY',
      'topic': 'PAYMENTS',
      'body': 'This is a reminder that your payment of {{1}} is due on {{2}}.',
      'body_params': ['₹1,500', '15 Nov'],
      'buttons': [
        {'type': 'PHONE_NUMBER', 'text': 'Call us'},
      ],
    },
    {
      'name': 'appointment_reminder',
      'language': 'en_US',
      'category': 'UTILITY',
      'topic': 'EVENT_REMINDER',
      'body': 'Reminder: your appointment is on {{1}} at {{2}}. Reply to change it.',
      'body_params': ['Thu 12 Nov', '11:30 am'],
    },
    {
      'name': 'feedback_survey',
      'language': 'en_US',
      'category': 'UTILITY',
      'topic': 'CUSTOMER_FEEDBACK',
      'body': 'Thank you for visiting! How was your experience? Tap below to tell us.',
      'buttons': [
        {'type': 'URL', 'text': 'Give feedback'},
      ],
    },
  ];
}
