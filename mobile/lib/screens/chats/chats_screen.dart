import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'chat_screen.dart';
import 'tickets_screen.dart';

/// WhatsApp chats only, newest first. Instagram chats live in their own section (never mixed in here).
class ChatsScreen extends StatelessWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
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
    final key = AppState.chatLists[widget.channel]!;
    final all = app.chatsOf(widget.channel);
    final me = '${app.me?['user']?['id'] ?? ''}';
    final q = _query.toLowerCase();
    final digits = q.replaceAll(RegExp(r'\D'), '');
    final shown = all.where((c) {
      if (!_matches(_filter, c, me)) return false;
      if (q.isEmpty) return true;
      final contact = c['contact'] as Map?;
      return contactName(contact).toLowerCase().contains(q) ||
          (digits.isNotEmpty && '${contact?['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '').contains(digits)) ||
          '${(c['last_message'] as Map?)?['body'] ?? ''}'.toLowerCase().contains(q);
    }).toList();
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
        SearchField(hint: ig ? 'Search name, username or message' : 'Search name, number or message', onChanged: (v) => setState(() => _query = v.trim())),
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
                    ],
                  )
                : ListView.separated(
                    itemCount: shown.length,
                    separatorBuilder: (_, _) => const Divider(indent: 78, height: 1),
                    itemBuilder: (context, index) => ChatRow(conversation: shown[index], instagram: ig),
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
    final body = '${last['body'] ?? ''}'.trim();
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
