import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'chat_screen.dart';

/// Support tickets, as on the web: the counts, Open and Resolved, search and dates, who has each
/// ticket, and for each one: open the chat, assign it, move it to the Sales Pipeline, resolve it.
class TicketsScreen extends StatefulWidget {
  const TicketsScreen({super.key});
  @override
  State<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends State<TicketsScreen> {
  String _status = 'open';
  String _query = '';
  String _range = 'all'; // all, today, 7, 30, custom
  DateTimeRange? _custom;
  List<Map<String, dynamic>>? _tickets;
  Map<String, dynamic> _counts = const {};
  List<Map<String, dynamic>> _team = const [];
  List<Map<String, dynamic>> _stages = const [];
  Map<String, dynamic> _can = const {};
  int _more = 0;
  bool _loading = false;
  String _error = '';
  int _ask = 0;

  @override
  void initState() {
    super.initState();
    _load(meta: true);
  }

  String _day(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  (String?, String?) get _dates {
    final today = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
    final t = DateTime(today.year, today.month, today.day);
    return switch (_range) {
      'today' => (_day(t), _day(t)),
      '7' => (_day(t.subtract(const Duration(days: 6))), _day(t)),
      '30' => (_day(t.subtract(const Duration(days: 29))), _day(t)),
      'custom' when _custom != null => (_day(_custom!.start), _day(_custom!.end)),
      _ => (null, null),
    };
  }

  Future<void> _load({bool meta = false, bool more = false}) async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    setState(() {
      _loading = true;
      _error = '';
    });
    final (from, to) = _dates;
    try {
      final data = await app.backend.get('/api/tickets', {
        'organizationId': app.orgId,
        'view': 'list',
        'status': _status,
        if (_query.isNotEmpty) 'q': _query,
        'from': ?from,
        'to': ?to,
        if (more) 'offset': '${_tickets?.length ?? 0}',
        if (meta) 'meta': '1',
      });
      if (!mounted || ask != _ask) return;
      final list = [for (final t in (data['tickets'] as List? ?? const [])) Map<String, dynamic>.from(t)];
      setState(() {
        _tickets = more ? [...?_tickets, ...list] : list;
        _counts = Map<String, dynamic>.from(data['counts'] as Map? ?? const {});
        _more = (data['more'] as num?)?.toInt() ?? 0;
        if (meta) {
          _team = [for (final u in (data['team'] as List? ?? const [])) Map<String, dynamic>.from(u)];
          _stages = [for (final s in (data['stages'] as List? ?? const [])) Map<String, dynamic>.from(s)];
          _can = Map<String, dynamic>.from(data['can'] as Map? ?? const {});
        }
      });
    } catch (e) {
      if (mounted && ask == _ask) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted && ask == _ask) setState(() => _loading = false);
    }
  }

  /// After a change: this list, and the open tickets the chats use.
  Future<void> _refresh() async {
    final app = AppScope.read(context);
    await _load();
    app.load('tickets', '/api/tickets', force: true);
  }

  String _who(Object? id) => id == null ? 'Unassigned' : '${_team.cast<Map?>().firstWhere((u) => u!['id'] == id, orElse: () => null)?['name'] ?? 'Someone'}';

  String _name(Map t) {
    final c = (t['contacts'] as Map?) ?? const {};
    final name = [c['first_name'], c['last_name']].where((x) => '${x ?? ''}'.trim().isNotEmpty).join(' ');
    return name.isEmpty ? '${c['phone_number'] ?? 'Customer'}' : name;
  }

  Future<void> _change(Map t, Map<String, dynamic> body, String done) async {
    final app = AppScope.read(context);
    try {
      await app.ask('/api/tickets', {'ticketId': t['id'], ...body}, method: 'PATCH');
      if (mounted) toast(context, done);
      await _refresh();
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    }
  }

  void _openChat(Map t) {
    final app = AppScope.read(context);
    final conversations = (app.cached('conversations')?['conversations'] as List? ?? const []);
    final found = conversations.cast<Map?>().firstWhere((c) => c!['id'] == t['conversation_id'], orElse: () => null);
    final c = (t['contacts'] as Map?) ?? const {};
    final conversation = found != null
        ? Map<String, dynamic>.from(found)
        : {
            'id': t['conversation_id'],
            'contact': {'id': t['contact_id'], ...c},
          };
    Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(conversation: conversation)));
  }

  Future<void> _assign(Map t) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Assign to', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            ListTile(
              leading: const Icon(Icons.person_off_outlined),
              title: const Text('Unassigned'),
              trailing: t['assigned_to'] == null ? const Icon(Icons.check, color: Brand.blue) : null,
              onTap: () => Navigator.pop(sheet, ''),
            ),
            for (final u in _team)
              ListTile(
                leading: Avatar('${u['name']}', size: 34),
                title: Text('${u['name']}'),
                trailing: t['assigned_to'] == u['id'] ? const Icon(Icons.check, color: Brand.blue) : null,
                onTap: () => Navigator.pop(sheet, '${u['id']}'),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    await _change(t, {'assignedTo': picked.isEmpty ? null : picked}, picked.isEmpty ? 'Unassigned.' : 'Assigned to ${_who(picked)}.');
  }

  Future<void> _toDeal(Map t) async {
    final moved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => _ToDealScreen(ticket: Map<String, dynamic>.from(t), stages: _stages, team: _team, canAssign: _can['assign'] == true),
      ),
    );
    if (moved == true) await _refresh();
  }

  Future<void> _actions(Map t) async {
    final open = t['status'] == 'open';
    final write = _can['write'] != false;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('${t['subject'] ?? t['title'] ?? 'Ticket'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('${_name(t)} · ${formatWhen(t['created_at'])}', style: const TextStyle(color: Brand.muted)),
              Text('Assigned: ${_who(t['assigned_to'])}', style: const TextStyle(color: Brand.muted)),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(sheet);
                  _openChat(t);
                },
                icon: const Icon(Icons.chat_outlined),
                label: const Text('Open the chat'),
              ),
              if (write && open) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _toDeal(t);
                  },
                  icon: const Icon(Icons.trending_up),
                  label: const Text('Move to Sales Pipeline'),
                ),
              ],
              if (_can['assign'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _assign(t);
                  },
                  icon: const Icon(Icons.person_add_alt),
                  label: const Text('Assign to someone'),
                ),
              ],
              if (write) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _change(t, {'status': open ? 'resolved' : 'open'}, open ? 'Ticket resolved.' : 'Ticket opened again.');
                  },
                  icon: Icon(open ? Icons.check_circle_outline : Icons.replay),
                  label: Text(open ? 'Resolve' : 'Open it again'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tickets = _tickets;
    Widget count(String label, Object? value, IconData icon) => Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            Icon(icon, size: 18, color: Brand.blue),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${value ?? 0}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Brand.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Tickets')),
      body: RefreshIndicator(
        onRefresh: () => _load(meta: true),
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Row(
                children: [
                  count('Total', _counts['total'], Icons.confirmation_number_outlined),
                  const SizedBox(width: 8),
                  count('Open', _counts['open'], Icons.schedule),
                  const SizedBox(width: 8),
                  count('Resolved', _counts['resolved'], Icons.check_circle_outline),
                ],
              ),
            ),
            SearchField(
              hint: 'Search subject, name or number',
              onChanged: (v) {
                _query = v.trim();
                _load();
              },
            ),
            FilterChips(
              children: [
                ChoiceChip(
                  label: Text('Open ${_counts['open'] ?? ''}'.trim()),
                  selected: _status == 'open',
                  onSelected: (_) {
                    setState(() => _status = 'open');
                    _load();
                  },
                ),
                ChoiceChip(
                  label: Text('Resolved ${_counts['resolved'] ?? ''}'.trim()),
                  selected: _status == 'resolved',
                  onSelected: (_) {
                    setState(() => _status = 'resolved');
                    _load();
                  },
                ),
              ],
            ),
            FilterChips(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              children: [
                for (final (id, label) in [('all', 'Any time'), ('today', 'Today'), ('7', 'Last 7 days'), ('30', 'Last 30 days')])
                  ChoiceChip(
                    label: Text(label),
                    selected: _range == id,
                    onSelected: (_) {
                      setState(() => _range = id);
                      _load();
                    },
                  ),
                ChoiceChip(
                  avatar: const Icon(Icons.date_range, size: 16),
                  label: Text(_range == 'custom' && _custom != null ? '${formatDay(_custom!.start)} – ${formatDay(_custom!.end)}' : 'Pick dates'),
                  selected: _range == 'custom',
                  onSelected: (_) async {
                    final now = DateTime.now();
                    final picked = await showDateRangePicker(context: context, firstDate: DateTime(now.year - 3), lastDate: now, initialDateRange: _custom);
                    if (picked == null) return;
                    setState(() {
                      _custom = picked;
                      _range = 'custom';
                    });
                    _load();
                  },
                ),
              ],
            ),
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Text(_error, style: const TextStyle(color: Brand.red)),
              ),
            if (tickets == null)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (tickets.isEmpty)
              Padding(
                padding: const EdgeInsets.all(16),
                child: EmptyState(
                  icon: Icons.confirmation_number_outlined,
                  title: _status == 'open' ? 'No open tickets' : 'No resolved tickets',
                  text: _query.isNotEmpty || _range != 'all' ? 'Try another search or dates.' : 'When the AI hands a chat to your team, a ticket shows up here.',
                ),
              )
            else
              for (var i = 0; i < tickets.length; i++) ...[
                if (i > 0) const Divider(indent: 72, height: 1),
                FlatRow(
                  onTap: () => _actions(tickets[i]),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Avatar(_name(tickets[i]), size: 44),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${tickets[i]['subject'] ?? tickets[i]['title'] ?? 'Ticket'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(formatAgo(DateTime.tryParse('${tickets[i]['created_at']}')), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${_name(tickets[i])} · ${(tickets[i]['contacts'] as Map?)?['phone_number'] ?? ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13.5, color: Brand.textSoft),
                            ),
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              runSpacing: 4,
                              children: [
                                Pill(
                                  tickets[i]['status'] == 'open' ? 'Open' : 'Resolved',
                                  tone: tickets[i]['status'] == 'open' ? PillTone.red : PillTone.grey,
                                  icon: tickets[i]['status'] == 'open' ? Icons.schedule : Icons.check,
                                ),
                                Pill(_who(tickets[i]['assigned_to']), icon: Icons.person_outline),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            if (_more > 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: OutlinedButton(onPressed: _loading ? null : () => _load(more: true), child: Text('Load more ($_more)')),
              ),
          ],
        ),
      ),
    );
  }
}

/// Move a ticket to the Sales Pipeline as a deal (like the web's Convert to Pipeline Lead).
class _ToDealScreen extends StatefulWidget {
  const _ToDealScreen({required this.ticket, required this.stages, required this.team, required this.canAssign});
  final Map<String, dynamic> ticket;
  final List<Map<String, dynamic>> stages, team;
  final bool canAssign;
  @override
  State<_ToDealScreen> createState() => _ToDealScreenState();
}

class _ToDealScreenState extends State<_ToDealScreen> {
  late final _title = TextEditingController(text: 'Ticket: ${widget.ticket['subject'] ?? widget.ticket['title'] ?? ''}');
  final _value = TextEditingController();
  String _priority = 'medium';
  late String? _stage = widget.stages.isEmpty ? null : '${widget.stages.first['id']}';
  String? _owner;
  bool _resolve = true;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _owner = AppScope.read(context).me?['user']?['id']?.toString();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await app.ask('/api/tickets/to-deal', {
        'ticketId': widget.ticket['id'],
        'title': _title.text.trim(),
        'value': _value.text.trim().isEmpty ? null : _value.text.trim(),
        'priority': _priority,
        'pipeline_stage_id': _stage,
        if (widget.canAssign) 'assigned_to': _owner,
        'resolve': _resolve,
      });
      if (!mounted) return;
      toast(context, _resolve ? 'Deal created and the ticket resolved.' : 'Deal created.');
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Move to Sales Pipeline')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          controller: _title,
          decoration: const InputDecoration(labelText: 'Deal name', hintText: 'e.g. Bridal package for Kavya'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _value,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Value (₹, optional)', hintText: 'e.g. 5000'),
        ),
        const SizedBox(height: 16),
        const Text('How hot is it?', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          children: [
            for (final (id, label) in [('high', 'Hot'), ('medium', 'Warm'), ('low', 'Cold')])
              ChoiceChip(label: Text(label), selected: _priority == id, onSelected: (_) => setState(() => _priority = id)),
          ],
        ),
        const SizedBox(height: 16),
        const Text('Stage', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        if (widget.stages.isEmpty)
          const Text('The first stage of your pipeline.', style: TextStyle(color: Brand.muted))
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [for (final s in widget.stages) ChoiceChip(label: Text('${s['name']}'), selected: _stage == s['id'], onSelected: (_) => setState(() => _stage = '${s['id']}'))],
          ),
        if (widget.canAssign && widget.team.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text('Who owns the deal', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [for (final u in widget.team) ChoiceChip(label: Text('${u['name']}'), selected: _owner == u['id'], onSelected: (_) => setState(() => _owner = '${u['id']}'))],
          ),
        ],
        const SizedBox(height: 8),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _resolve,
          activeThumbColor: Colors.white,
          activeTrackColor: Brand.blue,
          onChanged: (v) => setState(() => _resolve = v),
          title: const Text('Resolve the ticket', style: TextStyle(fontWeight: FontWeight.w700)),
          subtitle: const Text('The chat stays linked to the new deal'),
        ),
        if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: Brand.red)),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.trending_up),
          label: const Text('Create deal'),
        ),
      ],
    ),
  );
}
