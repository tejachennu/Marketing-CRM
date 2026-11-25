import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Right after sign-up (owner, 25 Nov 2026): what the two connectors give with the business's own WhatsApp, that our
/// team also runs their ads and social media, that both work without WhatsApp for ₹300 a month (confirmations from
/// WAMA CRM's number, bills, invoices and reports), and then the pick: which connector, with or without WhatsApp.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.startPage = 0});

  /// Demo screenshots: open on this page.
  final int startPage;
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Slide {
  const _Slide({required this.icon, required this.eyebrow, required this.title, required this.intro, required this.points, required this.gain, this.team = false});
  final Widget icon;
  final String eyebrow;
  final String title;
  final String intro;
  final List<String> points;
  final String gain;

  /// Show "our team runs your ads and social media"
  final bool team;
}

final _slides = [
  _Slide(
    icon: const FrontDeskIcon(size: 34, color: Brand.blue),
    eyebrow: 'Connector 1 · with your own WhatsApp',
    title: 'Front Desk',
    intro: 'For salons, clinics, gyms, studios, service centres and any business that takes bookings.',
    points: const [
      'Customers book on WhatsApp day and night, and the AI answers their questions',
      'Reminders before every visit, so fewer people forget to come',
      'Walk-in bills and GST invoices sent on WhatsApp',
      'Memberships, reviews, staff commission and daily reports',
      'Your own website with a Book button',
    ],
    gain: 'You gain: more bookings, fewer missed calls, and every visit and bill in one place.',
    team: true,
  ),
  _Slide(
    icon: const Icon(Icons.shopping_bag_outlined, size: 34, color: Brand.blue),
    eyebrow: 'Connector 2 · with your own WhatsApp',
    title: 'E-commerce',
    intro: 'For shops, boutiques, restaurants and home businesses that sell products.',
    points: const [
      'Your products inside WhatsApp and on your own online store',
      'Customers order and pay by UPI, card or cash on delivery',
      'Order updates, courier tracking and cart reminders on WhatsApp',
      'Offers, GST invoices and sales reports',
      'The AI answers product questions 24 × 7',
    ],
    gain: 'You gain: sales on WhatsApp and online, from one app.',
    team: true,
  ),
  _Slide(
    icon: const Icon(Icons.receipt_long_outlined, size: 34, color: Brand.blue),
    eyebrow: 'No WhatsApp Business yet?',
    title: 'Both work without WhatsApp, at ₹300 a month',
    intro: 'Start today with Front Desk or E-commerce, and connect your own WhatsApp whenever you are ready.',
    points: const [
      'Booking and order confirmations reach your customers from WAMA CRM\'s WhatsApp number',
      'Bills and GST invoices, shared as a link',
      'Billing, sales and staff reports',
      'Works on this app and on the website',
      'Connect your own WhatsApp later for AI chat, campaigns and more',
    ],
    gain: 'You gain: a proper billing and booking system for ₹300 a month, no setup needed.',
  ),
];

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final PageController _pages = PageController(initialPage: widget.startPage);
  late int _page = widget.startPage;
  String _connector = 'salon';
  bool _ownWhatsApp = false;
  bool _busy = false;

  int get _last => _slides.length; // the pick page comes after the slides

  void _go(int page) => _pages.animateToPage(page, duration: const Duration(milliseconds: 280), curve: Curves.easeOut);

  Future<void> _finish() async {
    final app = AppScope.read(context);
    setState(() => _busy = true);
    try {
      await app.finishOnboarding(connector: _connector, ownWhatsApp: _ownWhatsApp);
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        for (var i = 0; i <= _last; i++)
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            margin: const EdgeInsets.only(right: 6),
                            width: i == _page ? 22 : 8,
                            height: 8,
                            decoration: BoxDecoration(color: i == _page ? Brand.blue : Brand.border, borderRadius: BorderRadius.circular(99)),
                          ),
                      ],
                    ),
                  ),
                  if (_page < _last) TextButton(onPressed: () => _go(_last), child: const Text('Skip')),
                ],
              ),
            ),
            Expanded(
              child: PageView(
                controller: _pages,
                onPageChanged: (i) => setState(() => _page = i),
                children: [for (final s in _slides) _slideView(s), _pickView(app)],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: _page < _last
                  ? Row(
                      children: [
                        if (_page > 0) ...[
                          Expanded(child: OutlinedButton(onPressed: () => _go(_page - 1), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), child: const Text('Back'))),
                          const SizedBox(width: 10),
                        ],
                        Expanded(flex: 2, child: FilledButton(onPressed: () => _go(_page + 1), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)), child: const Text('Next'))),
                      ],
                    )
                  : FilledButton(
                      onPressed: _busy ? null : _finish,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Start using the app'),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _slideView(_Slide s) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
    children: [
      Container(
        width: 64,
        height: 64,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(18)),
        child: s.icon,
      ),
      const SizedBox(height: 16),
      Text(s.eyebrow.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: Brand.blue)),
      const SizedBox(height: 4),
      Text(s.title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700, height: 1.2)),
      const SizedBox(height: 8),
      Text(s.intro, style: const TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.4)),
      const SizedBox(height: 16),
      for (final p in s.points)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.check_circle, size: 19, color: Brand.blue)),
              const SizedBox(width: 10),
              Expanded(child: Text(p, style: const TextStyle(fontSize: 15, height: 1.35))),
            ],
          ),
        ),
      const SizedBox(height: 6),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(14)),
        child: Text(s.gain, style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4)),
      ),
      if (s.team) ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.line)),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.campaign_outlined, color: Brand.blue),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Our team helps you grow: we run your Instagram, Facebook and Google ads and take care of your social media, with posts, reels and photos.',
                  style: TextStyle(height: 1.4, fontSize: 14),
                ),
              ),
            ],
          ),
        ),
      ],
    ],
  );

  Widget _pickView(AppState app) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
    children: [
      const Text('Pick what fits your business', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w700, height: 1.2)),
      const SizedBox(height: 6),
      const Text('Your 14-day free trial starts now. Change any of this later in More → Connectors and Billing.', style: TextStyle(color: Brand.textSoft, height: 1.4)),
      const SizedBox(height: 18),
      const Text('Which one do you need?', style: TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      _choice(
        on: _connector == 'salon',
        icon: const FrontDeskIcon(size: 24, color: Brand.blue),
        title: 'Front Desk',
        text: 'Bookings, bills and reviews',
        onTap: () => setState(() => _connector = 'salon'),
      ),
      const SizedBox(height: 8),
      _choice(
        on: _connector == 'ecommerce',
        icon: const Icon(Icons.shopping_bag_outlined, color: Brand.blue),
        title: 'E-commerce',
        text: 'Products, orders and your online store',
        onTap: () => setState(() => _connector = 'ecommerce'),
      ),
      const SizedBox(height: 18),
      const Text('Your WhatsApp', style: TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      _choice(
        on: !_ownWhatsApp,
        icon: const Icon(Icons.receipt_long_outlined, color: Brand.blue),
        title: 'Without WhatsApp · ₹300 a month',
        text: 'Confirmations from WAMA CRM\'s number, bills, invoices and reports',
        onTap: () => setState(() => _ownWhatsApp = false),
      ),
      const SizedBox(height: 8),
      _choice(
        on: _ownWhatsApp,
        icon: const Icon(Icons.chat_outlined, color: Brand.blue),
        title: 'With my own WhatsApp · Growth',
        text: 'Everything, plus AI chat, campaigns and templates. We connect your number for you.',
        onTap: () => setState(() => _ownWhatsApp = true),
      ),
      const SizedBox(height: 14),
      const Text('You pay only after the free trial. No card needed now.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: Brand.muted)),
    ],
  );

  Widget _choice({required bool on, required Widget icon, required String title, required String text, required VoidCallback onTap}) => Material(
    color: on ? Brand.blueSoft : Colors.white,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: on ? Brand.blue : Brand.line, width: on ? 1.5 : 1)),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            icon,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(text, style: const TextStyle(color: Brand.muted, fontSize: 13, height: 1.3)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(on ? Icons.radio_button_checked : Icons.radio_button_off, color: on ? Brand.blue : Brand.faint),
          ],
        ),
      ),
    ),
  );
}
