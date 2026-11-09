import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../templates/template_widgets.dart';

/// One WhatsApp chat. Messages typed offline wait on the phone and go when the internet is back.
/// After 24 hours without a message from the customer, WhatsApp only delivers templates, so the
/// box offers a template instead.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.conversation});
  final Map<String, dynamic> conversation;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  String get _id => '${widget.conversation['id']}';
  String get _key => 'messages:$_id';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => AppScope.read(context).load(_key, '/api/messages', query: {'conversationId': _id, 'limit': '60'}, force: true));
  }

  List<Map<String, dynamic>> _messages(AppState app) {
    final server = [for (final m in ((app.cached(_key) ?? const {})['messages'] as List? ?? const [])) Map<String, dynamic>.from(m)];
    final waiting = [
      for (final item in app.pending('message'))
        if (item.body['conversationId'] == _id) {'id': item.id, 'body': item.body['message'], 'sender_type': 'user', 'created_at': item.createdAt.toUtc().toIso8601String(), '_waiting': true, '_failed': item.state.name == 'failed'},
    ];
    return [...server, ...waiting];
  }

  /// When the customer last wrote: from the chat on the phone, or the list's last message.
  bool _windowOpen(List<Map<String, dynamic>> messages) {
    DateTime? last;
    for (final m in messages.reversed) {
      if (m['sender_type'] == 'contact') {
        last = DateTime.tryParse('${m['created_at']}');
        break;
      }
    }
    final lastMessage = widget.conversation['last_message'] as Map?;
    if (last == null && lastMessage?['sender_type'] == 'contact') last = DateTime.tryParse('${lastMessage?['created_at']}');
    return last != null && DateTime.now().difference(last).inHours < 24;
  }

  void _send(AppState app, {String? text, Map<String, dynamic>? template}) {
    final phone = widget.conversation['contact']?['phone_number'];
    final body = text ?? template!['preview'];
    app.enqueue(
      kind: 'message',
      label: 'Message to ${contactName(widget.conversation['contact'])}: ${body.toString().split('\n').first}',
      path: '/api/messages/send',
      body: {
        'conversationId': _id,
        'organizationId': app.orgId,
        'phoneNumber': phone,
        'message': body,
        'channel': 'whatsapp',
        if (template != null) ...{'templateName': template['name'], 'templateLanguage': template['language'], 'templateVariables': template['variables'], 'templateMetaComponents': template['components']},
      },
    );
    _text.clear();
    if (!app.online) toast(context, 'Saved. It will be sent when you are online.');
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final messages = _messages(app);
    final open = _windowOpen(messages);
    final name = contactName(widget.conversation['contact']);
    return Scaffold(
      backgroundColor: const Color(0xFFEFEAE2),
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(children: [
          Avatar(name, size: 36),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16.5)),
              Text('${widget.conversation['contact']?['phone_number'] ?? ''}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Brand.muted)),
            ]),
          ),
        ]),
      ),
      body: Column(children: [
        SyncBanner(cacheKey: _key),
        Expanded(
          child: ListView.builder(
            reverse: true,
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            itemCount: messages.length,
            itemBuilder: (context, index) => _Bubble(message: messages[messages.length - 1 - index]),
          ),
        ),
        if (!open)
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: const Text('This customer has not messaged in 24 hours. WhatsApp only delivers an approved template now.', style: TextStyle(fontSize: 13, color: Brand.textSoft)),
          ),
        SafeArea(
          top: false,
          child: Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Row(children: [
              IconButton(
                tooltip: 'Send a template',
                onPressed: () async {
                  final picked = await pickTemplate(context, firstName: name.split(' ').first);
                  if (picked != null && context.mounted) _send(app, template: picked);
                },
                icon: const Icon(Icons.description_outlined, color: Brand.blue),
              ),
              Expanded(
                child: open
                    ? TextField(
                        controller: _text,
                        minLines: 1,
                        maxLines: 5,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(hintText: 'Message', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                      )
                    : FilledButton.icon(
                        onPressed: () async {
                          final picked = await pickTemplate(context, firstName: name.split(' ').first);
                          if (picked != null && context.mounted) _send(app, template: picked);
                        },
                        icon: const Icon(Icons.description_outlined),
                        label: const Text('Send a template'),
                      ),
              ),
              if (open)
                IconButton.filled(
                  style: IconButton.styleFrom(backgroundColor: Brand.blue),
                  onPressed: () {
                    final text = _text.text.trim();
                    if (text.isNotEmpty) _send(app, text: text);
                  },
                  icon: const Icon(Icons.send, color: Colors.white),
                ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});
  final Map<String, dynamic> message;
  @override
  Widget build(BuildContext context) {
    final mine = message['sender_type'] != 'contact';
    final waiting = message['_waiting'] == true;
    final failed = message['_failed'] == true;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.fromLTRB(12, 8, 10, 6),
        decoration: BoxDecoration(
          color: failed ? Brand.redSoft : mine ? const Color(0xFFD9FDD3) : Colors.white,
          borderRadius: BorderRadius.only(topLeft: const Radius.circular(12), topRight: const Radius.circular(12), bottomLeft: Radius.circular(mine ? 12 : 2), bottomRight: Radius.circular(mine ? 2 : 12)),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Align(alignment: Alignment.centerLeft, child: Text('${message['body'] ?? ''}', style: const TextStyle(fontSize: 15, height: 1.3))),
          const SizedBox(height: 2),
          Row(mainAxisSize: MainAxisSize.min, children: [
            Text(failed ? 'Not sent' : waiting ? 'Waiting for internet' : formatTime(message['created_at']), style: TextStyle(fontSize: 11, color: failed ? Brand.red : Brand.muted)),
            if (mine) ...[
              const SizedBox(width: 4),
              Icon(failed ? Icons.error_outline : waiting ? Icons.schedule : Icons.done_all, size: 14, color: failed ? Brand.red : message['status'] == 'read' ? Brand.blue : Brand.faint),
            ],
          ]),
        ]),
      ),
    );
  }
}
