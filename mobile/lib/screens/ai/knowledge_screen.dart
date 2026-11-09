import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// The answers the AI chatbot and AI suggestions use: question-style titles with the answer.
/// Kept on the phone; added, changed or removed offline and synced later. Managers change it.
List<Map<String, dynamic>> articlesOf(AppState app) {
  final removed = {
    for (final item in app.pending('knowledge'))
      if (item.method == 'DELETE') Uri.parse(item.path).queryParameters['id'],
  };
  final edited = {
    for (final item in app.pending('knowledge'))
      if (item.method == 'PATCH') '${item.body['id']}': item,
  };
  final added = [
    for (final item in app.pending('knowledge'))
      if (item.method == 'POST') {'id': item.id, 'title': item.body['title'], 'content': item.body['content'], '_waiting': true, '_failed': item.state.name == 'failed'},
  ];
  final saved = [
    for (final a in (app.cached('knowledge')?['articles'] as List? ?? const []))
      if (!removed.contains('${a['id']}'))
        {
          ...Map<String, dynamic>.from(a),
          if (edited['${a['id']}'] != null) ...{'title': edited['${a['id']}']!.body['title'], 'content': edited['${a['id']}']!.body['content'], '_waiting': true},
        },
  ];
  return [...added.reversed, ...saved];
}

class KnowledgeScreen extends StatefulWidget {
  const KnowledgeScreen({super.key});
  @override
  State<KnowledgeScreen> createState() => _KnowledgeScreenState();
}

class _KnowledgeScreenState extends State<KnowledgeScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final all = articlesOf(app);
    final q = _query.toLowerCase();
    final shown = all.where((a) => q.isEmpty || '${a['title']} ${a['content']}'.toLowerCase().contains(q)).toList();
    final canEdit = app.can('manage');
    return Scaffold(
      appBar: AppBar(title: Text('Knowledge base · ${all.length}')),
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              backgroundColor: Brand.blue,
              foregroundColor: Colors.white,
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ArticleScreen())),
              icon: const Icon(Icons.add),
              label: const Text('Add answer', style: TextStyle(fontWeight: FontWeight.w700)),
            )
          : null,
      body: Column(
        children: [
          const SyncBanner(cacheKey: 'knowledge'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search answers'),
              onChanged: (v) => setState(() => _query = v.trim()),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: app.syncNow,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(4, 4, 4, 12),
                    child: Text(
                      'The AI chatbot replies to customers from these answers, and AI suggestions in chats use them too. Write them the way you would answer a customer.',
                      style: TextStyle(color: Brand.textSoft, fontSize: 13.5, height: 1.4),
                    ),
                  ),
                  if (shown.isEmpty)
                    EmptyState(
                      icon: Icons.menu_book_outlined,
                      title: q.isEmpty ? 'No answers yet' : 'Nothing found',
                      text: q.isEmpty ? 'Add your timings, prices, address and common questions.' : 'Try other words.',
                    ),
                  for (final a in shown) ...[
                    Panel(
                      onTap: canEdit && a['_waiting'] != true ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => ArticleScreen(article: a))) : null,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text('${a['title']}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800)),
                              ),
                              if (a['_waiting'] == true) WaitingPill(failed: a['_failed'] == true),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${a['content']}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Brand.textSoft, height: 1.35),
                          ),
                          if (a['created_at'] != null) ...[const SizedBox(height: 6), Text('Added ${formatWhen(a['created_at'])}', style: const TextStyle(fontSize: 12, color: Brand.faint))],
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class ArticleScreen extends StatefulWidget {
  const ArticleScreen({super.key, this.article});
  final Map<String, dynamic>? article;
  @override
  State<ArticleScreen> createState() => _ArticleScreenState();
}

class _ArticleScreenState extends State<ArticleScreen> {
  late final _title = TextEditingController(text: widget.article?['title'] ?? '');
  late final _content = TextEditingController(text: widget.article?['content'] ?? '');

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final editing = widget.article != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(editing ? 'Edit answer' : 'New answer'),
        actions: [
          if (editing)
            IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.delete_outline, color: Brand.red),
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Remove this answer?'),
                    content: const Text('The AI stops using it.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                      TextButton(
                        onPressed: () => Navigator.pop(context, true),
                        style: TextButton.styleFrom(foregroundColor: Brand.red),
                        child: const Text('Remove'),
                      ),
                    ],
                  ),
                );
                if (ok != true) return;
                await app.enqueue(kind: 'knowledge', label: 'Remove answer: ${widget.article!['title']}', method: 'DELETE', path: '/api/knowledge?id=${widget.article!['id']}', body: {});
                if (context.mounted) Navigator.pop(context);
              },
            ),
        ],
      ),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                TextField(
                  controller: _title,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Question or topic', hintText: 'Do you have parking?'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _content,
                  minLines: 6,
                  maxLines: 14,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Answer', hintText: 'Yes, free two-wheeler parking in front…', alignLabelWithHint: true),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Tip: one topic per answer, with prices, timings and names spelled out. The AI uses the exact words you write.',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(
            onPressed: () async {
              final title = _title.text.trim(), content = _content.text.trim();
              if (title.isEmpty || content.isEmpty) return toast(context, 'Write the question and the answer.');
              if (editing) {
                await app.enqueue(kind: 'knowledge', label: 'Change answer: $title', method: 'PATCH', path: '/api/knowledge', body: {'id': widget.article!['id'], 'title': title, 'content': content});
              } else {
                await app.enqueue(kind: 'knowledge', label: 'New answer: $title', path: '/api/knowledge', body: {'organizationId': app.orgId, 'type': 'manual', 'title': title, 'content': content});
              }
              if (!context.mounted) return;
              toast(context, app.online ? 'Saved. The AI uses it from now on.' : 'Saved on the phone. It syncs when you are online.');
              Navigator.pop(context);
            },
            icon: const Icon(Icons.check),
            label: const Text('Save answer'),
          ),
        ),
      ),
    );
  }
}
