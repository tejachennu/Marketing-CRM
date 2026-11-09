import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'campaign_screen.dart';
import 'new_campaign_screen.dart';

export 'new_campaign_screen.dart' show NewCampaignScreen;

/// What each campaign state is called, as on the web.
const campaignStatusWords = {
  'COMPLETED': 'Sent',
  'RUNNING': 'Sending',
  'PROCESSING': 'Sending',
  'PENDING': 'Starting',
  'SCHEDULED': 'Scheduled',
  'FAILED': 'Failed',
  'STOPPED': 'Stopped',
  'CANCELLED': 'Stopped',
  'PAUSED': 'Paused',
};

bool isSending(String status) => status == 'RUNNING' || status == 'PROCESSING' || status == 'PENDING';

PillTone campaignTone(String status) => status == 'FAILED'
    ? PillTone.red
    : isSending(status) || status == 'SCHEDULED'
    ? PillTone.blue
    : PillTone.grey;

/// The filters on the list, with the server's names for them.
const _filters = [('', 'All'), ('scheduled', 'Scheduled'), ('sending', 'Sending'), ('completed', 'Sent'), ('failed', 'Failed'), ('stopped', 'Stopped')];

/// Campaigns: totals, search and filters, and every campaign; tap one to see who got it and who replied.
class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key});
  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  String _status = '';
  String _search = '';
  final _searchBox = TextEditingController();
  Timer? _debounce;
  int _page = 1;
  final List<Map<String, dynamic>> _more = [];
  bool _loadingMore = false;

  /// The first page with no filter is the list kept on the phone for offline use.
  String get _key => _status.isEmpty && _search.isEmpty ? 'campaigns' : 'campaigns:$_status:$_search';
  Map<String, String> get _query => {'limit': '30', if (_status.isNotEmpty) 'status': _status, if (_search.isNotEmpty) 'search': _search};

  void _reload() {
    _page = 1;
    _more.clear();
    AppScope.read(context).load(_key, '/api/campaigns', query: _query, force: true);
  }

  Future<void> _loadMore() async {
    final app = AppScope.read(context);
    setState(() => _loadingMore = true);
    try {
      final data = await app.backend.get('/api/campaigns', {..._query, 'organizationId': app.orgId, 'page': '${_page + 1}', 'summary': 'false'});
      setState(() {
        _page++;
        _more.addAll([for (final c in (data['campaigns'] as List? ?? const [])) Map<String, dynamic>.from(c)]);
      });
    } catch (e) {
      if (mounted) toast(context, 'Could not load more. ${'$e'.replaceFirst('Exception: ', '')}');
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchBox.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (!app.can('campaigns')) {
      return Scaffold(
        appBar: AppBar(title: const Text('Campaigns')),
        body: const EmptyState(icon: Icons.campaign_outlined, title: 'For managers', text: 'Ask an admin for access to campaigns.'),
      );
    }
    final data = app.cached(_key);
    final base = app.cached('campaigns');
    final summary = (data?['summary'] ?? base?['summary']) as Map?;
    // Campaigns made on this phone that have not reached the server yet
    final waiting = _status.isNotEmpty || _search.isNotEmpty
        ? const <Map<String, dynamic>>[]
        : [
            for (final item in app.pending('campaign'))
              {
                'id': item.id,
                'name': item.body['name'],
                'status': '_WAITING',
                'template_name': item.body['templateName'],
                'total_contacts': (item.body['audience'] as List?)?.length ?? 0,
                'sent_count': 0,
                'created_at': item.createdAt.toIso8601String(),
                '_failed': item.state.name == 'failed',
              },
          ];
    final campaigns = [...waiting.reversed, for (final c in (data?['campaigns'] as List? ?? const [])) Map<String, dynamic>.from(c), ..._more];
    final pages = ((data?['pagination'] as Map?)?['pages'] as num?)?.toInt() ?? 1;
    int count(String key) => (summary?[key] as num?)?.toInt() ?? 0;

    final searchBox = SearchField(
      controller: _searchBox,
      hint: 'Search campaign or template',
      onChanged: (v) {
        _debounce?.cancel();
        _debounce = Timer(const Duration(milliseconds: 450), () {
          if (!mounted) return;
          setState(() => _search = v.trim());
          _reload();
        });
      },
    );
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Campaigns')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-campaigns',
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => const NewCampaignScreen()));
          if (mounted && _key != 'campaigns') _reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('New campaign', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: Column(
        children: [
          SyncBanner(cacheKey: _key),
          searchBox,
          FilterChips(
            children: [
              for (final (value, label) in _filters)
                ChoiceChip(
                  label: Text(summary == null || value.isEmpty || count(value) == 0 ? label : '$label ${count(value)}'),
                  selected: _status == value,
                  onSelected: (_) {
                    setState(() => _status = value);
                    _reload();
                  },
                ),
            ],
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                _reload();
                await app.syncNow();
              },
              child: ListView(
                padding: const EdgeInsets.only(bottom: 96),
                children: [
                  if (summary != null)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(14)),
                      child: Row(
                        children: [
                          _Stat(label: 'Campaigns', value: '${count('total')}'),
                          _Stat(label: 'Messages sent', value: shortCount(count('sent'))),
                          _Stat(label: 'Not sent', value: shortCount(count('failedMessages')), attention: count('failedMessages') > 0),
                        ],
                      ),
                    ),
                  if (data == null && app.isLoading(_key))
                    const SizedBox(height: 400, child: SkeletonList())
                  else if (campaigns.isEmpty)
                    EmptyState(
                      icon: Icons.campaign_outlined,
                      title: _status.isEmpty && _search.isEmpty ? 'No campaigns yet' : 'No campaigns match',
                      text: _status.isEmpty && _search.isEmpty ? 'Send an approved template to many customers at once.' : 'Try another word or filter.',
                    )
                  else ...[
                    for (var i = 0; i < campaigns.length; i++) ...[
                      if (i > 0) const Divider(indent: 76),
                      CampaignCard(
                        campaign: campaigns[i],
                        onTap: campaigns[i]['status'] == '_WAITING'
                            ? null
                            : () async {
                                final c = campaigns[i];
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => CampaignScreen(campaignId: '${c['id']}', name: '${c['name']}'),
                                  ),
                                );
                                if (mounted) _reload();
                              },
                      ),
                    ],
                    if (_page < pages)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Center(
                          child: OutlinedButton(onPressed: _loadingMore || !app.online ? null : _loadMore, child: Text(_loadingMore ? 'Loading…' : 'Load more')),
                        ),
                      ),
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

/// 1,250 or 12.5K.
String shortCount(num n) => n >= 100000 ? '${(n / 1000).round()}K' : (n >= 10000 ? '${(n / 1000).toStringAsFixed(1)}K' : formatCount(n));

String formatCount(num n) {
  final s = n.toInt().toString();
  return s.length <= 3 ? s : '${s.substring(0, s.length - 3)},${s.substring(s.length - 3)}';
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.attention = false});
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
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: attention ? Brand.red : Brand.text),
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
}

/// One campaign in the list: name, state, when, and how far it got.
class CampaignCard extends StatelessWidget {
  const CampaignCard({super.key, required this.campaign, this.onTap});
  final Map<String, dynamic> campaign;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final c = campaign;
    final status = '${c['status']}';
    final total = (c['total_contacts'] as num?) ?? 0;
    final sent = (c['sent_count'] as num?) ?? 0;
    final read = (c['read_count'] as num?) ?? 0;
    final failed = (c['failed_count'] as num?) ?? 0;
    final replies = (c['active_chats_count'] as num?) ?? 0;
    final toReply = (c['unread_chats_count'] as num?) ?? 0;
    final when = status == 'SCHEDULED' && c['scheduled_at'] != null ? 'Goes ${formatWhen(c['scheduled_at'])}' : formatWhen(c['created_at']);
    final (icon, iconBg, iconFg) = switch (status) {
      'FAILED' => (Icons.error_outline, Brand.redSoft, Brand.red),
      'SCHEDULED' => (Icons.schedule, Brand.blueSoft, Brand.blue),
      '_WAITING' => (Icons.cloud_upload_outlined, Brand.lineSoft, Brand.textSoft),
      _ when isSending(status) => (Icons.send, Brand.blueSoft, Brand.blue),
      _ => (Icons.campaign_outlined, Brand.lineSoft, Brand.navy),
    };
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
              child: Icon(icon, color: iconFg, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${c['name']}',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        when,
                        style: TextStyle(fontSize: 12, color: status == 'SCHEDULED' ? Brand.blue : Brand.faint, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          status == 'FAILED' && sent == 0
                              ? '${failed.toInt()} of ${total.toInt()} could not be sent'
                              : status == 'SCHEDULED' || status == '_WAITING'
                              ? '${total.toInt()} people · ${c['template_name'] ?? ''}'
                              : '${sent.toInt()} of ${total.toInt()} sent${sent > 0 ? ' · ${read.toInt()} read' : ''}${failed > 0 ? ' · ${failed.toInt()} not sent' : ''}',
                          style: TextStyle(fontSize: 13.5, color: status == 'FAILED' ? Brand.red : Brand.muted),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (status == '_WAITING') WaitingPill(failed: c['_failed'] == true) else Pill(campaignStatusWords[status] ?? status, tone: campaignTone(status)),
                    ],
                  ),
                  if (isSending(status) || (status == 'COMPLETED' && total > 0)) ...[
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: LinearProgressIndicator(minHeight: 4, value: total == 0 ? 0 : (sent / total).clamp(0, 1).toDouble(), backgroundColor: Brand.lineSoft, color: Brand.blue),
                    ),
                  ],
                  if (replies > 0) ...[
                    const SizedBox(height: 6),
                    Text(
                      '${replies.toInt()} replied${toReply > 0 ? ' · ${toReply.toInt()} waiting for you' : ''}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.blue),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
