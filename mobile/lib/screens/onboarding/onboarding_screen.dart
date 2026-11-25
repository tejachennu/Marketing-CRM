import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../auth/auth_parts.dart';
import '../explainers/explainer_content.dart';
import '../explainers/explainer_player.dart';

/// Right after sign-up (owner, 25 Nov 2026): what the two connectors give with the business's own WhatsApp, that our
/// team also runs their ads and social media, that both work without WhatsApp for ₹300 a month (confirmations from
/// WAMA CRM's number, bills, invoices and reports), and then the pick in two explained steps (owner: "make it two
/// steps and explain more"): 1. which connector, 2. with or without their own WhatsApp.
/// Each page has its own drawing (assets/images: desk, shop, nowa).
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.startPage = 0});

  /// Demo screenshots: open on this page.
  final int startPage;
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Slide {
  const _Slide({required this.picture, required this.pictureLabel, required this.tagIcon, required this.tag, required this.title, required this.intro, required this.points, required this.gain, required this.video, this.team = false});

  /// The drawing in assets/images, e.g. "desk" (360 × 232)
  final String picture;
  final String pictureLabel;
  final IconData tagIcon;
  final String tag;
  final String title;
  final String intro;
  final List<(IconData, String)> points;
  final String gain;

  /// Show "our team runs your ads and social media"
  final bool team;

  /// The explainer video that goes with this slide (explainers/explainer_content.dart)
  final String video;
}

const _slides = [
  _Slide(
    picture: 'desk',
    video: 'automation',
    pictureLabel: "A day's bookings, a reminder on WhatsApp and a paid bill",
    tagIcon: Icons.chat_outlined,
    tag: 'Connector 1 · with your own WhatsApp',
    title: 'Front Desk',
    intro: 'For salons, clinics, gyms, studios, service centres and any business that takes bookings.',
    points: [
      (Icons.event_available_outlined, 'Customers book on WhatsApp day and night, and the AI answers their questions'),
      (Icons.notifications_active_outlined, 'Reminders before every visit, so fewer people forget to come'),
      (Icons.receipt_long_outlined, 'Walk-in bills and GST invoices sent on WhatsApp'),
      (Icons.card_membership_outlined, 'Memberships, reviews, staff commission and daily reports'),
      (Icons.language_outlined, 'Your own website with a Book button'),
      (Icons.camera_alt_outlined, 'Instagram too: comments and DMs answered by AI, bookings from the chat'),
    ],
    gain: 'More bookings, fewer missed calls, and every visit and bill in one place.',
    team: true,
  ),
  _Slide(
    picture: 'shop',
    video: 'website',
    pictureLabel: 'An online store with products, an order paid by UPI and a parcel on the way',
    tagIcon: Icons.chat_outlined,
    tag: 'Connector 2 · with your own WhatsApp',
    title: 'E-commerce',
    intro: 'For shops, boutiques, restaurants and home businesses that sell products.',
    points: [
      (Icons.storefront_outlined, 'Your products inside WhatsApp and on your own online store'),
      (Icons.payments_outlined, 'Customers order and pay by UPI, card or cash on delivery'),
      (Icons.local_shipping_outlined, 'Order updates, courier tracking and cart reminders on WhatsApp'),
      (Icons.sell_outlined, 'Offers, GST invoices and sales reports'),
      (Icons.smart_toy_outlined, 'The AI answers product questions 24 × 7'),
      (Icons.camera_alt_outlined, 'Instagram too: comments and DMs answered by AI, orders from the chat'),
    ],
    gain: 'Sales on WhatsApp and online, from one app.',
    team: true,
  ),
  _Slide(
    picture: 'nowa',
    video: 'grow',
    pictureLabel: 'A booking confirmation, an invoice link and a sales report',
    tagIcon: Icons.bolt_outlined,
    tag: 'No WhatsApp Business yet?',
    title: 'Both work without WhatsApp, at ₹300 a month',
    intro: 'Start today with Front Desk or E-commerce, and connect your own WhatsApp whenever you are ready.',
    points: [
      (Icons.mark_chat_read_outlined, "Booking and order confirmations reach your customers from WAMA CRM's WhatsApp number"),
      (Icons.receipt_long_outlined, 'Bills and GST invoices, shared as a link'),
      (Icons.bar_chart_outlined, 'Billing, sales and staff reports'),
      (Icons.devices_outlined, 'Works on this app and on the website'),
      (Icons.link_outlined, 'Connect your own WhatsApp later for AI chat, campaigns and more'),
    ],
    gain: 'A proper billing and booking system for ₹300 a month, no setup needed.',
  ),
];

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final PageController _pages = PageController(initialPage: widget.startPage);
  late int _page = widget.startPage;
  String _connector = 'salon';
  bool _ownWhatsApp = false;
  bool _busy = false;

  /// Page 0: the explainer videos; then the slides; then step 1 (which connector) and step 2 (WhatsApp), the last page.
  int get _pickConnector => _slides.length + 1;
  int get _last => _slides.length + 2;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _go(int page) => _pages.animateToPage(page, duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);

  Future<void> _finish() async {
    final app = AppScope.read(context);
    setState(() => _busy = true);
    try {
      await app.finishOnboarding(connector: _connector, ownWhatsApp: _ownWhatsApp);
    } catch (e) {
      if (mounted) toast(context, friendlyAuthError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Android back goes to the page before, not out of the app
      canPop: _page == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_busy) _go(_page - 1);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 6, 8, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Semantics(
                        label: 'Page ${_page + 1} of ${_last + 1}',
                        child: Row(
                          children: [
                            for (var i = 0; i <= _last; i++)
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 220),
                                margin: const EdgeInsets.only(right: 6),
                                width: i == _page ? 24 : 8,
                                height: 8,
                                decoration: BoxDecoration(color: i == _page ? Brand.blue : (i < _page ? const Color(0xFF7CC5B4) : Brand.border), borderRadius: BorderRadius.circular(99)),
                              ),
                          ],
                        ),
                      ),
                    ),
                    // Keeps its place on the pick page so the dots do not jump
                    Opacity(
                      opacity: _page < _pickConnector ? 1 : 0,
                      child: TextButton(onPressed: _page < _pickConnector ? () => _go(_pickConnector) : null, style: TextButton.styleFrom(minimumSize: const Size(64, 48)), child: const Text('Skip')),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: PageView(
                  controller: _pages,
                  onPageChanged: (i) => setState(() => _page = i),
                  children: [_videosView(), for (final s in _slides) _slideView(s), _connectorView(), _whatsAppView()],
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 14),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Brand.lineSoft)),
                ),
                child: Row(
                  children: [
                    if (_page > 0) ...[
                      SizedBox(
                        width: 56,
                        height: 54,
                        child: OutlinedButton(
                          onPressed: _busy ? null : () => _go(_page - 1),
                          style: OutlinedButton.styleFrom(padding: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                          child: const Icon(Icons.arrow_back, semanticLabel: 'Back'),
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: _page < _last
                          ? BigButton(label: _page == _pickConnector ? 'Next: your WhatsApp' : 'Next', icon: Icons.arrow_forward, onPressed: () => _go(_page + 1))
                          : BigButton(label: 'Start using the app', busy: _busy, onPressed: _finish),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Page 0: what we do for them, as short videos in English, Telugu or Hindi (owner: "videos on the onboarding itself").
  Widget _videosView() => ExplainerGallery(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
    header: const Padding(
      padding: EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Welcome! Your free trial has started', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1.18, letterSpacing: -0.5, color: Brand.navy)),
          SizedBox(height: 8),
          Text(
            'Watch how we help you get more customers: ads, chats, auto replies and reminders. Each video is under a minute.',
            style: TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.42),
          ),
        ],
      ),
    ),
  );

  Widget _slideView(_Slide s) => LayoutBuilder(
    builder: (context, box) => ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      children: [
        Container(
          height: (box.maxHeight * 0.36).clamp(150.0, 260.0),
          padding: const EdgeInsets.fromLTRB(6, 10, 6, 6),
          decoration: BoxDecoration(color: const Color(0xFFF6FBF4), borderRadius: BorderRadius.circular(24)),
          child: AuthPicture(s.picture, aspect: 360 / 232, maxHeight: 250, semantic: s.pictureLabel),
        ),
        const SizedBox(height: 10),
        _WatchButton(video: s.video),
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerLeft,
          child: SoftPill(icon: s.tagIcon, label: s.tag),
        ),
        const SizedBox(height: 10),
        Text(s.title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1.18, letterSpacing: -0.5, color: Brand.navy)),
        const SizedBox(height: 8),
        Text(s.intro, style: const TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.42)),
        const SizedBox(height: 16),
        for (final (icon, text) in s.points)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, size: 18, color: Brand.blue),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(text, style: const TextStyle(fontSize: 15, height: 1.35, color: Brand.text)),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Brand.bubble, borderRadius: BorderRadius.circular(16)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.trending_up, color: Brand.blue, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'You gain: ', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF15603E))),
                      TextSpan(text: s.gain),
                    ],
                  ),
                  style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4, color: Brand.text),
                ),
              ),
            ],
          ),
        ),
        if (s.team) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.fromLTRB(10, 10, 14, 10),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
            child: Row(
              children: [
                const SizedBox(width: 76, child: AuthPicture('team', aspect: 120 / 88, maxHeight: 56)),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'Our team helps you grow: we run your Instagram, Facebook and Google ads and take care of your social media, with posts, reels and photos.',
                    style: TextStyle(height: 1.4, fontSize: 13.5, color: Brand.textSoft),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    ),
  );

  Widget _stepTitle(String step, String title, String text) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(step.toUpperCase(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: Brand.blue)),
      const SizedBox(height: 6),
      Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1.18, letterSpacing: -0.5, color: Brand.navy)),
      const SizedBox(height: 8),
      Text(text, style: const TextStyle(color: Brand.textSoft, height: 1.42, fontSize: 15)),
    ],
  );

  // ── Step 1 of 2: which connector ──

  Widget _connectorView() => ListView(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 18),
    children: [
      _stepTitle('Step 1 of 2', 'Pick what fits your business', 'Choose the app you want to start with. You use one at a time and can switch whenever you like, from More, then Connectors.'),
      const SizedBox(height: 18),
      _ConnectorCard(
        on: _connector == 'salon',
        picture: 'desk',
        icon: const FrontDeskIcon(size: 22, color: Brand.blue),
        title: 'Front Desk',
        bestFor: 'Salons, clinics, gyms, studios, repair and service centres',
        points: const [
          'Customers book on WhatsApp, with a reminder before each visit',
          'Walk-in bills and GST invoices in one tap',
          'Memberships, reviews, staff commission and daily reports',
        ],
        onTap: () => setState(() => _connector = 'salon'),
      ),
      const SizedBox(height: 12),
      _ConnectorCard(
        on: _connector == 'ecommerce',
        picture: 'shop',
        icon: const Icon(Icons.shopping_bag_outlined, size: 22, color: Brand.blue),
        title: 'E-commerce',
        bestFor: 'Shops, boutiques, restaurants and home businesses',
        points: const [
          'Your products on WhatsApp and on your own online store',
          'Orders paid by UPI, card or cash on delivery',
          'Delivery tracking, offers, GST invoices and sales reports',
        ],
        onTap: () => setState(() => _connector = 'ecommerce'),
      ),
    ],
  );

  // ── Step 2 of 2: with or without their own WhatsApp ──

  Widget _whatsAppView() => ListView(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 18),
    children: [
      _stepTitle(
        'Step 2 of 2',
        'How should WhatsApp messages go out?',
        'Your customers get booking confirmations, bills and updates on WhatsApp. Choose whose number sends them.',
      ),
      const SizedBox(height: 18),
      _PlanCard(
        on: !_ownWhatsApp,
        icon: Icons.receipt_long_outlined,
        title: 'Without WhatsApp',
        price: '₹300 a month',
        text: "Start today with nothing to set up. Messages go out from WAMA CRM's WhatsApp number, and each one names your business and gives your phone number.",
        included: const [
          "Booking and order confirmations from WAMA CRM's number",
          'Bills and GST invoices, shared as a link',
          'Sales, staff and order reports',
          'Up to 3 team members',
          "Each message costs Meta's price, paid from your message wallet, with nothing added",
        ],
        missing: const ['No chat inbox, AI replies or campaigns'],
        goodIf: 'you do not have WhatsApp Business yet, or want to start small.',
        onTap: () => setState(() => _ownWhatsApp = false),
      ),
      const SizedBox(height: 12),
      _PlanCard(
        on: _ownWhatsApp,
        icon: Icons.chat_outlined,
        title: 'With my own WhatsApp',
        price: 'Growth plan · ₹2,500 a month',
        text: 'Customers chat with your own business number, and your team answers them from one inbox in this app.',
        included: [
          'Your own WhatsApp number. We help you connect it',
          'Confirmations, bills and reminders sent from your number',
          indianLanguagesOn(AppScope.of(context)) ? 'Team inbox with AI replies in English, Telugu and Hindi' : "Team inbox with AI replies in your customers' languages",
          'Campaigns and message templates',
          '₹300 of AI credit every month, and ads help from our team',
          'Up to 5 team members',
        ],
        goodIf: 'customers already message your business on WhatsApp.',
        onTap: () => setState(() => _ownWhatsApp = true),
      ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(14)),
        child: const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.lightbulb_outline, size: 20, color: Brand.textSoft),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Not sure? Start without WhatsApp. You can connect your own number any time, and your bookings, bills and customers stay as they are.',
                style: TextStyle(fontSize: 13.5, height: 1.4, color: Brand.textSoft),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 14),
      const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.verified_user_outlined, size: 17, color: Brand.muted),
          SizedBox(width: 8),
          Expanded(
            child: Text('Your 14-day free trial starts now. You pay only after it ends. No card needed.', style: TextStyle(fontSize: 13, color: Brand.muted, height: 1.4)),
          ),
        ],
      ),
    ],
  );
}

/// A selectable card: soft green with a green edge when picked.
class _PickCard extends StatelessWidget {
  const _PickCard({required this.on, required this.onTap, required this.child});
  final bool on;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    button: true,
    child: Material(
      color: on ? const Color(0xFFF1FCEE) : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: on ? Brand.blue : Brand.line, width: on ? 1.8 : 1)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: child),
    ),
  );
}

Widget _tick(bool on) => AnimatedSwitcher(
  duration: const Duration(milliseconds: 160),
  child: Icon(on ? Icons.check_circle : Icons.radio_button_unchecked, key: ValueKey(on), color: on ? Brand.blue : Brand.faint, size: 26),
);

Widget _line(IconData icon, Color color, String text, {Color textColor = Brand.text}) => Padding(
  padding: const EdgeInsets.only(top: 7),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 17, color: color)),
      const SizedBox(width: 8),
      Expanded(child: Text(text, style: TextStyle(fontSize: 13.5, height: 1.35, color: textColor))),
    ],
  ),
);

/// Step 1: one connector with its picture, who it is for and what it gives.
class _ConnectorCard extends StatelessWidget {
  const _ConnectorCard({required this.on, required this.picture, required this.icon, required this.title, required this.bestFor, required this.points, required this.onTap});
  final bool on;
  final String picture;
  final Widget icon;
  final String title;
  final String bestFor;
  final List<String> points;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _PickCard(
    on: on,
    onTap: onTap,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          height: 118,
          color: on ? const Color(0xFFE3F8DE) : const Color(0xFFF6FBF4),
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
          child: AuthPicture(picture, aspect: 360 / 232, maxHeight: 110),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  icon,
                  const SizedBox(width: 8),
                  Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18, color: Brand.text))),
                  _tick(on),
                ],
              ),
              const SizedBox(height: 6),
              Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(text: 'Best for: ', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.textSoft)),
                    TextSpan(text: bestFor),
                  ],
                ),
                style: const TextStyle(fontSize: 13.5, height: 1.35, color: Brand.muted),
              ),
              const SizedBox(height: 4),
              for (final p in points) _line(Icons.check, Brand.blue, p),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Step 2: a way to send WhatsApp messages, with its price, what is in it, what is not, and who it suits.
class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.on, required this.icon, required this.title, required this.price, required this.text, required this.included, this.missing = const [], required this.goodIf, required this.onTap});
  final bool on;
  final IconData icon;
  final String title;
  final String price;
  final String text;
  final List<String> included;
  final List<String> missing;
  final String goodIf;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _PickCard(
    on: on,
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: on ? Colors.white : Brand.blueSoft, borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, size: 22, color: Brand.blue),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17, color: Brand.text)),
                    const SizedBox(height: 5),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                      decoration: BoxDecoration(color: on ? Brand.blue : Brand.blueSoft, borderRadius: BorderRadius.circular(99)),
                      child: Text(price, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: on ? Colors.white : const Color(0xFF15603E))),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              _tick(on),
            ],
          ),
          const SizedBox(height: 10),
          Text(text, style: const TextStyle(fontSize: 14, height: 1.4, color: Brand.textSoft)),
          const SizedBox(height: 4),
          for (final p in included) _line(Icons.check, Brand.blue, p),
          for (final p in missing) _line(Icons.remove_circle_outline, Brand.faint, p, textColor: Brand.muted),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(color: on ? Colors.white : Brand.page, borderRadius: BorderRadius.circular(10)),
            child: Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: 'Good if ', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.textSoft)),
                  TextSpan(text: goodIf),
                ],
              ),
              style: const TextStyle(fontSize: 13, height: 1.35, color: Brand.textSoft),
            ),
          ),
        ],
      ),
    ),
  );
}

/// "▶ Watch: Things that happen by themselves · 27 sec" under a slide's picture.
class _WatchButton extends StatelessWidget {
  const _WatchButton({required this.video});
  final String video;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final ex = explainers.firstWhere((e) => e.id == video, orElse: () => explainers.first);
    // The videos' words are in English (the voice follows the language picked)
    const lang = 'en';
    return Material(
      color: const Color(0xFF0B141A),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => openExplainer(context, ex.id),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
                child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 24),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '${VideoWords.watch.of(lang)}: ${ex.title.of(lang)}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14, height: 1.25),
                ),
              ),
              const SizedBox(width: 8),
              Text('${secondsFor(ex, indianLanguagesOn(app))} ${VideoWords.seconds.of(lang)}', style: const TextStyle(color: Color(0xBFFFFFFF), fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}
