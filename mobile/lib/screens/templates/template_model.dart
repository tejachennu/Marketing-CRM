/// WhatsApp templates as WhatsApp Manager builds them: the same choices, limits and words as the
/// web (lib/whatsapp-templates/template-model.ts). A draft is a plain map with the web's fields, so
/// the server reads it exactly as it reads the web's; the server also checks it (validateDraft).
library;

typedef Draft = Map<String, dynamic>;

const categories = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

const categoryLabels = {
  'MARKETING': (title: 'Marketing', description: "Promotions or information about your business, products or services. Or any message that isn't utility or authentication."),
  'UTILITY': (title: 'Utility', description: 'Messages about a specific transaction, account, order or customer request.'),
  'AUTHENTICATION': (title: 'Authentication', description: 'One-time passcodes used to verify a transaction or login.'),
};

const templateTypes = {
  'MARKETING': [
    (type: 'custom', title: 'Default', description: 'Send messages with media and customised buttons to engage your customers.'),
    (type: 'carousel', title: 'Media card carousel', description: 'Send up to 10 scrollable cards, each with an image or video and buttons.'),
    (type: 'catalog', title: 'Catalogue', description: 'Send messages that drive sales by connecting your product catalogue.'),
    (type: 'mpm', title: 'Multi-product message', description: 'Send up to 30 products from your catalogue, in sections, in one message.'),
    (type: 'spm', title: 'Single-product message', description: 'Feature one product from your catalogue, with its image, name and price.'),
    (type: 'product_carousel', title: 'Product card carousel', description: 'Send 2 to 10 scrollable product cards from your catalogue.'),
    (type: 'lto', title: 'Limited-time offer', description: 'Send an offer with an expiry countdown and a copy-code button.'),
    (type: 'coupon', title: 'Coupon code', description: 'Send messages with a promo code customers can copy with one tap.'),
    (type: 'flow', title: 'Flows', description: 'Send a form to capture interests, appointment requests or run surveys.'),
    (type: 'call_permission', title: 'Call permissions request', description: 'Ask customers for permission to call them on WhatsApp.'),
  ],
  'UTILITY': [
    (type: 'custom', title: 'Default', description: 'Send messages about an existing order or account.'),
    (type: 'flow', title: 'Flows', description: 'Send a form to collect feedback, send reminders or manage orders.'),
    (type: 'order_details', title: 'Order details', description: 'Send an order summary with a Review and pay button (payments in India).'),
    (type: 'call_permission', title: 'Call permissions request', description: 'Ask customers for permission to call them on WhatsApp.'),
  ],
  'AUTHENTICATION': [(type: 'otp', title: 'One-time passcode', description: 'Send codes to verify a transaction or login.')],
};

String typeTitle(String category, String type) => (templateTypes[category] ?? const []).where((t) => t.type == type).map((t) => t.title).firstOrNull ?? 'Default';

const templateLanguages = [
  ('en', 'English'), ('en_US', 'English (US)'), ('en_GB', 'English (UK)'), ('hi', 'Hindi'), ('te', 'Telugu'), ('ta', 'Tamil'), ('kn', 'Kannada'), //
  ('ml', 'Malayalam'), ('mr', 'Marathi'), ('bn', 'Bengali'), ('gu', 'Gujarati'), ('pa', 'Punjabi'), ('ur', 'Urdu'), ('ar', 'Arabic'), ('es', 'Spanish'),
  ('pt_BR', 'Portuguese (BR)'), ('fr', 'French'), ('de', 'German'), ('id', 'Indonesian'), ('ms', 'Malay'), ('it', 'Italian'), ('ru', 'Russian'),
  ('tr', 'Turkish'), ('zh_CN', 'Chinese (CHN)'), ('ja', 'Japanese'),
];

String languageLabel(Object? code) => templateLanguages.where((l) => l.$1 == code).map((l) => l.$2).firstOrNull ?? '$code';

/// What each Meta status means, as WhatsApp Manager shows it (tone: green, yellow, red, gray).
const statusInfo = {
  'APPROVED': (label: 'Active', tone: 'green', help: 'Approved by Meta. You can send it.'),
  'PENDING': (label: 'In review', tone: 'yellow', help: 'Meta is reviewing it, usually within minutes and at most 24 hours.'),
  'IN_APPEAL': (label: 'In appeal', tone: 'yellow', help: 'You appealed the rejection; Meta is reviewing it again.'),
  'REJECTED': (label: 'Rejected', tone: 'red', help: 'Meta did not approve it. Fix the reason and edit it, or create a new one.'),
  'PAUSED': (label: 'Paused', tone: 'gray', help: 'Paused by Meta after negative feedback. It is resumed automatically after the pause.'),
  'DISABLED': (label: 'Disabled', tone: 'red', help: 'Disabled by Meta after repeated negative feedback. Create a new template.'),
  'PENDING_DELETION': (label: 'Being deleted', tone: 'gray', help: 'Deleted; its name can be reused after 30 days.'),
  'DELETED': (label: 'Deleted', tone: 'gray', help: 'Deleted.'),
  'LIMIT_EXCEEDED': (label: 'Limit exceeded', tone: 'red', help: 'Your account has reached its template limit.'),
  'ARCHIVED': (label: 'Archived', tone: 'gray', help: 'Archived.'),
};

const rejectionReasons = {
  'ABUSIVE_CONTENT': 'The content was flagged as abusive.',
  'INCORRECT_CATEGORY': 'The category does not match the content. Pick the category the message really is.',
  'INVALID_FORMAT': 'The format is invalid: check variables, samples and buttons.',
  'SCAM': 'The content was flagged as a possible scam.',
  'TAG_CONTENT_MISMATCH': 'The content does not match the template type or language.',
  'PROMOTIONAL': 'Promotional content in a Utility template. Use the Marketing category.',
  'NONE': 'Meta gave no reason.',
};

const qualityLabels = {'GREEN': 'High quality', 'YELLOW': 'Medium quality', 'RED': 'Low quality'};

class Limits {
  static const name = 512, headerText = 60, body = 1024, carouselBody = 160, footer = 60, buttonText = 25, url = 2000;
  static const buttons = 10, couponCode = 15, cards = 10, minCards = 2, ltoText = 16, otpApps = 5;
}

/// Message validity period Meta allows per category, in seconds.
const ttlLimits = {'AUTHENTICATION': (min: 30, max: 900, def: 600), 'UTILITY': (min: 30, max: 43200, def: 2592000), 'MARKETING': (min: 43200, max: 2592000, def: 2592000)};
const ttlChoices = [30, 60, 120, 180, 300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400, 259200, 604800, 1209600, 2592000];

/// "10 minutes", "12 hours", "30 days".
String describeDuration(int seconds) {
  if (seconds % 86400 == 0) return '${seconds ~/ 86400} day${seconds == 86400 ? '' : 's'}';
  if (seconds % 3600 == 0) return '${seconds ~/ 3600} hour${seconds == 3600 ? '' : 's'}';
  if (seconds % 60 == 0) return '${seconds ~/ 60} minute${seconds == 60 ? '' : 's'}';
  return '$seconds seconds';
}

// ── Variables ──

final _variable = RegExp(r'\{\{\s*([^{}]*?)\s*\}\}');

/// The variables in a text, in order of first use: "{{1}}" → "1", "{{first_name}}" → "first_name".
List<String> extractVariables(String? text) {
  final names = <String>[];
  for (final m in _variable.allMatches(text ?? '')) {
    final name = m.group(1)!;
    if (!names.contains(name)) names.add(name);
  }
  return names;
}

/// The next variable to insert: "{{3}}" for numbers, a fresh name for names.
String nextVariable(String text, String format, [List<String> existing = const []]) {
  final used = [...extractVariables(text), ...existing];
  if (format == 'NAMED') {
    var i = 1;
    while (used.contains('variable_$i')) {
      i++;
    }
    return '{{variable_$i}}';
  }
  final numbers = used.map(int.tryParse).whereType<int>();
  return '{{${(numbers.isEmpty ? 0 : numbers.reduce((a, b) => a > b ? a : b)) + 1}}}';
}

/// Text with each variable replaced by its sample, for the preview.
String fillSamples(String? text, Map? samples, [String prefix = '']) =>
    (text ?? '').replaceAllMapped(_variable, (m) => '${samples?['$prefix${m.group(1)}'] ?? ''}'.isEmpty ? m.group(0)! : '${samples!['$prefix${m.group(1)}']}');

// ── Drafts ──

Map<String, dynamic> emptyCard() => {
  'headerFormat': 'IMAGE',
  'headerHandle': '',
  'body': '',
  'samples': <String, dynamic>{},
  'buttons': [
    {'type': 'QUICK_REPLY', 'text': 'Interested'},
  ],
};

Draft emptyDraft([String category = 'MARKETING', String type = 'custom']) => {
  'name': '',
  'language': 'en',
  'category': category,
  'type': type,
  'parameterFormat': 'POSITIONAL',
  'headerFormat': type == 'mpm' ? 'TEXT' : 'NONE',
  'headerText': '',
  'headerHandle': '',
  'body': '',
  'footer': '',
  'buttons': type == 'coupon'
      ? [
          {'type': 'COPY_CODE', 'example': ''},
        ]
      : type == 'lto'
      ? [
          {'type': 'COPY_CODE', 'example': ''},
          {'type': 'URL', 'text': 'Book now', 'url': 'https://'},
        ]
      : type == 'flow'
      ? [
          {'type': 'FLOW', 'text': 'Open form', 'flow_id': ''},
        ]
      : <Map<String, dynamic>>[],
  'samples': <String, dynamic>{},
  'cards': type == 'carousel' ? [emptyCard(), emptyCard()] : <Map<String, dynamic>>[],
  'lto': {'text': 'Expiring offer!', 'hasExpiration': true},
  'otp': {
    'type': 'COPY_CODE',
    'buttonText': 'Copy code',
    'autofillText': 'Autofill',
    'apps': [
      {'packageName': '', 'signatureHash': ''},
    ],
    'zeroTapTermsAccepted': false,
    'addSecurityRecommendation': true,
    'codeExpirationMinutes': 10,
  },
  'productCards': 3,
  'ttlSeconds': null,
  'allowCategoryChange': true,
};

/// A deep copy, so editing never changes the original.
Draft copyDraft(Map d) => _deep(d) as Draft;
Object? _deep(Object? v) => v is Map
    ? <String, dynamic>{for (final e in v.entries) '${e.key}': _deep(e.value)}
    : v is List
    ? [for (final x in v) _deep(x)]
    : v;

/// The draft of a template from the list (the server reads Meta's template the same way as the web).
Draft draftOf(Map template) {
  final d = template['draft'];
  if (d is Map) return copyDraft(d);
  final out = emptyDraft('${template['category'] ?? 'MARKETING'}');
  out['name'] = template['name'] ?? '';
  out['language'] = template['language'] ?? 'en';
  return out;
}

/// The text WhatsApp shows for an authentication template (Meta writes it).
({String body, String footer}) otpPreviewText(Map draft) {
  final otp = (draft['otp'] as Map?) ?? const {};
  final minutes = otp['codeExpirationMinutes'];
  return (
    body: '*123456* is your verification code.${otp['addSecurityRecommendation'] == false ? '' : ' For your security, do not share this code.'}',
    footer: minutes == null ? '' : 'This code expires in $minutes minutes.',
  );
}

/// Templates that use products from the linked catalogue.
const productTypes = ['catalog', 'mpm', 'spm', 'product_carousel'];

/// The body text of a template from Meta's list.
String bodyOf(Map template) => '${((template['components'] as List?) ?? const []).cast<Map?>().firstWhere((c) => '${c!['type']}'.toUpperCase() == 'BODY', orElse: () => null)?['text'] ?? ''}';
