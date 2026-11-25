import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/backend.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/whatsapp_lock.dart';
import '../../ui/widgets.dart';
import 'chat_parts.dart';
import 'chat_screen.dart';
import 'tickets_screen.dart';

/// WhatsApp chats only, newest first. Instagram chats live in their own section (never mixed in here).
class ChatsScreen extends StatelessWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (!app.whatsappOn) {
      return Scaffold(backgroundColor: Brand.page, appBar: AppBar(title: const Text('Chats')), body: const WhatsAppLocked(feature: 'Chats'));
    }
    final openTickets = ((app.cached('tickets') ?? const {})['tickets'] as List? ?? const []).where((t) => t['status'] == 'open').length;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(app.instagramOn ? 'WhatsApp' : 'Chats')),
      body: ChatList(
        channel: 'whatsapp',
        extraChip: ActionChip(
          avatar: const Icon(Icons.confirmation_number_outlined, size: 17),
          label: Text(openTickets > 0 ? 'Tickets $openTickets' : 'Tickets'),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TicketsScreen())),
        ),
      ),
    );
  }
}

/// What a chat list can be narrowed to.
enum ChatFilter { all, unread, waiting, mine, aiOff }

/// The customer wrote last: the chat waits for an answer.
bool chatWaiting(Map c) => (c['last_message'] as Map?)?['sender_type'] == 'contact';

/// One channel's chats: search, filters with counts, and the list. Used by WhatsApp and by Instagram.
class ChatList extends StatefulWidget {
  const ChatList({super.key, required this.channel, this.extraChip, this.onRefresh, this.banner});
  final String channel;
  final Widget? extraChip;

  /// Extra work on pull to refresh (Instagram asks Instagram for new messages first).
  final Future<void> Function()? onRefresh;

  /// A note above the list (Instagram: messages not shared, or slowed down).
  final Widget? banner;
  @override
  State<ChatList> createState() => _ChatListState();
}

class _ChatListState extends State<ChatList> {
  String _query = '';
  ChatFilter _filter = ChatFilter.all;

  /// The phone keeps the newest 50 chats. Older ones come with Load more, and a search also asks the server.
  List<Map<String, dynamic>> _more = const [];
  int _page = 1;
  bool? _moreLeft;
  bool _loadingMore = false;
  List<Map<String, dynamic>> _found = const [];
  bool _searching = false;
  Timer? _wait;

  @override
  void dispose() {
    _wait?.cancel();
    super.dispose();
  }

  String get _key => AppState.chatLists[widget.channel]!;

  /// The server has chats the phone does not.
  bool _serverHasMore(AppState app) => _moreLeft ?? (app.cached(_key)?['hasMore'] == true);

  /// Chats from the server for the screen only: a customer's file in the last message is cut to its type (it can be MB).
  static List<Map<String, dynamic>> _chatsFrom(Map<String, dynamic> data) {
    final out = <Map<String, dynamic>>[];
    for (final c in (data['conversations'] as List? ?? const [])) {
      if (c is! Map) continue;
      final chat = Map<String, dynamic>.from(c);
      final last = chat['last_message'];
      final media = last is Map ? last['media_url'] : null;
      if (media is String && media.startsWith('data:')) {
        final comma = media.indexOf(',');
        chat['last_message'] = {...last as Map, 'media_url': comma < 0 ? 'data:' : media.substring(0, comma + 1)};
      }
      out.add(chat);
    }
    return out;
  }

  Future<void> _loadMore(AppState app) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final data = await app.backend.get('/api/conversations', {'organizationId': app.orgId, 'limit': '50', 'channel': widget.channel, 'page': '$next'});
      if (!mounted) return;
      final got = _chatsFrom(data);
      setState(() {
        _more = [..._more, ...got];
        _page = next;
        _moreLeft = data['hasMore'] == true && got.isNotEmpty;
      });
    } catch (e) {
      if (mounted) toast(context, e is ApiException || e is OfflineException ? '$e' : 'More chats could not be loaded. Please try again.');
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _search(AppState app, String value) {
    final q = value.trim();
    setState(() {
      _query = q;
      _found = const [];
    });
    _wait?.cancel();
    // Everything is on the phone already: the search there is enough
    if (q.length < 2 || !_serverHasMore(app)) return;
    _wait = Timer(const Duration(milliseconds: 400), () => _searchServer(app, q));
  }

  Widget _moreButton(AppState app) => _loadingMore
      ? const Padding(padding: EdgeInsets.all(10), child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))
      : OutlinedButton(onPressed: () => _loadMore(app), child: const Text('Load more chats'));

  Future<void> _searchServer(AppState app, String q) async {
    if (!app.online || !mounted) return;
    setState(() => _searching = true);
    try {
      final data = await app.backend.get('/api/conversations', {'organizationId': app.orgId, 'limit': '50', 'channel': widget.channel, 'search': q});
      if (mounted && q == _query) setState(() => _found = _chatsFrom(data));
    } catch (_) {
      // The chats on the phone are still searched
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  bool _matches(ChatFilter f, Map<String, dynamic> c, String me) => switch (f) {
        ChatFilter.all => true,
        ChatFilter.unread => ((c['unread_count'] as num?) ?? 0) > 0,
        ChatFilter.waiting => chatWaiting(c),
        ChatFilter.mine => me.isNotEmpty && c['assigned_to'] == me,
        ChatFilter.aiOff => c['auto_reply_enabled'] == false,
      };

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final ig = widget.channel == 'instagram';
    final key = _key;
    final saved = app.chatsOf(widget.channel);
    final savedIds = {for (final c in saved) c['id']};
    // The newest chats kept on the phone, then older ones brought with Load more
    final all = [...saved, ..._more.where((c) => !savedIds.contains(c['id']) && AppState.isInstagramChat(c) == ig)];
    final me = '${app.me?['user']?['id'] ?? ''}';
    final q = _query.toLowerCase();
    final digits = q.replaceAll(RegExp(r'\D'), '');
    final shown = all.where((c) {
      if (!_matches(_filter, c, me)) return false;
      if (q.isEmpty) return true;
      final contact = c['contact'] as Map?;
      return contactName(contact).toLowerCase().contains(q) ||
          (digits.isNotEmpty && '${contact?['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '').contains(digits)) ||
          messageText((c['last_message'] as Map?)?['body']).toLowerCase().contains(q);
    }).toList();
    // Chats the server found for the search that the phone does not have
    if (q.isNotEmpty) {
      final shownIds = {for (final c in shown) c['id']};
      shown.addAll(_found.where((c) => !shownIds.contains(c['id']) && AppState.isInstagramChat(c) == ig && _matches(_filter, c, me)));
    }
    final canLoadMore = q.isEmpty && _serverHasMore(app);
    // Nothing on the phone yet and the first fetch did not work
    final notLoaded = all.isEmpty && app.savedAt(key) == null && !app.isLoading(key);
    int count(ChatFilter f) => all.where((c) => _matches(f, c, me)).length;
    String label(String name, ChatFilter f) {
      final n = count(f);
      return n > 0 ? '$name $n' : name;
    }

    final chips = <(ChatFilter, String)>[
      (ChatFilter.all, 'All'),
      (ChatFilter.unread, label('Unread', ChatFilter.unread)),
      (ChatFilter.waiting, label('Waiting for reply', ChatFilter.waiting)),
      if (me.isNotEmpty && all.any((c) => c['assigned_to'] == me)) (ChatFilter.mine, label('Mine', ChatFilter.mine)),
      if (all.any((c) => c['auto_reply_enabled'] == false)) (ChatFilter.aiOff, label('AI off', ChatFilter.aiOff)),
    ];
    return Column(
      children: [
        SyncBanner(cacheKey: key),
        ?widget.banner,
        SearchField(hint: ig ? 'Search name, username or message' : 'Search name, number or message', onChanged: (v) => _search(app, v)),
        if (_searching) const LinearProgressIndicator(minHeight: 2),
        FilterChips(
          children: [
            for (final (f, text) in chips) ChoiceChip(label: Text(text), selected: _filter == f, onSelected: (_) => setState(() => _filter = f)),
            ?widget.extraChip,
          ],
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              await widget.onRefresh?.call();
              await app.syncNow();
            },
            child: app.isLoading(key)
                ? const SkeletonList()
                : notLoaded
                ? ListView(
                    children: [
                      EmptyState(
                        icon: Icons.cloud_off,
                        title: app.online ? 'Could not load your chats' : 'Connect to the internet to see your chats',
                        text: app.online ? 'Check the internet and try again.' : 'Your chats are not saved on the phone yet.',
                        action: FilledButton(
                          onPressed: () async {
                            if (widget.onRefresh != null) return widget.onRefresh!();
                            await app.loadChats(widget.channel);
                          },
                          child: const Text('Try again'),
                        ),
                      ),
                    ],
                  )
                : shown.isEmpty
                ? ListView(
                    children: [
                      EmptyState(
                        icon: ig ? Icons.camera_alt_outlined : Icons.chat_bubble_outline,
                        title: all.isEmpty ? 'No chats yet' : 'Nothing here',
                        text: all.isEmpty
                            ? (ig ? 'Instagram messages to your business show up here.' : 'Customer messages on WhatsApp show up here.')
                            : 'No chat matches this filter or search.',
                      ),
                      if (canLoadMore) Center(child: _moreButton(app)),
                    ],
                  )
                : ListView.separated(
                    itemCount: shown.length + (canLoadMore ? 1 : 0),
                    separatorBuilder: (_, _) => const Divider(indent: 78, height: 1),
                    itemBuilder: (context, index) => index == shown.length
                        ? Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), child: Center(child: _moreButton(app)))
                        : ChatRow(conversation: shown[index], instagram: ig),
                  ),
          ),
        ),
      ],
    );
  }
}

/// One chat in a list, like WhatsApp: picture, name and time on top; ticks, last message and unread count below.
class ChatRow extends StatelessWidget {
  const ChatRow({super.key, required this.conversation, this.instagram = false});
  final Map<String, dynamic> conversation;
  final bool instagram;
  @override
  Widget build(BuildContext context) {
    final c = conversation;
    final contact = c['contact'] as Map?;
    final raw = contactName(contact);
    final name = instagram ? raw : (RegExp(r'^\+?\d[\d\s-]{7,}$').hasMatch(raw) ? showPhone(raw) : raw);
    final unread = (c['unread_count'] as num?)?.toInt() ?? 0;
    final last = c['last_message'] as Map? ?? const {};
    final mine = last['sender_type'] != null && last['sender_type'] != 'contact';
    final body = messageText(last['body']).trim();
    final media = '${last['media_url'] ?? ''}'.isNotEmpty || body == '[Media Attachment]';
    final preview = body.isEmpty || body == '[Media Attachment]'
        ? (media ? '📎 Photo or file' : '')
        : body.replaceAll(RegExp(r'\s+'), ' ');
    final aiOff = c['auto_reply_enabled'] == false;
    final timeColor = unread > 0 ? Brand.green : Brand.faint;
    return Material(
      color: Colors.white,
      child: InkWell(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(conversation: c))),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 11, 16, 11),
          child: Row(
            children: [
              Avatar(name, size: 48),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Expanded(
                          child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Brand.text)),
                        ),
                        const SizedBox(width: 8),
                        Text(formatWhen('${c['last_message_at'] ?? last['created_at'] ?? ''}'), style: TextStyle(fontSize: 12, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w400, color: timeColor)),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        if (mine)
                          const Padding(padding: EdgeInsets.only(right: 3), child: Icon(Icons.done_all, size: 16, color: Brand.faint)),
                        Expanded(
                          child: Text(
                            preview.isEmpty ? (instagram ? 'Instagram chat' : 'WhatsApp chat') : preview,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 14, color: unread > 0 ? Brand.text : Brand.muted, fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.w400),
                          ),
                        ),
                        if (aiOff)
                          const Padding(
                            padding: EdgeInsets.only(left: 6),
                            child: Tooltip(message: 'AI replies are off in this chat', child: Icon(Icons.person_outline, size: 17, color: Brand.faint)),
                          ),
                        if (unread > 0)
                          Container(
                            margin: const EdgeInsets.only(left: 8),
                            constraints: const BoxConstraints(minWidth: 21),
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: Brand.green, borderRadius: BorderRadius.circular(99)),
                            child: Text('$unread', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
