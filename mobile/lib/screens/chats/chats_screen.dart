import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'chat_screen.dart';

/// WhatsApp chats, newest first, with unread counts. Read from the phone when offline.
class ChatsScreen extends StatefulWidget {
  const ChatsScreen({super.key});
  @override
  State<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends State<ChatsScreen> {
  String _query = '';
  bool _unreadOnly = false;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final all = [for (final c in ((app.cached('conversations') ?? const {})['conversations'] as List? ?? const [])) Map<String, dynamic>.from(c)];
    final q = _query.toLowerCase();
    final shown = all.where((c) {
      if (_unreadOnly && ((c['unread_count'] as num?) ?? 0) == 0) return false;
      if (q.isEmpty) return true;
      return contactName(c['contact']).toLowerCase().contains(q) || '${c['contact']?['phone_number'] ?? ''}'.contains(q);
    }).toList();
    final unread = all.where((c) => ((c['unread_count'] as num?) ?? 0) > 0).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Chats')),
      body: Column(
        children: [
          const SyncBanner(cacheKey: 'conversations'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name or number'),
              onChanged: (v) => setState(() => _query = v.trim()),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: Row(
              children: [
                ChoiceChip(label: const Text('All'), selected: !_unreadOnly, onSelected: (_) => setState(() => _unreadOnly = false)),
                const SizedBox(width: 8),
                ChoiceChip(label: Text('Unread · $unread'), selected: _unreadOnly, onSelected: (_) => setState(() => _unreadOnly = true)),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: app.syncNow,
              child: shown.isEmpty
                  ? ListView(
                      children: const [EmptyState(icon: Icons.chat_bubble_outline, title: 'No chats', text: 'Customer messages on WhatsApp show up here.')],
                    )
                  : ListView.separated(
                      itemCount: shown.length,
                      separatorBuilder: (_, _) => const Divider(indent: 76),
                      itemBuilder: (context, index) => _ChatRow(conversation: shown[index]),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.conversation});
  final Map<String, dynamic> conversation;
  @override
  Widget build(BuildContext context) {
    final c = conversation;
    final name = contactName(c['contact']);
    final unread = (c['unread_count'] as num?)?.toInt() ?? 0;
    final last = c['last_message'] as Map? ?? const {};
    final mine = last['sender_type'] == 'user';
    return InkWell(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(conversation: c))),
      child: Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          children: [
            Avatar(name, size: 46),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          style: TextStyle(fontSize: 15.5, fontWeight: unread > 0 ? FontWeight.w800 : FontWeight.w700),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        formatWhen(c['last_message_at']),
                        style: TextStyle(fontSize: 12, fontWeight: unread > 0 ? FontWeight.w800 : FontWeight.w500, color: unread > 0 ? Brand.blue : Brand.faint),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      if (mine)
                        const Padding(
                          padding: EdgeInsets.only(right: 4),
                          child: Icon(Icons.done_all, size: 15, color: Brand.faint),
                        ),
                      Expanded(
                        child: Text(
                          '${last['body'] ?? ''}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13.5, color: unread > 0 ? Brand.text : Brand.muted),
                        ),
                      ),
                      if (unread > 0)
                        Container(
                          margin: const EdgeInsets.only(left: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(99)),
                          child: Text(
                            '$unread',
                            style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w800),
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
    );
  }
}
