import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../config.dart';
import '../../data/app_state.dart';
import '../../data/demo_backend.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Billing, as on the web: the plan and what it says now (trial, active, payment failed, ended),
/// subscribe or stop auto-renew with Razorpay, AI credit with top-ups, payments, what the plan
/// includes, how businesses use it, and common questions.
class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key});
  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

const _faq = [
  (
    'When am I charged?',
    'If you subscribe during your free trial, the first ₹3,000 is charged on the day the trial ends, not before. After that it renews automatically every month on the same date.',
  ),
  ('What happens when the trial ends?', 'If no plan is set up, the workspace pauses until you subscribe. Nothing is deleted: your chats, contacts, campaigns and settings are all kept.'),
  (
    'How do AI credits work?',
    'Every workspace starts with free AI credit. AI replies, reply suggestions, lead scoring and writing help use it. When it runs out, only AI pauses; everything else keeps working. Add credit any time and the meter goes back to 100%. Credit does not expire.',
  ),
  ('Can I stop the plan?', 'Yes. Stop auto-renew any time and you keep every feature until the end of the month you paid for. You can turn it back on before then and nothing changes.'),
  ('How do I pay?', 'Through Razorpay with UPI autopay, debit or credit card, or net banking. Razorpay emails a receipt for every payment.'),
];
const _aiUses = ['WhatsApp AI replies', 'Shopping assistant', 'Reply suggestions', 'Lead scoring', 'Writing help'];

String _date(Object? iso) {
  final t = DateTime.tryParse('${iso ?? ''}');
  if (t == null) return '';
  final ist = t.toUtc().add(const Duration(hours: 5, minutes: 30));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${ist.day} ${months[ist.month - 1]} ${ist.year}';
}

/// What the plan panel says: the same states as the web.
({String tone, IconData icon, String eyebrow, String title, String body, String? action, String? actionKind, String? caption, double? progress, List<(String, String)> facts}) _status(Map b) {
  final until = _date(b['accessUntil']);
  if (b['configured'] != true) {
    return (
      tone: 'neutral',
      icon: Icons.schedule,
      eyebrow: 'Setting up',
      title: 'Billing is being set up',
      body: 'Everything keeps working in the meantime. There is nothing for you to do.',
      action: null,
      actionKind: null,
      caption: null,
      progress: null,
      facts: const [],
    );
  }
  if (b['exempt'] == true) {
    return (
      tone: 'neutral',
      icon: Icons.verified_user_outlined,
      eyebrow: 'Custom arrangement',
      title: 'Nothing to pay here',
      body: 'Your workspace is covered by an arrangement with Magnetora. Every feature is included.',
      action: null,
      actionKind: null,
      caption: null,
      progress: null,
      facts: const [],
    );
  }
  switch (b['status']) {
    case 'trialing':
      final left = (b['trialDaysLeft'] as num?)?.toInt() ?? 0;
      final total = (b['trialDays'] as num?)?.toInt() ?? 14;
      return (
        tone: 'brand',
        icon: Icons.schedule,
        eyebrow: 'Free trial',
        title: left <= 1 ? 'Your free trial ends today' : '$left days left in your free trial',
        body: 'Your trial ends on $until. Subscribe now so your inbox, campaigns and AI keep running without a break.',
        action: 'Subscribe · ₹3,000 / month',
        actionKind: 'subscribe',
        caption: 'First charge on $until, when the trial ends.',
        progress: math.min(100, math.max(4, (total - left) / total * 100)) / 100,
        facts: [('Plan', 'WAMA CRM Pro'), ('Trial ends', until), ('After the trial', '₹3,000 / month')],
      );
    case 'active':
      if (b['cancelAtPeriodEnd'] == true) {
        return (
          tone: 'amber',
          icon: Icons.event_busy_outlined,
          eyebrow: 'Auto-renew is off',
          title: 'Your plan ends on $until',
          body: 'You keep every feature until then. Turn auto-renew back on and nothing changes for your team.',
          action: 'Turn auto-renew on',
          actionKind: 'subscribe',
          caption: 'Next charge on $until.',
          progress: null,
          facts: [('Access until', until), ('Next charge', 'None'), ('Plan', 'WAMA CRM Pro')],
        );
      }
      if (b['autoPayPending'] == true) {
        return (
          tone: 'green',
          icon: Icons.verified_outlined,
          eyebrow: 'Auto-pay is set up',
          title: "You're all set",
          body: 'Your free trial carries on until $until. The first ₹3,000 is charged on that day, then every month. Nothing has been charged yet.',
          action: 'Cancel auto-pay',
          actionKind: 'cancel',
          caption: null,
          progress: null,
          facts: [('Trial ends', until), ('First charge', '₹3,000 · $until'), ('Pay with', 'Razorpay auto-pay')],
        );
      }
      return (
        tone: 'green',
        icon: Icons.verified_outlined,
        eyebrow: 'Active',
        title: 'WAMA CRM Pro is active',
        body: 'Your plan renews automatically every month. Every feature is on for your whole team.',
        action: 'Stop auto-renew',
        actionKind: 'cancel',
        caption: null,
        progress: null,
        facts: [('Plan', 'WAMA CRM Pro'), ('Next charge', until.isEmpty ? '₹3,000 monthly' : '₹3,000 · $until'), ('Pay with', 'Razorpay auto-pay')],
      );
    case 'past_due':
      return (
        tone: 'red',
        icon: Icons.warning_amber_rounded,
        eyebrow: 'Payment failed',
        title: 'Your last payment did not go through',
        body: 'Razorpay will try again. To avoid any interruption, pay now with another card or UPI.',
        action: 'Pay ₹3,000 now',
        actionKind: 'subscribe',
        caption: 'Then monthly through auto-pay.',
        progress: null,
        facts: [('Amount due', '₹3,000'), if (until.isNotEmpty) ('Access until', until), ('Plan', 'WAMA CRM Pro')],
      );
    case 'cancelled':
      if (b['hasAccess'] == true) {
        return (
          tone: 'amber',
          icon: Icons.event_busy_outlined,
          eyebrow: 'Plan cancelled',
          title: 'Your plan ends on $until',
          body: 'You keep every feature until then.',
          action: 'Subscribe again',
          actionKind: 'subscribe',
          caption: 'Charged today, then monthly.',
          progress: null,
          facts: const [],
        );
      }
  }
  return (
    tone: 'brand',
    icon: Icons.lock_outline,
    eyebrow: b['status'] == 'cancelled' ? 'Plan ended' : (b['onTrial'] == true ? 'Trial ended' : 'Plan ended'),
    title: 'Subscribe to unlock your workspace',
    body: 'Your chats, contacts and settings are safe and waiting for you.',
    action: 'Subscribe · ₹3,000 / month',
    actionKind: 'subscribe',
    caption: 'Charged today, then monthly.',
    progress: null,
    facts: const [],
  );
}

class _BillingScreenState extends State<BillingScreen> {
  Map<String, dynamic>? _b;
  String _error = '';
  String _notice = '';
  String? _busy;
  Object _amount = 1000; // an option, or 'other'
  final _custom = TextEditingController();
  String _group = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/billing', {'organizationId': app.orgId, 'extras': '1'});
      if (!mounted) return;
      setState(() {
        _b = data;
        _error = '';
        final groups = (data['featureGroups'] as List?) ?? const [];
        if (_group.isEmpty && groups.isNotEmpty) _group = '${groups.first['id']}';
        final options = ((data['topupOptions'] as List?) ?? const []).cast<num>();
        if (options.isNotEmpty && !options.contains(_amount) && _amount != 'other') _amount = options.contains(1000) ? 1000 : options.first;
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    }
  }

  /// Razorpay Checkout on the phone. Returns its response (to confirm on the server), or null when closed.
  Future<Map<String, dynamic>?> _checkout(Map<String, dynamic> options) async {
    if (AppConfig.demo || AppScope.read(context).backend is DemoBackend) {
      return {
        'razorpay_payment_id': 'pay_demo',
        'razorpay_signature': 'demo',
        ...?(options['order_id'] == null ? null : {'razorpay_order_id': options['order_id']}),
      };
    }
    if (kIsWeb) throw Exception('Payments open in the phone app, or on the web at wamacrm.magnetora.in.');
    final razorpay = Razorpay();
    final done = Completer<Map<String, dynamic>?>();
    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (dynamic response) {
      if (!done.isCompleted) done.complete(Map<String, dynamic>.from((response as Map?) ?? const {}));
    }, rawMap: true);
    razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (dynamic response) {
      final map = (response as Map?) ?? const {};
      // Closing the window is not an error
      if (map['code'] == Razorpay.PAYMENT_CANCELLED) {
        if (!done.isCompleted) done.complete(null);
        return;
      }
      if (!done.isCompleted) done.completeError(Exception('${map['message'] ?? 'The payment failed. No money was taken.'}'));
    }, rawMap: true);
    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (dynamic _) {
      if (!done.isCompleted) done.complete(null);
    }, rawMap: true);
    razorpay.open({
      ...options,
      'name': 'WAMA CRM',
      'theme': {'color': '#008069'},
    });
    try {
      return await done.future;
    } finally {
      razorpay.clear();
    }
  }

  Future<void> _subscribe() async {
    final app = AppScope.read(context);
    setState(() {
      _busy = 'subscribe';
      _error = '';
      _notice = '';
    });
    try {
      final data = await app.ask('/api/billing/subscribe', {});
      final startsAt = data['startsAt'];
      final paid = await _checkout({
        'key': data['keyId'],
        'subscription_id': data['subscriptionId'],
        'description': startsAt != null ? '₹3,000 a month · first charge on ${_date(startsAt)}' : '₹3,000 a month',
        'notes': {'organization_id': app.orgId},
      });
      if (paid == null) return;
      await app.ask('/api/billing/subscribe', paid);
      if (!mounted) return;
      setState(() => _notice = startsAt != null ? 'Auto-pay is set up. Your first ₹3,000 is charged on ${_date(startsAt)}.' : 'Payment received. Your plan is active. Thank you!');
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _cancel() async {
    final app = AppScope.read(context);
    final b = _b!;
    final pending = b['autoPayPending'] == true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(pending ? 'Cancel auto-pay?' : 'Stop auto-renew?'),
        content: Text(
          pending
              ? 'Nothing has been charged. Your free trial carries on until ${_date(b['accessUntil'])}, and you can set up auto-pay again any time before then.'
              : 'You keep every feature until ${_date(b['accessUntil'])}. You can turn auto-renew back on before then and nothing changes.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep it')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Brand.red),
            onPressed: () => Navigator.pop(d, true),
            child: Text(pending ? 'Cancel auto-pay' : 'Stop auto-renew'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busy = 'cancel';
      _error = '';
      _notice = '';
    });
    try {
      final data = await app.ask('/api/billing/cancel', {});
      if (!mounted) return;
      setState(
        () => _notice = data['trial'] == true
            ? 'Auto-pay cancelled. Nothing was charged, and your free trial carries on until ${_date(data['accessUntil'])}.'
            : 'Auto-renew is off. You keep access until ${_date(data['accessUntil'])}.',
      );
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _topup(num value) async {
    final app = AppScope.read(context);
    setState(() {
      _busy = 'topup';
      _error = '';
      _notice = '';
    });
    try {
      final data = await app.ask('/api/billing/topup', {'amount': value});
      final paid = await _checkout({'key': data['keyId'], 'order_id': data['orderId'], 'amount': data['amount'], 'currency': data['currency'], 'description': 'AI credit'});
      if (paid == null) return;
      await app.ask('/api/billing/topup', paid);
      if (!mounted) return;
      _custom.clear();
      setState(() => _notice = 'AI credit added. Your meter is back to 100%.');
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final b = _b;
    if (b == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Billing')),
        body: Center(
          child: _error.isEmpty
              ? const CircularProgressIndicator()
              : Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    _error,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Brand.red),
                  ),
                ),
        ),
      );
    }
    final canPay = app.can('billing');
    final paymentsOn = b['razorpayKeyId'] != null && b['configured'] == true;
    final view = _status(b);
    final (panel, ink, soft) = switch (view.tone) {
      'brand' => (Brand.blue, Colors.white, Colors.white70),
      'green' => (Brand.bubble, Brand.text, Brand.textSoft),
      'amber' => (const Color(0xFFFFF4DC), Brand.text, Brand.textSoft),
      'red' => (Brand.redSoft, Brand.text, Brand.textSoft),
      _ => (Brand.page, Brand.text, Brand.textSoft),
    };
    final percent = (b['aiPercentLeft'] as num?)?.round();
    final aiPaused = b['aiPaused'] == true;
    final options = ((b['topupOptions'] as List?) ?? const []).cast<num>();
    final minTopup = (b['minTopup'] as num?) ?? 100;
    final maxTopup = (b['maxTopup'] as num?) ?? 100000;
    final chosen = _amount == 'other' ? (num.tryParse(_custom.text.replaceAll(',', '')) ?? 0) : _amount as num;
    final chosenValid = chosen >= minTopup && chosen <= maxTopup;
    final groups = ((b['featureGroups'] as List?) ?? const []).cast<Map>();
    final group = groups.where((g) => g['id'] == _group).firstOrNull ?? groups.firstOrNull;
    final useCases = ((b['useCases'] as List?) ?? const []).cast<Map>();
    final payments = ((b['payments'] as List?) ?? const []).cast<Map>();
    final plan = (b['plan'] as Map?) ?? const {};

    return Scaffold(
      appBar: AppBar(title: const Text('Billing')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            const Row(
              children: [
                Icon(Icons.lock_outline, size: 15, color: Brand.muted),
                SizedBox(width: 4),
                Expanded(
                  child: Text('Payments secured by Razorpay', style: TextStyle(color: Brand.muted, fontSize: 13)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (_notice.isNotEmpty) _note(_notice, false),
            if (_error.isNotEmpty) _note(_error, true),
            // The plan, and what it says now
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: panel, borderRadius: BorderRadius.circular(20)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(view.icon, color: ink, size: 20),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          view.eyebrow,
                          style: TextStyle(color: ink, fontWeight: FontWeight.w700, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    view.title,
                    style: TextStyle(color: ink, fontSize: 22, fontWeight: FontWeight.w700, height: 1.2),
                  ),
                  const SizedBox(height: 6),
                  Text(view.body, style: TextStyle(color: soft, fontSize: 14, height: 1.35)),
                  if (view.progress != null) ...[
                    const SizedBox(height: 12),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(value: view.progress, minHeight: 6, backgroundColor: Colors.white24, color: Colors.white),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Expanded(
                          child: Text('Trial started', style: TextStyle(color: soft, fontSize: 12)),
                        ),
                        Flexible(
                          child: Text(
                            'Ends ${_date(b['accessUntil'])}',
                            textAlign: TextAlign.right,
                            style: TextStyle(color: soft, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (view.facts.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 18,
                      runSpacing: 10,
                      children: [
                        for (final (label, value) in view.facts)
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(label, style: TextStyle(color: soft, fontSize: 12)),
                              Text(
                                value,
                                style: TextStyle(color: ink, fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ],
                  if (view.action != null) ...[
                    const SizedBox(height: 16),
                    if (!canPay)
                      Text('Only workspace admins can change the plan.', style: TextStyle(color: soft))
                    else ...[
                      SizedBox(
                        width: double.infinity,
                        child: view.actionKind == 'cancel'
                            ? OutlinedButton(
                                onPressed: _busy != null ? null : _cancel,
                                style: OutlinedButton.styleFrom(foregroundColor: ink),
                                child: _busy == 'cancel' ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(view.action!),
                              )
                            : FilledButton(
                                onPressed: _busy != null || !paymentsOn ? null : _subscribe,
                                style: view.tone == 'brand' ? FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Brand.blue) : null,
                                child: _busy == 'subscribe' ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(view.action!),
                              ),
                      ),
                      if (view.actionKind == 'subscribe')
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(paymentsOn ? view.caption ?? '' : 'Online payments are not switched on yet. Please contact us.', style: TextStyle(color: soft, fontSize: 12.5)),
                        ),
                    ],
                  ],
                ],
              ),
            ),
            // AI credit
            const SectionLabel('AI credit'),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border.all(color: Brand.line),
                borderRadius: BorderRadius.circular(16),
              ),
              child: percent == null
                  ? const Text('Your workspace uses its own AI key, so there is no AI credit to track.', style: TextStyle(color: Brand.textSoft))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            SizedBox(
                              width: 92,
                              height: 92,
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  CircularProgressIndicator(
                                    value: percent / 100,
                                    strokeWidth: 9,
                                    backgroundColor: Brand.line,
                                    color: aiPaused
                                        ? Brand.red
                                        : percent <= 20
                                        ? const Color(0xFFF59E0B)
                                        : Brand.blue,
                                  ),
                                  Center(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text('$percent%', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                                        const Text('left', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Pill(
                                    aiPaused
                                        ? 'Paused'
                                        : percent <= 20
                                        ? 'Running low'
                                        : 'Running',
                                    tone: aiPaused ? PillTone.red : PillTone.blue,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    aiPaused
                                        ? 'AI is paused'
                                        : percent <= 20
                                        ? 'Add credit soon'
                                        : 'AI is working for you',
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                                  ),
                                  Text(
                                    aiPaused ? 'Add credit to switch AI replies and suggestions back on. Everything else keeps working.' : 'Credit is used a little at a time as AI helps your team.',
                                    style: const TextStyle(fontSize: 13, color: Brand.textSoft),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Wrap(spacing: 6, runSpacing: 6, children: [for (final u in _aiUses) Pill(u)]),
                        const Divider(height: 28),
                        if (!canPay)
                          const Text('Your workspace admin can add AI credit.', style: TextStyle(color: Brand.muted))
                        else ...[
                          const Text('Add credit', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final o in options) ChoiceChip(label: Text(formatRupees(o)), selected: _amount == o, onSelected: (_) => setState(() => _amount = o)),
                              ChoiceChip(label: const Text('Other'), selected: _amount == 'other', onSelected: (_) => setState(() => _amount = 'other')),
                            ],
                          ),
                          if (_amount == 'other') ...[
                            const SizedBox(height: 8),
                            TextField(
                              controller: _custom,
                              keyboardType: TextInputType.number,
                              onChanged: (_) => setState(() {}),
                              decoration: InputDecoration(labelText: 'Amount (₹)', hintText: '$minTopup to ${formatRupees(maxTopup).replaceAll('₹', '')}'),
                            ),
                          ],
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: !chosenValid || _busy != null || !paymentsOn ? null : () => _topup(chosen),
                              child: _busy == 'topup'
                                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : Text(chosenValid ? 'Add ${formatRupees(chosen)} of AI credit' : 'Choose an amount (₹$minTopup+)'),
                            ),
                          ),
                        ],
                      ],
                    ),
            ),
            // What the plan includes
            if (plan.isNotEmpty) ...[
              const SectionLabel('Your plan'),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  border: Border.all(color: Brand.line),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${plan['name'] ?? 'WAMA CRM Pro'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: formatRupees(plan['price']),
                            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                          ),
                          TextSpan(
                            text: ' / ${plan['interval'] ?? 'month'}',
                            style: const TextStyle(color: Brand.muted),
                          ),
                        ],
                      ),
                    ),
                    if (groups.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        height: 40,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            for (final g in groups)
                              Padding(
                                padding: const EdgeInsets.only(right: 6),
                                child: ChoiceChip(label: Text('${g['title']}'), selected: g['id'] == group?['id'], onSelected: (_) => setState(() => _group = '${g['id']}')),
                              ),
                          ],
                        ),
                      ),
                      if (group != null) ...[
                        const SizedBox(height: 10),
                        Text('${group['title']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        Text('${group['summary']}', style: const TextStyle(color: Brand.textSoft)),
                        const SizedBox(height: 8),
                        for (final point in (group['points'] as List? ?? const []))
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.check_circle, size: 18, color: Brand.blue),
                                const SizedBox(width: 8),
                                Expanded(child: Text('$point')),
                              ],
                            ),
                          ),
                      ],
                    ] else
                      for (final f in (plan['features'] as List? ?? const []))
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Row(
                            children: [
                              const Icon(Icons.check_circle, size: 18, color: Brand.blue),
                              const SizedBox(width: 8),
                              Expanded(child: Text('$f')),
                            ],
                          ),
                        ),
                  ],
                ),
              ),
            ],
            // How businesses use it
            if (useCases.isNotEmpty) ...[
              const SectionLabel('How businesses use WAMA CRM'),
              for (final u in useCases)
                Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(14)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${u['business']}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text('${u['headline']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(height: 6),
                      for (final (i, step) in (u['steps'] as List? ?? const []).indexed) Text('${i + 1}. $step', style: const TextStyle(fontSize: 13, color: Brand.textSoft)),
                    ],
                  ),
                ),
            ],
            // Payments
            if (canPay) ...[
              const SectionLabel('Payments'),
              if (payments.isEmpty)
                const Text('No payments yet. Your plan and AI credit payments will show here.', style: TextStyle(color: Brand.muted))
              else
                for (final p in payments)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: Text('${p['purpose'] ?? 'Payment'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(_date(p['date'])),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(formatRupees(p['amount']), style: const TextStyle(fontWeight: FontWeight.w700)),
                        const Text(
                          'Paid',
                          style: TextStyle(fontSize: 12, color: Brand.blue, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
            ],
            // Questions
            const SectionLabel('Common questions'),
            for (final (q, a) in _faq)
              Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(bottom: 10),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  title: Text(q, style: const TextStyle(fontWeight: FontWeight.w600)),
                  children: [Text(a, style: const TextStyle(color: Brand.textSoft))],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _note(String text, bool error) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: error ? Brand.redSoft : Brand.bubble, borderRadius: BorderRadius.circular(12)),
    child: Text(
      text,
      style: TextStyle(color: error ? Brand.red : const Color(0xFF15603E), fontWeight: FontWeight.w600),
    ),
  );
}
