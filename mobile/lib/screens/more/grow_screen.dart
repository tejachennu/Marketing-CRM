import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// "Grow your business": Magnetora's marketing services for businesses on WAMA (more Google
/// reviews, Google and Meta ads, photo and video, Instagram and Facebook promotion), with one tap
/// to WhatsApp the team.
const growWhatsApp = '918367629608';

class GrowScreen extends StatelessWidget {
  const GrowScreen({super.key});

  static const _services = [
    (Icons.star_rate_rounded, 'More Google reviews', 'We ask your happy customers at the right time, so your rating and reviews keep growing.'),
    (Icons.ads_click, 'Google and Meta ads', 'Ads on Google, Instagram and Facebook that bring calls, chats and bookings, within your budget.'),
    (Icons.videocam_outlined, 'Video editing', 'Reels and short videos of your work, edited to look professional.'),
    (Icons.photo_camera_outlined, 'Photos', 'Good photos of your shop, team and work for Google, Instagram and your catalog.'),
    (Icons.campaign_outlined, 'Instagram and Facebook promotion', 'Regular posts, offers and festival creatives that keep customers coming back.'),
    (Icons.hub_outlined, 'Everything in one place', 'WhatsApp, ads, reviews and content working together to grow your business.'),
  ];

  Future<void> _chat(BuildContext context) async {
    final app = AppScope.read(context);
    final text = 'Hi Magnetora, I use WAMA CRM (${app.orgName}). I want to grow my business with marketing. Please call me back.';
    final url = Uri.parse('https://wa.me/$growWhatsApp?text=${Uri.encodeComponent(text)}');
    final ok = await launchUrl(url, mode: LaunchMode.externalApplication).catchError((_) => false);
    if (!ok && context.mounted) toast(context, 'Could not open WhatsApp. Message us on +91 83676 29608.');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    appBar: AppBar(title: const Text('Grow your business')),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        // The offer, on WhatsApp's dark green
        Container(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 20),
          decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(20)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(20)),
                child: const Text(
                  'By Magnetora, the team behind WAMA',
                  style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'More reviews.\nMore customers.',
                style: TextStyle(color: Colors.white, fontSize: 26, height: 1.2, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                'We run your marketing end to end: Google reviews, ads on Google, Instagram and Facebook, and photos and videos of your work.',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.92), fontSize: 14.5, height: 1.4),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => _chat(context),
                style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Brand.blue, shape: const StadiumBorder()),
                icon: const Icon(Icons.chat_outlined),
                label: const Text('WhatsApp us', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const Text('What we do for you', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final (icon, title, text) in _services)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(color: Brand.bubble, shape: BoxShape.circle),
                  child: Icon(icon, color: Brand.blue, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text(text, style: const TextStyle(fontSize: 13.5, color: Brand.textSoft, height: 1.35)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(16)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Talk to us, no obligation', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text('Tell us about your business on WhatsApp. We will suggest a simple plan for your budget.', style: TextStyle(fontSize: 13.5, color: Brand.textSoft, height: 1.35)),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(onPressed: () => _chat(context), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp +91 83676 29608')),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
