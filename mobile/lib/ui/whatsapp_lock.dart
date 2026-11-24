import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/app_state.dart';
import '../screens/more/billing_screen.dart';
import 'theme.dart';
import 'widgets.dart';

/// Magnetora's team connects a business's WhatsApp number for them.
const supportWhatsApp = '918367629608';
const supportPhone = '+918367629608';

/// WhatsApp is not connected yet: chats, campaigns, templates, tickets and the booking flow stay locked, and the
/// owner is asked to contact us to connect it.
class WhatsAppLocked extends StatelessWidget {
  const WhatsAppLocked({super.key, required this.feature});

  /// What is locked, in plain words ("Chats", "Campaigns"…)
  final String feature;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    // Starter (₹999) has no own WhatsApp: it needs Growth or Pro first, then we connect the number
    final starter = app.sharedWhatsApp;
    final text = Uri.encodeComponent(starter ? 'Hi, I want to move ${app.orgName} to Growth and connect our own WhatsApp.' : 'Hi, please connect WhatsApp for ${app.orgName} on WAMA CRM.');
    Future<void> open(String url) async {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
      if (!ok && context.mounted) toast(context, 'Could not open it. Message us on +91 83676 29608.');
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 32),
      children: [
        Center(
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 88,
                height: 88,
                decoration: const BoxDecoration(color: Brand.blueSoft, shape: BoxShape.circle),
                child: const Icon(Icons.chat_outlined, size: 40, color: Brand.blue),
              ),
              Positioned(
                right: -2,
                bottom: -2,
                child: Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: Brand.line, width: 2)),
                  child: const Icon(Icons.lock, size: 20, color: Brand.textSoft),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text(
          starter ? 'Your own WhatsApp comes with Growth' : feature == 'WhatsApp' ? 'Connect your WhatsApp' : 'Connect WhatsApp to use ${feature.toLowerCase()}',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text(
          starter
              ? 'Your Starter plan covers bookings, bills, GST invoices and reports. To use ${feature == 'WhatsApp' ? 'chats, AI replies and campaigns' : feature.toLowerCase()} on your own WhatsApp number, move to Growth or Pro. We connect the number for you.'
              : 'Your WhatsApp Business number is not connected yet. Our team connects it for you, usually the same day. Message or call us and we will set it up.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Brand.textSoft, height: 1.45, fontSize: 15),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.line)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Once connected, you get', style: TextStyle(fontWeight: FontWeight.w700)),
              SizedBox(height: 8),
              _Point('Customer chats in one inbox for your team'),
              _Point('AI replies to customers, day and night'),
              _Point('Campaigns and approved message templates'),
              _Point('Bookings, bills and reminders on WhatsApp'),
            ],
          ),
        ),
        const SizedBox(height: 20),
        if (starter && app.can('billing')) ...[
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BillingScreen())),
            icon: const Icon(Icons.workspace_premium_outlined),
            label: const Text('See plans'),
          ),
          const SizedBox(height: 10),
        ],
        (starter && app.can('billing') ? OutlinedButton.icon : FilledButton.icon)(
          style: (starter && app.can('billing') ? OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)) : FilledButton.styleFrom(minimumSize: const Size.fromHeight(52))),
          onPressed: () => open('https://wa.me/$supportWhatsApp?text=$text'),
          icon: const Icon(Icons.chat),
          label: Text(starter ? 'WhatsApp us' : 'WhatsApp us to connect'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
          onPressed: () => open('tel:$supportPhone'),
          icon: const Icon(Icons.call_outlined),
          label: const Text('Call us · +91 83676 29608'),
        ),
        const SizedBox(height: 14),
        const Text('Your bills, bookings and contacts keep working meanwhile.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      ],
    );
  }
}

class _Point extends StatelessWidget {
  const _Point(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.check_circle, size: 17, color: Brand.blue),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(height: 1.3))),
      ],
    ),
  );
}

/// A locked feature opened from a menu: the same card under its own title bar.
class WhatsAppLockedScreen extends StatelessWidget {
  const WhatsAppLockedScreen({super.key, required this.feature});
  final String feature;
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Brand.page,
    appBar: AppBar(title: Text(feature)),
    body: WhatsAppLocked(feature: feature),
  );
}
