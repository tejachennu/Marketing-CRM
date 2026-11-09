import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../contacts/contacts_screen.dart';
import '../templates/template_widgets.dart';

const _statusWords = {'COMPLETED': 'Sent', 'RUNNING': 'Sending', 'PENDING': 'Starting', 'SCHEDULED': 'Scheduled', 'FAILED': 'Failed', 'STOPPED': 'Stopped', 'PAUSED': 'Paused'};

/// Campaigns: how each one did (sent, delivered, read), and New campaign.
class CampaignsScreen extends StatelessWidget {
  const CampaignsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (!app.can('campaigns')) {
      return Scaffold(appBar: AppBar(title: const Text('Campaigns')), body: const EmptyState(icon: Icons.campaign_outlined, title: 'For managers', text: 'Ask an admin for access to campaigns.'));
    }
    final waiting = [
      for (final item in app.pending('campaign'))
        {'id': item.id, 'name': item.body['name'], 'status': '_WAITING', 'template_name': item.body['templateName'], 'total_contacts': (item.body['audience'] as List?)?.length ?? 0, 'sent_count': 0, 'created_at': item.createdAt.toIso8601String(), '_failed': item.state.name == 'failed'},
    ];
    final campaigns = [...waiting.reversed, for (final c in ((app.cached('campaigns') ?? const {})['campaigns'] as List? ?? const [])) Map<String, dynamic>.from(c)];
    num sum(String key) => campaigns.fold<num>(0, (s, c) => s + ((c[key] as num?) ?? 0));
    final sent = sum('sent_count'), delivered = sum('delivered_count'), read = sum('read_count');
    return Scaffold(
      appBar: AppBar(title: const Text('Campaigns')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewCampaignScreen())),
        icon: const Icon(Icons.add),
        label: const Text('New campaign', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: Column(children: [
        const SyncBanner(cacheKey: 'campaigns'),
        Expanded(
          child: RefreshIndicator(
            onRefresh: app.syncNow,
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
              Panel(
                child: Row(children: [
                  _Stat(label: 'Sent', value: '${sent.toInt()}'),
                  _Stat(label: 'Delivered', value: sent == 0 ? '—' : '${(delivered * 100 / sent).round()}%'),
                  _Stat(label: 'Read', value: sent == 0 ? '—' : '${(read * 100 / sent).round()}%'),
                ]),
              ),
              const SectionLabel('All campaigns'),
              if (campaigns.isEmpty) const EmptyState(icon: Icons.campaign_outlined, title: 'No campaigns yet', text: 'Send an approved template to many customers at once.'),
              for (final c in campaigns) ...[_CampaignCard(campaign: c), const SizedBox(height: 10)],
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w600)),
        ]),
      );
}

class _CampaignCard extends StatelessWidget {
  const _CampaignCard({required this.campaign});
  final Map<String, dynamic> campaign;
  @override
  Widget build(BuildContext context) {
    final c = campaign;
    final status = '${c['status']}';
    final total = (c['total_contacts'] as num?) ?? 0;
    final sent = (c['sent_count'] as num?) ?? 0;
    final delivered = (c['delivered_count'] as num?) ?? 0;
    final read = (c['read_count'] as num?) ?? 0;
    final failed = (c['failed_count'] as num?) ?? 0;
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${c['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
          if (status == '_WAITING') WaitingPill(failed: c['_failed'] == true) else Pill(_statusWords[status] ?? status, tone: status == 'FAILED' ? PillTone.red : status == 'RUNNING' ? PillTone.blue : PillTone.grey),
        ]),
        const SizedBox(height: 4),
        Text(
          status == 'SCHEDULED' && c['scheduled_at'] != null ? 'Goes ${formatWhen(c['scheduled_at'])} · ${c['template_name']}' : '${formatWhen(c['created_at'])} · ${c['template_name'] ?? ''}',
          style: const TextStyle(fontSize: 13, color: Brand.muted),
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(minHeight: 7, value: total == 0 ? 0 : (sent / total).clamp(0, 1).toDouble(), backgroundColor: Brand.lineSoft, color: status == 'FAILED' ? Brand.red : Brand.blue),
        ),
        const SizedBox(height: 8),
        Text(
          status == 'FAILED' ? '${failed.toInt()} of ${total.toInt()} could not be sent' : '${sent.toInt()} of ${total.toInt()} sent${sent > 0 ? ' · ${delivered.toInt()} delivered · ${read.toInt()} read' : ''}',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: status == 'FAILED' ? Brand.red : Brand.textSoft),
        ),
      ]),
    );
  }
}

/// A new campaign: an approved template, who gets it, what fills its blanks, and when.
/// Made offline, it waits on the phone and is created and started when the internet is back.
class NewCampaignScreen extends StatefulWidget {
  const NewCampaignScreen({super.key});
  @override
  State<NewCampaignScreen> createState() => _NewCampaignScreenState();
}

class _NewCampaignScreenState extends State<NewCampaignScreen> {
  final _name = TextEditingController();
  Map<String, dynamic>? _template;
  String? _tag; // null: everyone
  final Map<String, String> _fixed = {};
  final Map<String, bool> _useName = {};
  int _when = 0; // 0 now, 1 this evening, 2 tomorrow morning

  DateTime? get _scheduledAt {
    final now = istNow();
    if (_when == 1) return fromIst(now, 18, 0);
    if (_when == 2) return fromIst(now.add(const Duration(days: 1)), 10, 0);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final contacts = contactsOf(app).where((c) => c['_waiting'] != true && '${c['phone_number'] ?? ''}'.isNotEmpty).toList();
    final tags = <String>{for (final c in contacts) for (final t in (c['tags'] as List? ?? const [])) '$t'}.toList()..sort();
    final audience = contacts.where((c) => _tag == null || (c['tags'] as List? ?? const []).contains(_tag)).toList();
    final templates = templatesOf(app).where((t) => t['status'] == 'APPROVED').toList();
    final parts = _template == null ? null : TemplateParts(_template!);
    final sample = <String, String>{
      if (parts != null)
        for (final b in parts.blanks) b: _useName[b] == true ? (audience.isEmpty ? 'Priya' : contactName(audience.first).split(' ').first) : (_fixed[b] ?? ''),
    };
    final eveningPassed = istNow().hour >= 18;

    return Scaffold(
      appBar: AppBar(title: const Text('New campaign')),
      body: Column(children: [
        const SyncBanner(),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(16), children: [
            TextField(controller: _name, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Campaign name', hintText: 'Diwali offer')),
            const SectionLabel('Template'),
            if (templates.isEmpty) const Text('No approved templates yet. Create one on the web first.', style: TextStyle(color: Brand.muted)),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final t in templates)
                ChoiceChip(
                  label: Text('${t['name']}'),
                  selected: _template?['id'] == t['id'],
                  onSelected: (_) => setState(() {
                    _template = t;
                    _fixed.clear();
                    _useName.clear();
                    final blanks = TemplateParts(t).blanks;
                    if (blanks.isNotEmpty) _useName[blanks.first] = true;
                  }),
                ),
            ]),
            if (parts != null) ...[
              const SizedBox(height: 12),
              TemplateBubble(parts: parts, values: sample),
              for (final b in parts.blanks) ...[
                const SizedBox(height: 12),
                Text('Blank {{$b}}', style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Wrap(spacing: 8, children: [
                  ChoiceChip(label: const Text("Customer's first name"), selected: _useName[b] == true, onSelected: (_) => setState(() => _useName[b] = true)),
                  ChoiceChip(label: const Text('Same text for all'), selected: _useName[b] != true, onSelected: (_) => setState(() => _useName[b] = false)),
                ]),
                if (_useName[b] != true) Padding(padding: const EdgeInsets.only(top: 8), child: TextField(decoration: const InputDecoration(hintText: 'Text for this blank'), onChanged: (v) => setState(() => _fixed[b] = v))),
              ],
            ],
            SectionLabel('Who gets it · ${audience.length}'),
            Wrap(spacing: 8, runSpacing: 8, children: [
              ChoiceChip(label: Text('Everyone · ${contacts.length}'), selected: _tag == null, onSelected: (_) => setState(() => _tag = null)),
              for (final t in tags) ChoiceChip(label: Text('$t · ${contacts.where((c) => (c['tags'] as List? ?? const []).contains(t)).length}'), selected: _tag == t, onSelected: (_) => setState(() => _tag = t)),
            ]),
            const SectionLabel('When'),
            Wrap(spacing: 8, runSpacing: 8, children: [
              ChoiceChip(label: Text(app.online ? 'Now' : 'As soon as online'), selected: _when == 0, onSelected: (_) => setState(() => _when = 0)),
              if (!eveningPassed) ChoiceChip(label: const Text('Today, 6 pm'), selected: _when == 1, onSelected: (_) => setState(() => _when = 1)),
              ChoiceChip(label: const Text('Tomorrow, 10 am'), selected: _when == 2, onSelected: (_) => setState(() => _when = 2)),
            ]),
            const SizedBox(height: 14),
            const Text('Only customers who agreed to hear from you should get marketing messages. WhatsApp may limit numbers that get many blocks.', style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4)),
          ]),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
          child: FilledButton.icon(
            onPressed: parts == null || audience.isEmpty || _name.text.trim().isEmpty || parts.blanks.any((b) => _useName[b] != true && (_fixed[b] ?? '').trim().isEmpty)
                ? null
                : () => _create(app, parts, audience),
            icon: Icon(_when == 0 ? Icons.send : Icons.schedule_send),
            label: Text(_when == 0 ? 'Send to ${audience.length}' : 'Schedule for ${audience.length}'),
          ),
        ),
      ),
    );
  }

  Future<void> _create(AppState app, TemplateParts parts, List<Map<String, dynamic>> audience) async {
    final localId = AppState.newLocalId();
    final recipients = [
      for (final c in audience)
        {
          'phone': c['phone_number'],
          'variables': {for (final b in parts.blanks) b: _useName[b] == true ? contactName(c).split(' ').first : _fixed[b]!.trim()},
        },
    ];
    await app.enqueue(
      kind: 'campaign',
      label: 'Campaign "${_name.text.trim()}" to ${audience.length}',
      path: '/api/campaigns',
      localId: localId,
      resultIdPath: 'campaign.id',
      body: {
        'organizationId': app.orgId,
        'name': _name.text.trim(),
        'templateName': _template!['name'],
        'templateBody': parts.body,
        'templateLanguage': _template!['language'] ?? 'en',
        'channel': 'whatsapp',
        'audience': recipients,
        'createdBy': app.me?['user']?['id'],
        if (_scheduledAt != null) 'scheduledAt': _scheduledAt!.toIso8601String(),
      },
    );
    // Sending now: start it once it exists on the server (scheduled ones start on their own)
    if (_scheduledAt == null) {
      await app.enqueue(kind: 'campaign_run', label: 'Start "${_name.text.trim()}"', path: '/api/campaigns/run', body: {'campaignId': localId});
    }
    if (!mounted) return;
    toast(context, app.online ? 'Campaign created.' : 'Campaign saved. It is created and sent when you are online.');
    Navigator.pop(context);
  }
}
