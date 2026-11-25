import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/app_state.dart';
import '../screens/more/billing_screen.dart';
import 'theme.dart';
import 'whatsapp_lock.dart' show supportWhatsApp;
import 'widgets.dart';

/// The free trial (14 days) or the paid plan has ended: the whole app waits here until a plan is chosen.
/// The server refuses everything but Billing meanwhile (lib/billing-gate.ts). Nothing is deleted.
class PlanEndedScreen extends StatefulWidget {
  const PlanEndedScreen({super.key});
  @override
  State<PlanEndedScreen> createState() => _PlanEndedScreenState();
}

class _PlanEndedScreenState extends State<PlanEndedScreen> {
  bool _checking = false;

  Future<void> _check() async {
    final app = AppScope.read(context);
    setState(() => _checking = true);
    await app.load('me', '/api/mobile/me', force: true);
    if (!mounted) return;
    setState(() => _checking = false);
    if (app.paused) {
      toast(
        context,
        'Still waiting for a plan. If you just paid, give it a minute and check again.',
      );
    } else {
      await app.syncNow();
    }
  }

  Future<void> _openBilling() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const BillingScreen()),
    );
    if (mounted) await _check();
  }

  Future<void> _help() async {
    final app = AppScope.read(context);
    final text = Uri.encodeComponent(
      'Hi, I need help choosing a plan for ${app.orgName}.',
    );
    final ok = await launchUrl(
      Uri.parse('https://wa.me/$supportWhatsApp?text=$text'),
      mode: LaunchMode.externalApplication,
    ).catchError((_) => false);
    if (!ok && mounted) {
      toast(context, 'Could not open WhatsApp. Message us on +91 83676 29608.');
    }
  }

  Future<void> _signOut() async {
    final app = AppScope.read(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true) await app.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final canPay = app.can('billing');
    final trial = app.trialEnded;
    return Scaffold(
      backgroundColor: Brand.page,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 36, 20, 28),
          children: [
            Center(
              child: Container(
                width: 88,
                height: 88,
                decoration: const BoxDecoration(
                  color: Brand.blueSoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  trial ? Icons.hourglass_bottom : Icons.event_busy_outlined,
                  size: 40,
                  color: Brand.blue,
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              trial
                  ? 'Your 14-day free trial has ended'
                  : 'Your plan has ended',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              canPay
                  ? 'Choose a plan to carry on with ${app.orgName}. Nothing is deleted: your bookings, bills, chats, contacts and settings are all kept.'
                  : 'Ask the owner of ${app.orgName} to choose a plan in Billing. Nothing is deleted: everything is kept and opens again once the plan is on.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Brand.textSoft,
                height: 1.45,
                fontSize: 15,
              ),
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Brand.line),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Point('Plans from ₹300 a month, cancel any time'),
                  _Point('Pay with UPI or card'),
                  _Point('The app opens again as soon as you pay'),
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (canPay)
              FilledButton.icon(
                onPressed: _openBilling,
                icon: const Icon(Icons.workspace_premium_outlined),
                label: const Text('Choose a plan'),
              ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _checking ? null : _check,
              icon: _checking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh),
              label: Text(canPay ? 'I have paid, check again' : 'Check again'),
            ),
            const SizedBox(height: 6),
            TextButton.icon(
              onPressed: _help,
              icon: const Icon(Icons.chat_outlined),
              label: const Text('Need help? WhatsApp us'),
            ),
            TextButton(
              onPressed: _signOut,
              child: const Text(
                'Sign out',
                style: TextStyle(color: Brand.textSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.check_circle, size: 18, color: Brand.blue),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 14.5, height: 1.3),
          ),
        ),
      ],
    ),
  );
}

/// A thin bar across the app in the last days of the free trial: tap to choose a plan.
class TrialBar extends StatelessWidget {
  const TrialBar({super.key});

  /// Shown from this many days left
  static const fromDays = 3;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final left = app.trialDaysLeft;
    if (left == null || left > fromDays) return const SizedBox.shrink();
    final words = left <= 0
        ? 'Your free trial ends today'
        : left == 1
        ? '1 day left in your free trial'
        : '$left days left in your free trial';
    final canPay = app.can('billing');
    return Material(
      color: const Color(0xFFFFF3CD),
      child: InkWell(
        onTap: canPay
            ? () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const BillingScreen()),
              )
            : null,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 9, 12, 9),
          child: Row(
            children: [
              const Icon(
                Icons.hourglass_top,
                size: 18,
                color: Color(0xFF6B5200),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  canPay
                      ? '$words. Choose a plan so nothing stops.'
                      : '$words. Ask the owner to choose a plan.',
                  style: const TextStyle(
                    color: Color(0xFF6B5200),
                    fontWeight: FontWeight.w600,
                    fontSize: 13.5,
                  ),
                ),
              ),
              if (canPay)
                const Icon(Icons.chevron_right, color: Color(0xFF6B5200)),
            ],
          ),
        ),
      ),
    );
  }
}
