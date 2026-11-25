import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';
import '../../data/app_state.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../store/online_payments.dart';
import 'setup_screen.dart';

/// Front Desk → Setup → Website and booking, as on the web: the business website on/off and its link, words,
/// colour, photos, what it shows, Instagram posts, the AI chat, the buttons it shows (Call, WhatsApp, Book now, Shop
/// online, Directions and map) and paying when booking (at the shop, online, or the customer's choice; full or an
/// advance). Saved with PUT /api/salon/website. Without appointments there is no booking: Book now shows as not
/// available and the booking payment card is hidden.
class WebsiteSettingsScreen extends StatefulWidget {
  const WebsiteSettingsScreen({super.key});
  @override
  State<WebsiteSettingsScreen> createState() => _WebsiteSettingsScreenState();
}

const siteColours = ['#1D5BEA', '#0E1B3D', '#7A2E4D', '#0F6E6E', '#8A4B2A', '#111827'];
const advanceChoices = [10, 20, 25, 30, 50, 100];

/// The website's call-to-action buttons (lib/salon/website.ts SITE_BUTTONS): key, name, what it covers.
const siteButtonChoices = [
  ('call', 'Call', 'Call buttons and your phone number'),
  ('whatsapp', 'WhatsApp', '"WhatsApp us" buttons'),
  ('book', 'Book now', 'Book buttons and the booking form'),
  ('shop', 'Shop online', 'The link to your online store'),
  ('directions', 'Directions and map', '"Get directions" and the map'),
];

/// Why a button cannot show even when it is switched on (as buttonBlocker on the web); null when it can.
String? siteButtonBlocker(String key, {required bool bookings, required bool store, required bool phone, required bool address}) {
  if (key == 'book' && !bookings) return 'Appointments are off (Setup → Appointments), so there is nothing to book.';
  if (key == 'shop' && !store) return 'Your online store is off.';
  if ((key == 'call' || key == 'whatsapp') && !phone) return 'Add a phone number in Business details first.';
  if (key == 'directions' && !address) return 'Add an address in Business details first.';
  return null;
}

Color _hex(String hex) => Color(int.parse('FF${hex.replaceAll('#', '')}', radix: 16));

class _WebsiteSettingsScreenState extends State<WebsiteSettingsScreen> {
  Map<String, dynamic>? _site;
  Map<String, dynamic> _meta = const {};
  String _saved = '';
  String _error = '';
  bool _saving = false;
  String? _uploading;
  final _tagline = TextEditingController();
  final _about = TextEditingController();
  final _instagram = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final c in [_tagline, _about, _instagram]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/salon/website', {'organizationId': app.orgId});
      if (!mounted) return;
      final site = Map<String, dynamic>.from(data['site'] as Map? ?? const {});
      setState(() {
        _error = '';
        _site = site;
        _meta = data;
        _tagline.text = '${site['tagline'] ?? ''}';
        _about.text = '${site['about'] ?? ''}';
        _instagram.text = '${site['instagram'] ?? ''}';
        _saved = _snapshot();
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  String _snapshot() => '${_site.toString()}|${_tagline.text}|${_about.text}|${_instagram.text}';
  void _set(String key, Object? value) => setState(() => _site = {..._site!, key: value});
  Map<String, dynamic> get _show => Map<String, dynamic>.from(_site?['show'] as Map? ?? const {});
  Map<String, dynamic> get _pay => Map<String, dynamic>.from(_site?['bookingPay'] as Map? ?? const {'mode': 'shop', 'advance': 100});
  Map<String, dynamic> get _buttons => Map<String, dynamic>.from(_site?['buttons'] as Map? ?? const {});

  String get _link {
    final domain = '${_meta['domain'] ?? ''}';
    if (domain.isNotEmpty && (_meta['storeOn'] != true || _site?['domainShows'] == 'website')) return 'https://$domain';
    return '${AppConfig.apiBase}/v/${_meta['slug'] ?? ''}';
  }

  Future<void> _pickPhoto(String target) async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp']);
    if (file == null || !mounted) return;
    setState(() => _uploading = target);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 4 * 1024 * 1024) throw Exception('Photos can be up to 4 MB.');
      if (!mounted) return;
      final data = await AppScope.read(context).uploadFile(bytes, file.name);
      final url = '${data['url'] ?? ''}';
      if (!url.startsWith('https://')) throw Exception('The photo could not be uploaded. Try a smaller JPG or PNG.');
      if (target == 'cover') {
        _set('cover', url);
      } else {
        _set('gallery', [...(_site!['gallery'] as List? ?? const []), url].take(12).toList());
      }
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final site = {..._site!, 'tagline': _tagline.text.trim(), 'about': _about.text.trim(), 'instagram': _instagram.text.trim()};
      final data = await AppScope.read(context).ask('/api/salon/website', {'site': site}, method: 'PUT');
      if (!mounted) return;
      setState(() {
        _site = Map<String, dynamic>.from(data['site'] as Map? ?? site);
        _saved = _snapshot();
      });
      toast(context, 'Website saved.');
    } catch (e) {
      if (mounted) toast(context, '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final canEdit = app.can('manage');
    // Appointments off: no booking on the website (the server's answer, else the phone's setting)
    final bookings = _meta['takesAppointments'] is bool ? _meta['takesAppointments'] == true : app.takesAppointments;
    final screenTitle = bookings ? 'Website and booking' : 'Website';
    final s = _site;
    if (s == null) {
      return Scaffold(
        appBar: AppBar(title: Text(screenTitle)),
        body: _error.isNotEmpty
            ? EmptyState(
                icon: Icons.cloud_off,
                title: 'Could not load',
                text: _error,
                action: OutlinedButton(
                  onPressed: () {
                    setState(() => _error = '');
                    _load();
                  },
                  child: const Text('Try again'),
                ),
              )
            : const SkeletonCards(),
      );
    }
    final dirty = _snapshot() != _saved;
    final gallery = [for (final g in (s['gallery'] as List? ?? const [])) '$g'];
    final ig = Map<String, dynamic>.from(_meta['instagram'] as Map? ?? const {});
    final pay = _pay;
    final chatProblem = '${_meta['chatProblem'] ?? ''}';
    Widget card(List<Widget> children) => Padding(padding: const EdgeInsets.only(bottom: 12), child: Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)));
    Widget title(String t) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(t, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)));
    Widget toggle(String label, bool value, ValueChanged<bool> onChanged, {String? sub}) =>
        SwitchListTile(value: value, onChanged: canEdit ? onChanged : null, contentPadding: EdgeInsets.zero, title: Text(label), subtitle: sub == null ? null : Text(sub));
    // Back or a swipe with changes not saved asks first
    return DiscardGuard(
      changed: canEdit && dirty && !_saving,
      child: Scaffold(
        backgroundColor: Brand.page,
        appBar: AppBar(title: Text(screenTitle)),
        bottomNavigationBar: canEdit
            ? SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
                  child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: !dirty || _saving ? null : _save, child: Text(_saving ? 'Saving…' : dirty ? 'Save website' : 'Saved')),
                ),
              )
            : null,
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            card([
              Row(children: [const Expanded(child: Text('Your website', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), Switch(value: s['enabled'] != false, onChanged: canEdit ? (v) => _set('enabled', v) : null)]),
              Text(
                bookings ? 'Services and prices with Book, your team, photos, reviews, hours and a map. Customers book and pay right there.' : 'Services and prices, your team, photos, reviews, hours and a map.',
                style: const TextStyle(color: Brand.textSoft, fontSize: 13.5),
              ),
              const SizedBox(height: 10),
              Text(_link.replaceFirst(RegExp(r'^https?://'), ''), style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(onPressed: () => launchUrl(Uri.parse(_link), mode: LaunchMode.externalApplication), icon: const Icon(Icons.open_in_new, size: 18), label: const Text('Open')),
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: _link));
                      toast(context, 'Link copied.');
                    },
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text('Copy'),
                  ),
                  OutlinedButton.icon(onPressed: () => SharePlus.instance.share(ShareParams(text: _link)), icon: const Icon(Icons.share, size: 18), label: const Text('Share')),
                ],
              ),
            ]),
            card([
              title('How it looks'),
              TextField(controller: _tagline, enabled: canEdit, maxLength: 140, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'One line about you', hintText: 'Hair, skin and bridal studio in Banjara Hills')),
              TextField(controller: _about, enabled: canEdit, maxLength: 1500, minLines: 3, maxLines: 6, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'About your business (optional)')),
              const SizedBox(height: 6),
              const Text('Colour', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final c in siteColours)
                    GestureDetector(
                      onTap: canEdit ? () => _set('colour', c) : null,
                      child: Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(color: _hex(c), shape: BoxShape.circle, border: Border.all(color: '${s['colour']}'.toUpperCase() == c ? Brand.text : Colors.transparent, width: 3)),
                        child: '${s['colour']}'.toUpperCase() == c ? const Icon(Icons.check, color: Colors.white, size: 18) : null,
                      ),
                    ),
                ],
              ),
            ]),
            card([
              title('Photos (${gallery.length}/12)'),
              Row(
                children: [
                  Container(
                    width: 120,
                    height: 72,
                    decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(8), image: '${s['cover'] ?? ''}'.isNotEmpty ? DecorationImage(image: NetworkImage('${s['cover']}'), fit: BoxFit.cover) : null),
                    alignment: Alignment.center,
                    child: '${s['cover'] ?? ''}'.isEmpty ? const Text('No cover', style: TextStyle(color: Colors.white70, fontSize: 12)) : null,
                  ),
                  const SizedBox(width: 12),
                  if (canEdit) Expanded(child: OutlinedButton(onPressed: _uploading != null ? null : () => _pickPhoto('cover'), child: Text(_uploading == 'cover' ? 'Uploading…' : '${s['cover'] ?? ''}'.isEmpty ? 'Add a cover photo' : 'Change cover'))),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final g in gallery)
                    Stack(
                      children: [
                        ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(g, width: 76, height: 76, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(width: 76, height: 76, color: Brand.lineSoft))),
                        if (canEdit)
                          Positioned(
                            right: 2,
                            top: 2,
                            child: GestureDetector(
                              onTap: () => _set('gallery', gallery.where((x) => x != g).toList()),
                              child: const CircleAvatar(radius: 12, backgroundColor: Colors.white, child: Icon(Icons.close, size: 15, color: Brand.red)),
                            ),
                          ),
                      ],
                    ),
                  if (canEdit && gallery.length < 12)
                    InkWell(
                      onTap: _uploading != null ? null : () => _pickPhoto('gallery'),
                      child: Container(
                        width: 76,
                        height: 76,
                        decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(8)),
                        child: _uploading == 'gallery' ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))) : const Icon(Icons.add_a_photo_outlined, color: Brand.muted),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              toggle('Show my latest Instagram posts', s['instagramLive'] == true, (v) => _set('instagramLive', v), sub: ig['connected'] == true ? 'From @${ig['username']}, by themselves (new posts within 30 minutes).' : 'Connect Instagram first (Settings → Instagram on the web).'),
            ]),
            card([
              title('What to show'),
              for (final (key, label) in [('prices', 'Prices of services'), ('team', bookings ? 'Your team, with Book with each person' : 'Your team'), ('memberships', 'Memberships'), ('reviews', 'Customer reviews')])
                toggle(label, _show[key] != false, (v) => _set('show', {..._show, key: v})),
              TextField(controller: _instagram, enabled: canEdit, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Instagram (optional)', hintText: '@yourstudio')),
              const SizedBox(height: 6),
              toggle('AI chat on your website', s['chat'] != false, (v) => _set('chat', v), sub: bookings ? 'Answers visitors from your services, prices, timings and Knowledge Base; checks a customer\'s booking.' : 'Answers visitors from your services, prices, timings and Knowledge Base.'),
              if (s['chat'] != false && chatProblem.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(8)),
                  child: Text('The chat is hidden on your website: $chatProblem', style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600, fontSize: 13)),
                ),
            ]),
            card([
              title('Buttons on your website'),
              const Text('Switch off any button you do not want customers to see. It goes from every place on the page.', style: TextStyle(color: Brand.textSoft, fontSize: 13.5)),
              const SizedBox(height: 4),
              for (final (key, label, hint) in siteButtonChoices)
                // Shop online only when the online store is on
                if (key != 'shop' || _meta['storeOn'] == true)
                  Builder(
                    builder: (context) {
                      final unavailable = key == 'book' && !bookings;
                      final blocker = siteButtonBlocker(key, bookings: bookings, store: _meta['storeOn'] == true, phone: _meta['hasPhone'] != false, address: _meta['hasAddress'] != false);
                      final on = _buttons[key] != false;
                      return SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: on && !unavailable,
                        onChanged: canEdit && !unavailable ? (v) => _set('buttons', {..._buttons, key: v}) : null,
                        title: Text(label, style: TextStyle(color: unavailable ? Brand.faint : null)),
                        subtitle: Text(blocker != null && on ? '$hint\n$blocker' : hint),
                        isThreeLine: blocker != null && on,
                      );
                    },
                  ),
            ]),
            if (bookings)
            card([
              title('Payment when booking'),
              const Text('An online payment keeps the time for 30 minutes; once paid, the booking is confirmed on WhatsApp and the amount is taken off the bill.', style: TextStyle(color: Brand.textSoft, fontSize: 13.5)),
              const SizedBox(height: 10),
              for (final (mode, label, sub) in const [('shop', 'Pay at the shop', 'No online payment'), ('choice', 'Customer chooses', 'Pay now or at the shop'), ('online', 'Pay online to book', 'Fewer no-shows')])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  onTap: canEdit ? () => _set('bookingPay', {...pay, 'mode': mode}) : null,
                  leading: Icon(pay['mode'] == mode ? Icons.radio_button_checked : Icons.radio_button_off, color: pay['mode'] == mode ? Brand.blue : Brand.faint),
                  title: Text(label),
                  subtitle: Text(sub),
                ),
              if (pay['mode'] != 'shop') ...[
                const SizedBox(height: 6),
                const Text('How much is paid online', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final n in advanceChoices)
                      ChoiceChip(label: Text(n == 100 ? 'Full amount' : '$n% advance'), selected: (pay['advance'] ?? 100) == n, onSelected: canEdit ? (_) => _set('bookingPay', {...pay, 'advance': n}) : null),
                  ],
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OnlinePaymentsScreen())),
                  icon: const Icon(Icons.account_balance_wallet_outlined),
                  label: const Text('Online payment: Razorpay or Stripe'),
                ),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}
