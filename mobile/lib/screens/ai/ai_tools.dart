import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../store/store_screen.dart' show confirmAction, plain;

/// The AI's extra tools, as on the web's Settings → Knowledge Base and General:
/// - Questions the AI couldn't answer: write the answer (the AI drafts it from the team's reply), save it as an FAQ
/// - Knowledge from your website, PDFs, Word files and text (read and split into parts the AI searches)
/// - How the AI replies (tone, emoji, quick buttons, typing) and when it hands a chat to your team

class UnansweredScreen extends StatefulWidget {
  const UnansweredScreen({super.key});
  @override
  State<UnansweredScreen> createState() => _UnansweredScreenState();
}

class _UnansweredScreenState extends State<UnansweredScreen> {
  List<Map<String, dynamic>>? _gaps;
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/knowledge/gaps', {'organizationId': app.orgId, 'status': 'open'});
      if (mounted) setState(() => _gaps = [for (final g in (data['gaps'] as List? ?? const [])) Map<String, dynamic>.from(g as Map)]);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
  }

  Future<void> _mark(Map<String, dynamic> gap, String action) async {
    try {
      await AppScope.read(context).ask('/api/knowledge/gaps', {'id': gap['id'], 'action': action});
      if (mounted) _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  Future<void> _answer(Map<String, dynamic> gap) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _AnswerGapScreen(gap: gap)));
    if (saved == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = AppScope.of(context).can('manage');
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Questions the AI couldn\'t answer')),
      body: _gaps == null
          ? (_error.isNotEmpty ? _LoadFailed(text: _error, onRetry: _retry) : const SkeletonList(rows: 5, avatar: false))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Text('Customers asked these and the AI had no answer, so it handed the chat to your team. Add the answer once and the AI answers it from now on.', style: TextStyle(color: Brand.textSoft)),
                  ),
                  if (_gaps!.isEmpty) const EmptyState(icon: Icons.task_alt, title: 'All answered', text: 'New questions the AI could not answer appear here.'),
                  for (final g in _gaps!)
                    FlatRow(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${g['question']}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text('Asked ${g['asked_count']} time${g['asked_count'] == 1 ? '' : 's'} · last ${formatWhen('${g['last_asked_at']}')}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                          if (canEdit)
                            Wrap(
                              spacing: 8,
                              children: [
                                FilledButton.tonal(onPressed: () => _answer(g), child: const Text('Write the answer')),
                                TextButton(onPressed: () => _mark(g, 'ignore'), child: const Text('Ignore')),
                              ],
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class _AnswerGapScreen extends StatefulWidget {
  const _AnswerGapScreen({required this.gap});
  final Map<String, dynamic> gap;
  @override
  State<_AnswerGapScreen> createState() => _AnswerGapScreenState();
}

class _AnswerGapScreenState extends State<_AnswerGapScreen> {
  late final _title = TextEditingController(text: '${widget.gap['question']}');
  final _content = TextEditingController();
  bool _drafting = false, _saving = false;
  String _error = '';

  @override
  void dispose() {
    _title.dispose();
    _content.dispose();
    super.dispose();
  }

  Future<void> _draft() async {
    setState(() {
      _drafting = true;
      _error = '';
    });
    try {
      final r = await AppScope.read(context).ask('/api/knowledge/gaps', {'id': widget.gap['id'], 'action': 'draft'});
      final d = Map<String, dynamic>.from(r['draft'] as Map? ?? const {});
      if (!mounted) return;
      setState(() {
        if ('${d['title'] ?? ''}'.isNotEmpty) _title.text = '${d['title']}';
        _content.text = '${d['content'] ?? ''}';
      });
      if (_content.text.contains('[')) toast(context, 'Fill in the [blanks] before saving.');
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _drafting = false);
    }
  }

  Future<void> _save() async {
    final title = _title.text.trim(), content = _content.text.trim();
    if (title.length < 3 || content.length < 3) return setState(() => _error = 'Write the question and its answer.');
    if (RegExp(r'\[[^\]]+\]').hasMatch(content)) return setState(() => _error = 'Fill in the [blanks] first.');
    setState(() => _saving = true);
    final app = AppScope.read(context);
    try {
      await app.ask('/api/knowledge', {'type': 'manual', 'title': title, 'content': content});
      await app.ask('/api/knowledge/gaps', {'id': widget.gap['id'], 'action': 'answered'});
      if (mounted) {
        toast(context, 'Saved. The AI answers this from now on.');
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Write the answer')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(controller: _title, decoration: const InputDecoration(labelText: 'Question')),
        const SizedBox(height: 12),
        TextField(controller: _content, minLines: 5, maxLines: 12, decoration: const InputDecoration(labelText: 'Answer', alignLabelWithHint: true)),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(onPressed: _drafting ? null : _draft, icon: const Icon(Icons.auto_awesome), label: Text(_drafting ? 'Writing…' : 'Write it with AI (from your team\'s reply)')),
        ),
        if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save answer')),
      ],
    ),
  );
}

/// Knowledge from your website, PDFs, Word files and text.
class SourcesScreen extends StatefulWidget {
  const SourcesScreen({super.key});
  @override
  State<SourcesScreen> createState() => _SourcesScreenState();
}

class _SourcesScreenState extends State<SourcesScreen> {
  List<Map<String, dynamic>>? _sources;
  String _error = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/knowledge/sources', {'organizationId': app.orgId});
      if (mounted) setState(() => _sources = [for (final s in (data['sources'] as List? ?? const [])) Map<String, dynamic>.from(s as Map)]);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
  }

  Future<void> _add(Map<String, dynamic> body, String done) async {
    setState(() => _busy = true);
    try {
      await AppScope.read(context).ask('/api/knowledge/sources', body);
      if (!mounted) return;
      toast(context, done);
      _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addWebsite() async {
    final url = TextEditingController();
    var whole = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          // Scrolls above the keyboard on small phones
          scrollable: true,
          title: const Text('Add your website'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: url, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Website address', hintText: 'https://yourshop.in')),
              CheckboxListTile(value: whole, onChanged: (v) => set(() => whole = v ?? true), contentPadding: EdgeInsets.zero, title: const Text('Read the whole site (up to 25 pages)')),
            ],
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add'))],
        ),
      ),
    );
    if (ok == true && url.text.trim().isNotEmpty) await _add({'kind': 'website', 'url': url.text.trim(), 'wholeSite': whole}, 'Reading your website. It takes a minute or two.');
    url.dispose();
  }

  Future<void> _addText() async {
    final title = TextEditingController(), text = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Paste text'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Name, like "Return policy"')),
            const SizedBox(height: 8),
            TextField(controller: text, minLines: 4, maxLines: 8, decoration: const InputDecoration(labelText: 'Text', alignLabelWithHint: true)),
          ],
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add'))],
      ),
    );
    if (ok == true) await _add({'kind': 'text', 'title': title.text.trim(), 'text': text.text.trim()}, 'Added. The AI can use it in a minute.');
    title.dispose();
    text.dispose();
  }

  Future<void> _addFile() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf', 'docx', 'txt', 'md', 'csv']);
    if (file == null || !mounted) return;
    // The size first, before reading it: the AI reads files up to 25 MB
    final size = file.lengthSync() ?? await file.length() ?? 0;
    if (!mounted) return;
    if (size > 25 * 1024 * 1024) return toast(context, 'The file is bigger than 25 MB. Split it into smaller files.');
    setState(() => _busy = true);
    final app = AppScope.read(context);
    try {
      final bytes = await file.readAsBytes();
      final pass = await app.ask('/api/knowledge/upload-url', {'purpose': 'source', 'fileName': file.name, 'size': bytes.length});
      final ending = file.name.split('.').last.toLowerCase();
      final type = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'csv': 'text/csv'}[ending] ?? 'text/plain';
      await app.backend.uploadToStorage('${pass['bucket']}', '${pass['path']}', '${pass['token']}', bytes, type);
      await app.ask('/api/knowledge/sources', {'kind': 'file', 'path': pass['path'], 'fileName': file.name});
      if (!mounted) return;
      toast(context, 'Reading ${file.name}. It takes a minute or two.');
      _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> s) async {
    // The AI stops answering from it at once, and reading a website again takes minutes: ask first
    final sure = await confirmAction(context, title: 'Delete this source?', message: 'The AI stops using "${s['title'] ?? 'it'}" in its answers.', yes: 'Delete', destructive: true);
    if (!sure || !mounted) return;
    final app = AppScope.read(context);
    try {
      await app.backend.send('DELETE', '/api/knowledge/sources?organizationId=${app.orgId}&id=${s['id']}', const {});
      if (!mounted) return;
      toast(context, 'Deleted.');
      _load();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = AppScope.of(context).can('manage');
    IconData icon(String kind) => switch (kind) { 'website' => Icons.language, 'pdf' => Icons.picture_as_pdf_outlined, 'document' => Icons.description_outlined, _ => Icons.notes };
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('Website and documents')),
      floatingActionButton: canEdit
          ? PopupMenuButton<String>(
              onSelected: (v) => v == 'website' ? _addWebsite() : v == 'file' ? _addFile() : _addText(),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'website', child: ListTile(leading: Icon(Icons.language), title: Text('Your website'), contentPadding: EdgeInsets.zero)),
                PopupMenuItem(value: 'file', child: ListTile(leading: Icon(Icons.upload_file), title: Text('PDF or Word file'), contentPadding: EdgeInsets.zero)),
                PopupMenuItem(value: 'text', child: ListTile(leading: Icon(Icons.notes), title: Text('Paste text'), contentPadding: EdgeInsets.zero)),
              ],
              child: FloatingActionButton.extended(onPressed: null, icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.add), label: const Text('Add')),
            )
          : null,
      body: _sources == null
          ? (_error.isNotEmpty ? _LoadFailed(text: _error, onRetry: _retry) : const SkeletonList(rows: 4, avatar: false))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 96),
                children: [
                  const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 8), child: Text('The AI reads these and answers customers from them, next to your FAQs.', style: TextStyle(color: Brand.textSoft))),
                  if (_sources!.isEmpty) const EmptyState(icon: Icons.menu_book_outlined, title: 'Nothing added yet', text: 'Add your website, a price list PDF or your policies.'),
                  for (final s in _sources!)
                    FlatRow(
                      child: Row(
                        children: [
                          Icon(icon('${s['kind']}'), color: Brand.muted),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${s['title']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                                Text(
                                  s['status'] == 'ready' ? 'Ready · ${s['chunk_count']} parts' : s['status'] == 'failed' ? '${s['error'] ?? 'Could not be read'}' : 'Being read…',
                                  style: TextStyle(fontSize: 12.5, color: s['status'] == 'failed' ? Brand.red : Brand.muted),
                                ),
                              ],
                            ),
                          ),
                          if (canEdit) IconButton(tooltip: 'Delete', onPressed: () => _delete(s), icon: const Icon(Icons.delete_outline)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

/// How the AI replies (tone, emoji, buttons, typing) and when it hands a chat to your team.
class ReplyStyleScreen extends StatefulWidget {
  const ReplyStyleScreen({super.key});
  @override
  State<ReplyStyleScreen> createState() => _ReplyStyleScreenState();
}

class _ReplyStyleScreenState extends State<ReplyStyleScreen> {
  Map<String, dynamic>? _settings, _style;
  final _message = TextEditingController();
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/ai/handoff', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(() {
        _settings = Map<String, dynamic>.from(data['settings'] as Map? ?? const {});
        _style = Map<String, dynamic>.from(data['style'] as Map? ?? const {'tone': 'friendly', 'emoji': true, 'buttons': true, 'typing': true});
        _message.text = '${_settings!['message'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  void _retry() {
    setState(() => _error = '');
    _load();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await AppScope.read(context).ask('/api/ai/handoff', {'settings': {..._settings!, 'message': _message.text.trim()}, 'style': _style}, method: 'PUT');
      if (mounted) toast(context, 'Saved.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = AppScope.of(context).can('manage');
    final s = _settings, st = _style;
    Widget toggle(String label, String sub, bool value, ValueChanged<bool> set) => SwitchListTile(value: value, onChanged: canEdit ? set : null, contentPadding: EdgeInsets.zero, title: Text(label), subtitle: Text(sub));
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('How the AI replies')),
      bottomNavigationBar: KeyboardBar.wrap(canEdit && s != null
          ? SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 10), child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save'))))
          : null),
      body: s == null || st == null
          ? (_error.isNotEmpty ? _LoadFailed(text: _error, onRetry: _retry) : const SkeletonCards())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Style', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final (v, label) in const [('friendly', 'Friendly'), ('professional', 'Professional'), ('short', 'Short')])
                            ChoiceChip(label: Text(label), selected: st['tone'] == v, onSelected: canEdit ? (_) => setState(() => _style = {...st, 'tone': v}) : null),
                        ],
                      ),
                      toggle('Emoji', 'A few, where they fit', st['emoji'] != false, (v) => setState(() => _style = {...st, 'emoji': v})),
                      toggle('Quick buttons', 'Follow-up questions the customer can tap', st['buttons'] != false, (v) => setState(() => _style = {...st, 'buttons': v})),
                      toggle('"Typing…"', 'Shows while the AI writes', st['typing'] != false, (v) => setState(() => _style = {...st, 'typing': v})),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('When the AI hands a chat to your team', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      toggle('Stop the AI in that chat', 'Your team takes over; the AI stays quiet there', s['pauseAi'] != false, (v) => setState(() => _settings = {...s, 'pauseAi': v})),
                      toggle('Turn the AI back on when the ticket is resolved', '', s['resumeOnResolve'] != false, (v) => setState(() => _settings = {...s, 'resumeOnResolve': v})),
                      toggle('Keep answering other questions when unsure', 'A ticket is still made for the one it could not answer', s['keepAiWhenUnsure'] == true, (v) => setState(() => _settings = {...s, 'keepAiWhenUnsure': v})),
                      const SizedBox(height: 8),
                      TextField(controller: _message, enabled: canEdit, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Your hand-off message (optional)', hintText: 'Empty: the AI writes it in the customer\'s language')),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

/// The first load did not work: why, with Try again.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.text, required this.onRetry});
  final String text;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => ListView(
    children: [
      EmptyState(
        icon: Icons.cloud_off,
        title: 'Could not load',
        text: text,
        action: FilledButton(onPressed: onRetry, child: const Text('Try again')),
      ),
    ],
  );
}
