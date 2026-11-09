import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'knowledge_screen.dart';

/// Try the AI chatbot: ask what a customer would ask and see its reply, with the knowledge base
/// answers it used. Nothing goes to customers from here. Needs the internet.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key, this.demoQuestion});

  /// Demo screenshots: ask this straight away.
  final String? demoQuestion;
  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _text = TextEditingController();
  final List<Map<String, dynamic>> _chat = [];
  String _session = 'new';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (widget.demoQuestion != null) WidgetsBinding.instance.addPostFrameCallback((_) => _ask(widget.demoQuestion!));
  }

  Future<void> _ask(String question) async {
    final app = AppScope.read(context);
    final text = question.trim();
    if (text.isEmpty || _busy) return;
    setState(() {
      _chat.add({'role': 'user', 'content': text});
      _busy = true;
    });
    _text.clear();
    try {
      final data = await app.ask('/api/ai/playground-chat', {
        'action': 'send_message',
        'sessionId': _session,
        'message': text,
        'chatHistory': [
          for (final m in _chat) {'role': m['role'], 'content': m['content']},
        ],
      });
      _session = '${data['sessionId'] ?? _session}';
      setState(
        () => _chat.add({
          'role': 'assistant',
          'content': '${data['reply'] ?? ''}',
          'faqs': [for (final f in (data['matchedFaqs'] as List? ?? const [])) '${f['title'] ?? ''}'].where((t) => t.isNotEmpty).toList(),
          'handover': data['isRiseTicket'] == true,
        }),
      );
    } catch (e) {
      setState(() => _chat.add({'role': 'error', 'content': '$e'.replaceFirst('Exception: ', '')}));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final answers = articlesOf(app).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Try the AI chatbot'),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const KnowledgeScreen())),
            icon: const Icon(Icons.menu_book_outlined, size: 18),
            label: Text('$answers answers'),
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
                if (_chat.isEmpty) ...[
                  const EmptyState(
                    icon: Icons.smart_toy_outlined,
                    title: 'Ask like a customer',
                    text: 'See how the chatbot replies on WhatsApp, using your knowledge base. Nothing is sent to customers from here.',
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      for (final q in ['What are your timings?', 'Is there parking?', 'How much is a facial?', 'Can I cancel my booking?']) ActionChip(label: Text(q), onPressed: () => _ask(q)),
                    ],
                  ),
                ],
                for (final m in _chat) _Message(message: m),
                if (_busy)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Row(
                      children: [
                        SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                        SizedBox(width: 10),
                        Text('Thinking…', style: TextStyle(color: Brand.muted)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      textCapitalization: TextCapitalization.sentences,
                      onSubmitted: _ask,
                      decoration: const InputDecoration(hintText: 'Ask what a customer would ask', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    style: IconButton.styleFrom(backgroundColor: Brand.blue),
                    onPressed: _busy ? null : () => _ask(_text.text),
                    icon: const Icon(Icons.send, color: Colors.white),
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

class _Message extends StatelessWidget {
  const _Message({required this.message});
  final Map<String, dynamic> message;
  @override
  Widget build(BuildContext context) {
    final role = message['role'];
    if (role == 'error') {
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
        child: Text(
          '${message['content']}',
          style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
        ),
      );
    }
    final mine = role == 'user';
    final faqs = (message['faqs'] as List? ?? const []);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: mine ? Brand.navy : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: mine ? null : Border.all(color: Brand.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!mine)
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.smart_toy_outlined, size: 15, color: Brand.blue),
                    SizedBox(width: 4),
                    Text(
                      'AI chatbot',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.blue),
                    ),
                  ],
                ),
              ),
            Text('${message['content']}', style: TextStyle(color: mine ? Colors.white : Brand.text, fontSize: 15, height: 1.35)),
            if (faqs.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 4, children: [for (final f in faqs) Pill('$f', icon: Icons.menu_book_outlined)]),
            ],
            if (message['handover'] == true) ...[
              const SizedBox(height: 8),
              const Text('Not in the knowledge base: on WhatsApp this goes to your team as a ticket.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            ],
          ],
        ),
      ),
    );
  }
}
