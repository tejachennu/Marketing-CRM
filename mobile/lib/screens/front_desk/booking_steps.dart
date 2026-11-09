import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// The booking flow's steps, as on the web: the business's own questions (buttons or a typed
/// answer), messages, photos, link buttons and its location around the booking steps (services,
/// who, day and time), each in the business's own words, plus "Write with AI".

const stepNames = {
  'services': 'Pick services',
  'staff': 'Pick who',
  'choice': 'Question with buttons',
  'text': 'Question with a typed answer',
  'message': 'Message',
  'image': 'Photo',
  'link': 'Link button',
  'location': 'Location',
  'datetime': 'Pick day and time',
};
const stepIcons = {
  'services': Icons.content_cut,
  'staff': Icons.person_outline,
  'choice': Icons.touch_app_outlined,
  'text': Icons.keyboard_outlined,
  'message': Icons.chat_outlined,
  'image': Icons.image_outlined,
  'link': Icons.link,
  'location': Icons.place_outlined,
  'datetime': Icons.calendar_month_outlined,
};
const stepHints = {
  'services': 'Customers pick from your services. Needed for every booking.',
  'staff': 'Customers pick who serves them, or anyone free.',
  'choice': 'Customers tap one answer. Saved on the booking.',
  'text': 'Customers type the answer. Saved on the booking.',
  'message': 'A note to the customer. No answer needed.',
  'image': 'A photo with a caption: an offer, your menu, your shop.',
  'link': 'Words with a button that opens a page: menu, prices, Instagram.',
  'location': 'Your shop on the map, so customers find you.',
  'datetime': 'Customers pick a day, then a free time. Always last.',
};

/// The usual words for the booking steps, used when the business writes none.
const defaultQuestion = {'services': 'Which service would you like?', 'staff': 'Who would you like for {service}?', 'datetime': 'Which day suits you for {service}?'};

List<Map<String, dynamic>> defaultSteps(bool askStaff) => [
  {'id': 's1', 'type': 'services'},
  if (askStaff) {'id': 's2', 'type': 'staff'},
  {'id': askStaff ? 's3' : 's2', 'type': 'datetime'},
];

bool _https(Object? v) => RegExp(r'^https://[^\s]+\.[^\s]+').hasMatch('${v ?? ''}'.trim());

/// Where a Google Maps link points, when the link says it (as the server reads it).
({double latitude, double longitude})? mapsCoordinates(String? url) {
  final text = Uri.decodeFull(url ?? '');
  for (final p in [
    RegExp(r'@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)'),
    RegExp(r'!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)'),
    RegExp(r'[?&](?:q|query|ll|destination|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)'),
  ]) {
    final m = p.firstMatch(text);
    if (m != null) {
      final lat = double.parse(m.group(1)!), lng = double.parse(m.group(2)!);
      if (lat.abs() <= 90 && lng.abs() <= 180) return (latitude: lat, longitude: lng);
    }
  }
  return null;
}

/// What a step still needs before saving, or null (the same rule as the server's stepProblem).
String? stepProblem(Map<String, dynamic> step) {
  final text = '${step['text'] ?? ''}'.trim();
  return switch (step['type']) {
    'choice' => text.isEmpty ? 'a question' : (((step['options'] as List?) ?? const []).length < 2 ? 'at least two answers' : null),
    'text' || 'message' => text.isEmpty ? 'its words' : null,
    'image' => _https(step['url']) ? null : 'a picture',
    'link' => text.isEmpty ? 'its words' : (_https(step['url']) ? null : 'an https link'),
    'location' => '${step['address'] ?? ''}'.trim().isNotEmpty || _https(step['url']) ? null : 'your address or a Google Maps link',
    _ => null,
  };
}

/// Is every step ready? Returns what to fix, or null.
String? unfinishedStep(List<Map<String, dynamic>> steps) {
  for (var i = 0; i < steps.length; i++) {
    final problem = stepProblem(steps[i]);
    if (problem != null) return 'Finish or remove step ${i + 1}: it needs $problem.';
  }
  return null;
}

String _summary(Map<String, dynamic> step) => switch (step['type']) {
  'choice' => '${step['text'] ?? ''} (${((step['options'] as List?) ?? const []).join(' / ')})',
  'text' || 'message' => '${step['text'] ?? ''}',
  'image' => '${step['text'] ?? ''}'.trim().isEmpty ? (_https(step['url']) ? 'Photo added' : '') : 'Photo · ${step['text']}',
  'link' => '${step['text'] ?? ''}'.trim().isEmpty ? '' : '${step['text']} [${'${step['button'] ?? ''}'.trim().isEmpty ? 'Open' : step['button']}]',
  'location' =>
    [step['name'], step['address']].where((x) => '${x ?? ''}'.trim().isNotEmpty).join(', ').isNotEmpty
        ? [step['name'], step['address']].where((x) => '${x ?? ''}'.trim().isNotEmpty).join(', ')
        : (_https(step['url']) ? 'Map link added' : ''),
  _ => '${step['text'] ?? ''}'.trim().isEmpty ? 'Usual words' : '${step['text']}',
};

class StepsEditor extends StatefulWidget {
  const StepsEditor({super.key, required this.steps, required this.onChanged, required this.onDraft, this.business = '', this.address = ''});
  final List<Map<String, dynamic>> steps;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;
  final void Function(String? welcome, String? language) onDraft;
  final String business;

  /// The business's address, to fill a location step in one tap.
  final String address;
  @override
  State<StepsEditor> createState() => _StepsEditorState();
}

class _StepsEditorState extends State<StepsEditor> {
  final _describe = TextEditingController();
  bool _drafting = false;
  String? _note;
  bool _noteIsError = false;

  List<Map<String, dynamic>> get steps => widget.steps;

  void _move(int index, int by) {
    final next = [...steps];
    final moved = next.removeAt(index);
    next.insert(index + by, moved);
    final services = next.indexWhere((s) => s['type'] == 'services');
    final staff = next.indexWhere((s) => s['type'] == 'staff');
    if (next.last['type'] != 'datetime' || (staff >= 0 && staff < services)) return toast(context, 'Pick who stays after services, and day and time stays last.');
    widget.onChanged(next);
  }

  Future<void> _edit(int index) async {
    final saved = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _StepSheet(step: Map<String, dynamic>.from(steps[index]), business: widget.business, address: widget.address),
    );
    if (saved != null) widget.onChanged([...steps]..[index] = saved);
  }

  Future<void> _add(String type) async {
    final step = <String, dynamic>{
      'id': 'n${DateTime.now().microsecondsSinceEpoch}',
      'type': type,
      if (type != 'staff') 'text': '',
      if (type == 'choice') 'options': <String>[],
      if (type == 'location') ...{'name': widget.business, 'address': widget.address},
    };
    final at = type == 'staff' ? steps.indexWhere((s) => s['type'] == 'services') + 1 : steps.length - 1;
    final next = [...steps]..insert(at, step);
    widget.onChanged(next);
    if (type != 'staff') {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (mounted) _edit(at);
    }
  }

  Future<void> _draft() async {
    final app = AppScope.read(context);
    setState(() {
      _drafting = true;
      _note = null;
    });
    try {
      final data = await app.ask('/api/salon/booking-flow/draft', {'description': _describe.text.trim()});
      final draft = Map<String, dynamic>.from(data['draft'] as Map);
      widget.onChanged([for (final s in draft['steps'] as List) Map<String, dynamic>.from(s)]);
      widget.onDraft('${draft['welcome'] ?? ''}'.isEmpty ? null : '${draft['welcome']}', draft['language'] as String?);
      final notes = [for (final n in (data['notes'] as List? ?? const [])) '$n'];
      setState(() {
        _note = 'Drafted ${(draft['steps'] as List).length} steps. Check each one, then save.${notes.isEmpty ? '' : ' ${notes.join(' ')}'}';
        _noteIsError = false;
      });
    } catch (e) {
      setState(() {
        _note = '$e'.replaceFirst('Exception: ', '');
        _noteIsError = true;
      });
    } finally {
      if (mounted) setState(() => _drafting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final full = steps.length >= 12;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Brand.blueSoft,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFCFDCFB)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Row(
                children: [
                  Icon(Icons.auto_awesome, size: 18, color: Brand.blue),
                  SizedBox(width: 6),
                  Text('Write with AI', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Say how customers should book. The AI drafts the steps; you check and save.', style: TextStyle(fontSize: 13, color: Brand.textSoft)),
              const SizedBox(height: 8),
              TextField(
                controller: _describe,
                minLines: 2,
                maxLines: 4,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(hintText: 'First visit? then services, who, day and time. Send our location at the end.'),
              ),
              if (_note != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _note!,
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: _noteIsError ? Brand.red : Brand.text),
                  ),
                ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _drafting || _describe.text.trim().length < 10 ? null : _draft,
                  icon: _drafting ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.auto_awesome, size: 18),
                  label: Text(_drafting ? 'Drafting…' : 'Draft my flow'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const Text('Tap a step to change its words.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 6),
        for (var i = 0; i < steps.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Panel(
              padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
              onTap: () => _edit(i),
              child: Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(10)),
                    child: Icon(stepIcons[steps[i]['type']] ?? Icons.help_outline, size: 19, color: Brand.navy),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${i + 1}. ${stepNames[steps[i]['type']] ?? steps[i]['type']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        if (stepProblem(steps[i]) != null)
                          Text(
                            'Tap to add ${stepProblem(steps[i])}',
                            style: const TextStyle(fontSize: 12.5, color: Brand.red, fontWeight: FontWeight.w600),
                          )
                        else if (_summary(steps[i]).trim().isNotEmpty)
                          Text(
                            _summary(steps[i]),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                          ),
                      ],
                    ),
                  ),
                  if (steps[i]['type'] != 'datetime') ...[
                    IconButton(visualDensity: VisualDensity.compact, tooltip: 'Move up', onPressed: i == 0 ? null : () => _move(i, -1), icon: const Icon(Icons.arrow_upward, size: 18)),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: 'Move down',
                      onPressed: i >= steps.length - 2 ? null : () => _move(i, 1),
                      icon: const Icon(Icons.arrow_downward, size: 18),
                    ),
                  ],
                  if (!['services', 'datetime'].contains(steps[i]['type']))
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: 'Remove',
                      onPressed: () => widget.onChanged([...steps]..removeAt(i)),
                      icon: const Icon(Icons.delete_outline, size: 19, color: Brand.red),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 6),
        Text(full ? 'A flow can have up to 12 steps.' : 'Add a step', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
        const SizedBox(height: 8),
        if (!full)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (type, label) in [
                ('choice', 'Question with buttons'),
                ('text', 'Typed answer'),
                ('message', 'Message'),
                ('location', 'Location'),
                ('image', 'Photo'),
                ('link', 'Link button'),
                if (!steps.any((s) => s['type'] == 'staff')) ('staff', 'Pick who'),
              ])
                ActionChip(
                  avatar: Icon(stepIcons[type], size: 18, color: Brand.blue),
                  label: Text(label),
                  onPressed: () => _add(type),
                ),
            ],
          ),
      ],
    );
  }
}

/// Change one step: its words, and what that kind of step needs (answers, picture, link, place).
class _StepSheet extends StatefulWidget {
  const _StepSheet({required this.step, required this.business, required this.address});
  final Map<String, dynamic> step;
  final String business, address;
  @override
  State<_StepSheet> createState() => _StepSheetState();
}

class _StepSheetState extends State<_StepSheet> {
  late final Map<String, dynamic> s = widget.step;
  late final _text = TextEditingController(text: '${s['text'] ?? ''}');
  late final _label = TextEditingController(text: '${s['label'] ?? ''}');
  late final _url = TextEditingController(text: '${s['url'] ?? ''}');
  late final _button = TextEditingController(text: '${s['button'] ?? ''}');
  late final _name = TextEditingController(text: '${s['name'] ?? ''}');
  late final _address = TextEditingController(text: '${s['address'] ?? ''}');
  late final List<String> _options = List<String>.from((s['options'] as List?)?.map((o) => '$o') ?? const []);
  final _option = TextEditingController();
  bool _uploading = false;
  bool _tried = false;

  String get _type => '${s['type']}';

  Map<String, dynamic> get _result {
    final text = _text.text.trim();
    final url = _url.text.trim();
    final out = <String, dynamic>{'id': s['id'], 'type': _type};
    switch (_type) {
      case 'choice':
        out.addAll({'text': text, 'label': _label.text.trim(), 'options': _options});
      case 'text':
        out.addAll({'text': text, 'label': _label.text.trim()});
      case 'message':
        out['text'] = text;
      case 'image':
        out.addAll({'url': url, if (text.isNotEmpty) 'text': text});
      case 'link':
        out.addAll({'text': text, 'url': url, 'button': _button.text.trim()});
      case 'location':
        final at = mapsCoordinates(url);
        out.addAll({
          'name': _name.text.trim(),
          'address': _address.text.trim(),
          if (url.isNotEmpty) 'url': url,
          if (at != null) ...{'latitude': at.latitude, 'longitude': at.longitude},
          if (text.isNotEmpty) 'text': text,
        });
      default:
        if (text.isNotEmpty) out['text'] = text;
    }
    return out;
  }

  Future<void> _pickPhoto() async {
    final app = AppScope.read(context);
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png']);
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 5 * 1024 * 1024) throw Exception('That photo is too big. WhatsApp takes photos up to 5 MB.');
      final up = await app.uploadFile(bytes, file.name);
      final url = '${up['url'] ?? ''}';
      if (!url.startsWith('https://')) throw Exception('The photo could not be stored. Paste a link to it instead.');
      setState(() => _url.text = url);
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final problem = stepProblem(_result);
    final at = mapsCoordinates(_url.text);
    Widget field(TextEditingController c, String label, {String? hint, int lines = 1, int? max, TextInputType? keyboard}) => Padding(
      padding: const EdgeInsets.only(top: 10),
      child: TextField(
        controller: c,
        minLines: lines,
        maxLines: lines == 1 ? 1 : lines + 2,
        maxLength: max,
        keyboardType: keyboard,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(labelText: label, hintText: hint, counterText: ''),
      ),
    );
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(stepIcons[_type], color: Brand.navy),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(stepNames[_type] ?? _type, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(stepHints[_type] ?? '', style: const TextStyle(fontSize: 13, color: Brand.muted)),
            if (defaultQuestion.containsKey(_type)) ...[
              field(_text, 'Your own words (optional)', hint: defaultQuestion[_type], lines: 2, max: 300),
              const SizedBox(height: 4),
              Text('Left empty, it says: "${defaultQuestion[_type]}"${_type == 'services' ? '' : ' ({service} becomes what they picked)'}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ],
            if (_type == 'choice' || _type == 'text') ...[
              field(_text, 'Question', hint: _type == 'choice' ? 'Is this your first visit?' : 'Any allergies?', lines: 2, max: 300),
              field(_label, 'Saved on the booking as', hint: 'Allergies', max: 30),
            ],
            if (_type == 'message') field(_text, 'Message', hint: 'Please come 10 minutes early.', lines: 3, max: 600),
            if (_type == 'choice') ...[
              const SizedBox(height: 14),
              Text('Answers to tap (${_options.length} of 10)', style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [for (final o in _options) InputChip(label: Text(o), onDeleted: () => setState(() => _options.remove(o)))],
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _option,
                      maxLength: 24,
                      decoration: const InputDecoration(hintText: 'Add an answer, like Yes', counterText: ''),
                      onSubmitted: (_) => setState(() {
                        final o = _option.text.trim();
                        if (o.isNotEmpty && !_options.contains(o) && _options.length < 10) _options.add(o);
                        _option.clear();
                      }),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: () => setState(() {
                      final o = _option.text.trim();
                      if (o.isNotEmpty && !_options.contains(o) && _options.length < 10) _options.add(o);
                      _option.clear();
                    }),
                    child: const Text('Add'),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Up to 3 answers show as buttons; more show as a list.', style: TextStyle(fontSize: 12, color: Brand.muted)),
            ],
            if (_type == 'image') ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      width: 84,
                      height: 84,
                      color: Brand.page,
                      child: _https(_url.text)
                          ? Image.network(
                              _url.text,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, color: Brand.faint),
                            )
                          : const Icon(Icons.image_outlined, color: Brand.faint, size: 30),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _uploading ? null : _pickPhoto,
                      icon: _uploading ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.upload),
                      label: Text(_https(_url.text) ? 'Change photo' : 'Choose a photo'),
                    ),
                  ),
                ],
              ),
              field(_url, 'or a link to the photo', hint: 'https://…jpg', keyboard: TextInputType.url),
              field(_text, 'Caption (optional)', hint: '20% off on facials this week', lines: 2, max: 600),
            ],
            if (_type == 'link') ...[
              field(_text, 'Words above the button', hint: 'See all our prices before you choose.', lines: 2, max: 600),
              field(_url, 'Link', hint: 'https://… (menu, prices, Instagram)', keyboard: TextInputType.url),
              field(_button, 'Button words', hint: 'See prices', max: 20),
            ],
            if (_type == 'location') ...[
              field(_name, 'Place name', hint: 'Glow Salon', max: 60),
              field(_address, 'Address', hint: 'Shop 4, Road 12, Banjara Hills', lines: 2, max: 200),
              if (widget.address.isNotEmpty && _address.text.trim() != widget.address)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setState(() {
                      _address.text = widget.address;
                      if (_name.text.trim().isEmpty) _name.text = widget.business;
                    }),
                    icon: const Icon(Icons.storefront_outlined, size: 18),
                    label: const Text('Use my business address'),
                  ),
                ),
              field(_url, 'Google Maps link (optional)', hint: 'Open your shop in Maps, Share, Copy link', keyboard: TextInputType.url),
              const SizedBox(height: 6),
              Text(
                at != null ? 'Sent as a map pin.' : 'Sent as your address with an "Open map" button. A Google Maps link with the place in it (like …/@17.41,78.44…) sends a map pin.',
                style: TextStyle(fontSize: 12.5, color: at != null ? Brand.blue : Brand.muted, fontWeight: at != null ? FontWeight.w700 : FontWeight.w400),
              ),
              field(_text, 'A line before the map (optional)', hint: 'Here is how to find us:', max: 300),
            ],
            if (_type != 'services' && _type != 'datetime' && _type != 'staff')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('{name} becomes the customer\'s first name, {business} your business name.', style: TextStyle(fontSize: 12, color: Brand.muted)),
              ),
            if (_tried && problem != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  'This step needs $problem.',
                  style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () {
                setState(() => _tried = true);
                if (problem != null) return;
                Navigator.pop(context, _result);
              },
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── How the customer sees it ──

class ChatBubble extends StatelessWidget {
  const ChatBubble({super.key, this.mine = false, required this.text});
  final bool mine;
  final String text;
  @override
  Widget build(BuildContext context) => Align(
    alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
    child: Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      constraints: const BoxConstraints(maxWidth: 270),
      decoration: BoxDecoration(color: mine ? const Color(0xFFD9FDD3) : Colors.white, borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: const TextStyle(fontSize: 13.5, height: 1.3)),
    ),
  );
}

/// A message with reply buttons (no list name) or a list (with its rows shown under it).
/// With [onTap], the buttons and rows can be tapped (the Try it screen).
class ListBubble extends StatelessWidget {
  const ListBubble({super.key, required this.text, required this.button, required this.rows, this.notes = const [], this.onTap});
  final String text, button;
  final List<String> rows;
  final List<String> notes;
  final ValueChanged<int>? onTap;
  @override
  Widget build(BuildContext context) {
    const blue = TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600, fontSize: 13.5);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
              child: Text(text, style: const TextStyle(fontSize: 13.5, height: 1.3)),
            ),
            if (button.isEmpty)
              for (var i = 0; i < rows.length; i++) ...[
                const Divider(height: 1),
                InkWell(
                  onTap: onTap == null ? null : () => onTap!(i),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.reply, size: 16, color: Color(0xFF027EB5)),
                        const SizedBox(width: 6),
                        Flexible(child: Text(rows[i], style: blue, overflow: TextOverflow.ellipsis)),
                      ],
                    ),
                  ),
                ),
              ]
            else ...[
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.format_list_bulleted, size: 16, color: Color(0xFF027EB5)),
                    const SizedBox(width: 6),
                    Flexible(child: Text(button, style: blue, overflow: TextOverflow.ellipsis)),
                  ],
                ),
              ),
              Container(
                color: Brand.page,
                child: Column(
                  children: [
                    for (var i = 0; i < rows.length; i++)
                      InkWell(
                        onTap: onTap == null ? null : () => onTap!(i),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      rows[i],
                                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    if (i < notes.length && notes[i].isNotEmpty)
                                      Text(
                                        notes[i],
                                        style: const TextStyle(fontSize: 11.5, color: Brand.muted),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                  ],
                                ),
                              ),
                              const Icon(Icons.radio_button_unchecked, size: 15, color: Brand.faint),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A photo, a link button or a map, as WhatsApp shows it.
class MediaBubble extends StatelessWidget {
  const MediaBubble.photo({super.key, required String this.url, this.text}) : place = null, address = null, pin = false, button = null;
  const MediaBubble.link({super.key, required String this.text, required String this.button}) : url = null, place = null, address = null, pin = false;
  const MediaBubble.map({super.key, this.place, this.address, this.pin = false}) : url = null, text = null, button = null;
  final String? url, text, button, place, address;
  final bool pin;

  @override
  Widget build(BuildContext context) {
    const blue = TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600, fontSize: 13.5);
    final isMap = url == null && button == null;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        width: 260,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (url != null)
              SizedBox(
                height: 150,
                child: _https(url)
                    ? Image.network(
                        url!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => const ColoredBox(
                          color: Brand.lineSoft,
                          child: Icon(Icons.image_outlined, color: Brand.faint, size: 32),
                        ),
                      )
                    : const ColoredBox(
                        color: Brand.lineSoft,
                        child: Icon(Icons.image_outlined, color: Brand.faint, size: 32),
                      ),
              ),
            if (isMap && pin)
              Container(
                height: 110,
                color: const Color(0xFFE3E8F2),
                child: const Icon(Icons.location_on, color: Brand.red, size: 40),
              ),
            if ((text ?? '').isNotEmpty || isMap)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                child: isMap
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text((place ?? '').isEmpty ? 'Location' : place!, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                          if ((address ?? '').isNotEmpty) Text(address!, style: const TextStyle(fontSize: 12.5, color: Brand.textSoft)),
                        ],
                      )
                    : Text(text!, style: const TextStyle(fontSize: 13.5, height: 1.3)),
              ),
            if (button != null || (isMap && !pin)) ...[
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.open_in_new, size: 15, color: Color(0xFF027EB5)),
                    const SizedBox(width: 6),
                    Text(button ?? 'Open map', style: blue),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The words a step says, with {name}, {business} and {service} filled in.
String stepWords(Map<String, dynamic> step, {required String name, required String business, required String service}) {
  final own = '${step['text'] ?? ''}'.trim();
  final words = own.isNotEmpty ? own : (defaultQuestion[step['type']] ?? '');
  return words.replaceAll('{name}', name).replaceAll('{business}', business).replaceAll('{service}', service);
}

/// The customer's view of the steps, all at once.
List<Widget> stepsPreview({
  required List<Map<String, dynamic>> steps,
  required String welcome,
  required String trigger,
  required List<Map<String, dynamic>> services,
  required List<Map<String, dynamic>> staff,
  required bool multiSelect,
  required bool autoApprove,
  required String business,
}) {
  final first = services.isEmpty ? null : services.first;
  final second = services.length > 1 ? services[1] : null;
  final picked = multiSelect && second != null ? '${first!['name']}, ${second['name']}' : '${first?['name'] ?? 'Haircut'}';
  String words(Map<String, dynamic> s) => stepWords(s, name: 'Priya', business: business, service: picked);
  final out = <Widget>[ChatBubble(text: trigger.isEmpty ? 'Book' : trigger[0].toUpperCase() + trigger.substring(1), mine: true)];
  for (var i = 0; i < steps.length; i++) {
    final s = steps[i];
    final intro = i == 0 ? '$welcome\n\n' : '';
    if (i == 0 && ['image', 'link', 'location'].contains(s['type'])) out.add(ChatBubble(text: welcome));
    switch (s['type']) {
      case 'services':
        out.add(
          ListBubble(
            text: i == 0 && welcome.trim().endsWith('?') && '${s['text'] ?? ''}'.trim().isEmpty ? welcome : '$intro${words(s)}',
            button: 'Choose a service',
            rows: [for (final sv in services.take(3)) '${sv['name']}'],
            notes: [for (final sv in services.take(3)) '${formatRupees(sv['price'])} · ${sv['duration_minutes']} min'],
          ),
        );
        out.add(ChatBubble(text: '${first?['name'] ?? 'Haircut'}', mine: true));
        if (multiSelect && second != null) {
          out.add(
            ListBubble(
              text: 'Added: ${first!['name']}. Would you like another service?',
              button: '',
              rows: ['Add another', steps.length > i + 1 && steps[i + 1]['type'] == 'datetime' ? 'Choose a day' : 'Continue'],
            ),
          );
          out.add(ChatBubble(text: 'Add another → ${second['name']}', mine: true));
        }
      case 'staff':
        out.add(ListBubble(text: '$intro${words(s)}', button: 'Choose who', rows: ['Anyone free', ...staff.take(2).map((m) => '${m['name']}')]));
        out.add(const ChatBubble(text: 'Anyone free', mine: true));
      case 'choice':
        final options = ((s['options'] as List?) ?? const []).map((o) => '$o').toList();
        final shown = options.isEmpty ? ['Answer 1', 'Answer 2'] : options;
        out.add(ListBubble(text: '$intro${words(s).isEmpty ? 'Your question' : words(s)}', button: shown.length <= 3 ? '' : 'Choose', rows: shown.take(shown.length <= 3 ? 3 : 4).toList()));
        out.add(ChatBubble(text: shown.first, mine: true));
      case 'text':
        out.add(ChatBubble(text: '$intro${words(s).isEmpty ? 'Your question' : words(s)}\n(Type your answer, or "cancel" to stop.)'));
        out.add(const ChatBubble(text: '…', mine: true));
      case 'message':
        out.add(ChatBubble(text: '$intro${words(s).isEmpty ? 'Your message' : words(s)}'));
      case 'image':
        out.add(MediaBubble.photo(url: '${s['url'] ?? ''}', text: words(s)));
      case 'link':
        out.add(MediaBubble.link(text: words(s).isEmpty ? 'Your words' : words(s), button: '${s['button'] ?? ''}'.trim().isEmpty ? 'Open' : '${s['button']}'));
      case 'location':
        if ('${s['text'] ?? ''}'.trim().isNotEmpty) out.add(ChatBubble(text: words(s)));
        out.add(MediaBubble.map(place: '${s['name'] ?? ''}', address: '${s['address'] ?? ''}', pin: mapsCoordinates('${s['url'] ?? ''}') != null || s['latitude'] is num));
      default:
        out.add(ListBubble(text: '$intro${words(s)}', button: 'Choose a day', rows: const ['Today', 'Tomorrow', 'Wed, 11 Nov']));
        out.add(const ChatBubble(text: 'Tomorrow', mine: true));
        out.add(ListBubble(text: '$picked on Tomorrow: tap "Choose a time" to pick one.', button: 'Choose a time', rows: const ['10:00 am', '10:30 am', '11:30 am']));
        out.add(const ChatBubble(text: '10:30 am', mine: true));
        out.add(
          ChatBubble(
            text: autoApprove
                ? 'Confirmed! $picked at $business, Tomorrow at 10:30 am. See you soon! ✨'
                : 'Thank you! We have your request for $picked on Tomorrow at 10:30 am. We will confirm it shortly.',
          ),
        );
    }
  }
  return out;
}
