import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../ui/theme.dart';

/// WhatsApp-style pieces of a chat: day chips between days, bubbles grouped by sender, *bold* / _italic_ /
/// ~strike~ / ```mono``` text with tappable links, the real ticks (sent, delivered, read), and swipe to reply.

/// One row of the chat list: a day chip, or a message with whether it starts a run from the same sender.
class ChatEntry {
  ChatEntry.day(this.day) : message = null, firstOfRun = false;
  ChatEntry.message(this.message, {required this.firstOfRun}) : day = null;
  final String? day;
  final Map<String, dynamic>? message;
  final bool firstOfRun;
}

bool _mine(Map<String, dynamic> m) => m['sender_type'] != 'contact';

/// "Today", "Yesterday", "Monday" (this week), "12 Nov 2026".
String chatDayLabel(DateTime day, [DateTime? now]) {
  final today = DateUtils.dateOnly(now ?? DateTime.now());
  final d = DateUtils.dateOnly(day);
  final diff = today.difference(d).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DateFormat('EEEE').format(d);
  return DateFormat(d.year == today.year ? 'd MMMM' : 'd MMM yyyy').format(d);
}

/// The chat's messages (oldest first) as rows: a day chip before each new day; a message starts a run when the
/// sender changes, a day starts, or more than 5 minutes passed.
List<ChatEntry> chatEntries(List<Map<String, dynamic>> messages, {DateTime? now}) {
  final out = <ChatEntry>[];
  DateTime? lastDay;
  Map<String, dynamic>? previous;
  for (final m in messages) {
    final at = DateTime.tryParse('${m['created_at'] ?? ''}')?.toLocal();
    final day = at == null ? null : DateUtils.dateOnly(at);
    var newDay = false;
    if (day != null && (lastDay == null || day != lastDay)) {
      out.add(ChatEntry.day(chatDayLabel(day, now)));
      lastDay = day;
      newDay = true;
    }
    final prevAt = previous == null ? null : DateTime.tryParse('${previous['created_at'] ?? ''}')?.toLocal();
    final first = previous == null || newDay || _mine(previous) != _mine(m) || (at != null && prevAt != null && at.difference(prevAt).inMinutes > 5);
    out.add(ChatEntry.message(m, firstOfRun: first));
    previous = m;
  }
  return out;
}

class ChatDayChip extends StatelessWidget {
  const ChatDayChip(this.label, {super.key});
  final String label;
  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(8),
            boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))],
          ),
          child: Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.textSoft, fontWeight: FontWeight.w600)),
        ),
      );
}

/// The ticks under your own messages: one grey (sent), two grey (delivered), two blue (read).
class MessageTicks extends StatelessWidget {
  const MessageTicks(this.status, {super.key});
  final String status;
  static const readBlue = Color(0xFF53BDEB);
  @override
  Widget build(BuildContext context) {
    final s = status.toLowerCase();
    if (s == 'failed' || s == 'undelivered') return const Icon(Icons.error_outline, size: 15, color: Brand.red);
    if (s == 'read' || s == 'played') return const Icon(Icons.done_all, size: 16, color: readBlue);
    if (s == 'delivered') return const Icon(Icons.done_all, size: 16, color: Brand.faint);
    if (s == 'queued' || s == 'accepted' || s == 'pending' || s == 'sending') return const Icon(Icons.schedule, size: 14, color: Brand.faint);
    return const Icon(Icons.done, size: 16, color: Brand.faint);
  }
}

/// WhatsApp's own formatting: *bold*, _italic_, ~strike~, ```mono```, and links you can tap.
class WaText extends StatefulWidget {
  const WaText(this.text, {super.key, this.style});
  final String text;
  final TextStyle? style;
  @override
  State<WaText> createState() => _WaTextState();
}

class _WaTextState extends State<WaText> {
  final _taps = <TapGestureRecognizer>[];

  @override
  void dispose() {
    for (final t in _taps) {
      t.dispose();
    }
    super.dispose();
  }

  static final _pattern = RegExp(r'(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?://[^\s]+)');

  @override
  Widget build(BuildContext context) {
    for (final t in _taps) {
      t.dispose();
    }
    _taps.clear();
    final base = widget.style ?? const TextStyle(fontSize: 15, height: 1.3, color: Brand.text);
    final spans = <InlineSpan>[];
    var at = 0;
    for (final match in _pattern.allMatches(widget.text)) {
      if (match.start > at) spans.add(TextSpan(text: widget.text.substring(at, match.start)));
      final part = match.group(0)!;
      if (part.startsWith('```')) {
        spans.add(TextSpan(text: part.substring(3, part.length - 3), style: const TextStyle(fontFamily: 'monospace')));
      } else if (part.startsWith('*')) {
        spans.add(TextSpan(text: part.substring(1, part.length - 1), style: const TextStyle(fontWeight: FontWeight.w700)));
      } else if (part.startsWith('_')) {
        spans.add(TextSpan(text: part.substring(1, part.length - 1), style: const TextStyle(fontStyle: FontStyle.italic)));
      } else if (part.startsWith('~')) {
        spans.add(TextSpan(text: part.substring(1, part.length - 1), style: const TextStyle(decoration: TextDecoration.lineThrough)));
      } else {
        final url = part.replaceAll(RegExp(r'[.,)!?]+$'), '');
        final tap = TapGestureRecognizer()..onTap = () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        _taps.add(tap);
        spans.add(TextSpan(text: url, style: const TextStyle(color: Color(0xFF027EB5), decoration: TextDecoration.underline), recognizer: tap));
        if (url.length < part.length) spans.add(TextSpan(text: part.substring(url.length)));
      }
      at = match.end;
    }
    if (at < widget.text.length) spans.add(TextSpan(text: widget.text.substring(at)));
    return Text.rich(TextSpan(style: base, children: spans));
  }
}

/// Swipe a message to the right to reply to it, like WhatsApp (a reply arrow shows as you pull).
class SwipeToReply extends StatefulWidget {
  const SwipeToReply({super.key, required this.child, required this.onReply, this.enabled = true});
  final Widget child;
  final VoidCallback onReply;
  final bool enabled;
  @override
  State<SwipeToReply> createState() => _SwipeToReplyState();
}

class _SwipeToReplyState extends State<SwipeToReply> {
  double _dx = 0;
  bool _fired = false;
  static const _trigger = 56.0;

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragUpdate: (d) => setState(() {
        _dx = (_dx + d.delta.dx).clamp(0.0, 80.0);
        if (_dx >= _trigger && !_fired) {
          _fired = true;
          Feedback.forTap(context);
        }
      }),
      onHorizontalDragEnd: (_) {
        if (_fired) widget.onReply();
        setState(() {
          _dx = 0;
          _fired = false;
        });
      },
      onHorizontalDragCancel: () => setState(() {
        _dx = 0;
        _fired = false;
      }),
      child: Stack(
        alignment: Alignment.centerLeft,
        children: [
          if (_dx > 8)
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Opacity(
                opacity: (_dx / _trigger).clamp(0.0, 1.0),
                child: Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.9), shape: BoxShape.circle),
                  child: const Icon(Icons.reply, size: 18, color: Brand.textSoft),
                ),
              ),
            ),
          AnimatedContainer(duration: Duration(milliseconds: _dx == 0 ? 180 : 0), transform: Matrix4.translationValues(_dx, 0, 0), child: widget.child),
        ],
      ),
    );
  }
}
