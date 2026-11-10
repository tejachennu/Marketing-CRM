import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'template_create.dart';
import 'template_editor.dart';
import 'template_model.dart';
import 'template_preview.dart';
import 'template_widgets.dart';

/// Message templates, as on the web (and WhatsApp Manager): every template with Meta's status and
/// quality, search and filters, Create (with AI or by hand), Meta's ready-made library, and for each
/// template: insights, edit, add a language, duplicate, delete. Checks Meta every 20 seconds while
/// one is in review, and lists the status changes it saw.
class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key});
  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  String _query = '';
  String _category = '';
  String _language = '';
  String _status = '';
  bool _syncing = false;
  Timer? _timer;
  Map<String, String>? _lastStatuses;
  final List<Map<String, String>> _updates = [];
  List<Map<String, dynamic>> _flows = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _remember(templatesOf(AppScope.read(context)));
      _sync();
      _loadFlows();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _remember(List<Map<String, dynamic>> list) => _lastStatuses = {for (final t in list) '${t['id']}': '${t['status']}'};

  Future<void> _loadFlows() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/commerce/meta-detect', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(
        () => _flows = [
          for (final f in (data['flows'] as List? ?? const []))
            if ('${f['status']}'.toUpperCase() == 'PUBLISHED') {'id': '${f['id']}', 'name': '${f['name']}'},
        ],
      );
    } catch (_) {
      // Only admins can list flows; others type the flow's id
    }
  }

  /// Fetch from Meta, and note what changed since the last time.
  Future<void> _sync() async {
    final app = AppScope.read(context);
    setState(() => _syncing = true);
    await app.load('templates', '/api/whatsapp-templates', query: const {'drafts': '1'}, force: true);
    if (!mounted) return;
    final list = templatesOf(app);
    final previous = _lastStatuses;
    if (previous != null) {
      final changes = [
        for (final t in list)
          if (previous.containsKey('${t['id']}') && previous['${t['id']}'] != '${t['status']}')
            {'name': '${t['name']}', 'language': '${t['language']}', 'from': previous['${t['id']}']!, 'to': '${t['status']}', 'at': DateTime.now().toIso8601String()},
      ];
      if (changes.isNotEmpty) {
        _updates.insertAll(0, changes);
        if (_updates.length > 10) _updates.removeRange(10, _updates.length);
        final first = changes.first;
        toast(
          context,
          changes.length == 1
              ? '“${first['name']}” (${languageLabel(first['language'])}) is now ${(statusInfo[first['to']]?.label ?? first['to']!).toLowerCase()}.'
              : '${changes.length} templates changed status.',
        );
      }
    }
    _remember(list);
    setState(() => _syncing = false);
    // While a template is in review, check Meta again every 20 seconds
    _timer?.cancel();
    if (list.any((t) => ['PENDING', 'IN_APPEAL'].contains(t['status']))) {
      _timer = Timer(const Duration(seconds: 20), () {
        if (mounted) _sync();
      });
    }
  }

  Future<void> _open(Widget screen) async {
    final done = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => screen));
    if (!mounted || done == null) return;
    toast(context, done);
    _sync();
  }

  Future<String?> _pick(String title, String current, List<(String, String)> options) => showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          ),
          for (final (value, label) in options)
            ListTile(
              title: Text(label),
              trailing: current == value ? const Icon(Icons.check, color: Brand.blue) : null,
              onTap: () => Navigator.pop(sheet, value),
            ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final canManage = app.can('campaigns');
    final data = app.cached('templates') ?? const {};
    final all = templatesOf(app);
    final q = _query.toLowerCase();
    final shown =
        all.where((t) {
          if (q.isNotEmpty && !'${t['name']}'.contains(q.replaceAll(RegExp(r'\s+'), '_')) && !bodyOf(t).toLowerCase().contains(q)) return false;
          if (_category.isNotEmpty && t['category'] != _category) return false;
          if (_language.isNotEmpty && t['language'] != _language) return false;
          if (_status.isNotEmpty && t['status'] != _status) return false;
          return true;
        }).toList()..sort((a, b) {
          final byName = '${a['name']}'.compareTo('${b['name']}');
          return byName != 0 ? byName : '${a['language']}'.compareTo('${b['language']}');
        });
    final reviewing = all.any((t) => ['PENDING', 'IN_APPEAL'].contains(t['status']));
    final languages = {for (final t in all) '${t['language']}'}.toList();
    final syncedAt = app.savedAt('templates');

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Message templates'),
        actions: [
          IconButton(
            tooltip: 'Sync with Meta',
            onPressed: _syncing ? null : _sync,
            icon: _syncing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.sync),
          ),
          if (canManage)
            IconButton(
              tooltip: 'Browse template library',
              onPressed: () => _open(TemplateLibraryScreen(existing: {for (final t in all) '${t['name']}'})),
              icon: const Icon(Icons.menu_book_outlined),
            ),
        ],
      ),
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              heroTag: 'fab-templates',
              backgroundColor: Brand.blue,
              foregroundColor: Colors.white,
              onPressed: () => _open(TemplateSetupScreen(existing: all, flows: _flows)),
              icon: const Icon(Icons.add),
              label: const Text('Create template', style: TextStyle(fontWeight: FontWeight.w700)),
            )
          : null,
      body: Column(
        children: [
          const SyncBanner(cacheKey: 'templates'),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _sync,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 96),
                children: [
                  if (data['notConnected'] != null)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(12)),
                      child: Text('${data['error'] ?? 'Connect WhatsApp (Cloud API) on the web, in Settings, to create templates.'}'),
                    ),
                  if (_updates.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      padding: const EdgeInsets.fromLTRB(12, 4, 4, 10),
                      decoration: BoxDecoration(
                        border: Border.all(color: Brand.line),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.notifications_none, size: 18),
                              const SizedBox(width: 6),
                              const Expanded(
                                child: Text('Status updates', style: TextStyle(fontWeight: FontWeight.w700)),
                              ),
                              TextButton(onPressed: () => setState(_updates.clear), child: const Text('Clear')),
                            ],
                          ),
                          for (final u in _updates)
                            Text(
                              '${u['name']} (${languageLabel(u['language'])}): ${statusInfo[u['from']]?.label ?? u['from']} → ${statusInfo[u['to']]?.label ?? u['to']} · ${formatTime(u['at'])}',
                              style: TextStyle(fontSize: 13, color: u['to'] == 'REJECTED' || u['to'] == 'DISABLED' ? Brand.red : Brand.text),
                            ),
                        ],
                      ),
                    ),
                  SearchField(hint: 'Search name or content', onChanged: (v) => setState(() => _query = v.trim())),
                  FilterChips(
                    children: [
                      for (final (label, value, onTap) in [
                        (
                          _category.isEmpty ? 'Category' : categoryLabels[_category]!.title,
                          _category,
                          () async {
                            final v = await _pick('Category', _category, [('', 'Any category'), for (final c in categories) (c, categoryLabels[c]!.title)]);
                            if (v != null) setState(() => _category = v);
                          },
                        ),
                        (
                          _language.isEmpty ? 'Language' : languageLabel(_language),
                          _language,
                          () async {
                            final v = await _pick('Language', _language, [('', 'Any language'), for (final l in languages) (l, languageLabel(l))]);
                            if (v != null) setState(() => _language = v);
                          },
                        ),
                        (
                          _status.isEmpty ? 'Status' : statusInfo[_status]!.label,
                          _status,
                          () async {
                            final v = await _pick('Status', _status, [
                              ('', 'Any status'),
                              for (final s in ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL']) (s, statusInfo[s]!.label),
                            ]);
                            if (v != null) setState(() => _status = v);
                          },
                        ),
                      ])
                        FilterChip(
                          label: Row(mainAxisSize: MainAxisSize.min, children: [Text(label), const Icon(Icons.arrow_drop_down, size: 18)]),
                          selected: value.isNotEmpty,
                          showCheckmark: false,
                          onSelected: (_) => onTap(),
                        ),
                    ],
                  ),
                  if (app.isLoading('templates'))
                    const SkeletonCards(tiles: false)
                  else if (shown.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: EmptyState(
                        icon: Icons.description_outlined,
                        title: all.isEmpty ? 'No message templates yet' : 'No templates match these filters',
                        text: all.isEmpty ? 'Create your first template to start sending campaigns.' : 'Clear a filter to see more.',
                      ),
                    )
                  else
                    for (final (i, t) in shown.indexed) _row(t, continued: i > 0 && shown[i - 1]['name'] == t['name'], canManage: canManage, all: all),
                  if (all.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: Text(
                        '${shown.length} of ${all.length} templates${syncedAt == null ? '' : ' · synced ${formatTime(syncedAt.toIso8601String())}'}${reviewing ? ' · checking Meta for review results every 20 seconds' : ''}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> t, {required bool continued, required bool canManage, required List<Map<String, dynamic>> all}) {
    final status = '${t['status']}';
    final quality = qualityLabels['${(t['quality_score'] as Map?)?['score'] ?? ''}'.toUpperCase()];
    return FlatRow(
      onTap: () => _open(TemplateScreen(template: t, flows: _flows)),
      padding: EdgeInsets.fromLTRB(continued ? 40 : 16, continued ? 2 : 12, 4, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (continued)
                  Text('↳ ${languageLabel(t['language'])} version', style: const TextStyle(color: Brand.muted, fontSize: 13))
                else
                  Text('${t['name']}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  bodyOf(t).isEmpty ? (t['category'] == 'AUTHENTICATION' ? 'One-time passcode' : '') : bodyOf(t),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Brand.textSoft, fontSize: 13.5, height: 1.3),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    TemplateStatusPill(status: status),
                    if (status == 'APPROVED') Text(quality ?? 'Quality pending', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    Text('${categoryLabels[t['category']]?.title ?? t['category']} · ${languageLabel(t['language'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ),
                if (status == 'REJECTED')
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('${rejectionReasons['${t['rejected_reason'] ?? 'NONE'}'] ?? t['rejected_reason']} ', style: const TextStyle(color: Brand.red, fontSize: 12.5)),
                        InkWell(
                          onTap: () => launchUrl(Uri.parse('https://business.facebook.com/business-support-home'), mode: LaunchMode.externalApplication),
                          child: const Text(
                            'Request review ↗',
                            style: TextStyle(color: Brand.blue, fontSize: 12.5, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (t['previous_category'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Category changed by Meta from ${categoryLabels[t['previous_category']]?.title ?? t['previous_category']}',
                      style: const TextStyle(color: Color(0xFF8A6100), fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
          if (canManage) TemplateActions(template: t, all: all, flows: _flows, onDone: _open, onChanged: _sync),
        ],
      ),
    );
  }
}

/// Meta's status as a coloured pill.
class TemplateStatusPill extends StatelessWidget {
  const TemplateStatusPill({super.key, required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final info = statusInfo[status];
    final (bg, fg) = switch (info?.tone) {
      'green' => (Brand.bubble, const Color(0xFF15603E)),
      'yellow' => (const Color(0xFFFEF4D6), const Color(0xFF8A6100)),
      'red' => (Brand.redSoft, Brand.red),
      _ => (Brand.page, Brand.textSoft),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (status == 'APPROVED') ...[Icon(Icons.check_circle, size: 13, color: fg), const SizedBox(width: 4)],
          Text(
            info?.label ?? status,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg),
          ),
        ],
      ),
    );
  }
}

/// The ⋯ menu of a template: insights, edit, add language, duplicate, delete.
class TemplateActions extends StatelessWidget {
  const TemplateActions({super.key, required this.template, required this.all, required this.flows, required this.onDone, required this.onChanged});
  final Map<String, dynamic> template;
  final List<Map<String, dynamic>> all;
  final List<Map<String, dynamic>> flows;
  final Future<void> Function(Widget screen) onDone;
  final Future<void> Function() onChanged;

  bool get editable => !['PENDING', 'IN_APPEAL', 'DISABLED', 'PENDING_DELETION', 'DELETED'].contains(template['status']);

  /// Meta-hosted samples can't be reused: they must be uploaded again.
  static Draft _fresh(Draft d) {
    if ('${d['headerHandle'] ?? ''}'.startsWith('http')) d['headerHandle'] = '';
    for (final c in (d['cards'] as List? ?? const []).cast<Map>()) {
      if ('${c['headerHandle'] ?? ''}'.startsWith('http')) c['headerHandle'] = '';
    }
    return d;
  }

  Future<void> _delete(BuildContext context) async {
    final app = AppScope.read(context);
    final languages = all.where((t) => t['name'] == template['name']).length;
    final choice = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Delete “${template['name']}”?'),
        content: const Text("Messages already sent are not affected, but you won't be able to send it again. You can't create a new template with the same name for 30 days."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          if (languages > 1) TextButton(onPressed: () => Navigator.pop(d, 'all'), child: const Text('Delete all languages')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Brand.red),
            onPressed: () => Navigator.pop(d, 'one'),
            child: Text('Delete ${languages > 1 ? languageLabel(template['language']) : 'template'}'),
          ),
        ],
      ),
    );
    if (choice == null || !context.mounted) return;
    try {
      final query = Uri(queryParameters: {'organizationId': app.orgId, 'name': '${template['name']}', if (choice == 'one') 'templateId': '${template['id']}'}).query;
      await app.ask('/api/whatsapp-templates?$query', {}, method: 'DELETE');
      if (context.mounted) toast(context, '“${template['name']}” was deleted.');
      await onChanged();
    } catch (e) {
      if (context.mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    tooltip: 'Actions for ${template['name']}',
    icon: const Icon(Icons.more_vert, color: Brand.muted),
    onSelected: (v) {
      switch (v) {
        case 'insights':
          onDone(TemplateInsightsScreen(template: template));
        case 'edit':
          onDone(TemplateEditorScreen(draft: draftOf(template), editing: template, flows: flows));
        case 'language':
          final copy = _fresh(draftOf(template));
          final used = {for (final t in all.where((t) => t['name'] == template['name'])) '${t['language']}'};
          copy['language'] = templateLanguages.where((l) => !used.contains(l.$1)).map((l) => l.$1).firstOrNull ?? copy['language'];
          onDone(TemplateSetupScreen(existing: all, flows: flows, start: copy, lockedName: '${template['name']}'));
        case 'duplicate':
          final copy = _fresh(draftOf(template));
          copy['name'] = '${template['name']}_copy';
          onDone(TemplateSetupScreen(existing: all, flows: flows, start: copy));
        case 'delete':
          _delete(context);
      }
    },
    itemBuilder: (_) => [
      if (template['status'] == 'APPROVED') const PopupMenuItem(value: 'insights', child: Text('View insights')),
      if (editable) const PopupMenuItem(value: 'edit', child: Text('Edit')),
      const PopupMenuItem(value: 'language', child: Text('Add language')),
      const PopupMenuItem(value: 'duplicate', child: Text('Duplicate')),
      const PopupMenuItem(
        value: 'delete',
        child: Text('Delete', style: TextStyle(color: Brand.red)),
      ),
    ],
  );
}

/// One template: how it looks, its status, and what you can do with it.
class TemplateScreen extends StatelessWidget {
  const TemplateScreen({super.key, required this.template, this.flows = const []});
  final Map<String, dynamic> template;
  final List<Map<String, dynamic>> flows;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final status = '${template['status']}';
    final all = templatesOf(app);
    Future<void> open(Widget screen) async {
      final done = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => screen));
      if (done != null && context.mounted) Navigator.pop(context, done);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('${template['name']}'),
        actions: [
          if (app.can('campaigns'))
            TemplateActions(
              template: template,
              all: all,
              flows: flows,
              onDone: open,
              onChanged: () async {
                if (context.mounted) Navigator.pop(context, 'Done.');
              },
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TemplateStatusPill(status: status),
              Pill(categoryLabels[template['category']]?.title ?? '${template['category']}'),
              Pill(languageLabel(template['language'])),
            ],
          ),
          const SizedBox(height: 6),
          Text(statusInfo[status]?.help ?? '', style: const TextStyle(color: Brand.muted, fontSize: 13)),
          if (status == 'REJECTED') ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
              child: Text(
                'Rejected by Meta. ${rejectionReasons['${template['rejected_reason'] ?? 'NONE'}'] ?? template['rejected_reason']}',
                style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
              ),
            ),
          ],
          const SectionLabel('Template preview'),
          TemplatePreview(draft: draftOf(template)),
          if (status == 'APPROVED') ...[
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => open(TemplateInsightsScreen(template: template)),
              icon: const Icon(Icons.bar_chart),
              label: const Text('View insights'),
            ),
          ],
        ],
      ),
    );
  }
}
