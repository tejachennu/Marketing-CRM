import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_screen.dart';

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
  Map<String, dynamic>? _s;
  String? _link;
  bool _storeOn = true;
  List<Map<String, dynamic>> _categories = [];
  String _error = '';
  bool _saving = false;
  String? _uploading;
  final Map<String, TextEditingController> _text = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
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
      setState(() {
        _s = Map<String, dynamic>.from(data['settings'] as Map);
        _s!['banners'] = [for (final b in (_s!['banners'] as List? ?? const [])) Map<String, dynamic>.from(b as Map)];
        _link = data['link'] as String?;
        _storeOn = data['storeOn'] != false;
        _categories = [for (final c in (data['categories'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)];
      });
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  Future<String?> _pickPicture(String key) async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp']);
    if (file == null || !mounted) return null;
    setState(() => _uploading = key);
    try {
      final bytes = await file.readAsBytes();
      if (!mounted) return null;
      final data = await AppScope.read(context).uploadFile(bytes, file.name);
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
                    onTap: () => setState(() => s['colour'] = _hex(c)),
                    customBorder: const CircleBorder(),
                    child: CircleAvatar(
                      radius: 18,
                      backgroundColor: Color(c),
                      child: s['colour'] == _hex(c) ? const Icon(Icons.check, color: Colors.white, size: 18) : null,
                    ),
                  ),
              ],
            ),
          ]),
          _section('Banners (slide at the top)', subtitle: 'Wide photos work best. A tap can open a category.', [
            for (var i = 0; i < banners.length; i++)
              Container(
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
          ]),
          _section('Contact and about', [
            PhoneField(value: '${s['whatsapp'] ?? ''}', onChanged: (v) => s['whatsapp'] = v, label: 'WhatsApp number'),
            gap(),
            PhoneField(value: '${s['phone'] ?? ''}', onChanged: (v) => s['phone'] = v, label: 'Phone to call'),
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
