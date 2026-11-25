import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_address.dart';
import 'store_logic.dart';
import 'store_screen.dart';
import 'online_payments.dart';

const _colours = [0xFF1D5BEA, 0xFF0E1B3D, 0xFF008069, 0xFFB45309, 0xFFBE185D, 0xFF6D28D9, 0xFF0F766E, 0xFFB91C1C];
String _hex(int c) => '#${(c & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

/// The online store website (as on the web's E-commerce → Website): on or off, its link, the look,
/// banners, categories, ordering, contact. Same API as the web.
class WebsiteScreen extends StatefulWidget {
  const WebsiteScreen({super.key});
  @override
  State<WebsiteScreen> createState() => _WebsiteScreenState();
}

class _WebsiteScreenState extends State<WebsiteScreen> {
  final _igLink = TextEditingController();
  Map<String, dynamic>? _s;
  String? _link;
  bool _storeOn = true;
  List<Map<String, dynamic>> _categories = [];
  String _error = '';
  bool _saving = false;
  String? _uploading;
  final Map<String, TextEditingController> _text = {};
  Map<String, dynamic>? _pay;
  final _keyId = TextEditingController();
  final _keySecret = TextEditingController();
  final _webhookSecret = TextEditingController();
  bool _payBusy = false;

  Map<String, dynamic>? _suggested;
  bool _prefilled = false;

  /// Counts "Fill blanks", so the phone boxes are built again with the numbers it filled in.
  int _fills = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// Pictures we made follow the store colour; the business's own photos are left alone.
  String _recolour(String url, String colour) => madePicture(url) == null ? url : url.replaceFirstMapped(RegExp(r'([?&]c=)[0-9A-Fa-f]{6}'), (m) => '${m[1]}${colour.replaceFirst('#', '')}');

  void _setColour(String colour) {
    final s = _s!;
    s['colour'] = colour;
    s['logo'] = _recolour('${s['logo'] ?? ''}', colour);
    for (final b in (s['banners'] as List).cast<Map<String, dynamic>>()) {
      b['image'] = _recolour('${b['image'] ?? ''}', colour);
    }
    for (final c in _categories) {
      c['image'] = _recolour('${c['image'] ?? ''}', colour);
    }
  }

  /// Fill every blank part from the business's details (nothing typed is replaced).
  void _fillBlanks() {
    final g = _suggested;
    final s = _s;
    if (g == null || s == null) return;
    setState(() {
      _fills++;
      for (final key in const ['title', 'tagline', 'logo', 'announcement', 'delivery_note', 'whatsapp', 'phone', 'address', 'about']) {
        final typed = (_text[key]?.text ?? '${s[key] ?? ''}').trim();
        if (typed.isEmpty && '${g[key] ?? ''}'.isNotEmpty) {
          s[key] = g[key];
          _text[key]?.text = '${g[key]}';
        }
      }
      for (final key in const ['delivery_fee', 'free_delivery_from']) {
        final typed = (_text[key]?.text ?? '${s[key] ?? ''}').trim();
        if ((typed.isEmpty || typed == 'null') && g[key] != null) {
          s[key] = g[key];
          _text[key]?.text = '${g[key]}';
        }
      }
      if ((s['banners'] as List).isEmpty) {
        s['banners'] = [for (final b in (g['banners'] as List? ?? const [])) Map<String, dynamic>.from(b as Map)];
      }
      for (final c in _categories) {
        if ('${c['image'] ?? ''}'.isNotEmpty) continue;
        for (final m in (g['categories'] as List? ?? const [])) {
          if ('${(m as Map)['name']}'.toLowerCase() == '${c['name']}'.toLowerCase()) c['image'] = m['image'];
        }
      }
    });
    toast(context, 'Filled from your business details. Check and Save.');
  }

  @override
  void dispose() {
    _keyId.dispose();
    _keySecret.dispose();
    _webhookSecret.dispose();
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _field(String key) => _text.putIfAbsent(key, () => TextEditingController(text: '${_s?[key] ?? ''}'));

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/commerce/storefront', {'organizationId': app.orgId});
      if (!mounted) return;
      final pay = await app.backend.get('/api/commerce/storefront/payments', {'organizationId': app.orgId}).catchError((_) => <String, dynamic>{});
      if (!mounted) return;
      setState(() {
        _pay = pay['error'] == null ? pay : null;
        _keyId.text = '${pay['keyId'] ?? ''}';
        _s = Map<String, dynamic>.from(data['settings'] as Map);
        _s!['banners'] = [for (final b in (_s!['banners'] as List? ?? const [])) Map<String, dynamic>.from(b as Map)];
        _link = data['link'] as String?;
        _storeOn = data['storeOn'] != false;
        _categories = [for (final c in (data['categories'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)];
        _suggested = data['suggested'] is Map ? Map<String, dynamic>.from(data['suggested'] as Map) : null;
        _prefilled = data['prefilled'] == true;
      });
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  /// Read the payment accounts again (after the Online payment screen), leaving the rest as typed.
  Future<void> _loadPay() async {
    final app = AppScope.read(context);
    try {
      final pay = await app.backend.get('/api/commerce/storefront/payments', {'organizationId': app.orgId});
      if (!mounted) return;
      setState(() {
        _pay = pay['error'] == null ? pay : null;
        _keyId.text = '${pay['keyId'] ?? ''}';
      });
    } catch (_) {}
  }

  Future<void> _connect() async {
    setState(() => _payBusy = true);
    try {
      final data = await AppScope.read(context).ask('/api/commerce/storefront/payments', {
        'keyId': _keyId.text.trim(),
        'keySecret': _keySecret.text.trim(),
        if (_webhookSecret.text.trim().isNotEmpty) 'webhookSecret': _webhookSecret.text.trim(),
      }, method: 'PUT');
      if (!mounted) return;
      setState(() {
        _pay = data;
        _keySecret.clear();
        _webhookSecret.clear();
        if (_s!['payment'] == 'later' || _s!['payment'] == null) _s!['payment'] = 'both';
      });
      toast(context, 'Razorpay connected${data['live'] == true ? '' : ' in test mode (no real money)'}. Save the website to use it.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _payBusy = false);
    }
  }

  Future<void> _disconnect() async {
    final app = AppScope.read(context);
    final ok = await confirmAction(
      context,
      title: 'Disconnect Razorpay?',
      message: 'Customers cannot pay online with Razorpay until you connect it again, and you will need your Key Secret again.',
      yes: 'Disconnect',
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _payBusy = true);
    try {
      final data = await app.backend.send('DELETE', '/api/commerce/storefront/payments?organizationId=${app.orgId}', const {});
      if (!mounted) return;
      setState(() {
        _pay = data;
        _keyId.clear();
        _s!['payment'] = 'later';
      });
      toast(context, 'Razorpay disconnected. Customers pay on delivery or pick up.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _payBusy = false);
    }
  }

  Future<String?> _pickPicture(String key) async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp']);
    if (file == null || !mounted) return null;
    setState(() => _uploading = key);
    try {
      // Phone camera photos are often over the 4 MB an upload can carry: made smaller first
      final (bytes, name) = await fitPhoto(await file.readAsBytes(), file.name);
      if (!mounted) return null;
      final data = await AppScope.read(context).uploadFile(bytes, name);
      final url = '${data['url'] ?? ''}';
      if (!url.startsWith('https://')) throw Exception('The picture could not be uploaded. Try a smaller JPG or PNG.');
      return url;
    } catch (e) {
      if (mounted) toast(context, plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Future<void> _save() async {
    final s = _s!;
    for (final key in ['title', 'tagline', 'announcement', 'delivery_note', 'address', 'about']) {
      s[key] = _field(key).text;
    }
    num? amount(String key) => _field(key).text.trim().isEmpty ? null : num.tryParse(_field(key).text.trim());
    s['delivery_fee'] = amount('delivery_fee');
    s['free_delivery_from'] = amount('free_delivery_from');
    s['min_order'] = amount('min_order') ?? 0;
    s['categories'] = [
      for (final c in _categories) {'name': c['name'], 'image': c['image'] ?? ''},
    ];
    setState(() => _saving = true);
    try {
      final data = await AppScope.read(context).ask('/api/commerce/storefront', {'settings': s}, method: 'PUT');
      if (!mounted) return;
      setState(() => _link = data['link'] as String? ?? _link);
      toast(context, data['settings']?['enabled'] == true ? 'Saved. Your online store is live.' : 'Saved. Your online store is switched off.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _picture(String key, String value, ValueChanged<String> onChange, {bool wide = false}) => InkWell(
    onTap: () async {
      final url = await _pickPicture(key);
      if (url != null) setState(() => onChange(url));
    },
    borderRadius: BorderRadius.circular(10),
    child: Container(
      width: wide ? 120 : 56,
      height: wide ? 68 : 56,
      decoration: BoxDecoration(
        color: Brand.lineSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Brand.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: _uploading == key
          ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
          : value.isEmpty
          ? const Icon(Icons.add_photo_alternate_outlined, color: Brand.faint)
          : madePicture(value) != null
          ? Container(
              color: madePicture(value),
              alignment: Alignment.center,
              child: const Icon(Icons.auto_awesome, color: Colors.white, size: 20),
            )
          : Image.network(
              value,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, color: Brand.faint),
            ),
    ),
  );

  Widget _section(String title, List<Widget> children, {String subtitle = ''}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          if (subtitle.isNotEmpty) Text(subtitle, style: const TextStyle(color: Brand.muted, fontSize: 13)),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = _s;
    final manage = AppScope.of(context).can('manage');
    if (s == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Online store website')),
        body: Center(
          child: _error.isEmpty ? const CircularProgressIndicator() : EmptyState(icon: Icons.language, title: 'Could not be loaded', text: _error),
        ),
      );
    }
    final banners = (s['banners'] as List).cast<Map<String, dynamic>>();
    Widget gap() => const SizedBox(height: 10);
    return Scaffold(
      appBar: AppBar(title: const Text('Online store website')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
        children: [
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: SwitchListTile(
              value: s['enabled'] == true,
              onChanged: manage ? (v) => setState(() => s['enabled'] = v) : null,
              title: const Text('Online store website', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('Your shop page with banners, categories and products. Customers order for pick up or delivery; orders come to Orders as “Website”.'),
            ),
          ),
          if (!_storeOn) const NoteBox(attention: true, icon: Icons.pause_circle_outline, text: 'Your store is switched off in the Store tab, so the website shows nothing until you switch it on.'),
          if (_link != null)
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_link!.replaceFirst(RegExp('^https?://'), ''), style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () async {
                          await Clipboard.setData(ClipboardData(text: _link!));
                          if (context.mounted) toast(context, 'Link copied.');
                        },
                        icon: const Icon(Icons.copy, size: 18),
                        label: const Text('Copy'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => SharePlus.instance.share(ShareParams(text: _link!)),
                        icon: const Icon(Icons.share, size: 18),
                        label: const Text('Share'),
                      ),
                      OutlinedButton.icon(onPressed: () => openLink(context, _link!), icon: const Icon(Icons.open_in_new, size: 18), label: const Text('Open')),
                    ],
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          StoreAddressCard(canManage: AppScope.of(context).can('settings')),
          if (manage && _suggested != null) ...[
            const SizedBox(height: 12),
            Panel(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.auto_awesome, color: Brand.blue),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_prefilled ? 'Filled in from your business details' : 'Fill from your business details', style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        Text(
                          _prefilled
                              ? 'Name, logo, contact, delivery charges, categories and banners come from your workspace and products. Pictures are made for you where you have no photo. Check them and tap Save.'
                              : 'Fills any blank part from your workspace and products. What you typed stays.',
                          style: const TextStyle(color: Brand.muted, fontSize: 13),
                        ),
                        if (!_prefilled) ...[const SizedBox(height: 8), OutlinedButton.icon(onPressed: _fillBlanks, icon: const Icon(Icons.auto_awesome, size: 18), label: const Text('Fill blanks'))],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          _section('Look', [
            TextField(
              controller: _field('title'),
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Store name', counterText: ''),
            ),
            gap(),
            TextField(
              controller: _field('tagline'),
              maxLength: 160,
              decoration: const InputDecoration(labelText: 'Line under the name', counterText: ''),
            ),
            gap(),
            TextField(
              controller: _field('announcement'),
              maxLength: 140,
              decoration: const InputDecoration(labelText: 'Strip at the top (optional)', hintText: 'Free delivery on orders above ₹999', counterText: ''),
            ),
            gap(),
            Row(
              children: [
                _picture('logo', '${s['logo'] ?? ''}', (url) => s['logo'] = url),
                const SizedBox(width: 12),
                const Expanded(child: Text('Logo (tap to upload)')),
                if ('${s['logo'] ?? ''}'.isNotEmpty) TextButton(onPressed: () => setState(() => s['logo'] = ''), child: const Text('Remove')),
              ],
            ),
            gap(),
            const Text('Colour', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final c in _colours)
                  InkWell(
                    onTap: () => setState(() => _setColour(_hex(c))),
                    customBorder: const CircleBorder(),
                    child: CircleAvatar(
                      radius: 18,
                      backgroundColor: Color(c),
                      child: s['colour'] == _hex(c) ? const Icon(Icons.check, color: Colors.white, size: 18) : null,
                    ),
                  ),
              ],
            ),
            gap(),
            const Text('How products are shown', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            RadioGroup<String>(
              groupValue: '${s['layout'] ?? 'grid'}',
              onChanged: (v) => setState(() => s['layout'] = v ?? 'grid'),
              child: Column(
                children: [
                  for (final l in storeLayouts.entries)
                    RadioListTile<String>(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: l.key,
                      title: Text(l.value.$1, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(l.value.$2),
                    ),
                ],
              ),
            ),
          ]),
          _section('Instagram on your store', subtitle: 'Shown above the footer. On Instagram open a post, tap ⋯ → Copy link, and paste it here (up to 9).', [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: (s['instagram'] as Map?)?['live'] == true,
              onChanged: (v) => setState(() => s['instagram'] = {...((s['instagram'] as Map?) ?? const {'handle': '', 'posts': []}), 'live': v}),
              title: const Text('Show my latest posts by themselves', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Needs Instagram connected. The links below are used when this is off.'),
            ),
            TextFormField(
              initialValue: '${(s['instagram'] as Map?)?['handle'] ?? ''}',
              decoration: const InputDecoration(labelText: 'Your Instagram name (optional)', prefixText: '@'),
              onChanged: (v) => s['instagram'] = {...((s['instagram'] as Map?) ?? const {'posts': []}), 'handle': v.replaceAll('@', '').trim()},
            ),
            const SizedBox(height: 8),
            for (final post in ((s['instagram'] as Map?)?['posts'] as List? ?? const []).cast<String>())
              Row(children: [
                Expanded(child: Text('instagram.com/$post', overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.blue))),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: Brand.red),
                  onPressed: () => setState(() => s['instagram'] = {...(s['instagram'] as Map), 'posts': ((s['instagram'] as Map)['posts'] as List).where((p) => p != post).toList()}),
                ),
              ]),
            TextField(
              controller: _igLink,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                labelText: 'Post or reel link',
                hintText: 'https://www.instagram.com/p/…',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.add),
                  onPressed: () {
                    final post = instagramPost(_igLink.text);
                    if (post == null) { toast(context, 'Paste the link of an Instagram post or reel.'); return; }
                    final ig = Map<String, dynamic>.from((s['instagram'] as Map?) ?? const {'handle': ''});
                    final posts = [...((ig['posts'] as List?) ?? const []).cast<String>()];
                    if (!posts.contains(post) && posts.length < 9) posts.add(post);
                    setState(() { s['instagram'] = {...ig, 'posts': posts}; _igLink.clear(); });
                  },
                ),
              ),
            ),
          ]),
          _section('Banners (slide at the top)', subtitle: 'Wide photos work best. A tap can open a category.', [
            for (var i = 0; i < banners.length; i++)
              Container(
                // Keyed by the banner itself, so its words move with it when one is removed or moved up
                key: ObjectKey(banners[i]),
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  border: Border.all(color: Brand.line),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        _picture('banner$i', '${banners[i]['image'] ?? ''}', (url) => banners[i]['image'] = url, wide: true),
                        const Spacer(),
                        IconButton(tooltip: 'Move up', onPressed: i == 0 ? null : () => setState(() => banners.insert(i - 1, banners.removeAt(i))), icon: const Icon(Icons.arrow_upward)),
                        IconButton(
                          tooltip: 'Remove',
                          onPressed: () => setState(() => banners.removeAt(i)),
                          icon: const Icon(Icons.delete_outline, color: Brand.red),
                        ),
                      ],
                    ),
                    if ('${banners[i]['image'] ?? ''}'.isEmpty)
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Add a picture, or this banner is left out.', style: TextStyle(color: Brand.red, fontSize: 12.5)),
                      ),
                    gap(),
                    TextFormField(
                      initialValue: '${banners[i]['title'] ?? ''}',
                      maxLength: 60,
                      onChanged: (v) => banners[i]['title'] = v,
                      decoration: const InputDecoration(labelText: 'Big words (optional)', counterText: ''),
                    ),
                    gap(),
                    TextFormField(
                      initialValue: '${banners[i]['text'] ?? ''}',
                      maxLength: 140,
                      onChanged: (v) => banners[i]['text'] = v,
                      decoration: const InputDecoration(labelText: 'Small words (optional)', counterText: ''),
                    ),
                    gap(),
                    TextFormField(
                      initialValue: '${banners[i]['button'] ?? ''}',
                      maxLength: 24,
                      onChanged: (v) => banners[i]['button'] = v,
                      decoration: const InputDecoration(labelText: 'Button, e.g. Shop now (optional)', counterText: ''),
                    ),
                    gap(),
                    DropdownButtonFormField<String>(
                      initialValue: _categories.any((c) => c['name'] == banners[i]['category']) ? '${banners[i]['category']}' : '',
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'A tap opens'),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('Nothing')),
                        for (final c in _categories)
                          DropdownMenuItem(
                            value: '${c['name']}',
                            child: Text('${c['name']}', overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) => setState(() => banners[i]['category'] = v ?? ''),
                    ),
                  ],
                ),
              ),
            if (banners.length < 8)
              OutlinedButton.icon(
                onPressed: () => setState(() => banners.add({'image': '', 'title': '', 'text': '', 'button': '', 'category': '', 'link': ''})),
                icon: const Icon(Icons.add),
                label: const Text('Add banner'),
              ),
          ]),
          _section('Categories', subtitle: 'From your products. Set the order and a picture for each.', [
            if (_categories.isEmpty) const Text('Add products with a category first.', style: TextStyle(color: Brand.muted)),
            for (var i = 0; i < _categories.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    _picture('cat$i', '${_categories[i]['image'] ?? ''}', (url) => _categories[i]['image'] = url),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${_categories[i]['name']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    IconButton(tooltip: 'Move up', onPressed: i == 0 ? null : () => setState(() => _categories.insert(i - 1, _categories.removeAt(i))), icon: const Icon(Icons.arrow_upward)),
                    IconButton(
                      tooltip: 'Move down',
                      onPressed: i == _categories.length - 1 ? null : () => setState(() => _categories.insert(i + 1, _categories.removeAt(i))),
                      icon: const Icon(Icons.arrow_downward),
                    ),
                  ],
                ),
              ),
          ]),
          _section('Ordering', subtitle: 'Customers pay when they get the order or pick it up.', [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: s['pickup'] != false,
              onChanged: (v) => setState(() => s['pickup'] = v || s['delivery'] == false),
              title: const Text('Customers can pick up'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: s['delivery'] != false,
              onChanged: (v) => setState(() => s['delivery'] = v || s['pickup'] == false),
              title: const Text('You deliver'),
            ),
            if (s['delivery'] != false) ...[
              TextField(
                controller: _field('delivery_fee'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Delivery charge', hintText: 'Same as Store settings'),
              ),
              gap(),
              TextField(
                controller: _field('free_delivery_from'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Free delivery from', hintText: 'Same as Store settings'),
              ),
              gap(),
              TextField(
                controller: _field('delivery_note'),
                maxLength: 400,
                maxLines: 3,
                minLines: 1,
                decoration: const InputDecoration(labelText: 'Delivery note (areas, times)', counterText: ''),
              ),
              gap(),
            ],
            TextField(
              controller: _field('min_order'),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Smallest order (optional)'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: s['show_out_of_stock'] == true,
              onChanged: (v) => setState(() => s['show_out_of_stock'] = v),
              title: const Text('Show out-of-stock products (greyed out)'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: s['accounts'] != false,
              onChanged: (v) => setState(() => s['accounts'] = v),
              title: const Text('Customers can sign in with Google'),
              subtitle: const Text('They see their orders and where each one is, and keep their cart. Anyone can still order without signing in.'),
            ),
          ]),
          if (manage)
            _section(
              'Online payment (Razorpay)',
              subtitle: 'Customers pay by UPI, card or net banking on your website. The money goes straight to your own Razorpay account; Razorpay charges its fee (about 2%).',
              [
                if (_pay?['connected'] == true)
                  Row(
                    children: [
                      Expanded(
                        child: Text('Connected · ${_pay!['keyId']}${_pay!['live'] == true ? '' : ' (test mode: no real money)'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                      TextButton(onPressed: _payBusy ? null : _disconnect, child: const Text('Disconnect')),
                    ],
                  )
                else
                  const Text('In Razorpay, open Account & Settings → API Keys → Generate key. Paste both here.', style: TextStyle(color: Brand.muted, fontSize: 13)),
                gap(),
                TextField(
                  controller: _keyId,
                  decoration: const InputDecoration(labelText: 'Key ID', hintText: 'rzp_live_…'),
                ),
                gap(),
                TextField(
                  controller: _keySecret,
                  obscureText: true,
                  decoration: InputDecoration(labelText: _pay?['connected'] == true ? 'Key Secret (leave empty to keep)' : 'Key Secret'),
                ),
                gap(),
                TextField(
                  controller: _webhookSecret,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: 'Webhook secret (recommended)',
                    helperText: _pay?['webhookUrl'] != null ? 'In Razorpay → Webhooks, add ${_pay!['webhookUrl']} with payment.captured and order.paid, and the same secret.' : null,
                    helperMaxLines: 4,
                  ),
                ),
                gap(),
                FilledButton(onPressed: _payBusy ? null : _connect, child: Text(_pay?['connected'] == true ? 'Save keys' : 'Connect Razorpay')),
                TextButton.icon(
                  onPressed: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OnlinePaymentsScreen()));
                    // Only the payment accounts can change there: unsaved website edits stay
                    _loadPay();
                  },
                  icon: const Icon(Icons.credit_card),
                  label: const Text('Stripe too, and which one customers pay with'),
                ),
                const SizedBox(height: 14),
                const Text('Payment options on your website', style: TextStyle(fontWeight: FontWeight.w600)),
                const Text('Customers see only the ones switched on. Keep at least one on.', style: TextStyle(color: Brand.muted, fontSize: 13)),
                Builder(
                  builder: (context) {
                    final connected = _pay?['connected'] == true;
                    final cod = (s['payment'] ?? 'later') != 'online';
                    final now = connected && (s['payment'] ?? 'later') != 'later';
                    void pick(bool nextCod, bool nextNow) {
                      if (!nextCod && !nextNow) return toast(context, 'Keep at least one way to pay switched on.');
                      setState(() => s['payment'] = nextCod && nextNow ? 'both' : (nextNow ? 'online' : 'later'));
                    }

                    return Column(
                      children: [
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: cod,
                          onChanged: (v) => pick(v, now),
                          title: const Text('Cash on delivery'),
                          subtitle: const Text('Pay when the order arrives, or at pick up'),
                        ),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: now,
                          onChanged: connected ? (v) => pick(cod, v) : null,
                          title: const Text('Pay now'),
                          subtitle: Text(connected ? 'UPI, card or net banking with Razorpay' : 'Connect Razorpay above first'),
                        ),
                      ],
                    );
                  },
                ),
              ],
            ),
          _section('Contact and about', [
            PhoneField(key: ValueKey('wa$_fills'), value: '${s['whatsapp'] ?? ''}', onChanged: (v) => s['whatsapp'] = v, label: 'WhatsApp number'),
            gap(),
            PhoneField(key: ValueKey('ph$_fills'), value: '${s['phone'] ?? ''}', onChanged: (v) => s['phone'] = v, label: 'Phone to call'),
            gap(),
            TextField(
              controller: _field('address'),
              maxLength: 300,
              maxLines: 3,
              minLines: 1,
              decoration: const InputDecoration(labelText: 'Shop address (also the pick-up place)', counterText: ''),
            ),
            gap(),
            TextField(
              controller: _field('about'),
              maxLength: 1200,
              maxLines: 5,
              minLines: 2,
              decoration: const InputDecoration(labelText: 'About your shop', counterText: ''),
            ),
          ]),
          _section('Info pages', subtitle: 'Linked at the bottom of your store. Razorpay and Google look for Returns, Shipping, Terms and Privacy. Leave one empty to hide it.', [
            for (final (key, title) in storeInfoPages)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: TextFormField(
                  initialValue: '${(s['pages'] as Map?)?[key] ?? ''}',
                  maxLength: 6000,
                  minLines: 2,
                  maxLines: 8,
                  decoration: InputDecoration(labelText: title, counterText: ''),
                  onChanged: (v) => s['pages'] = {...((s['pages'] as Map?) ?? const {}), key: v},
                ),
              ),
          ]),
          if (manage)
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save website'),
            ),
        ],
      ),
    );
  }
}
