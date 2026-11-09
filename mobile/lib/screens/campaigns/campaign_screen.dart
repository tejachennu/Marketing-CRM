import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../chats/chat_screen.dart';
import 'campaigns_screen.dart';

/// One campaign: how it did, what went out, who replied (to answer them), and each person's state.
/// Send now / cancel a scheduled one, stop one that is sending, or send again to those who missed it.
class CampaignScreen extends StatefulWidget {
  const CampaignScreen({super.key, required this.campaignId, this.name = 'Campaign'});
  final String campaignId;
  final String name;
  @override
  State<CampaignScreen> createState() => _CampaignScreenState();
}

const _dispatchWords = {'PENDING': 'Waiting', 'SENT': 'Sent', 'DELIVERED': 'Delivered', 'READ': 'Read', 'FAILED': 'Not sent', 'SKIPPED': 'Skipped'};

class _CampaignScreenState extends State<CampaignScreen> {
  bool _everyone = false;
  String _show = 'all'; // all, delivered, read, failed, replied
  String _search = '';
  int _limit = 50;
  bool _busy = false;

  String get _key => 'campaign:${widget.campaignId}';

  String? _error;

  Future<void> _load() async {
    try {
      await AppScope.read(context).load(_key, '/api/campaigns', query: {'id': widget.campaignId}, force: true, rethrowErrors: true);
      if (mounted && _error != null) setState(() => _error = null);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _act(String title, String message, String confirmLabel, String path, Map<String, dynamic> body, String done, {bool destructive = false}) async {
    final app = AppScope.read(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Not now')),
          TextButton(
            style: destructive ? TextButton.styleFrom(foregroundColor: Brand.red) : null,
            onPressed: () => Navigator.pop(d, true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await app.ask(path, {'campaignId': widget.campaignId, ...body});
      if (mounted) toast(context, done);
      _load();
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final data = app.cached(_key);
    final c = Map<String, dynamic>.from(data?['campaign'] as Map? ?? const {});
    final people = [for (final p in (data?['conversations'] as List? ?? const [])) Map<String, dynamic>.from(p)];
    final status = '${c['status'] ?? ''}';
    final total = (c['total_contacts'] as num?)?.toInt() ?? people.length;
    final sent = (c['sent_count'] as num?)?.toInt() ?? 0;
    final failed = (c['failed_count'] as num?)?.toInt() ?? 0;
    // The campaign's own totals when the server has them, else counted from the people listed
    int most(Object? saved, int counted) => [(saved as num?)?.toInt() ?? 0, counted].reduce((a, b) => a > b ? a : b);
    final delivered = most(c['delivered_count'], people.where((p) => p['dispatch_status'] == 'DELIVERED' || p['dispatch_status'] == 'READ').length);
    final read = most(c['read_count'], people.where((p) => p['dispatch_status'] == 'READ').length);
    final replied = people.where((p) => p['has_replied'] == true).toList()
      ..sort((a, b) {
        if ((a['needs_reply'] == true) != (b['needs_reply'] == true)) return a['needs_reply'] == true ? -1 : 1;
        return '${b['last_message_at'] ?? ''}'.compareTo('${a['last_message_at'] ?? ''}');
      });
    final toReply = replied.where((p) => p['needs_reply'] == true).length;
    final missed = total - sent;
    final sample = people.isEmpty ? const <String, String>{} : {for (final e in (people.first['variables_mapped'] as Map? ?? const {}).entries) '${e.key}': '${e.value}'};
    final body = '${c['template_body'] ?? ''}'.replaceAllMapped(RegExp(r'\{\{\s*([\w]+)\s*\}\}'), (m) => sample[m.group(1)]?.isNotEmpty == true ? sample[m.group(1)]! : '{{${m.group(1)}}}');

    return Scaffold(
      appBar: AppBar(
        title: Text(c['name'] == null ? widget.name : '${c['name']}', overflow: TextOverflow.ellipsis),
        actions: [
          if (c.isNotEmpty && !isSending(status) && status != 'SCHEDULED' && app.can('campaigns'))
            PopupMenuButton<String>(
              onSelected: (_) => _act(
                'Send to everyone again?',
                'All $total people get the message again, including those who already got it.',
                'Send to everyone',
                '/api/campaigns/rerun',
                {'rerunType': 'all'},
                'Sending to everyone again.',
                destructive: true,
              ),
              itemBuilder: (_) => const [PopupMenuItem(value: 'all', child: Text('Send to everyone again'))],
            ),
        ],
      ),
      body: Column(
        children: [
          SyncBanner(cacheKey: _key),
          Expanded(
            child: data == null && _error != null && !app.isLoading(_key)
                ? EmptyState(
                    icon: app.online ? Icons.error_outline : Icons.wifi_off,
                    title: app.online ? 'Could not load' : 'Needs the internet',
                    text: app.online ? _error! : 'Open this campaign once online to see who got it.',
                    action: OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  )
                : data == null
                ? (app.isLoading(_key) || app.online
                      ? const SkeletonCards(cards: 3)
                      : const EmptyState(icon: Icons.wifi_off, title: 'Needs the internet', text: 'Open this campaign once online to see who got it.'))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [
                        Panel(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Pill(campaignStatusWords[status] ?? status, tone: campaignTone(status)),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      status == 'SCHEDULED' && c['scheduled_at'] != null ? 'Goes ${formatWhen(c['scheduled_at'])}' : 'Made ${formatWhen(c['created_at'])}',
                                      style: const TextStyle(fontSize: 13, color: Brand.muted),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 14),
                              Row(children: [_Num('People', '$total'), _Num('Sent', '$sent'), _Num('Delivered', '$delivered'), _Num('Read', '$read')]),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  _Num('Not sent', '$failed', attention: failed > 0),
                                  _Num('Replied', '${replied.length}'),
                                  _Num('Reply rate', '${c['reply_rate'] ?? 0}%'),
                                  _Num('To answer', '$toReply', attention: toReply > 0),
                                ],
                              ),
                              const SizedBox(height: 14),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(99),
                                child: LinearProgressIndicator(
                                  minHeight: 7,
                                  value: total == 0 ? 0 : (sent / total).clamp(0, 1).toDouble(),
                                  backgroundColor: Brand.lineSoft,
                                  color: status == 'FAILED' ? Brand.red : Brand.blue,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (app.can('campaigns')) ...[
                          const SizedBox(height: 12),
                          if (status == 'SCHEDULED')
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton(
                                    style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                                    onPressed: _busy
                                        ? null
                                        : () => _act(
                                            'Cancel this campaign?',
                                            'It will not be sent at its time.',
                                            'Cancel campaign',
                                            '/api/campaigns/scheduled',
                                            {'action': 'cancel_schedule'},
                                            'Campaign cancelled.',
                                            destructive: true,
                                          ),
                                    child: const Text('Cancel'),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: FilledButton.icon(
                                    onPressed: _busy
                                        ? null
                                        : () => _act('Send it now?', 'All $total people get it now instead of at its time.', 'Send now', '/api/campaigns/scheduled', {
                                            'action': 'send_now',
                                          }, 'Sending now.'),
                                    icon: const Icon(Icons.send, size: 18),
                                    label: const Text('Send now'),
                                  ),
                                ),
                              ],
                            )
                          else if (isSending(status))
                            OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                              onPressed: _busy
                                  ? null
                                  : () => _act(
                                      'Stop this campaign?',
                                      'Messages already sent stay sent. People not reached yet will not get it; you can send to them later.',
                                      'Stop sending',
                                      '/api/campaigns/stop',
                                      {},
                                      'Campaign stopped.',
                                      destructive: true,
                                    ),
                              icon: const Icon(Icons.stop_circle_outlined),
                              label: const Text('Stop sending'),
                            )
                          else if (missed > 0)
                            FilledButton.icon(
                              onPressed: _busy
                                  ? null
                                  : () => _act(
                                      'Send to the $missed who did not get it?',
                                      'They get the message now. People who already got it are not messaged again.',
                                      'Send now',
                                      '/api/campaigns/rerun',
                                      {'rerunType': 'failed_only'},
                                      'Sending to the ones who missed it.',
                                    ),
                              icon: const Icon(Icons.replay),
                              label: Text('Send to the $missed who did not get it'),
                            ),
                        ],
                        if (body.trim().isNotEmpty) ...[
                          SectionLabel('Message · ${c['template_name'] ?? ''}'),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(color: Brand.chatBg, borderRadius: BorderRadius.circular(16)),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Container(
                                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                                child: Text(body, style: const TextStyle(height: 1.4)),
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        SegmentedButton<bool>(
                          showSelectedIcon: false,
                          segments: [
                            ButtonSegment(value: false, label: Text('Replies · ${replied.length}')),
                            ButtonSegment(value: true, label: Text('Everyone · ${people.length}')),
                          ],
                          selected: {_everyone},
                          onSelectionChanged: (s) => setState(() => _everyone = s.first),
                        ),
                        const SizedBox(height: 12),
                        if (!_everyone) ..._replies(context, replied) else ..._list(people),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _contact(Map<String, dynamic> p) => {'id': p['contact_id'], 'first_name': p['first_name'], 'last_name': p['last_name'], 'phone_number': p['contact_phone'] ?? p['phone_number']};

  List<Widget> _replies(BuildContext context, List<Map<String, dynamic>> replied) {
    if (replied.isEmpty) {
      return const [EmptyState(icon: Icons.chat_bubble_outline, title: 'No replies yet', text: 'When people answer this campaign, they show here and you can reply.')];
    }
    return [
      Card(
        child: Column(
          children: [
            for (var i = 0; i < replied.length; i++) ...[
              if (i > 0) const Divider(indent: 72),
              Builder(
                builder: (context) {
                  final p = replied[i];
                  final contact = _contact(p);
                  final last = p['last_message'] as Map?;
                  final unread = (p['unread_count'] as num?)?.toInt() ?? 0;
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    leading: Avatar(contactName(contact), size: 42),
                    title: Text(contactName(contact), style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      last == null ? '${contact['phone_number'] ?? ''}' : '${last['sender_type'] == 'user' ? 'You: ' : ''}${last['body'] ?? 'File'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(formatWhen(p['last_message_at']), style: TextStyle(fontSize: 12, color: p['needs_reply'] == true ? Brand.blue : Brand.muted)),
                        if (unread > 0 || p['needs_reply'] == true) ...[
                          const SizedBox(height: 4),
                          unread > 0
                              ? Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                  decoration: BoxDecoration(color: Brand.green, borderRadius: BorderRadius.circular(99)),
                                  child: Text(
                                    '$unread',
                                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800),
                                  ),
                                )
                              : const Pill('Answer', tone: PillTone.blue),
                        ],
                      ],
                    ),
                    onTap: p['conversation_id'] == null
                        ? null
                        : () async {
                            await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(conversation: {'id': p['conversation_id'], 'contact': contact, 'last_message': last})));
                            if (mounted) _load();
                          },
                  );
                },
              ),
            ],
          ],
        ),
      ),
    ];
  }

  List<Widget> _list(List<Map<String, dynamic>> people) {
    bool keep(Map<String, dynamic> p) {
      final s = '${p['dispatch_status']}';
      final ok = switch (_show) {
        'delivered' => s == 'DELIVERED' || s == 'READ',
        'read' => s == 'READ',
        'failed' => s == 'FAILED',
        'replied' => p['has_replied'] == true,
        _ => true,
      };
      if (!ok) return false;
      final q = _search.toLowerCase();
      if (q.isEmpty) return true;
      final digits = q.replaceAll(RegExp(r'\D'), '');
      return contactName(_contact(p)).toLowerCase().contains(q) || (digits.isNotEmpty && '${p['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '').contains(digits));
    }

    final shown = people.where(keep).toList();
    return [
      SearchField(
        hint: 'Search name or number',
        padding: EdgeInsets.zero,
        onChanged: (v) => setState(() {
          _search = v.trim();
          _limit = 50;
        }),
      ),
      const SizedBox(height: 10),
      SizedBox(
        height: 40,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            for (final (v, l) in [('all', 'All'), ('delivered', 'Delivered'), ('read', 'Read'), ('failed', 'Not sent'), ('replied', 'Replied')])
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(l),
                  selected: _show == v,
                  onSelected: (_) => setState(() {
                    _show = v;
                    _limit = 50;
                  }),
                ),
              ),
          ],
        ),
      ),
      const SizedBox(height: 10),
      if (shown.isEmpty)
        const EmptyState(icon: Icons.people_outline, title: 'Nobody here', text: 'Try another filter.')
      else
        Card(
          child: Column(
            children: [
              for (var i = 0; i < shown.length && i < _limit; i++) ...[
                if (i > 0) const Divider(indent: 16),
                Builder(
                  builder: (context) {
                    final p = shown[i];
                    final s = '${p['dispatch_status']}';
                    final contact = _contact(p);
                    return ListTile(
                      title: Text(contactName(contact), style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                        s == 'FAILED' && '${p['error_message'] ?? ''}'.isNotEmpty ? '${p['error_message']}' : '${p['phone_number'] ?? contact['phone_number'] ?? ''}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: s == 'FAILED' ? Brand.red : Brand.muted, fontSize: 13),
                      ),
                      trailing: Pill(
                        p['has_replied'] == true ? 'Replied' : (_dispatchWords[s] ?? s),
                        tone: s == 'FAILED'
                            ? PillTone.red
                            : p['has_replied'] == true || s == 'READ'
                            ? PillTone.blue
                            : PillTone.grey,
                      ),
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      if (shown.length > _limit)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Center(
            child: OutlinedButton(onPressed: () => setState(() => _limit += 50), child: Text('Show more (${shown.length - _limit} left)')),
          ),
        ),
    ];
  }
}

class _Num extends StatelessWidget {
  const _Num(this.label, this.value, {this.attention = false});
  final String label, value;
  final bool attention;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            value,
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: attention ? Brand.red : Brand.text),
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 11.5, color: Brand.muted, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
}
