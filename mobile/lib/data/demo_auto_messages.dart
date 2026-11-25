/// The demo's answers for the automatic messages' templates (Front Desk: /api/salon/templates; the shop:
/// /api/commerce/shop-messages), shaped like the server's (lib/whatsapp-templates/auto-messages.ts): each message
/// with its suggested wording, the template set up for it and where it stands with Meta.
class AutoDef {
  const AutoDef(this.purpose, this.title, this.when, this.baseName, this.fields, this.body, this.bodyFields, [this.buttons = const []]);
  final String purpose;
  final String title;
  final String when;
  final String baseName;

  /// (key, label, sample)
  final List<(String, String, String)> fields;

  /// The suggested text in Meta's form ({{1}}…), and what fills each blank.
  final String body;
  final List<String> bodyFields;

  /// (type, text, note)
  final List<(String, String, String)> buttons;
}

const deskAutoDefs = [
  AutoDef(
    'bill',
    'Bill',
    'Sends the bill with a link to view it',
    'bill_ready',
    [
      ('first_name', 'Customer first name', 'Priya'),
      ('customer_name', 'Customer full name', 'Priya Sharma'),
      ('business', 'Business name', 'Glow Salon'),
      ('bill_number', 'Bill number', 'INV-0001'),
      ('amount', 'Bill amount', '₹1,200'),
      ('services', 'Services', 'Haircut'),
      ('staff', 'Staff name', 'Anitha'),
      ('date', 'Date', 'Sat, 8 Nov'),
    ],
    'Hi {{1}}, thank you for visiting {{2}}. Your bill {{3}} for {{4}} is ready. Tap below to view or download it.',
    ['first_name', 'business', 'bill_number', 'amount'],
    [('URL', 'View bill', 'Opens the bill')],
  ),
  AutoDef(
    'booking',
    'Booking confirmed',
    'Confirms a booking from the counter or the chat',
    'booking_confirmed',
    [
      ('first_name', 'Customer first name', 'Priya'),
      ('customer_name', 'Customer full name', 'Priya Sharma'),
      ('business', 'Business name', 'Glow Salon'),
      ('date_time', 'Date and time', 'Sat, 8 Nov at 5:00 pm'),
      ('date', 'Date', 'Sat, 8 Nov'),
      ('time', 'Time', '5:00 pm'),
      ('services', 'Services', 'Haircut'),
      ('staff', 'Staff name', 'Anitha'),
      ('visit', 'Services with staff', 'Haircut with Anitha'),
    ],
    'Hi {{1}}, your appointment at {{2}} is confirmed for {{3}}: {{4}}. Reply to this message if you need to change it.',
    ['first_name', 'business', 'date_time', 'visit'],
  ),
  AutoDef(
    'reminder',
    'Appointment reminder',
    'About 2 hours before the appointment',
    'appointment_reminder',
    [
      ('first_name', 'Customer first name', 'Priya'),
      ('customer_name', 'Customer full name', 'Priya Sharma'),
      ('business', 'Business name', 'Glow Salon'),
      ('time', 'Time', '5:00 pm'),
      ('date', 'Date', 'Sat, 8 Nov'),
      ('services', 'Services', 'Haircut'),
      ('staff', 'Staff name', 'Anitha'),
      ('visit', 'Services with staff', 'Haircut with Anitha'),
    ],
    'Hi {{1}}, this is a reminder of your appointment at {{2}} today at {{3}} for {{4}}. Reply to this message if you need to change it.',
    ['first_name', 'business', 'time', 'services'],
  ),
  AutoDef(
    'feedback',
    'Feedback request',
    'Asks how the visit was, with a link to the feedback form',
    'feedback_request',
    [
      ('first_name', 'Customer first name', 'Priya'),
      ('customer_name', 'Customer full name', 'Priya Sharma'),
      ('business', 'Business name', 'Glow Salon'),
      ('services', 'Services', 'Haircut'),
      ('staff', 'Staff name', 'Anitha'),
    ],
    'Hi {{1}}, thank you for visiting {{2}}. How was your {{3}} with us? Tap below to rate your visit and the team. It takes less than a minute.',
    ['first_name', 'business', 'services'],
    [('URL', 'Give feedback', 'Opens the feedback form')],
  ),
];

const shopAutoDefs = [
  AutoDef(
    'cart_reminder',
    'Cart reminder',
    'An hour after a customer left items in the cart without ordering (once).',
    'cart_reminder',
    [
      ('first_name', 'Customer first name', 'Asha'),
      ('cart_items', 'What is in the cart', '2 × Cotton kurta'),
      ('shop', 'Shop name', 'Glow Store'),
      ('cart_link', 'Link back to the cart', 'https://glowstore.in/?cart=Ab12Cd'),
    ],
    'Hi {{1}}, you left {{2}} in your cart at {{3}}. Open {{4}} to finish your order. Reply to this message if you need help.',
    ['first_name', 'cart_items', 'shop', 'cart_link'],
  ),
  AutoDef(
    'cod_confirm',
    'Cash on Delivery check',
    'Right after a Cash on Delivery order, before you ship it.',
    'cod_order_check',
    [('first_name', 'Customer first name', 'Asha'), ('order_number', 'Order number', 'W-1042'), ('amount', 'Amount to pay', '₹1,499'), ('shop', 'Shop name', 'Glow Store')],
    'Hi {{1}}, thank you for your order {{2}} at {{3}}. You will pay {{4}} in cash when it arrives. Please confirm so we can send it.',
    ['first_name', 'order_number', 'shop', 'amount'],
    [('QUICK_REPLY', 'Yes, send it', 'The customer confirms the order'), ('QUICK_REPLY', 'Cancel order', 'Cancels it before you ship it')],
  ),
  AutoDef(
    'review_ask',
    '"How was it?" review ask',
    'When the order is delivered.',
    'order_review_request',
    [('first_name', 'Customer first name', 'Asha'), ('order_number', 'Order number', 'W-1042'), ('review_link', 'Link to write a review', 'https://glowstore.in/review/Ab12Cd')],
    'Hi {{1}}, your order {{2}} was delivered. Please tell us how it was at {{3}} so we can serve you better.',
    ['first_name', 'order_number', 'review_link'],
  ),
  AutoDef(
    'back_in_stock',
    'Back in stock',
    'When a product someone asked about is back in stock.',
    'back_in_stock_alert',
    [('product', 'Product name', 'Cotton kurta (M)'), ('shop', 'Shop name', 'Glow Store'), ('product_link', 'Link to the product', 'https://glowstore.in/p/kurta')],
    'Hello, you asked us to tell you when {{1}} is back at {{2}}. It is in stock now. See it here: {{3}} or reply to this message.',
    ['product', 'shop', 'product_link'],
  ),
  AutoDef(
    'refund_update',
    'Return and refund updates',
    'When you accept or decline a return, and when you refund an order.',
    'return_refund_update',
    [('first_name', 'Customer first name', 'Asha'), ('order_number', 'Order number', 'W-1042'), ('update', 'What happened', 'we have refunded ₹1,499 to your account.')],
    'Hi {{1}}, an update on your return for order {{2}}: {{3}} Reply to this message if you have any questions.',
    ['first_name', 'order_number', 'update'],
  ),
  AutoDef(
    'order_update',
    'Order updates',
    "When you change an order's status and tell the customer, and when the courier updates the parcel.",
    'order_status_update',
    [('first_name', 'Customer first name', 'Asha'), ('order_number', 'Order number', 'W-1042'), ('update', 'The update', 'Order #W-1042 has shipped with Delhivery.')],
    'Hi {{1}}, here is an update on your order: {{2}} Reply to this message if you have any questions.',
    ['first_name', 'update'],
  ),
];

const autoLanguages = [
  {'code': 'en', 'label': 'English'},
  {'code': 'hi', 'label': 'Hindi'},
  {'code': 'te', 'label': 'Telugu'},
  {'code': 'ta', 'label': 'Tamil'},
  {'code': 'kn', 'label': 'Kannada'},
  {'code': 'ml', 'label': 'Malayalam'},
  {'code': 'mr', 'label': 'Marathi'},
];

final _numbered = RegExp(r'\{\{\s*(\d+)\s*\}\}');
final _token = RegExp(r'\{([^{}\n]{1,60})\}');

String _bodyOf(Map t) => '${(t['components'] as List? ?? const []).firstWhere((c) => c['type'] == 'BODY', orElse: () => {'text': ''})['text']}';
List<Map> _buttonsOf(Map t) => [
  for (final c in (t['components'] as List? ?? const []))
    if (c['type'] == 'BUTTONS') ...[for (final b in (c['buttons'] as List)) Map.from(b as Map)],
];

/// Meta's text with each blank as its label in braces.
String toEditorText(String body, List fieldKeys, AutoDef def) => body.replaceAllMapped(_numbered, (m) {
  final i = int.parse(m.group(1)!) - 1;
  final key = i < fieldKeys.length ? fieldKeys[i] : null;
  final f = def.fields.where((f) => f.$1 == key).firstOrNull;
  return '{${f?.$2 ?? '?'}}';
});

/// The editor's text in Meta's form, and what fills each blank.
(String, List<String>) fromEditorText(String text, AutoDef def) {
  final keys = <String>[];
  final body = text.replaceAllMapped(_token, (m) {
    final wanted = m.group(1)!.toLowerCase().trim();
    final f = def.fields.where((f) => f.$2.toLowerCase() == wanted || f.$1 == wanted).firstOrNull;
    if (f == null) return m.group(0)!;
    if (!keys.contains(f.$1)) keys.add(f.$1);
    return '{{${keys.indexOf(f.$1) + 1}}}';
  });
  return (body.trim(), keys);
}

String freeName(String base, List<Map<String, dynamic>> templates) {
  final taken = {for (final t in templates) '${t['name']}'};
  if (!taken.contains(base)) return base;
  var n = 2;
  while (taken.contains('${base}_$n')) {
    n++;
  }
  return '${base}_$n';
}

const _reasons = {
  'PROMOTIONAL': 'Meta read it as an advert. Keep to the facts about the visit or order, without offers, prices off or words like "sale" and "discount".',
  'INVALID_FORMAT': 'Meta found a problem with the layout. Keep words before and after each blank, and check the button words.',
};

Map<String, dynamic> _status(Map? t) => switch (t?['status']) {
  null => {'state': 'missing', 'label': 'Not found', 'reason': null},
  'APPROVED' => {'state': 'approved', 'label': 'Approved', 'reason': null},
  'REJECTED' => {'state': 'rejected', 'label': 'Rejected', 'reason': _reasons[t?['rejected_reason']] ?? 'Meta did not say why. Change the words a little and send it again.'},
  'PAUSED' => {'state': 'paused', 'label': 'Paused', 'reason': 'Meta paused it for a while after customers reported it.'},
  _ => {'state': 'review', 'label': 'In review', 'reason': null},
};

Map? _find(List<Map<String, dynamic>> templates, String? name, String? language) => templates.where((t) => t['name'] == name && t['language'] == (language ?? 'en')).firstOrNull;

/// One message as the screens show it. [choice]: {name, language, fields, previous?} or null.
Map<String, dynamic> autoView(AutoDef def, Map? choice, List<Map<String, dynamic>> templates) {
  final fields = [
    for (final f in def.fields) {'key': f.$1, 'label': f.$2, 'sample': f.$3},
  ];
  Map<String, dynamic>? current;
  if (choice != null && '${choice['name'] ?? ''}'.isNotEmpty) {
    final t = _find(templates, choice['name'], choice['language']);
    final previous = choice['previous'] as Map?;
    current = {
      'name': choice['name'],
      'language': choice['language'] ?? 'en',
      'languageLabel': autoLanguages.where((l) => l['code'] == (choice['language'] ?? 'en')).firstOrNull?['label'] ?? choice['language'],
      ..._status(t),
      'category': t != null && t['category'] != 'UTILITY' ? t['category'] : null,
      'text': t == null ? null : toEditorText(_bodyOf(t), List.from(choice['fields'] as List? ?? def.bodyFields), def),
      'buttons': t == null ? null : [for (final b in _buttonsOf(t)) '${b['text'] ?? ''}'],
      'previous': previous == null ? null : {'name': previous['name'], 'state': _status(_find(templates, previous['name'], previous['language']))['state']},
    };
  }
  return {
    'purpose': def.purpose,
    'title': def.title,
    'when': def.when,
    'fields': fields,
    'buttons': [
      for (final b in def.buttons) {'type': b.$1, 'text': b.$2, 'note': b.$3},
    ],
    'suggestion': {
      'text': toEditorText(def.body, def.bodyFields, def),
      'buttons': [for (final b in def.buttons) b.$2],
      'fieldKeys': def.bodyFields,
    },
    'current': current,
  };
}

/// The account's templates to pick from, with their blanks.
List<Map<String, dynamic>> accountList(List<Map<String, dynamic>> templates) => [
  for (final t in templates)
    {
      'name': t['name'],
      'language': t['language'],
      'status': t['status'],
      'category': t['category'],
      'body': _bodyOf(t),
      'blanks': _numbered.allMatches(_bodyOf(t)).map((m) => int.parse(m.group(1)!)).fold<int>(0, (a, b) => a > b ? a : b),
      'urlButton': _buttonsOf(t).any((b) => b['type'] == 'URL'),
      'quickReplies': _buttonsOf(t).where((b) => b['type'] == 'QUICK_REPLY').length,
    },
];

/// "Send for approval": a new template in review under a free name, set up for the message (the earlier approved
/// one kept while it waits). Returns the new choice, or throws what still needs fixing.
/// [others]: templates on the account that only the demo's views know about (their names are taken too).
Map<String, dynamic> submitAuto(AutoDef def, Map<String, dynamic> body, Map? old, List<Map<String, dynamic>> templates, String Function() id, {List<Map<String, dynamic>> others = const []}) {
  final text = '${body['text'] ?? ''}';
  if (text.trim().length < 10) throw Exception('Write the message.');
  if (text.contains('{{') || text.contains('}}')) throw Exception('Use single braces for blanks, like {Customer first name}, or the blank buttons.');
  final (meta, keys) = fromEditorText(text, def);
  final unknown = [
    for (final m in _token.allMatches(text))
      if (!def.fields.any((f) => f.$2.toLowerCase() == m.group(1)!.toLowerCase().trim() || f.$1 == m.group(1)!.trim())) m.group(1),
  ];
  if (unknown.isNotEmpty) throw Exception('{${unknown.first}} is not a blank this message can fill. Use the blank buttons to add one.');
  if (RegExp(r'^\{\{\d+\}\}').hasMatch(meta) || RegExp(r'\{\{\d+\}\}[.!?]?$').hasMatch(meta)) {
    throw Exception("The message can't start or end with a blank. Add some words before or after it.");
  }
  final name = freeName(def.baseName, [...templates, ...others]);
  final language = '${body['language'] ?? 'en'}';
  final words = [for (final b in (body['buttons'] as List? ?? const [])) '$b'];
  templates.add({
    'id': id(),
    'name': name,
    'status': 'PENDING',
    'category': 'UTILITY',
    'language': language,
    'components': [
      {'type': 'BODY', 'text': meta},
      if (def.buttons.isNotEmpty)
        {
          'type': 'BUTTONS',
          'buttons': [
            for (var i = 0; i < def.buttons.length; i++) {'type': def.buttons[i].$1, 'text': i < words.length ? words[i] : def.buttons[i].$2},
          ],
        },
    ],
  });
  final oldApproved = old != null && _find([...templates, ...others], old['name'], old['language'])?['status'] == 'APPROVED';
  final previous = oldApproved ? {'name': old['name'], 'language': old['language'], 'fields': old['fields']} : old?['previous'];
  return {'name': name, 'language': language, 'fields': keys, 'previous': ?previous};
}
