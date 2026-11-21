import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';
import 'pickers.dart';

/// Front Desk → Members, like the web's Members tab: membership cards (search, filter, details with what is left
/// and how it was used, send on WhatsApp), the plans (managers add and switch them), and selling a card at the
/// counter. Same /api/salon/memberships and /api/salon/act as the web.

/// active, expiring (14 days or less), expired, cancelled, upcoming: like cardState on the web.
String memberCardState(Map card, [DateTime? now]) {
  final t = now ?? DateTime.now();
  if (card['status'] == 'cancelled') return 'cancelled';
  final ends = DateTime.tryParse('${card['expires_at'] ?? ''}');
  final starts = DateTime.tryParse('${card['starts_at'] ?? ''}');
  if (ends != null && !ends.isAfter(t)) return 'expired';
  if (starts != null && starts.isAfter(t)) return 'upcoming';
  if (ends != null && ends.difference(t).inDays <= 14) return 'expiring';
  return 'active';
}

const _stateWords = {'active': 'Active', 'expiring': 'Ending soon', 'expired': 'Expired', 'cancelled': 'Cancelled', 'upcoming': 'Starts later'};

/// "₹640 left", "1 of 4 Haircut left", "15% off"
String memberCardLeft(Map card) {
  final parts = <String>[];
  final credit = (card['credit_balance'] as num?) ?? num.tryParse('${card['credit_balance']}') ?? 0;
  if (credit > 0) parts.add('${formatRupees(credit)} left');
  for (final s in (card['sessions'] as List? ?? const [])) {
    final total = ((s as Map)['total'] as num?) ?? 0;
    final used = (s['used'] as num?) ?? 0;
    parts.add('${total - used} of $total ${s['name']} left');
  }
  final off = (card['plan'] as Map?)?['discount_percent'];
  if (parts.isEmpty && off is num && off > 0) parts.add('${off.toInt()}% off');
  return parts.join(' · ');
}

String _planLine(Map p) {
  final gets = <String>[
    if (((p['credit'] as num?) ?? 0) > 0) '${formatRupees(p['credit'])} to spend',
    for (final s in (p['sessions'] as List? ?? const [])) '${(s as Map)['count']} × ${s['name']}',
    if (((p['discount_percent'] as num?) ?? 0) > 0) '${(p['discount_percent'] as num).toInt()}% off services',
    if (p['validity_days'] != null) 'valid ${p['validity_days']} days',
  ];
  return gets.join(' · ');
}

class MembersScreen extends StatefulWidget {
  const MembersScreen({super.key});
  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  List<Map<String, dynamic>>? _cards;
  List<Map<String, dynamic>>? _plans;
  String _q = '';
  String _state = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final q = {'organizationId': app.orgId};
    try {
      final r = await Future.wait([app.backend.get('/api/salon/memberships', {...q, 'view': 'cards'}), app.backend.get('/api/salon/memberships', {...q, 'view': 'plans'})]);
      if (!mounted) return;
      setState(() {
        _cards = [for (final c in (r[0]['cards'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)];
        _plans = [for (final p in (r[1]['plans'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
        _error = '';
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final manage = app.can('manage');
    final cards = (_cards ?? const <Map<String, dynamic>>[]).where((c) {
      final s = memberCardState(c);
      if (_state.isNotEmpty && !(s == _state || (_state == 'active' && s == 'expiring'))) return false;
      final q = _q.trim().toLowerCase();
      return q.isEmpty || '${c['customer_name']} ${c['card_number']} ${c['customer_phone']}'.toLowerCase().contains(q);
    }).toList();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: Brand.page,
        appBar: AppBar(
          title: const Text('Members'),
          bottom: const TabBar(tabs: [Tab(text: 'Cards'), Tab(text: 'Plans')]),
        ),
        floatingActionButton: Builder(
          builder: (context) {
            final onPlans = DefaultTabController.of(context).index == 1;
            if (!app.can('write') || (onPlans && !manage)) return const SizedBox.shrink();
            return FloatingActionButton.extended(
              onPressed: () async {
                final done = onPlans ? await _openPlan(context, null) : await _sell(context);
                if (done == true) _load();
              },
              icon: Icon(onPlans ? Icons.add : Icons.card_membership),
              label: Text(onPlans ? 'New plan' : 'Sell'),
            );
          },
        ),
        body: _error.isNotEmpty && _cards == null
            ? EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error, action: TextButton(onPressed: _load, child: const Text('Try again')))
            : _cards == null
            ? const SkeletonList(rows: 6)
            : TabBarView(
                children: [
                  RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.only(bottom: 96),
                      children: [
                        SearchField(hint: 'Name, phone or card number', onChanged: (v) => setState(() => _q = v)),
                        FilterChips(
                          children: [
                            for (final (value, label) in const [('', 'All'), ('active', 'Active'), ('expiring', 'Ending soon'), ('expired', 'Expired')])
                              ChoiceChip(label: Text(label), selected: _state == value, onSelected: (_) => setState(() => _state = value)),
                          ],
                        ),
                        if (cards.isEmpty)
                          EmptyState(icon: Icons.card_membership, title: _cards!.isEmpty ? 'No members yet' : 'Nobody matches', text: _cards!.isEmpty ? 'Sell a membership card at the counter: tap Sell.' : 'Try another name or filter.'),
                        for (final c in cards)
                          FlatRow(
                            onTap: () async {
                              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MemberCardScreen(cardId: '${c['id']}')));
                              _load();
                            },
                            child: Row(
                              children: [
                                Avatar('${c['customer_name']}', size: 44),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('${c['customer_name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 2),
                                      Text('${c['card_number']} · ${(c['plan'] as Map?)?['name'] ?? 'Plan'}${memberCardLeft(c).isNotEmpty ? ' · ${memberCardLeft(c)}' : ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5, color: Brand.muted)),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                _StatePill(memberCardState(c)),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.only(bottom: 96, top: 8),
                      children: [
                        if ((_plans ?? const []).isEmpty)
                          EmptyState(icon: Icons.workspace_premium_outlined, title: 'No plans yet', text: manage ? 'Make a plan like Gold: a price, how long it lasts, and what it gives (credit, free sessions or a discount).' : 'A manager adds membership plans.'),
                        for (final p in _plans ?? const <Map<String, dynamic>>[])
                          FlatRow(
                            onTap: manage ? () async => (await _openPlan(context, p)) == true ? _load() : null : null,
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('${p['name']} · ${formatRupees(p['price'])}', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: p['active'] == false ? Brand.muted : Brand.text)),
                                      const SizedBox(height: 2),
                                      Text(_planLine(p), style: const TextStyle(fontSize: 13.5, color: Brand.muted)),
                                    ],
                                  ),
                                ),
                                if (manage)
                                  Switch(
                                    value: p['active'] != false,
                                    onChanged: (on) async {
                                      try {
                                        await app.ask('/api/salon/memberships', {'action': {'type': 'plan_active', 'plan_id': p['id'], 'active': on}});
                                        _load();
                                      } catch (e) {
                                        if (context.mounted) toast(context, '$e');
                                      }
                                    },
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Future<bool?> _sell(BuildContext context) {
    final plans = (_plans ?? const <Map<String, dynamic>>[]).where((p) => p['active'] != false).toList();
    if (plans.isEmpty) {
      toast(context, 'Add a membership plan first (Plans tab).');
      return Future.value(false);
    }
    return Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => SellMembershipScreen(plans: plans)));
  }

  Future<bool?> _openPlan(BuildContext context, Map<String, dynamic>? plan) =>
      Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => PlanScreen(plan: plan)));
}

class _StatePill extends StatelessWidget {
  const _StatePill(this.state);
  final String state;
  @override
  Widget build(BuildContext context) => Pill(_stateWords[state] ?? state, tone: state == 'expired' || state == 'cancelled' ? PillTone.red : state == 'expiring' ? PillTone.navy : PillTone.blue);
}

/// One membership card: what is left, valid till, how it was used, send it on WhatsApp.
class MemberCardScreen extends StatefulWidget {
  const MemberCardScreen({super.key, required this.cardId});
  final String cardId;
  @override
  State<MemberCardScreen> createState() => _MemberCardScreenState();
}

class _MemberCardScreenState extends State<MemberCardScreen> {
  Map<String, dynamic>? _data;
  String _error = '';
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/salon/memberships', {'organizationId': app.orgId, 'view': 'card', 'id': widget.cardId});
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final card = Map<String, dynamic>.from(_data?['card'] as Map? ?? const {});
    final usage = [for (final u in (_data?['usage'] as List? ?? const [])) Map<String, dynamic>.from(u as Map)];
    final state = card.isEmpty ? 'active' : memberCardState(card);
    final ends = DateTime.tryParse('${card['expires_at'] ?? ''}')?.toLocal();
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: Text('${card['card_number'] ?? 'Membership'}')),
      body: _data == null
          ? (_error.isNotEmpty ? EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error) : const SkeletonCards())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(16)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text('${(card['plan'] as Map?)?['name'] ?? 'Membership'}', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700))),
                          _StatePill(state),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Text('${card['customer_name']}', style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600)),
                      if ('${card['customer_phone'] ?? ''}'.isNotEmpty) Text(showPhone(card['customer_phone']), style: const TextStyle(color: Colors.white70, fontSize: 14)),
                      const SizedBox(height: 12),
                      Text(memberCardLeft(card).isEmpty ? 'Nothing left on this card' : memberCardLeft(card), style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
                      if (ends != null) Text('${state == 'expired' ? 'Ended' : 'Valid till'} ${formatDay(ends)}', style: const TextStyle(color: Colors.white70, fontSize: 13.5)),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _sending || '${card['customer_phone'] ?? ''}'.isEmpty
                            ? null
                            : () async {
                                setState(() => _sending = true);
                                try {
                                  await app.ask('/api/salon/memberships', {'action': {'type': 'send_card', 'card_id': card['id']}});
                                  if (context.mounted) toast(context, 'Card sent on WhatsApp.');
                                } catch (e) {
                                  if (context.mounted) toast(context, '$e');
                                } finally {
                                  if (mounted) setState(() => _sending = false);
                                }
                              },
                        icon: const Icon(Icons.send),
                        label: const Text('Send on WhatsApp'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      onPressed: '${_data?['link'] ?? ''}'.isEmpty
                          ? null
                          : () {
                              Clipboard.setData(ClipboardData(text: '${_data!['link']}'));
                              toast(context, 'Card link copied.');
                            },
                      icon: const Icon(Icons.link),
                      label: const Text('Copy link'),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const SectionLabel('How it was used'),
                if (usage.isEmpty) const Padding(padding: EdgeInsets.all(12), child: Text('Not used yet.', style: TextStyle(color: Brand.muted))),
                for (final u in usage)
                  FlatRow(
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${u['detail'] ?? u['kind']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text(formatWhen('${u['created_at']}'), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                            ],
                          ),
                        ),
                        if (((u['amount'] as num?) ?? 0) > 0) Text(formatRupees(u['amount']), style: const TextStyle(fontWeight: FontWeight.w600)),
                        if (((u['sessions'] as num?) ?? 0) > 0) Text('${u['sessions']} session${u['sessions'] == 1 ? '' : 's'}'),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

/// Sell a membership card at the counter: who, which plan, how they paid, and send the card on WhatsApp.
class SellMembershipScreen extends StatefulWidget {
  const SellMembershipScreen({super.key, required this.plans});
  final List<Map<String, dynamic>> plans;
  @override
  State<SellMembershipScreen> createState() => _SellMembershipScreenState();
}

class _SellMembershipScreenState extends State<SellMembershipScreen> {
  Map<String, dynamic> _customer = const {};
  late String _planId = '${widget.plans.first['id']}';
  String? _payment = 'upi';
  bool _send = true;
  bool _busy = false;
  bool _tried = false;

  @override
  Widget build(BuildContext context) {
    final name = '${_customer['name'] ?? ''}'.trim();
    final phone = '${_customer['phone'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
    final plan = widget.plans.firstWhere((p) => '${p['id']}' == _planId, orElse: () => widget.plans.first);
    return Scaffold(
      appBar: AppBar(title: const Text('Sell a membership')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FormSection(
            title: 'Customer',
            child: CustomerPicker(
              onChanged: (c) => setState(() => _customer = c),
              nameError: _tried && name.length < 2 ? 'Type the customer\'s name.' : null,
              phoneError: _tried && phone.length < 10 ? 'A phone number is needed to send the card.' : null,
            ),
          ),
          FormSection(
            title: 'Plan',
            child: Column(
              children: [
                for (final p in widget.plans)
                  ListTile(
                    onTap: () => setState(() => _planId = '${p['id']}'),
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(_planId == '${p['id']}' ? Icons.radio_button_checked : Icons.radio_button_off, color: _planId == '${p['id']}' ? Brand.blue : Brand.faint),
                    title: Text('${p['name']} · ${formatRupees(p['price'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(_planLine(p)),
                  ),
              ],
            ),
          ),
          FormSection(
            title: 'Paid by',
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (value, label) in const [('cash', 'Cash'), ('upi', 'UPI'), ('card', 'Card'), (null, 'Not paid yet')])
                  ChoiceChip(label: Text(label), selected: _payment == value, onSelected: (_) => setState(() => _payment = value)),
              ],
            ),
          ),
          SwitchListTile(
            value: _send,
            onChanged: (v) => setState(() => _send = v),
            contentPadding: EdgeInsets.zero,
            title: const Text('Send the card on WhatsApp'),
            subtitle: const Text('A link to the card with what it gives and till when.'),
          ),
          const SizedBox(height: 12),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            onPressed: _busy
                ? null
                : () async {
                    setState(() => _tried = true);
                    if (name.length < 2 || phone.length < 10) return;
                    setState(() => _busy = true);
                    try {
                      final r = await AppScope.read(context).ask('/api/salon/act', {
                        'action': {'type': 'sell_membership', 'customer': {'contact_id': _customer['contact_id'], 'name': name, 'phone': _customer['phone']}, 'plan_id': _planId, 'payment_method': _payment, 'send_whatsapp': _send},
                      });
                      if (!context.mounted) return;
                      toast(context, '${r['message'] ?? 'Membership sold.'}');
                      Navigator.of(context).pop(true);
                    } catch (e) {
                      if (context.mounted) toast(context, '$e');
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
            child: Text(_busy ? 'Selling…' : 'Sell ${plan['name']} · ${formatRupees(plan['price'])}'),
          ),
        ],
      ),
    );
  }
}

/// A membership plan (managers): name, price, how long, and what it gives.
class PlanScreen extends StatefulWidget {
  const PlanScreen({super.key, this.plan});
  final Map<String, dynamic>? plan;
  @override
  State<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends State<PlanScreen> {
  late final _name = TextEditingController(text: '${widget.plan?['name'] ?? ''}');
  late final _price = TextEditingController(text: widget.plan?['price'] == null ? '' : '${widget.plan!['price']}');
  late final _days = TextEditingController(text: '${widget.plan?['validity_days'] ?? 365}');
  late final _discount = TextEditingController(text: widget.plan?['discount_percent'] == null || widget.plan!['discount_percent'] == 0 ? '' : '${widget.plan!['discount_percent']}');
  late final _credit = TextEditingController(text: widget.plan?['credit'] == null || widget.plan!['credit'] == 0 ? '' : '${widget.plan!['credit']}');
  late final Map<String, int> _sessions = {for (final s in (widget.plan?['sessions'] as List? ?? const [])) '${(s as Map)['service_id']}': ((s['count'] as num?) ?? 1).toInt()};
  bool _busy = false;
  String _error = '';

  @override
  void dispose() {
    for (final c in [_name, _price, _days, _discount, _credit]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final services = FrontDesk(AppScope.of(context)).services;
    InputDecoration box(String label, {String? suffix, String? prefix}) => InputDecoration(labelText: label, suffixText: suffix, prefixText: prefix);
    return Scaffold(
      appBar: AppBar(title: Text(widget.plan == null ? 'New plan' : 'Edit plan')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: _name, decoration: box('Name, like Gold'), textCapitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: TextField(controller: _price, decoration: box('Price', prefix: '₹ '), keyboardType: const TextInputType.numberWithOptions(decimal: true))),
              const SizedBox(width: 12),
              Expanded(child: TextField(controller: _days, decoration: box('Valid for', suffix: 'days'), keyboardType: TextInputType.number)),
            ],
          ),
          const SizedBox(height: 18),
          const Text('What it gives (at least one)', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: TextField(controller: _credit, decoration: box('Credit to spend', prefix: '₹ '), keyboardType: const TextInputType.numberWithOptions(decimal: true))),
              const SizedBox(width: 12),
              Expanded(child: TextField(controller: _discount, decoration: box('Discount', suffix: '%'), keyboardType: TextInputType.number)),
            ],
          ),
          const SizedBox(height: 14),
          const Text('Free sessions', style: TextStyle(fontWeight: FontWeight.w600)),
          for (final s in services)
            Row(
              children: [
                Expanded(child: Text('${s['name']}', maxLines: 1, overflow: TextOverflow.ellipsis)),
                IconButton(onPressed: (_sessions['${s['id']}'] ?? 0) == 0 ? null : () => setState(() => _sessions['${s['id']}'] = (_sessions['${s['id']}'] ?? 0) - 1), icon: const Icon(Icons.remove_circle_outline)),
                SizedBox(width: 24, child: Text('${_sessions['${s['id']}'] ?? 0}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
                IconButton(onPressed: () => setState(() => _sessions['${s['id']}'] = (_sessions['${s['id']}'] ?? 0) + 1), icon: const Icon(Icons.add_circle_outline)),
              ],
            ),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error, style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600))),
          const SizedBox(height: 16),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            onPressed: _busy ? null : () => _save(services),
            child: Text(_busy ? 'Saving…' : 'Save plan'),
          ),
        ],
      ),
    );
  }

  Future<void> _save(List<Map<String, dynamic>> services) async {
    final name = _name.text.trim();
    final price = num.tryParse(_price.text.trim()) ?? -1;
    final days = int.tryParse(_days.text.trim()) ?? 0;
    final discount = num.tryParse(_discount.text.trim()) ?? 0;
    final credit = num.tryParse(_credit.text.trim()) ?? 0;
    final sessions = [
      for (final s in services)
        if ((_sessions['${s['id']}'] ?? 0) > 0) {'service_id': s['id'], 'name': s['name'], 'count': _sessions['${s['id']}']},
    ];
    final problem = name.length < 2
        ? 'Give the plan a name, like Gold or Bridal.'
        : price < 0
        ? 'Type the price.'
        : days < 1 || days > 3650
        ? 'Valid for: between 1 day and 10 years.'
        : discount < 0 || discount > 100
        ? 'The discount is a percent from 0 to 100.'
        : discount == 0 && credit <= 0 && sessions.isEmpty
        ? 'Add at least one benefit: credit to spend, free sessions, or a discount.'
        : '';
    setState(() => _error = problem);
    if (problem.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      await AppScope.read(context).ask('/api/salon/memberships', {
        'action': {
          'type': 'save_plan',
          'plan': {if (widget.plan?['id'] != null) 'id': widget.plan!['id'], 'name': name, 'price': price, 'validity_days': days, 'discount_percent': discount, 'credit': credit, 'sessions': sessions},
        },
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
