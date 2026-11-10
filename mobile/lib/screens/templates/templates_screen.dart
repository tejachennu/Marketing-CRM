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
                  // The numbers, as filters: tap one to see only those
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                    child: Row(
                      children: [
                        for (final (i, (status, label, color)) in [
                          ('', 'All', Brand.text),
                          ('APPROVED', 'Active', const Color(0xFF15603E)),
                          ('PENDING', 'In review', const Color(0xFF8A6100)),
                          ('REJECTED', 'Rejected', Brand.red),
                        ].indexed) ...[
                          if (i > 0) const SizedBox(width: 8),
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(14),
                              onTap: () => setState(() => _status = _status == status ? '' : status),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                                decoration: BoxDecoration(
                                  color: _status == status ? Brand.bubble : Brand.page,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: _status == status ? Brand.blue : Colors.transparent),
                                ),
                                child: Column(
                                  children: [
                                    Text(
                                      '${status.isEmpty ? all.length : all.where((t) => t['status'] == status).length}',
                                      style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: color),
                                    ),
                                    FittedBox(
                                      child: Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
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
                    for (final name in {for (final t in shown) '${t['name']}'})
                      _card(
                        [
                          for (final t in shown)
                            if (t['name'] == name) t,
                        ],
                        canManage: canManage,
                        all: all,
                      ),
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

  /// One template (all its languages): what kind it is, its words, and each language with Meta's status.
  Widget _card(List<Map<String, dynamic>> versions, {required bool canManage, required List<Map<String, dynamic>> all}) {
    final t = versions.first;
    final draft = t['draft'] as Map?;
    final type = '${draft?['type'] ?? (t['category'] == 'AUTHENTICATION' ? 'otp' : 'custom')}';
    final body = bodyOf(t);
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Brand.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => _open(TemplateScreen(template: t, flows: _flows)),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CategoryIcon(category: '${t['category']}', type: type, size: 42),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${t['name']}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                          Text('${categoryLabels[t['category']]?.title ?? t['category']} · ${typeTitle('${t['category']}', type)}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                        ],
                      ),
                    ),
                    if (canManage) TemplateActions(template: t, all: all, flows: _flows, onDone: _open, onChanged: _sync),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(54, 6, 10, 0),
                  child: Text(
                    body.isEmpty ? (t['category'] == 'AUTHENTICATION' ? 'One-time passcode' : '') : body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Brand.textSoft, fontSize: 13.5, height: 1.3),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(54, 8, 10, 0),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final v in versions)
                        InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => _open(TemplateScreen(template: v, flows: _flows)),
                          child: _LanguageChip(template: v),
                        ),
                    ],
                  ),
                ),
                for (final v in versions)
                  if (v['status'] == 'REJECTED')
                    Padding(
                      padding: const EdgeInsets.fromLTRB(54, 6, 10, 0),
                      child: Text(
                        '${versions.length > 1 ? '${languageLabel(v['language'])}: ' : ''}${rejectionReasons['${v['rejected_reason'] ?? 'NONE'}'] ?? v['rejected_reason']}',
                        style: const TextStyle(color: Brand.red, fontSize: 12.5),
                      ),
                    ),
                if (t['previous_category'] != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(54, 6, 10, 0),
                    child: Text(
                      'Category changed by Meta from ${categoryLabels[t['previous_category']]?.title ?? t['previous_category']}',
                      style: const TextStyle(color: Color(0xFF8A6100), fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A language version: the language and Meta's status (with quality when active).
class _LanguageChip extends StatelessWidget {
  const _LanguageChip({required this.template});
  final Map<String, dynamic> template;
  @override
  Widget build(BuildContext context) {
    final status = '${template['status']}';
    final quality = '${(template['quality_score'] as Map?)?['score'] ?? ''}'.toUpperCase();
    final dot = switch (statusInfo[status]?.tone) {
      'green' => quality == 'RED' ? Brand.red : (quality == 'YELLOW' ? const Color(0xFFF7B928) : const Color(0xFF25D366)),
      'yellow' => const Color(0xFFF7B928),
      'red' => Brand.red,
      _ => Brand.faint,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              '${languageLabel(template['language'])} · ${statusInfo[status]?.label ?? status}',
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
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

  void addLanguage(Future<void> Function(Widget screen) open) {
    final copy = _fresh(draftOf(template));
    final used = {for (final t in all.where((t) => t['name'] == template['name'])) '${t['language']}'};
    copy['language'] = templateLanguages.where((l) => !used.contains(l.$1)).map((l) => l.$1).firstOrNull ?? copy['language'];
    open(TemplateSetupScreen(existing: all, flows: flows, start: copy, lockedName: '${template['name']}'));
  }

  void duplicate(Future<void> Function(Widget screen) open) {
    final copy = _fresh(draftOf(template));
    copy['name'] = '${template['name']}_copy';
    open(TemplateSetupScreen(existing: all, flows: flows, start: copy));
  }

  Future<void> delete(BuildContext context, {VoidCallback? done}) => _delete(context, done: done);

  Future<void> _delete(BuildContext context, {VoidCallback? done}) async {
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
      done?.call();
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
          addLanguage(onDone);
        case 'duplicate':
          duplicate(onDone);
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

/// One template: how it looks, Meta's status, its details and everything you can do with it.
class TemplateScreen extends StatelessWidget {
  const TemplateScreen({super.key, required this.template, this.flows = const []});
  final Map<String, dynamic> template;
  final List<Map<String, dynamic>> flows;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final status = '${template['status']}';
    final all = templatesOf(app);
    final draft = draftOf(template);
    final type = '${draft['type']}';
    final canManage = app.can('campaigns');
    final editable = !['PENDING', 'IN_APPEAL', 'DISABLED', 'PENDING_DELETION', 'DELETED'].contains(status);
    final quality = qualityLabels['${(template['quality_score'] as Map?)?['score'] ?? ''}'.toUpperCase()];
    final others = all.where((t) => t['name'] == template['name'] && t['id'] != template['id']).toList();
    final actions = TemplateActions(template: template, all: all, flows: flows, onDone: (_) async {}, onChanged: () async {});

    Future<void> open(Widget screen) async {
      final done = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => screen));
      if (done != null && context.mounted) Navigator.pop(context, done);
    }

    Widget action(IconData icon, String label, VoidCallback onTap, {Color? color}) => Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: color == null ? Brand.bubble : Brand.redSoft,
                child: Icon(icon, size: 20, color: color ?? Brand.blue),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color ?? Brand.text),
              ),
            ],
          ),
        ),
      ),
    );

    Widget info(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: const TextStyle(color: Brand.muted)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text('${template['name']}')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          Row(
            children: [
              CategoryIcon(category: '${template['category']}', type: type, size: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${categoryLabels[template['category']]?.title ?? template['category']} · ${typeTitle('${template['category']}', type)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        TemplateStatusPill(status: status),
                        if (status == 'APPROVED') Text(quality ?? 'Quality pending', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(statusInfo[status]?.help ?? '', style: const TextStyle(color: Brand.muted, fontSize: 13)),
          if (status == 'REJECTED') ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Rejected by Meta. ${rejectionReasons['${template['rejected_reason'] ?? 'NONE'}'] ?? template['rejected_reason']}',
                    style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                  ),
                  TextButton.icon(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero),
                    onPressed: () => launchUrl(Uri.parse('https://business.facebook.com/business-support-home'), mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Request review with Meta'),
                  ),
                ],
              ),
            ),
          ],
          if (template['previous_category'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Category changed by Meta from ${categoryLabels[template['previous_category']]?.title ?? template['previous_category']}',
                style: const TextStyle(color: Color(0xFF8A6100), fontSize: 13),
              ),
            ),
          if (canManage) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (status == 'APPROVED') action(Icons.bar_chart, 'Insights', () => open(TemplateInsightsScreen(template: template))),
                if (editable) action(Icons.edit_outlined, 'Edit', () => open(TemplateEditorScreen(draft: draft, editing: template, flows: flows))),
                action(Icons.translate, 'Add language', () => actions.addLanguage(open)),
                action(Icons.copy_all_outlined, 'Duplicate', () => actions.duplicate(open)),
                action(Icons.delete_outline, 'Delete', () => actions.delete(context, done: () => Navigator.pop(context, 'Deleted.')), color: Brand.red),
              ],
            ),
          ],
          const SectionLabel('How customers see it'),
          TemplatePreview(draft: draft),
          const SectionLabel('Details'),
          info('Name', '${template['name']}'),
          info('Language', languageLabel(template['language'])),
          info('Category', categoryLabels[template['category']]?.title ?? '${template['category']}'),
          info('Type', typeTitle('${template['category']}', type)),
          if (extractVariables('${draft['body']}').isNotEmpty) info('Blanks', '${extractVariables('${draft['body']}').map((v) => '{{$v}}').join(', ')}, filled in when it is sent'),
          if (template['message_send_ttl_seconds'] is num) info('Valid for', describeDuration((template['message_send_ttl_seconds'] as num).toInt())),
          if (others.isNotEmpty) ...[
            const SectionLabel('Other languages'),
            for (final o in others)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.translate),
                title: Text(languageLabel(o['language'])),
                trailing: TemplateStatusPill(status: '${o['status']}'),
                onTap: () => Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => TemplateScreen(template: o, flows: flows),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
