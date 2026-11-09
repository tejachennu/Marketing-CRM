import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'template_widgets.dart';

/// The workspace's WhatsApp templates with Meta's status. Kept on the phone for offline use.
class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key});
  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  String _status = 'ALL';

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final all = templatesOf(app);
    final shown = all.where((t) => _status == 'ALL' || t['status'] == _status).toList();
    int count(String s) => all.where((t) => t['status'] == s).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Templates')),
      body: Column(children: [
        const SyncBanner(cacheKey: 'templates'),
        SizedBox(
          height: 56,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 10, 16, 6), children: [
            for (final (key, label) in [('ALL', 'All · ${all.length}'), ('APPROVED', 'Approved · ${count('APPROVED')}'), ('PENDING', 'In review · ${count('PENDING')}'), ('REJECTED', 'Rejected · ${count('REJECTED')}')])
              Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(label), selected: _status == key, onSelected: (_) => setState(() => _status = key))),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: app.syncNow,
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 6, 16, 24), children: [
              if (shown.isEmpty) const EmptyState(icon: Icons.description_outlined, title: 'No templates here', text: 'Create templates on the web; they appear here once Meta has them.'),
              for (final t in shown) ...[
                Panel(
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TemplateScreen(template: t))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${t['name']}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800))),
                      Pill(statusWords[t['status']] ?? '${t['status']}', tone: statusTone('${t['status']}')),
                    ]),
                    const SizedBox(height: 6),
                    Text(TemplateParts(t).body, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.textSoft, fontSize: 13.5, height: 1.35)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, children: [Pill(categoryWords[t['category']] ?? '${t['category']}'), Pill('${t['language']}'.toUpperCase())]),
                  ]),
                ),
                const SizedBox(height: 10),
              ],
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('To create or change a template, use Templates on the web. Meta checks each one before it can be sent.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted, fontSize: 12.5)),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class TemplateScreen extends StatelessWidget {
  const TemplateScreen({super.key, required this.template});
  final Map<String, dynamic> template;
  @override
  Widget build(BuildContext context) {
    final parts = TemplateParts(template);
    final status = '${template['status']}';
    return Scaffold(
      appBar: AppBar(title: Text('${template['name']}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Wrap(spacing: 6, children: [
          Pill(statusWords[status] ?? status, tone: statusTone(status)),
          Pill(categoryWords[template['category']] ?? '${template['category']}'),
          Pill('${template['language']}'.toUpperCase()),
        ]),
        if (status == 'REJECTED' && template['rejected_reason'] != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.error_outline, color: Brand.red, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text('Meta said: ${template['rejected_reason']}', style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600))),
            ]),
          ),
        ],
        const SectionLabel('How customers see it'),
        TemplateBubble(parts: parts),
        if (parts.blanks.isNotEmpty) ...[
          const SectionLabel('Blanks'),
          Text('This template has ${parts.blanks.length} blank${parts.blanks.length == 1 ? '' : 's'} (${parts.blanks.map((b) => '{{$b}}').join(', ')}), filled in when it is sent.', style: const TextStyle(color: Brand.textSoft)),
        ],
      ]),
    );
  }
}
