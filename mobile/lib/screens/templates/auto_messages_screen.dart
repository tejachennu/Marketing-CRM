import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// The WhatsApp templates for the messages Front Desk or the shop sends by itself, as on the web: each message has a
/// suggested wording the business sends to Meta for approval as it is or after editing it, then sees where it stands
/// (In review, Approved, Rejected with Meta's reason) and can edit and send it again. Once Meta approves it, that
/// message uses it by itself. Same server as the web: GET / POST / PUT on [path] (`/api/salon/templates` or
/// `/api/commerce/shop-messages`), which also writes the template and says what still needs fixing.

/// A word in braces in the editor's text ("{Customer first name}").
final _token = RegExp(r'\{([^{}\n]{1,60})\}');

/// The field a word in braces means (its label in any letter case, or its key), or null.
Map<String, dynamic>? fieldFor(String token, List<Map<String, dynamic>> fields) {
  final wanted = token.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  for (final f in fields) {
    if ('${f['label']}'.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim() == wanted || f['key'] == wanted.replaceAll(' ', '_')) return f;
  }
  return null;
}

/// Words in braces that are not a blank this message fills.
List<String> unknownBlanks(String text, List<Map<String, dynamic>> fields) => {
  for (final m in _token.allMatches(text))
    if (fieldFor(m.group(1)!, fields) == null && !RegExp(r'^\s*\d+\s*$').hasMatch(m.group(1)!)) m.group(1)!.trim(),
}.toList();

List<Map<String, dynamic>> _maps(Object? list) => [for (final x in (list as List? ?? const [])) Map<String, dynamic>.from(x as Map)];

class AutoMessagesScreen extends StatefulWidget {
  const AutoMessagesScreen({super.key, required this.title, required this.path, required this.intro, this.shop = false, this.onChanged});
  final String title;
  final String path;
  final String intro;

  /// The shop's messages (switches, and its way of picking a template); Front Desk otherwise.
  final bool shop;

  /// After something changed (Front Desk reloads its setup, which counts the templates set up).
  final Future<void> Function(BuildContext context)? onChanged;

  @override
  State<AutoMessagesScreen> createState() => _AutoMessagesScreenState();
}

class _AutoMessagesScreenState extends State<AutoMessagesScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  String? _busy;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final app = AppScope.read(context);
      final data = await app.backend.get(widget.path, {'organizationId': app.orgId});
      if (mounted) {
        setState(() {
          _data = data;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _run(String busy, Future<void> Function() work, {String? done}) async {
    setState(() => _busy = busy);
    try {
      await work();
      await _load();
      if (mounted) await widget.onChanged?.call(context);
      if (mounted && done != null) toast(context, done);
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _sendSuggested(Map<String, dynamic> view) => _run(
    '${view['purpose']}',
    () => AppScope.read(context).ask(widget.path, {'purpose': view['purpose'], 'text': (view['suggestion'] as Map)['text'], 'language': 'en', 'buttons': (view['suggestion'] as Map)['buttons']}),
    done: 'Sent to Meta for approval.',
  );

  Future<void> _toggle(Map<String, dynamic> view, bool on) {
    final messages = Map<String, dynamic>.from(_data?['messages'] as Map? ?? const {});
    messages['${view['purpose']}'] = {...Map<String, dynamic>.from(messages['${view['purpose']}'] as Map? ?? const {}), 'on': on};
    return _run('on:${view['purpose']}', () => AppScope.read(context).ask(widget.path, {'messages': messages}, method: 'PUT'));
  }

  /// Use one of the account's approved templates for a message (null: stop using a template).
  Future<void> _pick(Map<String, dynamic> view, Map<String, dynamic>? chosen) {
    final purpose = '${view['purpose']}';
    final app = AppScope.read(context);
    return _run('pick:$purpose', () {
      if (widget.shop) {
        return app.ask(widget.path, {
          'purpose': purpose,
          'pick': chosen == null ? null : {'template': chosen['name'], 'language': chosen['language'], 'fields': chosen['fields']},
        }, method: 'PUT');
      }
      final choices = Map<String, dynamic>.from(_data?['choices'] as Map? ?? const {});
      if (chosen == null) {
        choices.remove(purpose);
      } else {
        final hasLink = _maps(view['buttons']).any((b) => b['type'] == 'URL');
        choices[purpose] = {'name': chosen['name'], 'language': chosen['language'], 'fields': chosen['fields'], 'url_field': chosen['urlButton'] == true && hasLink ? 'link' : null};
      }
      return app.ask(widget.path, {'choices': choices}, method: 'PUT');
    }, done: chosen == null ? 'Stopped using a template.' : 'Saved.');
  }

  Future<void> _edit(Map<String, dynamic> view) async {
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => AutoMessageEditor(view: view, path: widget.path, languages: _maps(_data?['languages'])),
      ),
    );
    if (sent == true) {
      await _load();
      if (mounted) await widget.onChanged?.call(context);
      if (mounted) toast(context, 'Sent to Meta for approval.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final views = _maps(data?['autoMessages']);
    final approved = views.where((v) => (v['current'] as Map?)?['state'] == 'approved').length;
    final locked = data?['ownWhatsApp'] == false;
    final connected = data?['connected'] == true;
    final account = _maps(data?['account']).where((t) => t['status'] == 'APPROVED').toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [if (data != null && !locked) IconButton(tooltip: 'Check status', onPressed: _busy == null ? _load : null, icon: const Icon(Icons.refresh))],
      ),
      body: data == null
          ? (_error != null
                ? ListView(
                    children: [
                      EmptyState(
                        icon: Icons.wifi_off,
                        title: 'Could not load',
                        text: _error!,
                        action: OutlinedButton(onPressed: _load, child: const Text('Try again')),
                      ),
                    ],
                  )
                : const SkeletonCards(tiles: false))
          : RefreshIndicator(
              onRefresh: _load,
              // A handful of messages: all built at once (a lazy list would leave the lower cards unbuilt)
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (locked)
                      Panel(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.lock_outline, color: Brand.muted),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                widget.shop
                                    ? "These messages go from your own WhatsApp number, which comes with Growth. On your plan, customers get their order confirmation from WAMA's WhatsApp number."
                                    : "On your plan these messages go from WAMA's WhatsApp number with fixed wording that is already approved, so there is nothing to set up here. Your own wording, from your own WhatsApp number, comes with Growth.",
                                style: const TextStyle(color: Brand.textSoft, height: 1.4),
                              ),
                            ),
                          ],
                        ),
                      )
                    else ...[
                      Text(widget.intro, style: const TextStyle(color: Brand.textSoft, height: 1.4)),
                      const SizedBox(height: 6),
                      Text(
                        '$approved of ${views.length} approved',
                        style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w600),
                      ),
                      if ('${data['message'] ?? ''}'.trim().isNotEmpty || !connected) ...[
                        const SizedBox(height: 10),
                        _Note('${data['message'] ?? 'Connect WhatsApp on the web to send templates for approval.'}'),
                      ],
                      const SizedBox(height: 12),
                      for (final view in views) ...[
                        _MessageCard(
                          view: view,
                          connected: connected,
                          busy: _busy,
                          canPick: account.isNotEmpty,
                          onSend: () => _sendSuggested(view),
                          onEdit: () => _edit(view),
                          onCheck: _load,
                          onToggle: (on) => _toggle(view, on),
                          onPick: () async {
                            final chosen = await showModalBottomSheet<Map<String, dynamic>>(
                              context: context,
                              isScrollControlled: true,
                              showDragHandle: true,
                              builder: (_) => _PickSheet(view: view, account: account),
                            );
                            if (chosen != null) await _pick(view, chosen);
                          },
                          onStop: () => _pick(view, null),
                        ),
                        const SizedBox(height: 10),
                      ],
                    ],
                  ],
                ),
              ),
            ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text, {this.red = false});
  final String text;
  final bool red;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(color: red ? Brand.redSoft : Brand.page, borderRadius: BorderRadius.circular(10)),
    child: Text(text, style: TextStyle(color: red ? Brand.red : Brand.textSoft, fontSize: 13, height: 1.4)),
  );
}

/// The message as the customer sees it on WhatsApp: each blank filled with its example (in bold).
class TemplateBubble extends StatelessWidget {
  const TemplateBubble({super.key, required this.text, required this.fields, this.buttons = const []});
  final String text;
  final List<Map<String, dynamic>> fields;
  final List<String> buttons;

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    var at = 0;
    for (final m in _token.allMatches(text)) {
      spans.add(TextSpan(text: text.substring(at, m.start)));
      final f = fieldFor(m.group(1)!, fields);
      spans.add(
        f == null
            ? TextSpan(
                text: m.group(0),
                style: const TextStyle(color: Brand.red),
              )
            : TextSpan(
                text: '${f['sample']}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
      );
      at = m.end;
    }
    spans.add(TextSpan(text: text.substring(at)));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: Brand.chatBg, borderRadius: BorderRadius.circular(12)),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 420),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: const BorderRadius.only(topRight: Radius.circular(10), bottomLeft: Radius.circular(10), bottomRight: Radius.circular(10)),
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 1, offset: const Offset(0, 1))],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                child: Text.rich(
                  TextSpan(children: spans),
                  style: const TextStyle(fontSize: 14, height: 1.35, color: Brand.text),
                ),
              ),
              for (final b in buttons)
                Container(
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: Brand.line)),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 8),
                  child: Text(
                    b.isEmpty ? 'Button' : b,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({
    required this.view,
    required this.connected,
    required this.busy,
    required this.canPick,
    required this.onSend,
    required this.onEdit,
    required this.onCheck,
    required this.onToggle,
    required this.onPick,
    required this.onStop,
  });
  final Map<String, dynamic> view;
  final bool connected;
  final String? busy;
  final bool canPick;
  final VoidCallback onSend;
  final VoidCallback onEdit;
  final VoidCallback onCheck;
  final ValueChanged<bool> onToggle;
  final VoidCallback onPick;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final current = view['current'] == null ? null : Map<String, dynamic>.from(view['current'] as Map);
    final state = current?['state'];
    final suggestion = Map<String, dynamic>.from(view['suggestion'] as Map);
    final text = '${current?['text'] ?? suggestion['text']}';
    final buttons = [for (final b in ((current?['buttons'] ?? suggestion['buttons']) as List? ?? const [])) '$b'];
    final fallback = (current?['previous'] as Map?)?['state'] == 'approved';
    final idle = busy == null;
    final pill = switch (state) {
      null => const Pill('Not set up'),
      'approved' => const Pill('Approved', tone: PillTone.blue, icon: Icons.check),
      'review' => const Pill('In review', tone: PillTone.navy, icon: Icons.schedule),
      'rejected' || 'missing' => Pill('${current?['label']}', tone: PillTone.red),
      _ => Pill('${current?['label']}'),
    };
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${view['title']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
                    Text('${view['when']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              pill,
            ],
          ),
          if (view['switchable'] == true)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: view['on'] != false,
              onChanged: busy == 'on:${view['purpose']}' ? null : onToggle,
              title: const Text('Send this message', style: TextStyle(fontWeight: FontWeight.w600)),
            )
          else
            const SizedBox(height: 10),
          TemplateBubble(text: text, fields: _maps(view['fields']), buttons: buttons),
          const SizedBox(height: 8),
          if (current != null) Text('On WhatsApp as ${current['name']} · ${current['languageLabel'] ?? current['language']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (current == null)
            const Text('Not set up yet: this message only reaches customers who wrote to you in the last 24 hours.', style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35)),
          if (state == 'review') ...[
            const SizedBox(height: 6),
            _Note('Meta is checking it, usually within minutes and at most a day.${fallback ? ' Until then your earlier approved wording is used.' : ''}'),
          ],
          if (state == 'approved')
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Used by itself when the customer has not written in the last 24 hours.${current?['category'] == 'MARKETING' ? ' Meta approved it as a marketing message: it still works, at Meta\'s marketing rate.' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.textSoft, height: 1.35),
              ),
            ),
          if (state == 'rejected') ...[
            const SizedBox(height: 6),
            _Note('Meta did not approve it. ${current?['reason'] ?? ''}${fallback ? ' Your earlier approved wording is still used.' : ''}', red: true),
          ],
          if (state == 'paused') ...[const SizedBox(height: 6), _Note('${current?['reason'] ?? ''}')],
          if (state == 'missing') ...[const SizedBox(height: 6), const _Note('It is no longer on your WhatsApp account. Send it for approval again.', red: true)],
          if (connected) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (current == null || state == 'missing')
                  FilledButton.icon(
                    onPressed: idle ? onSend : null,
                    icon: busy == view['purpose'] ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send, size: 18),
                    label: const Text('Send for approval'),
                  ),
                if (state == 'rejected')
                  FilledButton.icon(onPressed: idle ? onEdit : null, icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Edit and send again'))
                else
                  OutlinedButton.icon(onPressed: idle ? onEdit : null, icon: const Icon(Icons.edit_outlined, size: 18), label: Text(current == null ? 'Edit first' : 'Edit wording')),
                if (state == 'review') OutlinedButton.icon(onPressed: idle ? onCheck : null, icon: const Icon(Icons.refresh, size: 18), label: const Text('Check status')),
              ],
            ),
            if (canPick || current != null)
              Wrap(
                children: [
                  if (canPick) TextButton(onPressed: idle ? onPick : null, child: const Text('Use one I already have')),
                  if (current != null)
                    TextButton(
                      style: TextButton.styleFrom(foregroundColor: Brand.muted),
                      onPressed: idle ? onStop : null,
                      child: const Text('Stop using a template'),
                    ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}

/// Change the wording, the button words and the language, then send it to Meta for approval.
class AutoMessageEditor extends StatefulWidget {
  const AutoMessageEditor({super.key, required this.view, required this.path, this.languages = const []});
  final Map<String, dynamic> view;
  final String path;
  final List<Map<String, dynamic>> languages;
  @override
  State<AutoMessageEditor> createState() => _AutoMessageEditorState();
}

class _AutoMessageEditorState extends State<AutoMessageEditor> {
  late final Map<String, dynamic>? _current = widget.view['current'] == null ? null : Map<String, dynamic>.from(widget.view['current'] as Map);
  late final Map<String, dynamic> _suggestion = Map<String, dynamic>.from(widget.view['suggestion'] as Map);
  late final List<Map<String, dynamic>> _fields = _maps(widget.view['fields']);
  late final List<Map<String, dynamic>> _buttonDefs = _maps(widget.view['buttons']);
  late final TextEditingController _text = TextEditingController(text: '${_current?['text'] ?? _suggestion['text']}');
  late final List<TextEditingController> _buttons = [
    for (var i = 0; i < _buttonDefs.length; i++)
      TextEditingController(text: '${(_current?['buttons'] as List?)?.elementAtOrNull(i) ?? (_suggestion['buttons'] as List?)?.elementAtOrNull(i) ?? _buttonDefs[i]['text']}'),
  ];
  late String _language = '${_current?['language'] ?? 'en'}';
  bool _sending = false;
  List<String> _problems = [];

  @override
  void dispose() {
    _text.dispose();
    for (final b in _buttons) {
      b.dispose();
    }
    super.dispose();
  }

  void _insert(String label) {
    final token = '{$label}';
    final value = _text.value;
    final start = value.selection.isValid ? value.selection.start : value.text.length;
    final end = value.selection.isValid ? value.selection.end : value.text.length;
    final before = value.text.substring(0, start);
    final pad = before.isNotEmpty && !RegExp(r'\s$').hasMatch(before) ? ' ' : '';
    final text = '$before$pad$token${value.text.substring(end)}';
    final at = before.length + pad.length + token.length;
    setState(() {
      _text.value = TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: at),
      );
      _problems = [];
    });
  }

  Future<void> _send() async {
    final unknown = unknownBlanks(_text.text, _fields);
    if (_text.text.trim().length < 10) return setState(() => _problems = ['Write the message.']);
    if (unknown.isNotEmpty) {
      final which = unknown.map((u) => '{$u}').join(', ');
      return setState(() => _problems = ['$which ${unknown.length == 1 ? 'is not a blank' : 'are not blanks'} this message can fill. Use the blank buttons to add one.']);
    }
    setState(() {
      _sending = true;
      _problems = [];
    });
    try {
      await AppScope.read(context).ask(widget.path, {
        'purpose': widget.view['purpose'],
        'text': _text.text,
        'language': _language,
        'buttons': [for (final b in _buttons) b.text.trim()],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _sending = false;
          _problems = ['$e'.replaceFirst('Exception: ', '')];
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final languages = widget.languages.isNotEmpty
        ? widget.languages
        : [
            {'code': 'en', 'label': 'English'},
            {'code': 'hi', 'label': 'Hindi'},
            {'code': 'te', 'label': 'Telugu'},
          ];
    final codes = {for (final l in languages) '${l['code']}'};
    return Scaffold(
      appBar: AppBar(title: Text('${widget.view['title']}')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_current?['state'] == 'rejected' && _current?['reason'] != null) ...[_Note('Why Meta did not approve it: ${_current!['reason']}', red: true), const SizedBox(height: 12)],
            const Text('Message', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            TextField(
              controller: _text,
              minLines: 4,
              maxLines: 10,
              maxLength: 1100,
              onChanged: (_) => setState(() => _problems = []),
              decoration: const InputDecoration(counterText: ''),
            ),
            const SizedBox(height: 4),
            const Text('Words in braces are filled for each customer. Tap one to add it where the cursor is.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [for (final f in _fields) ActionChip(label: Text('+ ${f['label']}'), onPressed: () => _insert('${f['label']}'))],
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() {
                  _text.text = '${_suggestion['text']}';
                  for (var i = 0; i < _buttons.length; i++) {
                    _buttons[i].text = '${(_suggestion['buttons'] as List?)?.elementAtOrNull(i) ?? _buttonDefs[i]['text']}';
                  }
                  _problems = [];
                }),
                child: const Text('Use the suggestion'),
              ),
            ),
            if (_buttonDefs.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(_buttonDefs.length == 1 ? 'Button' : 'Buttons', style: const TextStyle(fontWeight: FontWeight.w700)),
              for (var i = 0; i < _buttonDefs.length; i++)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: TextField(
                    controller: _buttons[i],
                    maxLength: 25,
                    onChanged: (_) => setState(() => _problems = []),
                    decoration: InputDecoration(labelText: 'Button ${i + 1}', helperText: '${_buttonDefs[i]['note']}', counterText: ''),
                  ),
                ),
            ],
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: codes.contains(_language) ? _language : 'en',
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Language of the words'),
              items: [
                for (final l in languages)
                  DropdownMenuItem(
                    value: '${l['code']}',
                    child: Text('${l['label']}', overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => _language = v ?? _language),
            ),
            const SizedBox(height: 8),
            const Text(
              'Kind: Utility, an update about a visit or an order. Keep it to the facts, without offers, so Meta approves it as one.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35),
            ),
            const SizedBox(height: 14),
            const Text('How it looks', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            TemplateBubble(text: _text.text, fields: _fields, buttons: [for (final b in _buttons) b.text]),
            for (final p in _problems)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  p,
                  style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _sending ? null : _send,
              icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send, size: 18),
              label: const Text('Send for approval'),
            ),
            const SizedBox(height: 8),
            Text(
              _current?['state'] == 'approved'
                  ? 'It goes to Meta as a new template. Your approved wording keeps going out until Meta approves this one.'
                  : 'It goes to Meta as a new template on your WhatsApp account. Meta usually answers within minutes.',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

/// Use one of the account's approved templates, and say what fills each of its blanks.
class _PickSheet extends StatefulWidget {
  const _PickSheet({required this.view, required this.account});
  final Map<String, dynamic> view;
  final List<Map<String, dynamic>> account;
  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  Map<String, dynamic>? _picked;
  List<String> _fields = [];

  @override
  Widget build(BuildContext context) {
    final fields = _maps(widget.view['fields']);
    final suggested = [for (final f in ((widget.view['suggestion'] as Map?)?['fieldKeys'] as List? ?? const [])) '$f'];
    final hasLink = _maps(widget.view['buttons']).any((b) => b['type'] == 'URL');
    final options = widget.account.where((t) => hasLink || t['urlButton'] != true).toList();
    final blanks = (_picked?['blanks'] as num?)?.toInt() ?? 0;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Use one I already have', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Your approved templates${hasLink ? '' : ' without a link button (this message has no link to open)'}.', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            if (options.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('None fit this message yet.', style: TextStyle(color: Brand.muted)),
              ),
            for (final t in options)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(_picked == t ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: Brand.blue),
                title: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${t['body']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                onTap: () => setState(() {
                  _picked = t;
                  final n = (t['blanks'] as num?)?.toInt() ?? 0;
                  _fields = [for (var i = 0; i < n; i++) i < suggested.length ? suggested[i] : '${fields[i.clamp(0, fields.length - 1)]['key']}'];
                }),
              ),
            for (var i = 0; i < blanks; i++)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: DropdownButtonFormField<String>(
                  key: ValueKey('${_picked?['name']}:$i'),
                  initialValue: _fields[i],
                  isExpanded: true,
                  decoration: InputDecoration(labelText: 'Blank ${i + 1}'),
                  items: [
                    for (final f in fields)
                      DropdownMenuItem(
                        value: '${f['key']}',
                        child: Text('${f['label']}', overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (v) => setState(() => _fields[i] = v ?? _fields[i]),
                ),
              ),
            const SizedBox(height: 14),
            FilledButton(onPressed: _picked == null ? null : () => Navigator.pop(context, {..._picked!, 'fields': _fields}), child: const Text('Use it')),
          ],
        ),
      ),
    );
  }
}
