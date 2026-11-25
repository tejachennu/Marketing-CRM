import 'billing_screen.dart';
import 'grow_screen.dart';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../data/local_store.dart';
import '../../data/push.dart';
import '../../ui/front_desk_icon.dart';
import '../../ui/theme.dart';
import '../../ui/whatsapp_lock.dart';
import '../../ui/widgets.dart';
import '../ai/assistant_screen.dart';
import '../ai/knowledge_screen.dart';
import '../front_desk/booking_flow_screen.dart';
import '../front_desk/logic.dart';
import '../campaigns/campaigns_screen.dart';
import '../contacts/contacts_screen.dart';
import '../explainers/explainer_player.dart';
import '../front_desk/reviews_team.dart';
import '../front_desk/setup_screen.dart';
import '../instagram/instagram_screen.dart';
import '../store/store_screen.dart';
import 'chat_tickets_screen.dart';
import 'connectors_screen.dart';
import 'delete_account_screen.dart';

/// Account, workspace, templates and the sync status.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final user = app.me?['user'] ?? const {};
    void open(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('More')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                // You and your business, with the connector in use
                Container(
                  margin: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(18)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Avatar('${user['name'] ?? user['email'] ?? 'You'}', size: 58),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${user['name'] ?? 'You'}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                                const SizedBox(height: 2),
                                Text('${user['email'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.textSoft, fontSize: 13.5)),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _Chip(icon: Icons.business_outlined, text: app.orgName),
                          if ('${user['role'] ?? ''}'.trim().isNotEmpty) _Chip(icon: Icons.badge_outlined, text: '${user['role']}'.replaceAll('_', ' ')),
                          _Chip(
                            icon: Icons.extension_outlined,
                            text: connectorName(app) ?? 'No connector yet',
                            onTap: app.can('settings') ? () => open(const ConnectorsScreen()) : null,
                          ),
                          // Free trial: how long is left (tap to choose a plan)
                          if (app.trialDaysLeft != null)
                            _Chip(
                              icon: Icons.hourglass_top,
                              // Same words as the trial bar and Billing (1 = less than a day left)
                              text: app.trialDaysLeft! <= 1 ? 'Free trial · last day' : 'Free trial · ${app.trialDaysLeft} days left',
                              onTap: app.can('billing') ? () => open(const BillingScreen()) : null,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Starter has no own number by choice (WAMA's number sends its messages): not a problem, so not red
                if (!app.whatsappOn && app.sharedWhatsApp)
                  _Row(
                    icon: Icons.chat_outlined,
                    title: 'Your own WhatsApp comes with Growth',
                    subtitle: "Your messages go from WAMA's number. Growth adds chats, AI replies and campaigns.",
                    onTap: () => open(const WhatsAppLockedScreen(feature: 'WhatsApp')),
                  )
                else if (!app.whatsappOn)
                  _Row(
                    icon: Icons.lock_outline,
                    iconColor: Brand.red,
                    title: 'Connect your WhatsApp',
                    subtitle: 'Chats, campaigns and templates are locked until it is connected. Tap to contact us.',
                    onTap: () => open(const WhatsAppLockedScreen(feature: 'WhatsApp')),
                  ),
                const _Gap(),
                _Row(
                  icon: app.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                  iconColor: app.online ? Brand.blue : Brand.textSoft,
                  title: app.online ? 'Online' : 'Offline',
                  subtitle: app.waitingCount == 0 ? 'Everything is saved · synced ${formatAgo(app.lastSync)}' : '${app.waitingCount} change${app.waitingCount == 1 ? '' : 's'} waiting to sync',
                  onTap: () => Navigator.pushNamed(context, '/sync'),
                ),
                const _Gap(),
                _Row(
                  icon: Icons.trending_up,
                  iconColor: Brand.blue,
                  title: 'Grow your business with marketing',
                  subtitle: 'Google and Meta ads, photos, videos, Instagram',
                  onTap: () => open(const GrowScreen()),
                ),
                _Row(
                  icon: Icons.play_circle_outline,
                  iconColor: Brand.blue,
                  title: 'How we help your business',
                  subtitle: 'Short videos in English, తెలుగు, हिंदी',
                  onTap: () => open(const ExplainerLibraryScreen()),
                ),
                const _Gap(),
                _Row(icon: Icons.people_outline, title: 'Contacts', subtitle: '${(app.cached('contacts')?['contacts'] as List? ?? const []).length} people', onTap: () => open(const ContactsScreen())),
                if (app.can('campaigns'))
                  _Row(
                    icon: app.whatsappOn ? Icons.campaign_outlined : Icons.lock_outline,
                    title: 'Campaigns',
                    subtitle: app.whatsappOn ? 'Send a WhatsApp template to many customers' : 'Locked · connect WhatsApp first',
                    onTap: () => open(app.whatsappOn ? const CampaignsScreen() : const WhatsAppLockedScreen(feature: 'Campaigns')),
                  ),
                if (app.storeOn) _Row(icon: Icons.storefront_outlined, title: 'E-commerce', subtitle: 'Orders, products, payments and delivery', onTap: () => open(const StoreScreen())),
                _Row(icon: Icons.camera_alt_outlined, title: 'Instagram', subtitle: app.instagramOn ? 'Messages, comments, posts and auto replies' : 'Connect to see messages, comments and posts here', onTap: () => open(const InstagramScreen())),
                const _Gap(),
                const _Title('AI'),
                _Row(icon: Icons.menu_book_outlined, title: 'Knowledge base', subtitle: '${articlesOf(app).length} answers the AI uses', onTap: () => open(const KnowledgeScreen())),
                _Row(icon: Icons.smart_toy_outlined, title: 'Try the AI chatbot', subtitle: 'Ask like a customer, see its reply', onTap: () => open(const AssistantScreen())),
                if (app.frontDeskOn && app.can('manage')) ...[
                  const _Gap(),
                  const _Title('Front Desk'),
                  _Row(icon: Icons.star_outline_rounded, title: 'Reviews', subtitle: 'What customers said after their visit', onTap: () => open(const ReviewsScreen())),
                  _Row(icon: Icons.groups_outlined, title: 'Team', subtitle: 'Sales, services and commission for each person', onTap: () => open(const TeamScreen())),
                  _Row(
                    leading: const FrontDeskIcon(size: 24, color: Brand.textSoft),
                    title: 'Front Desk setup',
                    subtitle: 'Services, team, business details, WhatsApp, templates',
                    onTap: () => open(const SetupScreen()),
                  ),
                  _Row(
                    icon: app.whatsappOn ? Icons.event_available_outlined : Icons.lock_outline,
                    title: 'Booking flow on WhatsApp',
                    subtitle: !app.whatsappOn
                        ? 'Locked · connect WhatsApp first'
                        : ((FrontDesk(app).settings['booking_flow'] as Map?)?['enabled'] == true)
                        ? 'On · customers book in taps'
                        : 'Off · set it up',
                    onTap: () => open(app.whatsappOn ? const BookingFlowScreen() : const WhatsAppLockedScreen(feature: 'Booking flow on WhatsApp')),
                  ),
                ],
                const _Gap(),
                const _Title('Workspace'),
                _Row(
                  icon: app.whatsappOn ? Icons.description_outlined : Icons.lock_outline,
                  title: 'WhatsApp templates',
                  subtitle: app.whatsappOn ? 'Messages Meta has approved, for campaigns and replies' : 'Locked · connect WhatsApp first',
                  onTap: () => app.whatsappOn ? Navigator.pushNamed(context, '/templates') : open(const WhatsAppLockedScreen(feature: 'WhatsApp templates')),
                ),
                _Row(
                  icon: Icons.extension_outlined,
                  title: 'Connectors',
                  subtitle: '${connectorName(app) == null ? 'None in use' : 'In use: ${connectorName(app)}'} · one at a time',
                  onTap: () => open(const ConnectorsScreen()),
                ),
                if (app.can('settings'))
                  _Row(
                    icon: app.whatsappOn ? Icons.forum_outlined : Icons.lock_outline,
                    title: 'Chat and tickets',
                    subtitle: app.whatsappOn ? 'AI replies, chatbot instructions, ticket emails' : 'Locked · connect WhatsApp first',
                    onTap: () => open(app.whatsappOn ? const ChatTicketsScreen() : const WhatsAppLockedScreen(feature: 'Chat and tickets')),
                  ),
                _Row(icon: Icons.credit_card, title: 'Billing', subtitle: 'Plan, AI credit and payments', onTap: () => open(const BillingScreen())),
                _Row(
                  icon: Icons.notifications_active_outlined,
                  title: 'Test notifications',
                  subtitle: Push.instance.status == 'Checking…' ? 'Send a pop-up to this phone to check it works' : Push.instance.status,
                  onTap: () async {
                    toast(context, 'Sending a test…');
                    try {
                      await app.startPush();
                      final data = await app.ask('/api/mobile/push-test', const {});
                      if (context.mounted) toast(context, '${data['message'] ?? 'Sent.'}');
                    } catch (e) {
                      if (context.mounted) toast(context, '$e');
                    }
                  },
                ),
                const _Row(icon: Icons.language, title: 'Team members', subtitle: 'Invite and manage on the web'),
                const _Gap(),
                _Row(
                  icon: Icons.logout,
                  iconColor: Brand.red,
                  title: 'Sign out',
                  titleColor: Brand.red,
                  onTap: () async {
                    final waiting = app.waitingCount;
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Sign out?'),
                        content: Text(
                          waiting > 0
                              ? '$waiting change${waiting == 1 ? ' has' : 's have'} not synced yet and will be lost. Sync first if you can.'
                              : 'The copy of your data on this phone is removed.',
                        ),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                          TextButton(
                            onPressed: () => Navigator.pop(context, true),
                            style: TextButton.styleFrom(foregroundColor: Brand.red),
                            child: const Text('Sign out'),
                          ),
                        ],
                      ),
                    );
                    if (ok == true) await app.signOut();
                  },
                ),
                // Google Play: people who made an account can ask for it to be deleted from inside the app
                _Row(
                  icon: Icons.person_remove_outlined,
                  iconColor: Brand.red,
                  title: 'Delete my account',
                  titleColor: Brand.red,
                  subtitle: 'Ask us to delete your account and data',
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DeleteAccountScreen())),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The connector in use, by name (one at a time).
String? connectorName(AppState app) {
  final c = app.me?['connectors'] as Map?;
  if (c?['frontDesk'] == true) return 'Front Desk';
  if (c?['ecommerce'] == true) return 'E-commerce';
  if (c?['pipeline'] == true) return 'Sales Pipeline';
  return null;
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.text, this.onTap});
  final IconData icon;
  final String text;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(99),
    child: InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 6, 12, 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: Brand.blue),
            const SizedBox(width: 5),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 200),
              child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.text)),
            ),
            if (onTap != null) const Padding(padding: EdgeInsets.only(left: 2), child: Icon(Icons.chevron_right, size: 16, color: Brand.muted)),
          ],
        ),
      ),
    ),
  );
}

/// The light grey strip between groups.
class _Gap extends StatelessWidget {
  const _Gap();
  @override
  Widget build(BuildContext context) => Container(height: 8, color: Brand.page);
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 2),
    child: Text(
      text,
      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.muted),
    ),
  );
}

/// A settings row: icon, title and a line under it.
class _Row extends StatelessWidget {
  const _Row({this.icon, this.leading, required this.title, this.subtitle, this.onTap, this.iconColor = Brand.textSoft, this.titleColor});
  final IconData? icon;
  final Widget? leading;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color iconColor;
  final Color? titleColor;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
      child: Row(
        children: [
          // A soft tile behind the icon (red rows stay red)
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: iconColor == Brand.red ? Brand.redSoft : Brand.blueSoft, borderRadius: BorderRadius.circular(11)),
            alignment: Alignment.center,
            child: leading ?? Icon(icon, color: iconColor == Brand.textSoft ? Brand.blue : iconColor, size: 21),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: titleColor ?? Brand.text),
                ),
                if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: const TextStyle(fontSize: 13.5, color: Brand.muted, height: 1.3))],
              ],
            ),
          ),
          if (onTap != null && titleColor == null) const Icon(Icons.chevron_right, color: Brand.faint, size: 22),
        ],
      ),
    ),
  );
}

/// What is waiting to reach the server, what was refused and why, with Try again and Discard.
class SyncScreen extends StatelessWidget {
  const SyncScreen({super.key});

  IconData _icon(String kind) => switch (kind) {
    'bill' || 'checkout' || 'payment' || 'send' => Icons.receipt_long_outlined,
    'booking' || 'appointment' => Icons.event_note_outlined,
    'contact' => Icons.person_outline,
    'knowledge' => Icons.menu_book_outlined,
    'chat_setting' => Icons.smart_toy_outlined,
    'ticket' => Icons.confirmation_number_outlined,
    'settings' => Icons.tune,
    'message' => Icons.chat_bubble_outline,
    _ => Icons.campaign_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final items = app.outbox;
    final failed = items.where((i) => i.state == OutboxState.failed).toList();
    final waiting = items.where((i) => i.state != OutboxState.failed).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Sync')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(app.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined, color: app.online ? Brand.blue : Brand.textSoft, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(app.online ? 'Online' : 'No internet', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  app.online
                      ? 'Changes go to the server as you make them. Last full sync ${formatAgo(app.lastSync)}.'
                      : 'Keep working: bills, bookings, contacts, messages and campaigns are saved on this phone and sent in order when the internet is back.',
                  style: const TextStyle(color: Brand.textSoft, height: 1.4),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: app.syncing || app.refreshing ? null : () => app.syncNow(),
                  icon: app.syncing || app.refreshing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.sync),
                  label: Text(app.syncing || app.refreshing ? 'Syncing…' : 'Sync now'),
                ),
              ],
            ),
          ),
          if (failed.isNotEmpty) ...[SectionLabel('Could not be saved · ${failed.length}'), for (final item in failed) _ItemCard(item: item, icon: _icon(item.kind))],
          SectionLabel('Waiting to sync · ${waiting.length}'),
          if (waiting.isEmpty)
            const Panel(
              child: Text('Nothing waiting. Everything on this phone is on the server too.', style: TextStyle(color: Brand.muted)),
            ),
          for (final item in waiting) _ItemCard(item: item, icon: _icon(item.kind)),
        ],
      ),
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.icon});
  final OutboxItem item;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    final failed = item.state == OutboxState.failed;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(color: failed ? Brand.redSoft : Brand.page, borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, size: 20, color: failed ? Brand.red : Brand.navy),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text('Made ${formatAgo(item.createdAt)}${item.state == OutboxState.sending ? ' · sending…' : ''}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    ],
                  ),
                ),
              ],
            ),
            if (item.error != null) ...[
              const SizedBox(height: 10),
              Text(
                item.error!,
                style: TextStyle(color: failed ? Brand.red : Brand.textSoft, fontWeight: FontWeight.w600, fontSize: 13.5),
              ),
            ],
            if (failed) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        // Gone for good (with anything that depends on it), and it sits next to Try again: ask first
                        final ok = await showDialog<bool>(
                          context: context,
                          builder: (d) => AlertDialog(
                            title: const Text('Discard this change?'),
                            content: const Text('It will not be saved. This cannot be undone.'),
                            actions: [
                              TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep')),
                              TextButton(
                                onPressed: () => Navigator.pop(d, true),
                                style: TextButton.styleFrom(foregroundColor: Brand.red),
                                child: const Text('Discard'),
                              ),
                            ],
                          ),
                        );
                        if (ok == true) await app.discard(item);
                      },
                      child: const Text('Discard'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(onPressed: () => app.retry(item), child: const Text('Try again')),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
