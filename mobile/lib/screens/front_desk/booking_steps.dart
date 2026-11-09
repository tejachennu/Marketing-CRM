import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// The booking flow's steps, as on the web: the business's own questions (buttons or a typed
/// answer) and messages around the booking steps, plus "Write with AI".

const stepNames = {'services': 'Pick services', 'staff': 'Pick who', 'choice': 'Question with buttons', 'text': 'Question with a typed answer', 'message': 'Message', 'datetime': 'Pick day and time'};
const stepIcons = {
  'services': Icons.content_cut,
  'staff': Icons.person_outline,
  'choice': Icons.touch_app_outlined,
  'text': Icons.keyboard_outlined,
  'message': Icons.chat_outlined,
  'datetime': Icons.calendar_month_outlined,
};

List<Map<String, dynamic>> defaultSteps(bool askStaff) => [
  {'id': 's1', 'type': 'services'},
  if (askStaff) {'id': 's2', 'type': 'staff'},
  {'id': askStaff ? 's3' : 's2', 'type': 'datetime'},
];

String _summary(Map<String, dynamic> step) => switch (step['type']) {
  'choice' => '${step['text'] ?? ''} (${((step['options'] as List?) ?? const []).join(' / ')})',
  'text' || 'message' => '${step['text'] ?? ''}',
  _ => '',
};

class StepsEditor extends StatefulWidget {
  const StepsEditor({super.key, required this.steps, required this.onChanged, required this.onDraft});
  final List<Map<String, dynamic>> steps;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;
  final void Function(String? welcome, String? language) onDraft;
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
    final step = Map<String, dynamic>.from(steps[index]);
    if (!['choice', 'text', 'message'].contains(step['type'])) return;
    final text = TextEditingController(text: '${step['text'] ?? ''}');
    final label = TextEditingController(text: '${step['label'] ?? ''}');
    final options = List<String>.from((step['options'] as List?)?.map((o) => '$o') ?? const []);
    final option = TextEditingController();
    final saved = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(stepNames[step['type']]!, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                TextField(
                  controller: text,
                  maxLines: step['type'] == 'message' ? 3 : 1,
                  decoration: InputDecoration(
                    labelText: step['type'] == 'message' ? 'Message' : 'Question',
                    hintText: step['type'] == 'choice'
                        ? 'Is this your first visit?'
                        : step['type'] == 'text'
                        ? 'Any allergies?'
                        : 'Please come 10 minutes early.',
                  ),
                ),
                if (step['type'] != 'message') ...[
                  const SizedBox(height: 10),
                  TextField(
                    controller: label,
                    decoration: const InputDecoration(labelText: 'Saved on the booking as', hintText: 'Allergies'),
                  ),
                ],
                if (step['type'] == 'choice') ...[
                  const SizedBox(height: 14),
                  const Text('Answers to tap', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [for (final o in options) InputChip(label: Text(o), onDeleted: () => setSheet(() => options.remove(o)))],
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: option,
                          maxLength: 24,
                          decoration: const InputDecoration(hintText: 'Add an answer', counterText: ''),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: () => setSheet(() {
                          final o = option.text.trim();
                          if (o.isNotEmpty && !options.contains(o) && options.length < 10) options.add(o);
                          option.clear();
                        }),
                        child: const Text('Add'),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    if (text.text.trim().isEmpty) return;
                    if (step['type'] == 'choice' && options.length < 2) return;
                    Navigator.pop(context, {...step, 'text': text.text.trim(), if (step['type'] != 'message') 'label': label.text.trim(), if (step['type'] == 'choice') 'options': options});
                  },
                  child: const Text('Done'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (saved != null) widget.onChanged([...steps]..[index] = saved);
  }

  Future<void> _add(String type) async {
    final step = {'id': 'n${DateTime.now().microsecondsSinceEpoch}', 'type': type, if (type != 'staff') 'text': '', if (type == 'choice') 'options': <String>[]};
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
      setState(() {
        _note = 'Drafted ${(draft['steps'] as List).length} steps. Change anything, then save.';
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
                decoration: const InputDecoration(hintText: 'First visit? then services, allergies, who, then day and time'),
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
                    child: Icon(stepIcons[steps[i]['type']], size: 19, color: Brand.navy),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${i + 1}. ${stepNames[steps[i]['type']]}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        if (_summary(steps[i]).trim().isNotEmpty)
                          Text(
                            _summary(steps[i]),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                          )
                        else if (['choice', 'text', 'message'].contains(steps[i]['type']))
                          const Text(
                            'Tap to write it',
                            style: TextStyle(fontSize: 12.5, color: Brand.red, fontWeight: FontWeight.w600),
                          ),
                      ],
                    ),
                  ),
                  if (steps[i]['type'] != 'datetime') ...[
                    IconButton(visualDensity: VisualDensity.compact, onPressed: i == 0 ? null : () => _move(i, -1), icon: const Icon(Icons.arrow_upward, size: 18)),
                    IconButton(visualDensity: VisualDensity.compact, onPressed: i >= steps.length - 2 ? null : () => _move(i, 1), icon: const Icon(Icons.arrow_downward, size: 18)),
                  ],
                  if (!['services', 'datetime'].contains(steps[i]['type']))
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: () => widget.onChanged([...steps]..removeAt(i)),
                      icon: const Icon(Icons.delete_outline, size: 19, color: Brand.red),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 4),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            ActionChip(avatar: const Icon(Icons.touch_app_outlined, size: 18), label: const Text('Question with buttons'), onPressed: steps.length >= 12 ? null : () => _add('choice')),
            ActionChip(avatar: const Icon(Icons.keyboard_outlined, size: 18), label: const Text('Typed answer'), onPressed: steps.length >= 12 ? null : () => _add('text')),
            ActionChip(avatar: const Icon(Icons.chat_outlined, size: 18), label: const Text('Message'), onPressed: steps.length >= 12 ? null : () => _add('message')),
            if (!steps.any((s) => s['type'] == 'staff')) ActionChip(avatar: const Icon(Icons.person_outline, size: 18), label: const Text('Pick who'), onPressed: () => _add('staff')),
          ],
        ),
      ],
    );
  }
}

/// Is every step written? Returns what to fix, or null.
String? unfinishedStep(List<Map<String, dynamic>> steps) {
  for (var i = 0; i < steps.length; i++) {
    final s = steps[i];
    if (['choice', 'text', 'message'].contains(s['type']) && '${s['text'] ?? ''}'.trim().isEmpty) return 'Write step ${i + 1}, or remove it.';
    if (s['type'] == 'choice' && ((s['options'] as List?) ?? const []).length < 2) return 'Step ${i + 1} needs at least two answers to tap.';
  }
  return null;
}

/// The customer's view of the steps.
List<Widget> stepsPreview({
  required List<Map<String, dynamic>> steps,
  required String welcome,
  required String trigger,
  required List<Map<String, dynamic>> services,
  required List<Map<String, dynamic>> staff,
  required bool multiSelect,
  required bool autoApprove,
  required String business,
  required Widget Function(String text, {bool mine}) chat,
  required Widget Function(String text, String button, List<String> rows) list,
}) {
  final first = services.isEmpty ? null : services.first;
  final second = services.length > 1 ? services[1] : null;
  final picked = multiSelect && second != null ? '${first!['name']}, ${second['name']}' : '${first?['name'] ?? 'Haircut'}';
  final out = <Widget>[chat(trigger[0].toUpperCase() + trigger.substring(1), mine: true)];
  for (var i = 0; i < steps.length; i++) {
    final s = steps[i];
    final intro = i == 0 ? '$welcome\n\n' : '';
    switch (s['type']) {
      case 'services':
        out.add(
          list(i == 0 && welcome.trim().endsWith('?') ? welcome : '${intro}Which service would you like?', 'Choose a service', [
            for (final sv in services.take(3)) '${sv['name']} · ${formatRupees(sv['price'])}',
          ]),
        );
        out.add(chat('${first?['name'] ?? 'Haircut'}', mine: true));
        if (multiSelect && second != null) {
          out.add(chat('Added: ${first!['name']}. Would you like another service?\n[Add another] [${steps.length > i + 1 && steps[i + 1]['type'] == 'datetime' ? 'Choose a day' : 'Continue'}]'));
          out.add(chat('Add another → ${second['name']}', mine: true));
        }
      case 'staff':
        out.add(list('${intro}Who would you like for $picked?', 'Choose who', ['Anyone free', ...staff.take(2).map((m) => '${m['name']}')]));
        out.add(chat('Anyone free', mine: true));
      case 'choice':
        final options = ((s['options'] as List?) ?? const []).map((o) => '$o').toList();
        out.add(list('$intro${s['text'] ?? 'Your question'}', options.length <= 3 ? '' : 'Choose', options.isEmpty ? ['Answer 1', 'Answer 2'] : options.take(4).toList()));
        out.add(chat(options.isEmpty ? 'Answer 1' : options.first, mine: true));
      case 'text':
        out.add(chat('$intro${s['text'] ?? 'Your question'}\n(Type your answer, or "cancel" to stop.)'));
        out.add(chat('…', mine: true));
      case 'message':
        out.add(chat('$intro${s['text'] ?? 'Your message'}'));
      default:
        out.add(list('${intro}Which day suits you for $picked?', 'Choose a day', const ['Today', 'Tomorrow', 'Wed, 11 Nov']));
        out.add(chat('Tomorrow', mine: true));
        out.add(list('$picked on Tomorrow: tap "Choose a time" to pick one.', 'Choose a time', const ['10:00 am', '10:30 am', '11:30 am']));
        out.add(chat('10:30 am', mine: true));
        out.add(
          chat(
            autoApprove ? 'Confirmed! $picked at $business, Tomorrow at 10:30 am. See you soon! ✨' : 'Thank you! We have your request for $picked on Tomorrow at 10:30 am. We will confirm it shortly.',
          ),
        );
    }
  }
  return out;
}
