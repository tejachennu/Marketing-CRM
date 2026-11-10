import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'template_editor.dart';
import 'template_model.dart';
import 'template_preview.dart';

/// Create a template, as on the web: write it with AI, or choose the category, the type, the name
/// and the language, then fill it in. Also used to add a language to a template (same name and
/// category) and to duplicate one.
class TemplateSetupScreen extends StatefulWidget {
  const TemplateSetupScreen({super.key, required this.existing, this.flows = const [], this.start, this.lockedName});
  final List<Map<String, dynamic>> existing;
  final List<Map<String, dynamic>> flows;
  final Draft? start;
  final String? lockedName;
  @override
  State<TemplateSetupScreen> createState() => _TemplateSetupScreenState();
}

class _TemplateSetupScreenState extends State<TemplateSetupScreen> {
  late Draft d = widget.start == null ? emptyDraft('MARKETING', 'custom') : copyDraft(widget.start!);
  late final _name = TextEditingController(text: '${d['name'] ?? ''}');
  bool get _locked => widget.lockedName != null;
  bool get _taken => widget.existing.any((t) => t['name'] == d['name'] && t['language'] == d['language']);

  Future<void> _edit(Draft draft) async {
    final done = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (_) => TemplateEditorScreen(draft: draft, flows: widget.flows),
      ),
    );
    if (done != null && mounted) Navigator.pop(context, done);
  }

  void _setType(String category, String type) => setState(() {
    d = {...emptyDraft(category, type), 'name': d['name'], 'language': d['language']};
  });

  @override
  Widget build(BuildContext context) {
    final category = '${d['category']}';
    return Scaffold(
      appBar: AppBar(title: Text(_locked ? 'Add language to ${widget.lockedName}' : 'Create template')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
        children: [
          if (_locked)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: Text('Same name and category; choose the language, then translate the content.', style: TextStyle(color: Brand.muted)),
            ),
          if (!_locked && widget.start == null) ...[
            _Card(
              title: 'Write it with AI',
              icon: Icons.auto_awesome,
              text: "Say what the message is for. AI writes the template, with blanks, examples and buttons that follow Meta's rules, and opens it in the editor to check.",
              child: AiTemplateWriter(onDraft: _edit),
            ),
            const SizedBox(height: 12),
          ],
          _Card(
            title: _locked ? 'Set up your template' : 'Or set it up yourself',
            text: 'Choose the category that best describes your message template. Then select the type of message you want to send.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final c in categories)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Opacity(
                      opacity: _locked && c != category ? 0.4 : 1,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: _locked ? null : () => _setType(c, templateTypes[c]!.first.type),
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: c == category ? Brand.bubble : Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: c == category ? Brand.blue : Brand.border, width: c == category ? 1.5 : 1),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CategoryIcon(category: c, size: 40),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(categoryLabels[c]!.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                                    Text(categoryLabels[c]!.description, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 4),
                const SizedBox(height: 6),
                const Text('Type of message', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                for (final t in templateTypes[category]!)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Material(
                      color: d['type'] == t.type ? Brand.bubble : Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(color: d['type'] == t.type ? Brand.blue : Brand.line),
                      ),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: _locked ? null : () => _setType(category, t.type),
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CategoryIcon(category: category, type: t.type, size: 38),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(t.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                                    Text(t.description, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                                  ],
                                ),
                              ),
                              if (d['type'] == t.type) const Icon(Icons.check_circle, color: Brand.blue, size: 20),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                if (category == 'UTILITY' && !_locked)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(
                                text: 'Skip the review. ',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                              TextSpan(text: "Meta's template library has ready-made utility templates that are approved as soon as you create them."),
                            ],
                          ),
                          style: TextStyle(fontSize: 13),
                        ),
                        TextButton.icon(
                          onPressed: () async {
                            final done = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => TemplateLibraryScreen(existing: {for (final t in widget.existing) '${t['name']}'})));
                            if (done != null && context.mounted) Navigator.pop(context, done);
                          },
                          icon: const Icon(Icons.menu_book_outlined),
                          label: const Text('Browse library'),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _Card(
            title: 'Template name and language',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _name,
                  enabled: !_locked,
                  onChanged: (v) {
                    final clean = v.toLowerCase().replaceAll(RegExp(r'\s+'), '_').replaceAll(RegExp('[^a-z0-9_]'), '');
                    if (clean != v) {
                      _name.value = TextEditingValue(
                        text: clean,
                        selection: TextSelection.collapsed(offset: clean.length),
                      );
                    }
                    setState(() => d['name'] = clean);
                  },
                  decoration: InputDecoration(
                    labelText: 'Name your template',
                    hintText: 'Enter a template name',
                    helperText: 'Lowercase letters, numbers and underscores.',
                    counterText: '${_name.text.length}/${Limits.name}',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: '${d['language']}',
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Select language'),
                  items: [for (final l in templateLanguages) DropdownMenuItem(value: l.$1, child: Text(l.$2))],
                  onChanged: (v) => setState(() => d['language'] = v ?? 'en'),
                ),
                if (_taken)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text(
                      'A template with this name and language already exists. Choose another name, or add another language to it under a new name.',
                      style: TextStyle(color: Brand.red, fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Discard')),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: FilledButton.icon(onPressed: '${d['name']}'.isEmpty || _taken ? null : () => _edit(d), icon: const Icon(Icons.chevron_right), label: const Text('Next')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.child, this.text, this.icon});
  final String title;
  final String? text;
  final IconData? icon;
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Brand.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            if (icon != null) ...[Icon(icon, size: 19, color: Brand.blue), const SizedBox(width: 6)],
            Expanded(
              child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        if (text != null)
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 12),
            child: Text(text!, style: const TextStyle(fontSize: 13, color: Brand.muted)),
          )
        else
          const SizedBox(height: 10),
        child,
      ],
    ),
  );
}

/// "Write it with AI": describe the message; AI writes the template and opens it in the editor.
class AiTemplateWriter extends StatefulWidget {
  const AiTemplateWriter({super.key, required this.onDraft});
  final void Function(Draft draft) onDraft;
  @override
  State<AiTemplateWriter> createState() => _AiTemplateWriterState();
}

class _AiTemplateWriterState extends State<AiTemplateWriter> {
  static const _ideas = [
    ('Festival offer', 'Wish customers a happy festival and tell them about our festive offer. Ask them to reply to book.', 'MARKETING'),
    ('New service', 'Tell customers about a new service we have started, with its price, and ask them to reply to book a slot.', 'MARKETING'),
    ('We miss you', 'Customers who have not visited in a while: say we miss them and offer a small discount on their next visit.', 'MARKETING'),
    ('Payment due', 'Remind the customer politely that a payment is due, with the amount and the due date.', 'UTILITY'),
    ('Order ready', 'Tell the customer their order or job is ready to collect, with the order number and our timings.', 'UTILITY'),
  ];
  final _text = TextEditingController();
  String _language = 'en';
  String _category = 'MARKETING';
  bool _busy = false;
  String _error = '';

  Future<void> _write() async {
    final app = AppScope.read(context);
    if (_text.text.trim().length < 5) return setState(() => _error = 'Describe the message in a few words first.');
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final data = await app.ask('/api/whatsapp-templates/ai-draft', {'description': _text.text.trim(), 'language': _language, 'category': _category});
      if (!mounted) return;
      widget.onDraft(copyDraft(data['draft'] as Map));
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final (label, text, category) in _ideas)
            ActionChip(
              label: Text(label),
              onPressed: () => setState(() {
                _text.text = text;
                _category = category;
              }),
            ),
        ],
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _text,
        minLines: 3,
        maxLines: 6,
        maxLength: 1500,
        decoration: const InputDecoration(
          labelText: 'What should the message say?',
          hintText: 'e.g. Tell customers about our Diwali offer: 20% off all services till 5 Nov. Ask them to reply to book.',
          alignLabelWithHint: true,
        ),
      ),
      DropdownButtonFormField<String>(
        initialValue: _language,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Language'),
        items: [for (final l in templateLanguages) DropdownMenuItem(value: l.$1, child: Text(l.$2))],
        onChanged: (v) => setState(() => _language = v ?? 'en'),
      ),
      const SizedBox(height: 10),
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(value: 'MARKETING', label: Text('Marketing')),
          ButtonSegment(value: 'UTILITY', label: Text('Utility')),
        ],
        selected: {_category},
        showSelectedIcon: false,
        onSelectionChanged: (v) => setState(() => _category = v.first),
      ),
      const SizedBox(height: 10),
      FilledButton.icon(
        onPressed: _busy ? null : _write,
        icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.auto_awesome),
        label: Text(_busy ? 'Writing…' : 'Write it with AI'),
      ),
      if (_error.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(_error, style: const TextStyle(color: Brand.red)),
        ),
      const SizedBox(height: 6),
      const Text('Uses AI credit. You can change everything before it goes to Meta for review.', style: TextStyle(fontSize: 12, color: Brand.muted)),
    ],
  );
}

// ── Meta's template library ──

const _topics = [
  ('', 'All topics'),
  ('ORDER_MANAGEMENT', 'Order management'),
  ('PAYMENTS', 'Payments'),
  ('ACCOUNT_UPDATES', 'Account updates'),
  ('CUSTOMER_FEEDBACK', 'Customer feedback'),
  ('EVENT_REMINDER', 'Event reminders'),
  ('IDENTITY_VERIFICATION', 'Identity verification'),
];

String _humanize(String name) {
  final s = name.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// A library template as an editor draft, for the preview.
Draft _libraryDraft(Map t) {
  final d = emptyDraft('UTILITY', 'custom');
  d['name'] = t['name'];
  d['language'] = t['language'];
  d['body'] = t['body'] ?? '';
  if (t['header'] != null) {
    d['headerFormat'] = 'TEXT';
    d['headerText'] = t['header'];
  }
  d['samples'] = {for (final (i, v) in ((t['body_params'] as List?) ?? const []).indexed) '${i + 1}': '$v'};
  d['buttons'] = [
    for (final b in ((t['buttons'] as List?) ?? const []).cast<Map>())
      if (b['type'] == 'URL')
        {'type': 'URL', 'text': b['text'] ?? 'Visit website', 'url': b['url'] ?? ''}
      else if (b['type'] == 'PHONE_NUMBER')
        {'type': 'PHONE_NUMBER', 'text': b['text'] ?? 'Call', 'phone_number': b['phone_number'] ?? ''}
      else if (b['type'] == 'QUICK_REPLY')
        {'type': 'QUICK_REPLY', 'text': b['text'] ?? ''},
  ];
  return d;
}

/// Meta's pre-approved utility templates: search, preview, name it, add your link or number, create.
class TemplateLibraryScreen extends StatefulWidget {
  const TemplateLibraryScreen({super.key, required this.existing});
  final Set<String> existing;
  @override
  State<TemplateLibraryScreen> createState() => _TemplateLibraryScreenState();
}

class _TemplateLibraryScreenState extends State<TemplateLibraryScreen> {
  String _search = '';
  String _topic = '';
  List<Map<String, dynamic>>? _list;
  String _error = '';
  int _ask = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    try {
      final data = await app.backend.get('/api/whatsapp-templates/library', {'organizationId': app.orgId, if (_search.isNotEmpty) 'search': _search, if (_topic.isNotEmpty) 'topic': _topic});
      if (!mounted || ask != _ask) return;
      setState(() {
        _list = [for (final t in (data['templates'] as List? ?? const [])) Map<String, dynamic>.from(t)];
        _error = '';
      });
    } catch (e) {
      if (mounted && ask == _ask) {
        setState(() {
          _list = [];
          _error = '$e'.replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Template library')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Text("Pre-approved utility templates from Meta. Add your website or phone number and send them right away.", style: TextStyle(color: Brand.muted, fontSize: 13)),
          ),
          SearchField(
            hint: 'Search: delivery, payment, appointment',
            onChanged: (v) {
              _search = v.trim();
              _load();
            },
          ),
          FilterChips(
            children: [
              for (final (value, label) in _topics)
                ChoiceChip(
                  label: Text(label),
                  selected: _topic == value,
                  onSelected: (_) {
                    setState(() => _topic = value);
                    _load();
                  },
                ),
            ],
          ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error, style: const TextStyle(color: Brand.red)),
            ),
          if (list == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (list.isEmpty && _error.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'No templates match. Try another word or topic.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Brand.muted),
              ),
            )
          else
            for (final t in list)
              FlatRow(
                onTap: () async {
                  final done = await Navigator.push<String>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => _LibraryTemplateScreen(template: t, existing: widget.existing),
                    ),
                  );
                  if (done != null && context.mounted) Navigator.pop(context, done);
                },
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_humanize('${t['name']}'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    if (t['topic'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Pill(_humanize('${t['topic']}'.toLowerCase()))),
                    const SizedBox(height: 4),
                    Text(
                      '${t['body'] ?? ''}',
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Brand.textSoft, fontSize: 13.5),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

class _LibraryTemplateScreen extends StatefulWidget {
  const _LibraryTemplateScreen({required this.template, required this.existing});
  final Map<String, dynamic> template;
  final Set<String> existing;
  @override
  State<_LibraryTemplateScreen> createState() => _LibraryTemplateScreenState();
}

class _LibraryTemplateScreenState extends State<_LibraryTemplateScreen> {
  late final _name = TextEditingController(text: _freeName());
  final Map<int, String> _base = {}, _example = {}, _phone = {};
  bool _busy = false;
  String _error = '';

  String _freeName() {
    final base = '${widget.template['name']}';
    var candidate = base;
    for (var n = 2; widget.existing.contains(candidate); n++) {
      candidate = '${base}_$n';
    }
    return candidate;
  }

  Future<void> _create() async {
    final app = AppScope.read(context);
    final buttons = ((widget.template['buttons'] as List?) ?? const []).cast<Map>();
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await app.ask('/api/whatsapp-templates/library', {
        'name': _name.text,
        'language': widget.template['language'],
        'libraryName': widget.template['name'],
        'buttonInputs': [
          for (final (i, b) in buttons.indexed)
            if (b['type'] == 'URL')
              {
                'type': 'URL',
                'url': {'base_url': _base[i] ?? '', if ((_example[i] ?? '').isNotEmpty) 'url_suffix_example': _example[i]},
              }
            else if (b['type'] == 'PHONE_NUMBER')
              {'type': 'PHONE_NUMBER', 'phone_number': _phone[i] ?? ''},
        ],
      });
      if (mounted) Navigator.pop(context, '“${_name.text}” was created from the library and is ready to send.');
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final buttons = ((widget.template['buttons'] as List?) ?? const []).cast<Map>();
    final taken = widget.existing.contains(_name.text);
    return Scaffold(
      appBar: AppBar(title: Text(_humanize('${widget.template['name']}'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Template preview', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 8),
          TemplatePreview(draft: _libraryDraft(widget.template)),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            onChanged: (v) {
              final clean = v.toLowerCase().replaceAll(RegExp(r'\s+'), '_').replaceAll(RegExp('[^a-z0-9_]'), '');
              if (clean != v) {
                _name.value = TextEditingValue(
                  text: clean,
                  selection: TextSelection.collapsed(offset: clean.length),
                );
              }
              setState(() {});
            },
            decoration: InputDecoration(labelText: 'Template name', errorText: taken ? 'You already have a template with this name.' : null),
          ),
          for (final (i, b) in buttons.indexed)
            if (b['type'] == 'URL') ...[
              const SizedBox(height: 12),
              TextField(
                onChanged: (v) => setState(() => _base[i] = v.trim()),
                decoration: InputDecoration(labelText: '“${b['text']}” button: your website', hintText: 'https://www.example.com/orders/{{1}}'),
              ),
              if ((_base[i] ?? '').contains('{{1}}')) ...[
                const SizedBox(height: 8),
                TextField(
                  onChanged: (v) => _example[i] = v.trim(),
                  decoration: const InputDecoration(labelText: 'Sample address', hintText: 'https://www.example.com/orders/12345'),
                ),
              ],
            ] else if (b['type'] == 'PHONE_NUMBER') ...[
              const SizedBox(height: 12),
              TextField(
                keyboardType: TextInputType.phone,
                onChanged: (v) => _phone[i] = v.trim(),
                decoration: InputDecoration(labelText: '“${b['text']}” button: your phone number', hintText: '+91 98765 43210'),
              ),
            ],
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text('Meta: $_error', style: const TextStyle(color: Brand.red)),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy || _name.text.isEmpty || taken ? null : _create,
            child: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Create template'),
          ),
        ],
      ),
    );
  }
}

// ── Insights ──

/// How an approved template is doing: sent, delivered, read and button clicks, by day.
class TemplateInsightsScreen extends StatefulWidget {
  const TemplateInsightsScreen({super.key, required this.template});
  final Map<String, dynamic> template;
  @override
  State<TemplateInsightsScreen> createState() => _TemplateInsightsScreenState();
}

class _TemplateInsightsScreenState extends State<TemplateInsightsScreen> {
  int _days = 7;
  Map<String, dynamic>? _data;
  String _error = '';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final data = await app.backend.get('/api/whatsapp-templates/insights', {'organizationId': app.orgId, 'templateId': '${widget.template['id']}', 'days': '$_days'});
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _percent(num part, num whole) => whole <= 0 ? '0%' : '${(part / whole * 100).round()}%';

  @override
  Widget build(BuildContext context) {
    final t = widget.template;
    final data = _data;
    final totals = (data?['totals'] as Map?) ?? const {};
    num n(Object? v) => (v as num?) ?? 0;
    final days = ((data?['days'] as List?) ?? const []).cast<Map>();
    final top = days.fold<num>(1, (m, d) => [m, n(d['sent']), n(d['delivered']), n(d['read'])].reduce((a, b) => a > b ? a : b));
    Widget stat(String label, num value, [String? note]) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Text('$value', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
          if (note != null) Text(note, style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ),
    );
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${t['name']}', maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(
              '${categoryLabels[t['category']]?.title ?? t['category']} · ${languageLabel(t['language'])} · Insights',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w400),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Performance', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 7, label: Text('7d')),
                  ButtonSegment(value: 30, label: Text('30d')),
                  ButtonSegment(value: 90, label: Text('90d')),
                ],
                selected: {_days},
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                onSelectionChanged: (v) {
                  setState(() => _days = v.first);
                  _load();
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_error.isNotEmpty)
            Text(_error, style: const TextStyle(color: Brand.red))
          else if (data == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            Opacity(
              opacity: _loading ? 0.6 : 1,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  LayoutBuilder(
                    builder: (context, box) {
                      final w = (box.maxWidth - 8) / 2;
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final tile in [
                            stat('Messages sent', n(totals['sent'])),
                            stat('Messages delivered', n(totals['delivered']), '${_percent(n(totals['delivered']), n(totals['sent']))} of sent'),
                            stat('Messages read', n(totals['read']), '${_percent(n(totals['read']), n(totals['delivered']))} of delivered'),
                            stat('Button clicks', n(totals['clicked']), '${_percent(n(totals['clicked']), n(totals['read']))} of read'),
                          ])
                            SizedBox(width: w, child: tile),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 14),
                  // Sent, delivered and read for each day
                  Container(
                    height: 170,
                    padding: const EdgeInsets.fromLTRB(8, 12, 8, 6),
                    decoration: BoxDecoration(
                      border: Border.all(color: Brand.line),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: days.isEmpty
                        ? const Center(
                            child: Text('Nothing sent in this period.', style: TextStyle(color: Brand.muted)),
                          )
                        : Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              for (final day in days)
                                Expanded(
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      for (final (key, color) in [('sent', const Color(0xFF0064E0)), ('delivered', Brand.blue), ('read', const Color(0xFFF7B928))])
                                        Flexible(
                                          child: Container(margin: const EdgeInsets.symmetric(horizontal: 0.5), height: 120 * n(day[key]) / top + 1, color: color),
                                        ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 6),
                  const Wrap(
                    spacing: 12,
                    children: [
                      _Legend(color: Color(0xFF0064E0), label: 'Sent'),
                      _Legend(color: Brand.blue, label: 'Delivered'),
                      _Legend(color: Color(0xFFF7B928), label: 'Read'),
                    ],
                  ),
                  const SectionLabel('Button clicks'),
                  if (((data['buttons'] as List?) ?? const []).isEmpty)
                    const Text('No button clicks in this period.', style: TextStyle(color: Brand.muted))
                  else
                    for (final b in (data['buttons'] as List).cast<Map>())
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${b['text'] ?? 'Button'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text('${b['type']}'.replaceAll('_', ' ').toLowerCase()),
                        trailing: Text('${b['count']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                      ),
                  const SizedBox(height: 8),
                  const Text('Counts come from Meta and can take up to a day to appear. Read counts only include people who share read receipts.', style: TextStyle(fontSize: 12, color: Brand.muted)),
                ],
              ),
            ),
          const SectionLabel('Template preview'),
          TemplatePreview(draft: draftOf(t)),
        ],
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(width: 10, height: 10, color: color),
      const SizedBox(width: 4),
      Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted)),
    ],
  );
}
