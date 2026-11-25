import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../data/backend.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../store/store_screen.dart' show fitPhoto;
import '../templates/template_widgets.dart';
import 'chat_parts.dart';
import 'media.dart';

/// One upload from the app can carry about 4 MB (the server refuses bigger ones). Photos are made smaller first.
const _maxUpload = 4 * 1024 * 1024;

/// An error in plain words for a toast: the server's or the app's own words, else [fallback].
String _plainError(Object e, String fallback) {
  final text = '$e';
  if (e is ApiException || e is OfflineException) return text;
  if (text.startsWith('Exception: ')) return text.substring(11);
  return fallback;
}

/// One chat (WhatsApp or Instagram: the screen follows the chat's channel), with everything the web inbox has:
/// - AI replies on/off for this chat (the chatbot answers from the knowledge base)
/// - AI suggested replies, with the knowledge base answer they came from
/// - Rephrase what you typed (professional, friendly, shorter, fix grammar)
/// - Photos and documents, reply to a message, templates after 24 hours
/// - The chat's open ticket, with Resolve; marked read when opened
/// Messages typed offline wait on the phone and go when the internet is back. AI and files need
/// the internet and say so.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.conversation, this.showSuggestions = false});
  final Map<String, dynamic> conversation;

  /// Open with the AI suggestions showing (demo screenshots).
  final bool showSuggestions;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  bool _showJump = false;
  String get _id => '${widget.conversation['id']}';

  /// An Instagram DM chat: 7-day reply window, no templates, no phone number.
  bool get _ig => AppState.isInstagramChat(widget.conversation);
  String get _key => 'messages:$_id';
  Map<String, dynamic>? _replyTo;
  bool _showSuggestions = false;
  bool _loadingSuggestions = false;
  String? _suggestionsError;
  List<Map<String, dynamic>> _suggestions = const [];
  bool _rephrasing = false;
  bool _uploading = false;

  /// The first fetch of this chat has finished (well or not): an empty chat after it says why.
  bool _loadTried = false;

  /// Messages before the newest ones kept on the phone, fetched as you scroll up (with the ones on screen then).
  List<Map<String, dynamic>> _older = const [];

  /// The server has messages before the oldest one shown (null: not asked yet, the phone's copy says).
  bool? _olderMore;
  bool _moreBefore = false;
  bool _loadingOlder = false;
  bool _olderFailed = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (!_scroll.hasClients) return;
      // "Jump to the latest message" shows once you scroll up a little (the list starts at the newest)
      final show = _scroll.offset > 400;
      if (show != _showJump) setState(() => _showJump = show);
      // Near the oldest message on screen: bring the ones before it
      if (_moreBefore && !_olderFailed && _scroll.position.pixels > _scroll.position.maxScrollExtent - 600) _loadOlder();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final app = AppScope.read(context);
      // No notifications for the chat on screen; new messages appear here live
      app.openChatId = _id;
      _app = app;
      _reload();
      if (((_conversation(app)['unread_count'] as num?) ?? 0) > 0) {
        app.enqueue(kind: 'chat_setting', label: 'Mark ${contactName(widget.conversation['contact'])} read', method: 'PATCH', path: '/api/conversations', body: {'conversationId': _id, 'read': true});
      }
      if (widget.showSuggestions) _suggest();
    });
  }

  AppState? _app;

  @override
  void dispose() {
    if (_app?.openChatId == _id) _app!.openChatId = null;
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// The chat as the phone knows it now, with a pending AI on/off change laid over it.
  Map<String, dynamic> _conversation(AppState app) {
    final saved = app.findChat(_id);
    final conv = Map<String, dynamic>.from(saved ?? widget.conversation);
    for (final item in app.pending('chat_setting')) {
      if (item.body['conversationId'] != _id) continue;
      if (item.body['autoReply'] is bool) conv['auto_reply_enabled'] = item.body['autoReply'];
      if (item.body['read'] == true) conv['unread_count'] = 0;
    }
    return conv;
  }

  Future<void> _reload() async {
    final app = _app ?? AppScope.read(context);
    await app.load(_key, '/api/messages', query: {'conversationId': _id, 'limit': '60'}, force: true);
    if (mounted) setState(() => _loadTried = true);
  }

  /// The messages from the server: older ones fetched while scrolling up, then the newest kept on the phone.
  List<Map<String, dynamic>> _serverMessages(Map<String, dynamic>? saved) {
    final server = [for (final m in (saved?['messages'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)];
    if (_older.isEmpty) return server;
    final ids = {for (final m in server) m['id']};
    return [..._older.where((m) => !ids.contains(m['id'])), ...server];
  }

  Future<void> _loadOlder() async {
    final app = _app;
    if (_loadingOlder || app == null) return;
    final shown = _serverMessages(app.cached(_key));
    final before = shown.isEmpty ? '' : '${shown.first['created_at'] ?? ''}';
    if (before.isEmpty) return;
    setState(() {
      _loadingOlder = true;
      _olderFailed = false;
    });
    try {
      final data = await app.backend.get('/api/messages', {'organizationId': app.orgId, 'conversationId': _id, 'limit': '60', 'before': before});
      if (!mounted) return;
      final got = [for (final m in (data['messages'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)];
      setState(() {
        _older = [...got, ...shown];
        _olderMore = data['hasMore'] == true && got.isNotEmpty;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _olderFailed = true);
      toast(context, _plainError(e, 'Older messages could not be loaded. Please try again.'));
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  List<Map<String, dynamic>> _messages(AppState app, Map<String, dynamic>? saved) {
    final server = _serverMessages(saved);
    final waiting = [
      for (final item in app.pending('message'))
        if (item.body['conversationId'] == _id)
          {
            'id': item.id,
            'body': item.body['message'],
            'media_url': item.body['mediaUrl'],
            'sender_type': 'user',
            'created_at': item.createdAt.toUtc().toIso8601String(),
            '_waiting': true,
            '_failed': item.state.name == 'failed',
          },
    ];
    return [...server, ...waiting];
  }

  Map<String, dynamic>? _openTicket(AppState app) {
    final resolving = {for (final item in app.pending('ticket')) '${item.body['ticketId']}'};
    final tickets = (app.cached('tickets')?['tickets'] as List? ?? const []);
    final t = tickets.cast<Map?>().firstWhere((t) => t!['conversation_id'] == _id && t['status'] == 'open' && !resolving.contains('${t['id']}'), orElse: () => null);
    return t == null ? null : Map<String, dynamic>.from(t);
  }

  /// Instagram: 24 hours, or 7 days once Meta has approved the app for Human Agent (the server says which).
  int _igHours(AppState app) => ((app.me?['instagram'] as Map?)?['replyHours'] as num?)?.toInt() ?? 24;

  bool _windowOpen(AppState app, List<Map<String, dynamic>> messages) {
    DateTime? last;
    for (final m in messages.reversed) {
      if (m['sender_type'] == 'contact') {
        last = DateTime.tryParse('${m['created_at']}');
        break;
      }
    }
    final lastMessage = widget.conversation['last_message'] as Map?;
    if (last == null && lastMessage?['sender_type'] == 'contact') last = DateTime.tryParse('${lastMessage?['created_at']}');
    // WhatsApp: 24 hours for free messages. Instagram: 24 hours (7 days when Meta allows Human Agent).
    return last != null && DateTime.now().difference(last).inMinutes < (_ig ? _igHours(app) : 24) * 60;
  }

  // ── Sending ──

  void _send(AppState app, {String? text, Map<String, dynamic>? template, String? mediaUrl, String? fileName}) {
    final phone = widget.conversation['contact']?['phone_number'];
    // A file on its own goes with no words (the customer never sees the phone's file name); the name is only for the list
    final String words = text ?? '${template?['preview'] ?? ''}';
    final label = words.isNotEmpty ? words : (fileName == null ? '' : '📎 $fileName');
    app.enqueue(
      kind: 'message',
      label: 'Message to ${contactName(widget.conversation['contact'])}: ${label.split('\n').first}',
      path: '/api/messages/send',
      body: {
        'conversationId': _id,
        'organizationId': app.orgId,
        'phoneNumber': phone,
        'message': words,
        'channel': _ig ? 'instagram' : 'whatsapp',
        'replyToMessageId': ?_replyTo?['id'],
        'mediaUrl': ?mediaUrl,
        if (template != null) ...{
          'templateName': template['name'],
          'templateLanguage': template['language'],
          'templateVariables': template['variables'],
          'templateMetaComponents': template['components'],
        },
      },
    );
    _text.clear();
    setState(() {
      _replyTo = null;
      _showSuggestions = false;
    });
    // Your own message is at the bottom: show it, even when you had scrolled up
    if (_scroll.hasClients && _scroll.offset > 0) _scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    if (!app.online) toast(context, 'Saved. It will be sent when you are online.');
  }

  Future<void> _attach(AppState app) async {
    // Instagram takes photos, videos, voice (m4a) and PDFs; WhatsApp also takes Word and Excel files
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: _ig ? ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'm4a', 'pdf'] : ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'mp4'],
    );
    if (file == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final photo = const ['jpg', 'jpeg', 'png', 'webp'].contains(file.name.split('.').last.toLowerCase());
      // The size first, before reading the file (a long video can be far bigger than the phone's memory)
      final size = file.lengthSync() ?? await file.length() ?? 0;
      if (size > (photo ? 30 * 1024 * 1024 : _maxUpload)) {
        if (mounted) toast(context, photo ? 'This photo is too big. Pick one under 4 MB.' : 'Files can be up to 4 MB from the app. Pick a smaller one.');
        return;
      }
      List<int> bytes = await file.readAsBytes();
      var name = file.name;
      // A big phone photo is made smaller first, so it fits in one upload
      if (photo) (bytes, name) = await fitPhoto(bytes, name);
      final uploaded = await app.uploadFile(bytes, name);
      if (!mounted) return;
      _send(app, text: _text.text.trim().isEmpty ? null : _text.text.trim(), mediaUrl: '${uploaded['url']}', fileName: name);
    } catch (e) {
      if (mounted) toast(context, _plainError(e, 'The file could not be sent. Please try again.'));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  // ── AI ──

  Future<void> _suggest() async {
    final app = AppScope.read(context);
    setState(() {
      _showSuggestions = true;
      _loadingSuggestions = true;
      _suggestionsError = null;
    });
    try {
      final data = await app.ask('/api/ai/copilot', {'conversationId': _id});
      if (!mounted) return;
      if (data['aiPaused'] == true) throw Exception(data['error'] ?? 'AI is paused. Top up the AI wallet on the web.');
      setState(
        () => _suggestions = [
          for (final s in (data['suggestions'] as List? ?? const [])) s is String ? {'text': s} : Map<String, dynamic>.from(s),
        ],
      );
    } catch (e) {
      if (mounted) setState(() => _suggestionsError = _plainError(e, 'Suggestions could not be loaded. Please try again.'));
    } finally {
      if (mounted) setState(() => _loadingSuggestions = false);
    }
  }

  Future<void> _rephrase(AppState app) async {
    final original = _text.text.trim();
    if (original.isEmpty) return;
    final tone = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      // Taller than the usual sheet allows on small phones: it scrolls instead of cutting off the last choice
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Rephrase with AI', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                ),
              ),
              for (final (id, label, hint, icon) in [
                ('professional', 'Professional', 'Polite and formal', Icons.business_center_outlined),
                ('friendly', 'Friendly', 'Warm and personal', Icons.sentiment_satisfied_alt_outlined),
                ('short', 'Shorter', 'Same meaning, fewer words', Icons.short_text),
                ('grammar', 'Fix grammar', 'Only spelling and grammar', Icons.spellcheck),
              ])
                ListTile(
                  leading: Icon(icon, color: Brand.navy),
                  title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(hint),
                  onTap: () => Navigator.pop(context, id),
                ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
    if (tone == null) return;
    setState(() => _rephrasing = true);
    try {
      final data = await app.ask('/api/ai/rephrase', {'text': original, 'tone': tone});
      final better = '${data['rephrased'] ?? ''}'.trim();
      if (better.isEmpty || !mounted) return;
      _text.text = better;
      _text.selection = TextSelection.collapsed(offset: better.length);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: const Text('Rephrased.'),
            action: SnackBarAction(label: 'Undo', textColor: Colors.white, onPressed: () => _text.text = original),
          ),
        );
    } catch (e) {
      if (mounted) toast(context, _plainError(e, 'It could not be rephrased. Please try again.'));
    } finally {
      if (mounted) setState(() => _rephrasing = false);
    }
  }

  void _toggleAi(AppState app, bool on) {
    app.enqueue(
      kind: 'chat_setting',
      label: 'AI replies ${on ? 'on' : 'off'} for ${contactName(widget.conversation['contact'])}',
      method: 'PATCH',
      path: '/api/conversations',
      body: {'conversationId': _id, 'autoReply': on},
    );
    toast(context, on ? 'AI replies are on for this chat.' : 'AI replies are off. You answer this chat yourself.');
  }

  void _messageActions(Map<String, dynamic> message, {required bool canReply}) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canReply)
              ListTile(
                leading: const Icon(Icons.reply),
                title: const Text('Reply'),
                onTap: () {
                  Navigator.pop(context);
                  setState(() => _replyTo = message);
                },
              ),
            ListTile(
              leading: const Icon(Icons.copy),
              title: const Text('Copy text'),
              onTap: () {
                Clipboard.setData(ClipboardData(text: messageText(message['body'])));
                Navigator.pop(context);
                toast(this.context, 'Copied.');
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// A message WhatsApp or Instagram did not deliver: why, and what to do now.
  void _notSent(AppState app, Map<String, dynamic> message, {required bool open}) {
    final words = messageText(message['body']).trim();
    final reason = '${message['error_message'] ?? ''}'.trim();
    final window = RegExp('131047|re-engagement|24 hours|24-hour', caseSensitive: false).hasMatch(reason);
    final canSendAgain = open && words.isNotEmpty && words != '[Media Attachment]' && !words.startsWith('[Template:');
    final explain = !window
        ? '${_ig ? 'Instagram' : 'WhatsApp'} did not deliver this message.'
        : _ig
        ? 'Too long since this customer wrote, so Instagram did not deliver it. You can answer again when they write to you.'
        : 'More than 24 hours since this customer wrote, so WhatsApp did not deliver it. Send an approved template instead.';
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Not sent', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.red)),
              const SizedBox(height: 6),
              Text(explain, style: const TextStyle(fontSize: 14.5, height: 1.4)),
              if (reason.isNotEmpty && !window) ...[
                const SizedBox(height: 6),
                Text(reason, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ],
              const SizedBox(height: 14),
              if (canSendAgain)
                FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _send(app, text: words);
                  },
                  icon: const Icon(Icons.send),
                  label: const Text('Send again'),
                ),
              if (!_ig) ...[
                if (canSendAgain) const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    Navigator.pop(sheet);
                    final picked = await pickTemplate(context, firstName: contactName(widget.conversation['contact']).split(' ').first);
                    if (picked != null && mounted) _send(app, template: picked);
                  },
                  icon: const Icon(Icons.description_outlined),
                  label: const Text('Send a template'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _contactSheet(Map<String, dynamic> conv) {
    final c = Map<String, dynamic>.from(conv['contact'] ?? const {});
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Avatar(contactName(c), size: 52),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(contactName(c), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                        Text(_ig ? 'Instagram' : showPhone(c['phone_number']), style: const TextStyle(color: Brand.muted)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if ('${c['email'] ?? ''}'.isNotEmpty) _InfoLine(icon: Icons.mail_outline, text: '${c['email']}'),
              if ('${c['company'] ?? ''}'.isNotEmpty) _InfoLine(icon: Icons.business_outlined, text: '${c['company']}'),
              if ((c['tags'] as List? ?? const []).isNotEmpty) Wrap(spacing: 6, children: [for (final t in c['tags']) Pill('$t')]),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final conv = _conversation(app);
    final saved = app.cached(_key);
    final messages = _messages(app, saved);
    _moreBefore = _olderMore ?? (saved?['hasMore'] == true);
    final open = _windowOpen(app, messages);
    final name = contactName(conv['contact']);
    final aiOn = conv['auto_reply_enabled'] != false;
    final ticket = _openTicket(app);
    // Read-only team members can read chats but not answer them (the server would refuse)
    final canWrite = app.can('write');
    final loading = saved == null && app.isLoading(_key);
    return Scaffold(
      backgroundColor: Brand.chatBg,
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: () => _contactSheet(conv),
          child: Row(
            children: [
              Avatar(name, size: 38),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w600)),
                    Row(
                      children: [
                        if (_ig) const Padding(padding: EdgeInsets.only(right: 4), child: Icon(Icons.camera_alt_outlined, size: 13, color: Brand.muted)),
                        Flexible(
                          child: Text(
                            _ig ? 'Instagram' : showPhone(conv['contact']?['phone_number']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w400, color: Brand.muted),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          // AI replies on / off for this chat: a small switch with its words, like a WhatsApp header action
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Tooltip(
              message: aiOn ? 'The AI answers this customer. Tap to answer yourself.' : 'You answer this customer. Tap to let the AI answer.',
              child: InkWell(
                borderRadius: BorderRadius.circular(99),
                onTap: app.can('write') ? () => _toggleAi(app, !aiOn) : null,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(8, 5, 10, 5),
                  decoration: BoxDecoration(
                    color: aiOn ? Brand.blueSoft : Brand.lineSoft,
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(color: aiOn ? Brand.blue.withValues(alpha: 0.35) : Brand.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(aiOn ? Icons.smart_toy : Icons.smart_toy_outlined, size: 16, color: aiOn ? Brand.blue : Brand.muted),
                      const SizedBox(width: 5),
                      Text(aiOn ? 'AI on' : 'AI off', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: aiOn ? Brand.blue : Brand.muted)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          SyncBanner(cacheKey: _key),
          if (ticket != null)
            Material(
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                child: Row(
                  children: [
                    const Icon(Icons.confirmation_number_outlined, size: 20, color: Brand.red),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Open ticket: ${ticket['subject'] ?? ticket['title'] ?? 'Needs a reply'}',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (canWrite)
                      TextButton(
                        onPressed: () {
                          app.enqueue(
                            kind: 'ticket',
                            label: 'Resolve ticket: ${ticket['subject'] ?? ticket['title'] ?? ''}',
                            method: 'PATCH',
                            path: '/api/tickets',
                            body: {'ticketId': ticket['id'], 'status': 'resolved'},
                          );
                          toast(context, 'Ticket resolved.');
                        },
                        child: const Text('Resolve'),
                      ),
                  ],
                ),
              ),
            ),
          Expanded(
            child: loading && messages.isEmpty
                ? const SkeletonList(rows: 6, avatar: false)
                : messages.isEmpty && _loadTried
                ? ListView(
                    children: [
                      saved == null
                          ? EmptyState(
                              icon: Icons.cloud_off,
                              title: app.online ? 'Could not load this chat' : 'Connect to the internet to see this chat',
                              text: app.online ? 'Check the internet and try again.' : 'This chat is not saved on the phone yet.',
                              action: FilledButton(onPressed: _reload, child: const Text('Try again')),
                            )
                          : EmptyState(icon: Icons.chat_bubble_outline, title: 'No messages yet', text: 'Messages with $name show here.'),
                    ],
                  )
                : Builder(
                    builder: (context) {
                      final entries = chatEntries(messages);
                      final byId = {for (final m in messages) '${m['id']}': m};
                      // One more row at the top while older messages can be fetched
                      final top = _moreBefore ? 1 : 0;
                      return Stack(
                        children: [
                          ListView.builder(
                            controller: _scroll,
                            reverse: true,
                            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                            itemCount: entries.length + top,
                            itemBuilder: (context, index) {
                              if (index == entries.length) {
                                return Center(
                                  child: Padding(
                                    padding: const EdgeInsets.all(8),
                                    child: _loadingOlder
                                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                                        : TextButton(onPressed: _loadOlder, child: const Text('Load older messages')),
                                  ),
                                );
                              }
                              final entry = entries[entries.length - 1 - index];
                              if (entry.day != null) return ChatDayChip(entry.day!);
                              final m = entry.message!;
                              final quotedId = replyParts(m['body']).$1;
                              final notSent = m['status'] == 'failed' && m['_waiting'] != true;
                              return SwipeToReply(
                                enabled: canWrite && open && m['_waiting'] != true,
                                onReply: () => setState(() => _replyTo = m),
                                child: GestureDetector(
                                  onLongPress: () => _messageActions(m, canReply: canWrite && m['_waiting'] != true),
                                  onTap: notSent && canWrite ? () => _notSent(app, m, open: open) : null,
                                  child: _Bubble(message: m, tail: entry.firstOfRun, quoted: quotedId == null ? null : byId[quotedId], contactName: name),
                                ),
                              );
                            },
                          ),
                          if (_showJump)
                            Positioned(
                              right: 12,
                              bottom: 12,
                              child: Material(
                                color: Colors.white,
                                shape: const CircleBorder(),
                                elevation: 2,
                                child: IconButton(
                                  tooltip: 'Latest messages',
                                  onPressed: () => _scroll.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut),
                                  icon: const Icon(Icons.keyboard_double_arrow_down, color: Brand.textSoft),
                                ),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
          ),
          if (_showSuggestions && canWrite)
            // Shrinks to share the room with the messages when the keyboard is up, so the message box stays on screen
            Flexible(
              child: _SuggestionsPanel(
                loading: _loadingSuggestions,
                error: _suggestionsError,
                suggestions: _suggestions,
                onClose: () => setState(() => _showSuggestions = false),
                onRetry: _suggest,
                onPick: (text) {
                  _text.text = text;
                  _text.selection = TextSelection.collapsed(offset: text.length);
                  setState(() => _showSuggestions = false);
                },
              ),
            ),
          if (!canWrite)
            SafeArea(
              top: false,
              child: Container(
                width: double.infinity,
                margin: const EdgeInsets.fromLTRB(10, 4, 10, 8),
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
                child: const Row(
                  children: [
                    Icon(Icons.visibility_outlined, size: 18, color: Brand.muted),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text('You can read chats. Ask an admin to let you reply.', style: TextStyle(fontSize: 13, height: 1.35, color: Brand.textSoft)),
                    ),
                  ],
                ),
              ),
            ),
          if (canWrite && !open)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(10, 4, 10, _igClosedGap),
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              decoration: BoxDecoration(color: const Color(0xFFFFF6D6), borderRadius: BorderRadius.circular(10)),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.lock_clock_outlined, size: 18, color: Color(0xFF7A5D00)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _ig
                          ? 'Instagram lets you reply only within ${_igHours(app) > 24 ? '7 days' : '24 hours'} of the customer\'s last message. You can answer again as soon as they write to you.'
                          : 'More than 24 hours since this customer wrote. WhatsApp only delivers an approved template now.',
                      style: const TextStyle(fontSize: 13, height: 1.35, color: Color(0xFF5C4600)),
                    ),
                  ),
                ],
              ),
            ),
          if (canWrite && _replyTo != null)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 8, 4, 0),
              child: Row(
                children: [
                  Container(width: 3, height: 34, color: Brand.blue),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _replyTo!['sender_type'] == 'contact' ? 'Replying to $name' : 'Replying to you',
                          style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.blue, fontSize: 12.5),
                        ),
                        Text(
                          _quoteText(_replyTo!),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, color: Brand.textSoft),
                        ),
                      ],
                    ),
                  ),
                  IconButton(onPressed: () => setState(() => _replyTo = null), icon: const Icon(Icons.close, size: 20)),
                ],
              ),
            ),
          // WhatsApp's message box: a rounded field with the extras inside it, and a round send button
          if (canWrite)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(6, 4, 6, 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (open || !_ig) Expanded(
                      child: open
                          ? Container(
                              constraints: const BoxConstraints(minHeight: 48),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(24),
                                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))],
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  IconButton(
                                    tooltip: 'Suggest replies with AI',
                                    onPressed: _loadingSuggestions ? null : _suggest,
                                    icon: _loadingSuggestions
                                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                        : const Icon(Icons.auto_awesome, color: Brand.muted),
                                  ),
                                  Expanded(
                                    child: TextField(
                                      controller: _text,
                                      minLines: 1,
                                      maxLines: 6,
                                      textCapitalization: TextCapitalization.sentences,
                                      style: const TextStyle(fontSize: 16),
                                      decoration: const InputDecoration(
                                        hintText: 'Message',
                                        border: InputBorder.none,
                                        enabledBorder: InputBorder.none,
                                        focusedBorder: InputBorder.none,
                                        filled: false,
                                        isDense: true,
                                        contentPadding: EdgeInsets.symmetric(vertical: 14),
                                      ),
                                    ),
                                  ),
                                  // Only the buttons follow the typing (the whole chat is not drawn again at each key)
                                  ValueListenableBuilder<TextEditingValue>(
                                    valueListenable: _text,
                                    builder: (context, value, _) => value.text.trim().isEmpty
                                        ? const SizedBox.shrink()
                                        : IconButton(
                                            tooltip: 'Rephrase with AI',
                                            onPressed: _rephrasing ? null : () => _rephrase(app),
                                            icon: _rephrasing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.edit_note, color: Brand.muted),
                                          ),
                                  ),
                                  PopupMenuButton<String>(
                                    tooltip: 'Attach',
                                    icon: _uploading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.attach_file, color: Brand.muted),
                                    onSelected: (choice) async {
                                      if (choice == 'file') return _attach(app);
                                      if (choice == 'template') {
                                        final picked = await pickTemplate(context, firstName: name.split(' ').first);
                                        if (picked != null && mounted) _send(app, template: picked);
                                      }
                                    },
                                    itemBuilder: (context) => [
                                      PopupMenuItem(value: 'file', child: ListTile(leading: const Icon(Icons.photo_outlined), title: Text(_ig ? 'Photo, video or PDF' : 'Photo or document'), contentPadding: EdgeInsets.zero)),
                                      if (!_ig) const PopupMenuItem(value: 'template', child: ListTile(leading: Icon(Icons.description_outlined), title: Text('Template'), contentPadding: EdgeInsets.zero)),
                                    ],
                                  ),
                                ],
                              ),
                            )
                          : FilledButton.icon(
                              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: const StadiumBorder()),
                              onPressed: () async {
                                final picked = await pickTemplate(context, firstName: name.split(' ').first);
                                if (picked != null && mounted) _send(app, template: picked);
                              },
                              icon: const Icon(Icons.description_outlined),
                              label: const Text('Send a template'),
                            ),
                    ),
                    if (open)
                      Padding(
                        padding: const EdgeInsets.only(left: 6),
                        child: SizedBox(
                          width: 48,
                          height: 48,
                          child: ValueListenableBuilder<TextEditingValue>(
                            valueListenable: _text,
                            builder: (context, value, _) => IconButton.filled(
                              tooltip: 'Send',
                              style: IconButton.styleFrom(backgroundColor: Brand.blue, disabledBackgroundColor: Brand.faint),
                              onPressed: value.text.trim().isNotEmpty ? () => _send(app, text: _text.text.trim()) : null,
                              icon: const Icon(Icons.send, color: Colors.white, size: 22),
                            ),
                          ),
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
}

const double _igClosedGap = 6;

/// A quoted message in one line: its words, or what kind of file it is.
String _quoteText(Map<String, dynamic> m) {
  final words = messageText(m['body']).trim();
  if (words.isNotEmpty && words != '[Media Attachment]') return words.replaceAll(RegExp(r'\s+'), ' ');
  final media = '${m['media_url'] ?? ''}';
  return media.isEmpty ? 'Message' : '📎 ${ChatMedia(media).label}';
}

class _SuggestionsPanel extends StatelessWidget {
  const _SuggestionsPanel({required this.loading, required this.error, required this.suggestions, required this.onClose, required this.onRetry, required this.onPick});
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> suggestions;
  final VoidCallback onClose, onRetry;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    return Container(
      // A share of the room above the keyboard (not of the whole screen), so the message box always fits
      constraints: BoxConstraints(maxHeight: (MediaQuery.sizeOf(context).height - MediaQuery.viewInsetsOf(context).bottom) * 0.35),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Brand.line)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 4, 0),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome, size: 18, color: Brand.blue),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('AI suggested replies', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
                IconButton(onPressed: onClose, icon: const Icon(Icons.close, size: 20)),
              ],
            ),
          ),
          Flexible(
            child: loading
                ? const Padding(
                    padding: EdgeInsets.all(20),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : error != null
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            error!,
                            style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                          ),
                        ),
                        TextButton(onPressed: onRetry, child: const Text('Try again')),
                      ],
                    ),
                  )
                : ListView(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                    children: [
                      if (suggestions.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(8),
                          child: Text('No suggestions for this chat. Add answers to the knowledge base to get better ones.', style: TextStyle(color: Brand.muted)),
                        ),
                      for (final s in suggestions)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: InkWell(
                            onTap: () => onPick('${s['text']}'),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Brand.page,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Brand.line),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${s['text']}', style: const TextStyle(fontSize: 14.5, height: 1.35)),
                                  if (s['article_title'] != null) ...[
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        const Icon(Icons.menu_book_outlined, size: 14, color: Brand.muted),
                                        const SizedBox(width: 4),
                                        Expanded(
                                          child: Text(
                                            'From the knowledge base: ${s['article_title']}',
                                            style: const TextStyle(fontSize: 12, color: Brand.muted),
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      children: [
        Icon(icon, size: 18, color: Brand.muted),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, this.tail = true, this.quoted, this.contactName = 'Customer'});
  final Map<String, dynamic> message;
  /// The first bubble of a run from the same side: it gets the little corner, and space above it
  final bool tail;

  /// The message this one replies to (when it is in the chat on screen), shown above the words.
  final Map<String, dynamic>? quoted;
  final String contactName;
  @override
  Widget build(BuildContext context) {
    final mine = message['sender_type'] != 'contact';
    final waiting = message['_waiting'] == true;
    // Not sent: refused before it left the phone, or WhatsApp / Instagram did not deliver it (tap for why)
    final failed = message['_failed'] == true || (mine && !waiting && message['status'] == 'failed');
    final media = '${message['media_url'] ?? ''}';
    final bot = message['sender_type'] == 'bot' || message['is_ai'] == true;
    final body = messageText(message['body']).trim();
    final text = body == '[Media Attachment]' && media.isNotEmpty ? '' : body;
    final quote = quoted;
    final maxWidth = MediaQuery.of(context).size.width * 0.8;
    // Time and ticks sit at the end of the last line when there is room (WhatsApp), else under the text
    final meta = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          failed
              ? (waiting ? 'Not sent' : 'Not sent · Why?')
              : waiting
              ? 'Waiting for internet'
              : formatTime(message['created_at']),
          style: TextStyle(fontSize: 11, color: failed ? Brand.red : Brand.muted),
        ),
        if (mine) ...[
          const SizedBox(width: 3),
          MessageTicks(failed ? 'failed' : waiting ? 'pending' : '${message['status'] ?? 'sent'}'),
        ],
      ],
    );
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: maxWidth),
        margin: EdgeInsets.only(top: tail ? 6 : 1.5, bottom: 1.5, left: mine ? 48 : 0, right: mine ? 0 : 48),
        padding: EdgeInsets.fromLTRB(media.isNotEmpty ? 4 : 9, media.isNotEmpty ? 4 : 6, media.isNotEmpty ? 4 : 8, 4),
        decoration: BoxDecoration(
          color: failed
              ? Brand.redSoft
              : mine
              ? Brand.bubble
              : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(!mine && tail ? 2 : 9),
            topRight: Radius.circular(mine && tail ? 2 : 9),
            bottomLeft: const Radius.circular(9),
            bottomRight: const Radius.circular(9),
          ),
          boxShadow: const [BoxShadow(color: Color(0x1A0B141A), blurRadius: 0.5, offset: Offset(0, 1))],
        ),
        child: IntrinsicWidth(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (bot)
                Padding(
                  padding: EdgeInsets.fromLTRB(media.isNotEmpty ? 5 : 0, 0, 0, 2),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.smart_toy_outlined, size: 13, color: Brand.blue),
                      SizedBox(width: 4),
                      Text('AI reply', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.blue)),
                    ],
                  ),
                ),
              if (quote != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.fromLTRB(8, 5, 8, 5),
                  decoration: BoxDecoration(
                    color: const Color(0x0D000000),
                    borderRadius: BorderRadius.circular(6),
                    border: const Border(left: BorderSide(color: Brand.blue, width: 3)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        quote['sender_type'] == 'contact' ? contactName : 'You',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.blue),
                      ),
                      Text(_quoteText(quote), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Brand.textSoft)),
                    ],
                  ),
                ),
              if (media.isNotEmpty)
                Builder(
                  builder: (context) {
                    final file = ChatMedia(media);
                    final at = DateTime.tryParse('${message['created_at'] ?? ''}')?.toLocal();
                    final chip = _FileChip(name: file.label, icon: file.icon);
                    return InkWell(
                      borderRadius: BorderRadius.circular(7),
                      onTap: waiting ? null : () => showMedia(context, file, at),
                      child: file.isImage && !waiting
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(7),
                              child: SizedBox(
                                width: (maxWidth - 8).clamp(120.0, 260.0),
                                height: 220,
                                // Kept in memory at the size it is drawn, not the camera's full size
                                child: file.image(height: 220, onError: chip, cacheWidth: (260 * MediaQuery.devicePixelRatioOf(context)).round()),
                              ),
                            )
                          : chip,
                    );
                  },
                ),
              if (text.isNotEmpty)
                Padding(
                  padding: EdgeInsets.fromLTRB(media.isNotEmpty ? 5 : 0, media.isNotEmpty ? 5 : 0, media.isNotEmpty ? 4 : 0, 0),
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.end,
                    spacing: 10,
                    children: [
                      WaText(text),
                      Padding(padding: const EdgeInsets.only(top: 4), child: meta),
                    ],
                  ),
                )
              else
                Padding(
                  padding: EdgeInsets.fromLTRB(4, 3, media.isNotEmpty ? 4 : 0, 0),
                  child: Align(alignment: Alignment.centerRight, child: meta),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FileChip extends StatelessWidget {
  const _FileChip({required this.name, this.icon = Icons.insert_drive_file_outlined});
  final String name;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.7),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: Brand.line),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 22, color: Brand.navy),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            name,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(width: 10),
        const Icon(Icons.download_for_offline_outlined, size: 22, color: Brand.blue),
      ],
    ),
  );
}
