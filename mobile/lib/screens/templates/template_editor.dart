import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'template_model.dart';
import 'template_preview.dart';

/// Create or edit a WhatsApp template, section by section as on the web (and WhatsApp Manager):
/// variable type, offer banner, header, body, samples, cards, footer, buttons, validity period.
/// Meta's rules are checked by the server, the same rules as the web.
class TemplateEditorScreen extends StatefulWidget {
  const TemplateEditorScreen({super.key, required this.draft, this.editing, this.flows = const []});
  final Draft draft;

  /// The template being edited (from Meta's list), or null for a new one.
  final Map<String, dynamic>? editing;
  final List<Map<String, dynamic>> flows;
  @override
  State<TemplateEditorScreen> createState() => _TemplateEditorScreenState();
}

class _TemplateEditorScreenState extends State<TemplateEditorScreen> {
  late final Draft d = copyDraft(widget.draft);
  final Map<String, Uint8List> _media = {};
  List<Map<String, dynamic>> _problems = const [];
  String _submitError = '';
  bool _busy = false;
  final _scroll = ScrollController();

  bool _checked = false;
  bool _checking = false;
  Timer? _checkTimer;

  bool get _editing => widget.editing != null;
  String get _type => '${d['type']}';
  void _set(void Function() change) {
    setState(change);
    _scheduleCheck();
  }

  @override
  void initState() {
    super.initState();
    _scheduleCheck(const Duration(milliseconds: 300));
  }

  @override
  void dispose() {
    _checkTimer?.cancel();
    super.dispose();
  }

  /// Ask the server what still needs fixing (Meta's rules, the same as the web), a moment after typing stops.
  void _scheduleCheck([Duration wait = const Duration(milliseconds: 900)]) {
    _checkTimer?.cancel();
    _checkTimer = Timer(wait, _check);
  }

  Future<void> _check() async {
    if (!mounted) return;
    final app = AppScope.read(context);
    setState(() => _checking = true);
    try {
      final data = await app.ask('/api/whatsapp-templates', {'draft': d, 'check': true});
      if (!mounted) return;
      setState(() {
        _problems = [for (final p in (data['problems'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
        _checked = true;
      });
    } catch (_) {
      // Offline or the server is older: checked again on Submit
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  bool _tried = false;
  List<String> _errors(String field) => [
    if (_tried)
      for (final p in _problems)
        if (p['field'] == field) '${p['message']}',
  ];

  Future<void> _submit([TabController? tabs]) async {
    final app = AppScope.read(context);
    setState(() {
      _tried = true;
      _busy = true;
      _submitError = '';
    });
    try {
      final check = await app.ask('/api/whatsapp-templates', {'draft': d, 'check': true});
      final problems = [for (final p in (check['problems'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
      if (problems.isNotEmpty) {
        setState(() {
          _problems = problems;
          _checked = true;
        });
        tabs?.animateTo(1);
        return;
      }
      setState(() => _problems = const []);
      if (_editing) {
        final t = widget.editing!;
        await app.ask('/api/whatsapp-templates', {'templateId': t['id'], 'draft': d, 'changeCategory': t['status'] != 'APPROVED' && t['category'] != d['category']}, method: 'PATCH');
      } else {
        await app.ask('/api/whatsapp-templates', {'draft': d});
      }
      if (!mounted) return;
      Navigator.pop(context, _editing ? '“${d['name']}” was updated and sent for review.' : '“${d['name']}” was submitted. Meta usually reviews it within minutes.');
    } catch (e) {
      if (mounted) setState(() => _submitError = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _status(TabController? tabs) {
    final ready = _checked && _problems.isEmpty;
    final (bg, fg, icon, label) = _checking && !_checked
        ? (Brand.page, Brand.muted, Icons.hourglass_empty, 'Checking')
        : ready
        ? (Brand.bubble, const Color(0xFF15603E), Icons.check_circle, 'Ready')
        : _problems.isNotEmpty
        ? (Brand.redSoft, Brand.red, Icons.error_outline, '${_problems.length} to fix')
        : (Brand.page, Brand.muted, Icons.pending_outlined, 'Not checked');
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => tabs?.animateTo(1),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: fg),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The preview tab: how it looks in WhatsApp, and Meta's checklist.
  Widget _previewTab() => ListView(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
    children: [
      TemplatePreview(draft: d, localMedia: _media),
      const SizedBox(height: 16),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: _checked && _problems.isEmpty ? Brand.bubble : (_problems.isEmpty ? Brand.page : Brand.redSoft), borderRadius: BorderRadius.circular(14)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  _checked && _problems.isEmpty ? Icons.verified_outlined : (_problems.isEmpty ? Icons.pending_outlined : Icons.error_outline),
                  color: _checked && _problems.isEmpty ? const Color(0xFF15603E) : (_problems.isEmpty ? Brand.muted : Brand.red),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _checked && _problems.isEmpty
                        ? "Ready to submit. It follows Meta's rules."
                        : _problems.isEmpty
                        ? 'Checking it against Meta’s rules…'
                        : 'Fix ${_problems.length == 1 ? 'this' : 'these ${_problems.length} things'} before submitting',
                    style: TextStyle(fontWeight: FontWeight.w700, color: _problems.isEmpty ? Brand.text : Brand.red),
                  ),
                ),
              ],
            ),
            if (_problems.isNotEmpty) ...[
              const SizedBox(height: 6),
              for (final p in _problems.take(10))
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('• ${p['message']}', style: const TextStyle(fontSize: 13)),
                ),
            ],
          ],
        ),
      ),
      if (_submitError.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Text('Meta: $_submitError', style: const TextStyle(color: Brand.red)),
        ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final canManage = app.can('campaigns') || app.can('manage');
    final editing = widget.editing;
    return DefaultTabController(
      length: 2,
      child: Builder(
        builder: (context) {
          final tabs = DefaultTabController.of(context);
          return Scaffold(
            appBar: AppBar(
              titleSpacing: 0,
              title: Row(
                children: [
                  CategoryIcon(category: '${d['category']}', size: 36),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_editing ? 'Edit ${d['name']}' : '${d['name']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text(
                          '${typeTitle('${d['category']}', _type)} · ${languageLabel(d['language'])}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w400),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              actions: [_status(tabs)],
              bottom: const TabBar(
                tabs: [
                  Tab(text: 'Edit'),
                  Tab(text: 'Preview'),
                ],
              ),
            ),
            body: TabBarView(
              children: [
                ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
                  children: [
                    if (editing?['status'] == 'REJECTED')
                      _Banner(
                        text: 'Rejected by Meta. ${rejectionReasons['${editing!['rejected_reason'] ?? 'NONE'}'] ?? editing['rejected_reason']} Fix the content below and submit it again.',
                        danger: true,
                      ),
                    if (_editing && editing!['status'] == 'APPROVED')
                      const _Banner(text: 'You can edit an approved template once a day and up to 10 times a month. After you submit, it goes back into review and you can keep sending it meanwhile.'),
                    ..._type == 'otp' ? _otpSections() : _sections(),
                    if (_submitError.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text('Meta: $_submitError', style: const TextStyle(color: Brand.red)),
                      ),
                    if (!canManage)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text('Only admins and managers can submit templates.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
                      ),
                  ],
                ),
                _previewTab(),
              ],
            ),
            bottomNavigationBar: SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Brand.line)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Discard')),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: FilledButton.icon(
                        onPressed: _busy || !canManage ? null : () => _submit(tabs),
                        icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
                        label: Text(_editing ? 'Submit changes' : 'Submit for review'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // ── Authentication (one-time passcode) ──

  List<Widget> _otpSections() {
    final otp = d['otp'] as Map;
    final apps = (otp['apps'] as List).cast<Map>();
    return [
      _Section(
        title: 'Code delivery setup',
        description: 'Choose how customers send the code from WhatsApp to your app.',
        errors: _errors('otp'),
        children: [
          for (final (value, title, text) in [
            ('ZERO_TAP', 'Zero-tap autofill', 'The code is sent to your app automatically, without the customer leaving it. Android only; falls back to one-tap and copy code.'),
            ('ONE_TAP', 'One-tap autofill', 'The customer taps a button to fill the code in your app. Android only; falls back to copy code.'),
            ('COPY_CODE', 'Copy code', 'The customer copies the code and pastes it into your app or website.'),
          ])
            _Choice(selected: otp['type'] == value, title: title, text: text, onTap: () => _set(() => otp['type'] = value)),
          if (otp['type'] != 'COPY_CODE') ...[
            const SizedBox(height: 8),
            const Text('App setup', style: TextStyle(fontWeight: FontWeight.w700)),
            for (final (i, a) in apps.indexed)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: _Input(
                        key: ValueKey('pkg$i'),
                        label: 'Package name',
                        value: '${a['packageName'] ?? ''}',
                        hint: 'com.example.app',
                        onChanged: (v) => _set(() => a['packageName'] = v.trim()),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _Input(
                        key: ValueKey('hash$i'),
                        label: 'App signature hash',
                        value: '${a['signatureHash'] ?? ''}',
                        hint: '11 characters',
                        onChanged: (v) => _set(() => a['signatureHash'] = v.trim()),
                      ),
                    ),
                    if (apps.length > 1) IconButton(tooltip: 'Remove app', onPressed: () => _set(() => apps.removeAt(i)), icon: const Icon(Icons.close)),
                  ],
                ),
              ),
            if (apps.length < Limits.otpApps)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _set(() => (otp['apps'] as List).add({'packageName': '', 'signatureHash': ''})),
                  icon: const Icon(Icons.add),
                  label: const Text('Add another app'),
                ),
              ),
            if (otp['type'] == 'ZERO_TAP')
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: otp['zeroTapTermsAccepted'] == true,
                onChanged: (v) => _set(() => otp['zeroTapTermsAccepted'] = v == true),
                title: const Text(
                  "I understand that zero-tap autofill sends the code straight to my app, and I'm responsible for using it as WhatsApp's zero-tap terms describe.",
                  style: TextStyle(fontSize: 13),
                ),
              ),
          ],
        ],
      ),
      _Section(
        title: 'Content',
        description: 'Meta writes the message text for authentication templates. Choose what it includes.',
        children: [
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: otp['addSecurityRecommendation'] != false,
            onChanged: (v) => _set(() => otp['addSecurityRecommendation'] = v == true),
            title: const Text('Add security recommendation'),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: otp['codeExpirationMinutes'] != null,
            onChanged: (v) => _set(() => otp['codeExpirationMinutes'] = v == true ? 10 : null),
            title: const Text('Add expiry time for the code'),
          ),
          if (otp['codeExpirationMinutes'] != null)
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('Expires in '),
                SizedBox(
                  width: 70,
                  child: _Input(
                    key: const ValueKey('expiry'),
                    value: '${otp['codeExpirationMinutes']}',
                    number: true,
                    onChanged: (v) => _set(() => otp['codeExpirationMinutes'] = int.tryParse(v) ?? 1),
                  ),
                ),
                const Text(' minutes'),
              ],
            ),
        ],
      ),
      _Section(
        title: 'Buttons',
        description: 'The button the customer taps to copy or autofill the code.',
        children: [
          _Input(key: const ValueKey('copy'), label: 'Copy code button', value: '${otp['buttonText'] ?? ''}', max: Limits.buttonText, onChanged: (v) => _set(() => otp['buttonText'] = v)),
          if (otp['type'] != 'COPY_CODE') ...[
            const SizedBox(height: 8),
            _Input(key: const ValueKey('autofill'), label: 'Autofill button', value: '${otp['autofillText'] ?? ''}', max: Limits.buttonText, onChanged: (v) => _set(() => otp['autofillText'] = v)),
          ],
        ],
      ),
      _validity(),
    ];
  }

  // ── Everything else ──

  List<Widget> _sections() {
    final format = '${d['parameterFormat']}';
    final samples = d['samples'] as Map;
    final headerVars = '${d['headerFormat']}' == 'TEXT' ? extractVariables('${d['headerText']}') : <String>[];
    final bodyVars = extractVariables('${d['body']}');
    final headerFormats = _type == 'lto'
        ? ['NONE', 'IMAGE', 'VIDEO']
        : _type == 'mpm'
        ? ['TEXT']
        : ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'];
    final allowedButtons = _type == 'coupon' || _type == 'lto'
        ? ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']
        : _type == 'flow'
        ? ['FLOW']
        : ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'VOICE_CALL'];
    const fixedButtons = {
      'catalog': ('View catalog', 'Opens your WhatsApp catalogue. Link a catalogue in Commerce first.'),
      'mpm': ('View items', 'Opens the products you pick when sending (up to 30, in sections).'),
      'spm': ('View', 'Opens the product you pick when sending.'),
      'product_carousel': ('View', 'Each card opens its product.'),
      'order_details': ('Review and pay', 'Opens the order with the amount, items and payment options you set when sending. Needs a payment setup in WhatsApp Manager.'),
    };
    final fixed = fixedButtons[_type];
    final cards = (d['cards'] as List).cast<Map<String, dynamic>>();
    return [
      _Section(
        title: 'Variable type',
        description: 'Choose how variables look in your message: numbers like {{1}} or names like {{first_name}}.',
        children: [
          Wrap(
            spacing: 6,
            children: [
              for (final (value, label) in [('POSITIONAL', 'Number'), ('NAMED', 'Name')])
                ChoiceChip(label: Text(label), selected: format == value, onSelected: _editing ? null : (_) => _set(() => d['parameterFormat'] = value)),
            ],
          ),
        ],
      ),
      if (_type == 'lto')
        _Section(
          title: 'Limited-time offer',
          description: 'A banner above your message with the offer heading and an expiry countdown.',
          errors: _errors('lto'),
          children: [
            _Input(key: const ValueKey('lto'), label: 'Offer heading', value: '${(d['lto'] as Map)['text'] ?? ''}', max: Limits.ltoText, onChanged: (v) => _set(() => (d['lto'] as Map)['text'] = v)),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: (d['lto'] as Map)['hasExpiration'] != false,
              onChanged: (v) => _set(() => (d['lto'] as Map)['hasExpiration'] = v == true),
              title: const Text('Show offer expiry (set when sending)'),
            ),
          ],
        ),
      if (_type == 'spm')
        const _Section(
          title: 'Header',
          description: "The product's image, name and price show at the top. You pick the product each time you send.",
          children: [Pill('Product', icon: Icons.shopping_bag_outlined)],
        ),
      if (!['carousel', 'product_carousel', 'spm'].contains(_type))
        _Section(
          title: 'Header',
          optional: _type != 'mpm',
          description: "Add a title, or choose the type of media you'll send with this header.",
          errors: _errors('header'),
          children: [
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final f in headerFormats)
                  ChoiceChip(
                    label: Text(switch (f) {
                      'NONE' => 'None',
                      'TEXT' => 'Text',
                      'IMAGE' => 'Image',
                      'VIDEO' => 'Video',
                      'DOCUMENT' => 'Document',
                      _ => 'Location',
                    }),
                    selected: d['headerFormat'] == f,
                    onSelected: (_) => _set(() {
                      d['headerFormat'] = f;
                      d['headerHandle'] = '';
                      d.remove('headerPreview');
                      _media.remove('header');
                    }),
                  ),
              ],
            ),
            if (d['headerFormat'] == 'TEXT') ...[
              const SizedBox(height: 10),
              _RichField(
                key: const ValueKey('header'),
                value: '${d['headerText'] ?? ''}',
                max: Limits.headerText,
                lines: 1,
                hint: 'Enter header text',
                tools: false,
                onChanged: (v) => _set(() => d['headerText'] = v),
                addVariable: headerVars.isEmpty ? () => nextVariable('', format) : null,
              ),
            ],
            if (['IMAGE', 'VIDEO', 'DOCUMENT'].contains(d['headerFormat'])) ...[
              const SizedBox(height: 10),
              _MediaUpload(
                format: '${d['headerFormat']}',
                uploaded: '${d['headerHandle'] ?? ''}'.isNotEmpty && !'${d['headerHandle']}'.startsWith('http'),
                onMeta: '${d['headerHandle'] ?? ''}'.startsWith('http'),
                onUploaded: (handle, bytes) => _set(() {
                  d['headerHandle'] = handle;
                  if (bytes != null) _media['header'] = bytes;
                }),
              ),
            ],
            if (d['headerFormat'] == 'LOCATION')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text("You'll add the location when you send the message.", style: TextStyle(color: Brand.muted)),
              ),
          ],
        ),
      _Section(
        title: 'Body',
        description: _type == 'carousel' ? 'The message above the cards.' : 'Enter the text for your message in the language you selected.',
        errors: _errors('body'),
        children: [
          _RichField(
            key: const ValueKey('body'),
            value: '${d['body'] ?? ''}',
            max: Limits.body,
            lines: 6,
            hint: 'Hello {{1}}, …',
            onChanged: (v) => _set(() => d['body'] = v),
            addVariable: () => nextVariable('${d['body']}', format, headerVars),
          ),
        ],
      ),
      if (bodyVars.isNotEmpty || headerVars.isNotEmpty)
        _Section(
          title: 'Variable samples',
          description: "Include samples of all variables to help Meta review your template. Don't use real customer information.",
          errors: _errors('samples'),
          children: [for (final name in headerVars) _sample('Header', name, samples, 'header:'), for (final name in bodyVars) _sample('Body', name, samples, '')],
        ),
      if (_type == 'product_carousel')
        _Section(
          title: 'Product cards',
          description: 'Each card shows a product from your catalogue, with a View button. You pick the products each time you send.',
          errors: _errors('cards'),
          children: [
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (var n = Limits.minCards; n <= Limits.cards; n++)
                  ChoiceChip(label: Text('$n cards'), selected: (d['productCards'] as num?)?.toInt() == n, onSelected: (_) => _set(() => d['productCards'] = n)),
              ],
            ),
          ],
        ),
      if (_type == 'call_permission')
        const _Section(
          title: 'Call permission request',
          description: "Below your message, customers see a request to allow calls from your business on WhatsApp, with Allow and Don't allow. Needs WhatsApp Business Calling on your number.",
          children: [],
        ),
      if (!['lto', 'carousel', 'product_carousel'].contains(_type))
        _Section(
          title: 'Footer',
          optional: true,
          description: 'Add a short line of text to the bottom of your message.',
          errors: _errors('footer'),
          children: [_Input(key: const ValueKey('footer'), value: '${d['footer'] ?? ''}', hint: 'Enter text', max: Limits.footer, onChanged: (v) => _set(() => d['footer'] = v))],
        ),
      if (_type == 'carousel')
        _Section(
          title: 'Carousel cards',
          description: '${Limits.minCards} to ${Limits.cards} cards. Every card has the same media type and the same buttons.',
          errors: _errors('cards'),
          children: [
            for (final (i, card) in cards.indexed) _card(i, card, cards, format),
            Wrap(
              spacing: 8,
              children: [
                if (cards.length < Limits.cards)
                  OutlinedButton.icon(
                    onPressed: () => _set(
                      () => cards.add({
                        ...emptyCard(),
                        'headerFormat': cards.isEmpty ? 'IMAGE' : cards.first['headerFormat'],
                        'buttons': cards.isEmpty ? emptyCard()['buttons'] : copyDraft({'b': cards.first['buttons']})['b'],
                      }),
                    ),
                    icon: const Icon(Icons.add),
                    label: const Text('Add card'),
                  ),
                if (cards.length > 1)
                  TextButton(
                    onPressed: () => _set(() {
                      for (var i = 1; i < cards.length; i++) {
                        cards[i]['buttons'] = copyDraft({'b': cards.first['buttons']})['b'];
                      }
                    }),
                    child: const Text("Use card 1's buttons on every card"),
                  ),
              ],
            ),
          ],
        ),
      if (fixed != null)
        _Section(title: 'Buttons', description: fixed.$2, children: [Pill(fixed.$1)])
      else if (!['carousel', 'call_permission'].contains(_type))
        _Section(
          title: 'Buttons',
          optional: _type == 'custom',
          description: 'Create buttons that let customers respond to your message or take action.',
          errors: _errors('buttons'),
          children: [_ButtonsEditor(buttons: (d['buttons'] as List).cast<Map<String, dynamic>>(), allowed: allowedButtons, flows: widget.flows, onChanged: () => setState(() {}))],
        ),
      _validity(),
      if (!_editing && d['category'] != 'AUTHENTICATION')
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: d['allowCategoryChange'] != false,
          onChanged: (v) => _set(() => d['allowCategoryChange'] = v == true),
          title: const Text("Allow Meta to change the category if it doesn't match the content, instead of rejecting the template.", style: TextStyle(fontSize: 13, color: Brand.textSoft)),
        ),
    ];
  }

  Widget _sample(String label, String name, Map samples, String prefix) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: _Input(
      key: ValueKey('sample:$prefix$name'),
      label: '$label {{$name}}',
      value: '${samples['$prefix$name'] ?? ''}',
      hint: 'Sample for {{$name}}',
      onChanged: (v) => _set(() => samples['$prefix$name'] = v),
    ),
  );

  Widget _card(int i, Map<String, dynamic> card, List<Map<String, dynamic>> cards, String format) {
    final samples = card['samples'] as Map;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Card ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              if (cards.length > Limits.minCards)
                IconButton(
                  tooltip: 'Remove card ${i + 1}',
                  onPressed: () => _set(() {
                    cards.removeAt(i);
                    _media.remove('card:$i');
                  }),
                  icon: const Icon(Icons.delete_outline, size: 20),
                ),
            ],
          ),
          Wrap(
            spacing: 6,
            children: [
              for (final f in ['IMAGE', 'VIDEO'])
                ChoiceChip(
                  label: Text(f == 'IMAGE' ? 'Image' : 'Video'),
                  selected: card['headerFormat'] == f,
                  // Every card has the same kind of media
                  onSelected: (_) => _set(() {
                    for (final c in cards) {
                      if (c['headerFormat'] != f) {
                        c['headerFormat'] = f;
                        c['headerHandle'] = '';
                        c.remove('headerPreview');
                      }
                    }
                    _media.removeWhere((k, _) => k.startsWith('card:'));
                  }),
                ),
            ],
          ),
          const SizedBox(height: 8),
          _MediaUpload(
            format: '${card['headerFormat']}',
            uploaded: '${card['headerHandle'] ?? ''}'.isNotEmpty && !'${card['headerHandle']}'.startsWith('http'),
            onMeta: '${card['headerHandle'] ?? ''}'.startsWith('http'),
            onUploaded: (handle, bytes) => _set(() {
              card['headerHandle'] = handle;
              if (bytes != null) _media['card:$i'] = bytes;
            }),
          ),
          const SizedBox(height: 8),
          _RichField(
            key: ValueKey('card$i'),
            value: '${card['body'] ?? ''}',
            max: Limits.carouselBody,
            lines: 2,
            hint: 'Card text',
            onChanged: (v) => _set(() => card['body'] = v),
            addVariable: () => nextVariable('${card['body']}', format),
          ),
          for (final name in extractVariables('${card['body']}'))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _Input(key: ValueKey('card$i:$name'), label: 'Sample {{$name}}', value: '${samples[name] ?? ''}', onChanged: (v) => _set(() => samples[name] = v)),
            ),
          const SizedBox(height: 8),
          _ButtonsEditor(buttons: (card['buttons'] as List).cast<Map<String, dynamic>>(), allowed: const ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'], flows: widget.flows, onChanged: () => setState(() {})),
        ],
      ),
    );
  }

  Widget _validity() {
    final limits = ttlLimits[d['category']] ?? ttlLimits['MARKETING']!;
    final choices = ttlChoices.where((s) => s >= limits.min && s <= limits.max).toList();
    final ttl = (d['ttlSeconds'] as num?)?.toInt();
    return _Section(
      title: 'Message validity period',
      optional: true,
      description: "If a message can't be delivered within this time, WhatsApp stops trying. Useful for codes and time-sensitive offers.",
      errors: _errors('ttl'),
      children: [
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: ttl != null,
          onChanged: (v) => _set(() => d['ttlSeconds'] = v == true ? (choices.contains(limits.def) ? limits.def : choices.last) : null),
          title: const Text('Set a custom validity period'),
        ),
        if (ttl != null)
          DropdownButtonFormField<int>(
            initialValue: choices.contains(ttl) ? ttl : choices.last,
            isExpanded: true,
            items: [for (final s in choices) DropdownMenuItem(value: s, child: Text(describeDuration(s)))],
            onChanged: (v) => _set(() => d['ttlSeconds'] = v),
          )
        else
          Text("Meta's default: ${describeDuration(limits.def)}.", style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
      ],
    );
  }
}

// ── Pieces ──

class _Banner extends StatelessWidget {
  const _Banner({required this.text, this.danger = false});
  final String text;
  final bool danger;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: danger ? Brand.redSoft : Brand.page, borderRadius: BorderRadius.circular(12)),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(danger ? Icons.error_outline : Icons.info_outline, size: 19, color: danger ? Brand.red : Brand.textSoft),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5))),
      ],
    ),
  );
}

const _sectionIcons = {
  'Code delivery setup': Icons.phonelink_lock_outlined,
  'Content': Icons.notes,
  'Buttons': Icons.smart_button_outlined,
  'Message validity period': Icons.timer_outlined,
  'Variable type': Icons.data_object,
  'Limited-time offer': Icons.local_offer_outlined,
  'Header': Icons.title,
  'Body': Icons.subject,
  'Variable samples': Icons.edit_note,
  'Product cards': Icons.view_carousel_outlined,
  'Call permission request': Icons.phone_in_talk_outlined,
  'Footer': Icons.short_text,
  'Carousel cards': Icons.view_carousel_outlined,
};

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.description, required this.children, this.optional = false, this.errors = const []});
  final String title, description;
  final List<Widget> children;
  final bool optional;
  final List<String> errors;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: errors.isEmpty ? Brand.line : Brand.red),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(color: errors.isEmpty ? Brand.bubble : Brand.redSoft, borderRadius: BorderRadius.circular(9)),
                  child: Icon(_sectionIcons[title] ?? Icons.tune, size: 17, color: errors.isEmpty ? Brand.blue : Brand.red),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                ),
                if (optional)
                  Container(
                    margin: const EdgeInsets.only(left: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(6)),
                    child: const Text('Optional', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(description, style: const TextStyle(fontSize: 13, color: Brand.muted)),
            if (children.isNotEmpty) const SizedBox(height: 10),
            ...children,
            for (final e in errors)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(e, style: const TextStyle(color: Brand.red, fontSize: 12.5)),
              ),
          ],
        ),
      ),
    ),
  );
}

class _Choice extends StatelessWidget {
  const _Choice({required this.selected, required this.title, required this.text, required this.onTap});
  final bool selected;
  final String title, text;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? Brand.bubble : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? Brand.blue : Brand.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, size: 20, color: selected ? Brand.blue : Brand.faint),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(text, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A text field that keeps its own controller; shows a counter when [max] is set.
class _Input extends StatefulWidget {
  const _Input({super.key, required this.value, required this.onChanged, this.label, this.hint, this.max, this.number = false});
  final String value;
  final ValueChanged<String> onChanged;
  final String? label, hint;
  final int? max;
  final bool number;
  @override
  State<_Input> createState() => _InputState();
}

class _InputState extends State<_Input> {
  late final _c = TextEditingController(text: widget.value);
  @override
  void didUpdateWidget(covariant _Input old) {
    super.didUpdateWidget(old);
    if (widget.value != _c.text) _c.text = widget.value;
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _c,
    keyboardType: widget.number ? TextInputType.number : TextInputType.text,
    onChanged: widget.onChanged,
    decoration: InputDecoration(
      labelText: widget.label,
      hintText: widget.hint,
      isDense: true,
      counterText: widget.max == null ? null : '${_c.text.length}/${widget.max}',
      counterStyle: TextStyle(color: widget.max != null && _c.text.length > widget.max! ? Brand.red : Brand.muted),
    ),
  );
}

const _emojis = [
  '😀',
  '😊',
  '😍',
  '🥳',
  '😎',
  '🤩',
  '👍',
  '🙏',
  '👋',
  '🎉',
  '🎁',
  '🔥',
  '✨',
  '⭐',
  '💯',
  '✅',
  '❤️',
  '💚',
  '🛍️',
  '🛒',
  '📦',
  '🚚',
  '💳',
  '💰',
  '🏷️',
  '⏰',
  '📅',
  '📍',
  '📞',
  '💬',
  '📚',
  '🪔',
];

/// A text box with WhatsApp formatting (bold, italic, strike, mono), emoji and "Add variable".
class _RichField extends StatefulWidget {
  const _RichField({super.key, required this.value, required this.onChanged, required this.max, required this.lines, required this.hint, this.addVariable, this.tools = true});
  final String value;
  final ValueChanged<String> onChanged;
  final int max, lines;
  final String hint;
  final String Function()? addVariable;
  final bool tools;
  @override
  State<_RichField> createState() => _RichFieldState();
}

class _RichFieldState extends State<_RichField> {
  late final _c = TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(covariant _RichField old) {
    super.didUpdateWidget(old);
    if (widget.value != _c.text) _c.text = widget.value;
  }

  void _edit(String before, [String? after]) {
    final sel = _c.selection;
    final text = _c.text;
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    final next = text.substring(0, start) + before + text.substring(start, end) + (after ?? '') + text.substring(end);
    _c.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: end + before.length + (after ?? '').length),
    );
    widget.onChanged(next);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    Widget tool(String tip, Widget icon, VoidCallback onTap) => IconButton(tooltip: tip, visualDensity: VisualDensity.compact, onPressed: onTap, icon: icon);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _c,
          minLines: widget.lines,
          maxLines: widget.lines == 1 ? 1 : widget.lines + 6,
          onChanged: (v) {
            widget.onChanged(v);
            setState(() {});
          },
          decoration: InputDecoration(hintText: widget.hint, isDense: true),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (widget.tools) ...[
                    tool('Bold', const Icon(Icons.format_bold, size: 20), () => _edit('*', '*')),
                    tool('Italic', const Icon(Icons.format_italic, size: 20), () => _edit('_', '_')),
                    tool('Strikethrough', const Icon(Icons.format_strikethrough, size: 20), () => _edit('~', '~')),
                    tool('Monospace', const Icon(Icons.code, size: 20), () => _edit('```', '```')),
                    tool(
                      'Emoji',
                      const Icon(Icons.emoji_emotions_outlined, size: 20),
                      () => showModalBottomSheet<void>(
                        context: context,
                        showDragHandle: true,
                        builder: (sheet) => SafeArea(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                            child: Wrap(
                              spacing: 4,
                              runSpacing: 4,
                              children: [
                                for (final e in _emojis)
                                  InkWell(
                                    onTap: () {
                                      Navigator.pop(sheet);
                                      _edit(e);
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.all(6),
                                      child: Text(e, style: const TextStyle(fontSize: 26)),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (widget.addVariable != null) TextButton.icon(onPressed: () => _edit(widget.addVariable!()), icon: const Icon(Icons.add, size: 18), label: const Text('Add variable')),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text('${_c.text.length}/${widget.max}', style: TextStyle(fontSize: 12, color: _c.text.length > widget.max ? Brand.red : Brand.muted)),
            ),
          ],
        ),
      ],
    );
  }
}

/// Upload a header sample to Meta (the web's MediaUpload). A photo is also kept for the preview.
class _MediaUpload extends StatefulWidget {
  const _MediaUpload({required this.format, required this.uploaded, required this.onMeta, required this.onUploaded});
  final String format;
  final bool uploaded, onMeta;
  final void Function(String handle, Uint8List? bytes) onUploaded;
  @override
  State<_MediaUpload> createState() => _MediaUploadState();
}

class _MediaUploadState extends State<_MediaUpload> {
  bool _busy = false;
  String _error = '';

  Future<void> _pick() async {
    final app = AppScope.read(context);
    final ext = switch (widget.format) {
      'IMAGE' => ['jpg', 'jpeg', 'png'],
      'VIDEO' => ['mp4', '3gp'],
      _ => ['pdf'],
    };
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ext);
    if (file == null) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 4 * 1024 * 1024) throw Exception("This sample is too large. Use a file under 4 MB; it is only an example for Meta's review.");
      final data = await app.uploadFile(bytes, file.name, path: '/api/whatsapp-templates/upload', fields: {'organizationId': app.orgId});
      widget.onUploaded('${data['handle']}', widget.format == 'IMAGE' ? bytes : null);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Wrap(
        spacing: 10,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          OutlinedButton.icon(
            onPressed: _busy ? null : _pick,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.upload),
            label: Text(widget.uploaded ? 'Choose another file' : 'Choose file'),
          ),
          if (widget.uploaded && !_busy)
            const Text(
              'Sample uploaded to Meta',
              style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w600, fontSize: 12.5),
            )
          else if (widget.onMeta)
            const Text('Current sample on Meta', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
        ],
      ),
      Text(switch (widget.format) {
        'IMAGE' => 'JPG or PNG, under 4 MB.',
        'VIDEO' => 'MP4, under 4 MB.',
        _ => 'PDF, under 4 MB.',
      }, style: const TextStyle(fontSize: 12, color: Brand.muted)),
      if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: Brand.red, fontSize: 12.5)),
    ],
  );
}

const _buttonChoices = [
  ('QUICK_REPLY', 'Custom', Icons.reply, 'Quick reply buttons'),
  ('URL', 'Visit website', Icons.open_in_new, 'Call-to-action buttons'),
  ('PHONE_NUMBER', 'Call phone number', Icons.call_outlined, 'Call-to-action buttons'),
  ('COPY_CODE', 'Copy offer code', Icons.copy, 'Call-to-action buttons'),
  ('FLOW', 'Complete flow', Icons.checklist, 'Call-to-action buttons'),
  ('VOICE_CALL', 'Call on WhatsApp', Icons.phone_in_talk_outlined, 'Call-to-action buttons'),
];

Map<String, dynamic> _newButton(String type) => switch (type) {
  'QUICK_REPLY' => {'type': type, 'text': ''},
  'URL' => {'type': type, 'text': 'Visit website', 'url': 'https://'},
  'PHONE_NUMBER' => {'type': type, 'text': 'Call us', 'phone_number': '+91'},
  'COPY_CODE' => {'type': type, 'example': ''},
  'FLOW' => {'type': type, 'text': 'Open form', 'flow_id': ''},
  _ => {'type': type, 'text': 'Call on WhatsApp'},
};

/// Buttons, like the web: quick replies kept together ahead of call-to-action buttons.
class _ButtonsEditor extends StatelessWidget {
  const _ButtonsEditor({required this.buttons, required this.allowed, required this.flows, required this.onChanged});
  final List<Map<String, dynamic>> buttons;
  final List<String> allowed;
  final List<Map<String, dynamic>> flows;
  final VoidCallback onChanged;

  void _add(String type) {
    final next = [...buttons, _newButton(type)];
    buttons
      ..clear()
      ..addAll([...next.where((b) => b['type'] == 'QUICK_REPLY'), ...next.where((b) => b['type'] != 'QUICK_REPLY')]);
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, b) in buttons.indexed)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.fromLTRB(12, 4, 4, 12),
            decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(_buttonChoices.firstWhere((c) => c.$1 == b['type'], orElse: () => _buttonChoices.first).$3, size: 16, color: Brand.textSoft),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _buttonChoices.firstWhere((c) => c.$1 == b['type'], orElse: () => _buttonChoices.first).$2,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Remove button',
                      onPressed: () {
                        buttons.removeAt(i);
                        onChanged();
                      },
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (b['type'] != 'COPY_CODE')
                        _Input(
                          key: ValueKey('btn$i${b['type']}text'),
                          label: 'Button text',
                          value: '${b['text'] ?? ''}',
                          max: Limits.buttonText,
                          onChanged: (v) {
                            b['text'] = v;
                            onChanged();
                          },
                        ),
                      if (b['type'] == 'URL') ...[
                        const SizedBox(height: 8),
                        _Input(
                          key: ValueKey('btn${i}url'),
                          label: 'Website URL',
                          hint: 'https://www.example.com',
                          value: '${b['url'] ?? ''}',
                          onChanged: (v) {
                            b['url'] = v.trim();
                            onChanged();
                          },
                        ),
                        if (extractVariables('${b['url']}').isNotEmpty) ...[
                          const SizedBox(height: 8),
                          _Input(
                            key: ValueKey('btn${i}example'),
                            label: 'Sample full URL',
                            hint: 'https://www.example.com/order/12345',
                            value: '${b['example'] ?? ''}',
                            onChanged: (v) {
                              b['example'] = v.trim();
                              onChanged();
                            },
                          ),
                        ] else
                          Align(
                            alignment: Alignment.centerLeft,
                            child: TextButton(
                              onPressed: () {
                                b['url'] = '${'${b['url']}'.replaceAll(RegExp(r'/+$'), '')}/{{1}}';
                                onChanged();
                              },
                              child: const Text('Make the end of the address a variable'),
                            ),
                          ),
                      ],
                      if (b['type'] == 'PHONE_NUMBER') ...[
                        const SizedBox(height: 8),
                        _Input(
                          key: ValueKey('btn${i}phone'),
                          label: 'Phone number',
                          hint: '+91 98765 43210',
                          value: '${b['phone_number'] ?? ''}',
                          onChanged: (v) {
                            b['phone_number'] = v;
                            onChanged();
                          },
                        ),
                      ],
                      if (b['type'] == 'COPY_CODE')
                        _Input(
                          key: ValueKey('btn${i}code'),
                          label: 'Sample offer code',
                          hint: 'SAVE20',
                          max: Limits.couponCode,
                          value: '${b['example'] ?? ''}',
                          onChanged: (v) {
                            b['example'] = v.toUpperCase();
                            onChanged();
                          },
                        ),
                      if (b['type'] == 'FLOW') ...[
                        const SizedBox(height: 8),
                        if (flows.isNotEmpty)
                          DropdownButtonFormField<String>(
                            initialValue: flows.any((f) => '${f['id']}' == b['flow_id']) ? '${b['flow_id']}' : null,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Flow', isDense: true),
                            hint: const Text('Choose a published flow'),
                            items: [
                              for (final f in flows)
                                DropdownMenuItem(
                                  value: '${f['id']}',
                                  child: Text('${f['name']}', overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) {
                              b['flow_id'] = v ?? '';
                              onChanged();
                            },
                          )
                        else
                          _Input(
                            key: ValueKey('btn${i}flow'),
                            label: 'Flow ID from Meta',
                            number: true,
                            value: '${b['flow_id'] ?? ''}',
                            onChanged: (v) {
                              b['flow_id'] = v.replaceAll(RegExp(r'\D'), '');
                              onChanged();
                            },
                          ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        if (buttons.length < Limits.buttons)
          Align(
            alignment: Alignment.centerLeft,
            child: PopupMenuButton<String>(
              onSelected: _add,
              itemBuilder: (_) => [
                for (final group in {for (final c in _buttonChoices.where((c) => allowed.contains(c.$1))) c.$4}) ...[
                  PopupMenuItem<String>(
                    enabled: false,
                    height: 32,
                    child: Text(
                      group,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.muted),
                    ),
                  ),
                  for (final c in _buttonChoices.where((c) => allowed.contains(c.$1) && c.$4 == group))
                    PopupMenuItem<String>(
                      value: c.$1,
                      child: Row(children: [Icon(c.$3, size: 18), const SizedBox(width: 10), Text(c.$2)]),
                    ),
                ],
              ],
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add, color: Brand.blue),
                    SizedBox(width: 6),
                    Text(
                      'Add button',
                      style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
