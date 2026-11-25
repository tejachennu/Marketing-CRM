import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// A blank outside the message text: in the title, or at the end of a button's link.
class ExtraBlank {
  const ExtraBlank(this.key, this.label, this.prefix, this.suggested);

  /// The name the server reads (header_text_1, button_url_1…).
  final String key;
  final String label;

  /// The fixed start of a link (shown before the box).
  final String prefix;

  /// What the template was approved with, filled in to start.
  final String suggested;
}

/// The ending of a link button's example ("https://g.page/r/abc" with url "https://g.page/r/{{1}}" → "abc").
String urlExampleEnding(Map b) {
  final url = '${b['url'] ?? ''}';
  final example = '${((b['example'] as List?) ?? const []).firstOrNull ?? ''}'.trim();
  if (example.isEmpty) return '';
  final fixed = url.split('{{1}}').first;
  if (fixed.isNotEmpty && example.startsWith(fixed)) return example.substring(fixed.length).trim();
  return example.startsWith(RegExp('https?://')) ? '' : example;
}

/// Pieces of a Meta template, read from its components.
class TemplateParts {
  TemplateParts(Map<String, dynamic> template) {
    for (final c in (template['components'] as List? ?? const [])) {
      final type = '${c['type']}'.toUpperCase();
      if (type == 'HEADER' && c['text'] != null) {
        header = '${c['text']}';
        final examples = ((c['example'] as Map?)?['header_text'] as List?) ?? const [];
        final keys = RegExp(r'\{\{\s*([\w]+)\s*\}\}').allMatches(header!).map((m) => m.group(1)!).toSet().toList();
        for (var i = 0; i < keys.length; i++) {
          extras.add(ExtraBlank('header_text_${i + 1}', 'Title {{${keys[i]}}}', '', i < examples.length ? '${examples[i]}' : ''));
        }
      }
      if (type == 'BODY') body = '${c['text'] ?? ''}';
      if (type == 'FOOTER') footer = '${c['text'] ?? ''}';
      if (type == 'BUTTONS') {
        final list = (c['buttons'] as List? ?? const []);
        buttons = [for (final b in list) '${b['text']}'];
        for (var i = 0; i < list.length; i++) {
          final b = list[i] as Map;
          if ('${b['type']}'.toUpperCase() == 'URL' && '${b['url'] ?? ''}'.contains('{{1}}')) {
            extras.add(ExtraBlank('button_url_${i + 1}', 'Link of the button "${b['text']}"', '${b['url']}'.split('{{1}}').first, urlExampleEnding(b)));
          }
        }
      }
    }
  }

  /// Blanks in the title and in button links (WhatsApp refuses the message if one is empty).
  final List<ExtraBlank> extras = [];
  String? header;
  String body = '';
  String? footer;
  List<String> buttons = const [];

  /// The blanks in the body: {{1}}, {{2}}… (or named ones).
  List<String> get blanks => RegExp(r'\{\{\s*([\w]+)\s*\}\}').allMatches(body).map((m) => m.group(1)!).toSet().toList();

  String fill(Map<String, String> values) => body.replaceAllMapped(RegExp(r'\{\{\s*([\w]+)\s*\}\}'), (m) => values[m.group(1)]?.trim().isNotEmpty == true ? values[m.group(1)]! : '{{${m.group(1)}}}');
}

List<Map<String, dynamic>> templatesOf(AppState app) => [for (final t in ((app.cached('templates') ?? const {})['templates'] as List? ?? const [])) Map<String, dynamic>.from(t)];

const statusWords = {'APPROVED': 'Approved', 'PENDING': 'In review', 'REJECTED': 'Rejected', 'PAUSED': 'Paused', 'DISABLED': 'Disabled'};
const categoryWords = {'MARKETING': 'Marketing', 'UTILITY': 'Updates', 'AUTHENTICATION': 'Codes'};

PillTone statusTone(String status) => switch (status) {
  'APPROVED' => PillTone.blue,
  'REJECTED' || 'DISABLED' => PillTone.red,
  _ => PillTone.grey,
};

/// How the message looks on the customer's phone.
class TemplateBubble extends StatelessWidget {
  const TemplateBubble({super.key, required this.parts, this.values = const {}});
  final TemplateParts parts;
  final Map<String, String> values;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Brand.chatBg, borderRadius: BorderRadius.circular(16)),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 320),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (parts.header != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(parts.header!, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                    Text(parts.fill(values), style: const TextStyle(fontSize: 14.5, height: 1.35)),
                    if (parts.footer != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(parts.footer!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      ),
                  ],
                ),
              ),
              for (final b in parts.buttons) ...[
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    b,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Choose an approved template and fill its blanks. Returns what to send, or null.
Future<Map<String, dynamic>?> pickTemplate(BuildContext context, {String firstName = ''}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _TemplatePicker(firstName: firstName),
  );
}

class _TemplatePicker extends StatefulWidget {
  const _TemplatePicker({required this.firstName});
  final String firstName;
  @override
  State<_TemplatePicker> createState() => _TemplatePickerState();
}

class _TemplatePickerState extends State<_TemplatePicker> {
  Map<String, dynamic>? _chosen;
  final Map<String, String> _values = {};

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final approved = templatesOf(app).where((t) => t['status'] == 'APPROVED').toList();
    final parts = _chosen == null ? null : TemplateParts(_chosen!);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
          child: ListView(
            shrinkWrap: true,
            children: [
              Text(parts == null ? 'Send a template' : _chosen!['name'], style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(parts == null ? 'Only templates Meta approved can be sent.' : 'Fill the blanks. This is how it will look.', style: const TextStyle(color: Brand.muted)),
              const SizedBox(height: 14),
              if (parts == null) ...[
                if (approved.isEmpty)
                  Text(
                    app.can('campaigns')
                        ? 'No approved templates yet. Make one in More → WhatsApp templates; Meta checks it first.'
                        : 'No approved templates yet. Ask your admin to make one in More → WhatsApp templates.',
                  ),
                for (final t in approved)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Panel(
                      onTap: () => setState(() {
                        _chosen = t;
                        _values.clear();
                        final chosen = TemplateParts(t);
                        final blanks = chosen.blanks;
                        if (blanks.isNotEmpty && widget.firstName.isNotEmpty) _values[blanks.first] = widget.firstName;
                        for (final extra in chosen.extras) {
                          if (extra.suggested.isNotEmpty) _values[extra.key] = extra.suggested;
                        }
                      }),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              ),
                              Pill(categoryWords[t['category']] ?? '${t['category']}'),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            TemplateParts(t).body,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Brand.muted, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ),
              ] else ...[
                TemplateBubble(parts: parts, values: _values),
                const SizedBox(height: 14),
                for (final blank in parts.blanks)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextFormField(
                      initialValue: _values[blank],
                      decoration: InputDecoration(labelText: 'Blank {{$blank}}'),
                      onChanged: (v) => setState(() => _values[blank] = v),
                    ),
                  ),
                for (final extra in parts.extras)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextFormField(
                      initialValue: _values[extra.key],
                      decoration: InputDecoration(labelText: extra.label, helperText: extra.prefix.isEmpty ? null : 'Link: ${extra.prefix}…', helperMaxLines: 2),
                      onChanged: (v) => setState(() => _values[extra.key] = v),
                    ),
                  ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(onPressed: () => setState(() => _chosen = null), child: const Text('Back')),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: [...parts.blanks, ...parts.extras.map((e) => e.key)].every((b) => (_values[b] ?? '').trim().isNotEmpty)
                            ? () => Navigator.pop(context, {
                                'name': _chosen!['name'],
                                'language': _chosen!['language'] ?? 'en',
                                'components': _chosen!['components'],
                                'variables': _values,
                                'preview': parts.fill(_values),
                              })
                            : null,
                        child: const Text('Send'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
