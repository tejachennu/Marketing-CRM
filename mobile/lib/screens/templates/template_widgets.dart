import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Pieces of a Meta template, read from its components.
class TemplateParts {
  TemplateParts(Map<String, dynamic> template) {
    for (final c in (template['components'] as List? ?? const [])) {
      final type = '${c['type']}'.toUpperCase();
      if (type == 'HEADER' && c['text'] != null) header = '${c['text']}';
      if (type == 'BODY') body = '${c['text'] ?? ''}';
      if (type == 'FOOTER') footer = '${c['text'] ?? ''}';
      if (type == 'BUTTONS') buttons = [for (final b in (c['buttons'] as List? ?? const [])) '${b['text']}'];
    }
  }
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
      decoration: BoxDecoration(color: const Color(0xFFEFEAE2), borderRadius: BorderRadius.circular(16)),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 320),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))]),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (parts.header != null) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(parts.header!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                Text(parts.fill(values), style: const TextStyle(fontSize: 14.5, height: 1.35)),
                if (parts.footer != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(parts.footer!, style: const TextStyle(fontSize: 12, color: Brand.muted))),
              ]),
            ),
            for (final b in parts.buttons) ...[
              const Divider(height: 1),
              Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: Text(b, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600))),
            ],
          ]),
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
          child: ListView(shrinkWrap: true, children: [
            Text(parts == null ? 'Send a template' : _chosen!['name'], style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(parts == null ? 'Only templates Meta approved can be sent.' : 'Fill the blanks. This is how it will look.', style: const TextStyle(color: Brand.muted)),
            const SizedBox(height: 14),
            if (parts == null) ...[
              if (approved.isEmpty) const Text('No approved templates yet. Create them on the web (Templates).'),
              for (final t in approved)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Panel(
                    onTap: () => setState(() {
                      _chosen = t;
                      _values.clear();
                      final blanks = TemplateParts(t).blanks;
                      if (blanks.isNotEmpty && widget.firstName.isNotEmpty) _values[blanks.first] = widget.firstName;
                    }),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                        Pill(categoryWords[t['category']] ?? '${t['category']}'),
                      ]),
                      const SizedBox(height: 4),
                      Text(TemplateParts(t).body, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                    ]),
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
              const SizedBox(height: 4),
              Row(children: [
                Expanded(child: OutlinedButton(onPressed: () => setState(() => _chosen = null), child: const Text('Back'))),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: parts.blanks.every((b) => (_values[b] ?? '').trim().isNotEmpty)
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
              ]),
            ],
          ]),
        ),
      ),
    );
  }
}
