import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../campaigns/audience.dart' show phoneDigits;
import 'store_logic.dart';
import 'store_screen.dart';

const _maxCollection = 30;

/// Products, as on the web: search, availability and catalog filters, sync with the WhatsApp catalog,
/// add the ones not in it yet, add / edit / remove, and send a product, a few, or the whole catalog.
class ProductsTab extends StatefulWidget {
  const ProductsTab({super.key, required this.store});
  final StoreScreenState store;
  @override
  State<ProductsTab> createState() => _ProductsTabState();
}

class _ProductsTabState extends State<ProductsTab> with AutomaticKeepAliveClientMixin {
  static const pageSize = 24;
  String _search = '';
  String _availability = 'all';
  String _catalog = 'all';
  Timer? _debounce;
  Timer? _settle;
  int _settleTries = 0;
  List<Map<String, dynamic>>? _products;
  Map<String, dynamic> _counts = const {'sending': 0, 'attention': 0, 'notSent': 0};
  int _page = 1, _pages = 1, _total = 0;
  bool _loading = false, _syncing = false, _pushing = false;
  String _error = '';
  int _ask = 0;
  final Map<String, Map<String, dynamic>> _picked = {};

  @override
  bool get wantKeepAlive => true;

  StoreSetup get _setup => StoreSetup(widget.store.org!);
  bool get _catalogLinked => _setup.catalogLinked && _setup.whatsappConnected;

  @override
  void initState() {
    super.initState();
    _load(1).then((_) {
      // Changes made in Commerce Manager are brought in when the list opens (quietly)
      if (mounted && _catalogLinked && AppScope.read(context).can('manage')) unawaited(_sync(quiet: true));
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _settle?.cancel();
    super.dispose();
  }

  Future<void> _load(int page, {bool silent = false}) async {
    final app = AppScope.read(context);
    final ask = ++_ask;
    if (!silent) setState(() => _loading = true);
    try {
      final data = await app.backend.get('/api/commerce/products', {
        'organizationId': app.orgId,
        'page': '$page',
        'limit': '$pageSize',
        'availability': _availability,
        if (_search.isNotEmpty) 'search': _search,
        if (_catalogLinked) 'counts': '1',
        if (_catalogLinked && _catalog != 'all') 'catalog': _catalog,
      });
      if (!mounted || ask != _ask) return;
      final pagination = (data['pagination'] as Map?) ?? const {};
      setState(() {
        _products = [for (final p in (data['products'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
        _page = page;
        _pages = (pagination['pages'] as num?)?.toInt() ?? 1;
        _total = (pagination['total'] as num?)?.toInt() ?? 0;
        if (data['catalog'] is Map) _counts = Map<String, dynamic>.from(data['catalog'] as Map);
        _error = '';
      });
      if (_search.isEmpty && _availability == 'all' && _catalog == 'all') widget.store.setProductCount(_total);
      _watchSending();
    } catch (e) {
      if (mounted && ask == _ask && !silent) setState(() => _error = plain(e));
    } finally {
      if (mounted && ask == _ask) setState(() => _loading = false);
    }
  }

  /// Meta processes catalog changes in the background: while some are outstanding, ask how they went.
  void _watchSending() {
    _settle?.cancel();
    if (!AppScope.read(context).can('manage') || !_catalogLinked || ((_counts['sending'] as num?) ?? 0) == 0 || _settleTries >= 12) return;
    _settle = Timer(const Duration(seconds: 30), () async {
      _settleTries++;
      try {
        await AppScope.read(context).ask('/api/commerce/products', {'action': 'refresh_catalog'});
      } catch (_) {}
      if (mounted) await _load(_page, silent: true);
    });
  }

  Future<void> _sync({bool quiet = false}) async {
    setState(() => _syncing = true);
    try {
      final data = await AppScope.read(context).ask('/api/commerce/products', {'action': 'sync_meta'});
      _settleTries = 0;
      await _load(1, silent: true);
      if (quiet || !mounted) return;
      final removed = (data['removed'] as num? ?? 0) > 0 ? ' ${data['removed']} no longer in the catalog removed.' : '';
      final skipped = (data['skipped'] as num? ?? 0) > 0 ? ' ${data['skipped']} with your own changes left as they are.' : '';
      if (data['error'] != null) {
        toast(context, 'Synced ${data['synced'] ?? 0} of ${data['total'] ?? 0} products. Some could not be saved: ${data['error']}');
      } else {
        toast(context, '${data['synced'] ?? 0} product${data['synced'] == 1 ? '' : 's'} synced from your WhatsApp catalog.$removed$skipped');
      }
    } catch (e) {
      if (!quiet && mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _pushToCatalog() async {
    setState(() => _pushing = true);
    try {
      final data = await AppScope.read(context).ask('/api/commerce/products', {'action': 'push_meta'});
      _settleTries = 0;
      await _load(_page, silent: true);
      if (!mounted) return;
      if (data['requestError'] != null && (data['sent'] ?? 0) == 0) {
        await showMessage(context, 'Nothing was added to your catalog', '${data['requestError']}');
        return;
      }
      if ((data['sent'] ?? 0) > 0) toast(context, '${data['sent']} product${data['sent'] == 1 ? '' : 's'} sent to your WhatsApp catalog. They usually appear within a few minutes.');
      if ((data['rejected'] ?? 0) > 0) {
        final examples = (data['problems'] as List? ?? const []).map((p) => '• ${p['title']}: ${(p['errors'] as List).first}').join('\n');
        await showMessage(context, '${data['rejected']} product${data['rejected'] == 1 ? ' was' : 's were'} not added', '$examples\n\nChoose “Needs attention” to see and fix them.');
      } else if ((data['sent'] ?? 0) == 0) {
        toast(context, 'Every product is already in your WhatsApp catalog.');
      }
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _pushing = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? product]) async {
    final saved = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => ProductFormScreen(product: product, currency: '${widget.store.org?['currency'] ?? 'INR'}', catalogLinked: _catalogLinked),
      ),
    );
    if (saved == null || !mounted) return;
    _settleTries = 0;
    if (_picked.containsKey(saved['id'])) _picked[saved['id']] = saved;
    await _load(product == null ? 1 : _page, silent: true);
  }

  Future<void> _remove(Map<String, dynamic> product) async {
    final ok = await confirmAction(
      context,
      title: 'Remove this product?',
      message: _catalogLinked && isInCatalog(product)
          ? '“${product['title']}” will be removed here and from your WhatsApp catalog, so customers can no longer order it. To stop selling it for a while, edit it and switch off “Available to sell” instead. Orders that already have it keep their details.'
          : '“${product['title']}” will be removed. Orders that already have it keep their details.',
      yes: 'Remove',
      destructive: true,
    );
    if (!ok || !mounted) return;
    final app = AppScope.read(context);
    try {
      final data = await app.backend.send('DELETE', '/api/commerce/products?organizationId=${app.orgId}&id=${product['id']}', const {});
      if (data['inCatalog'] == true && data['catalogRemoved'] != true && mounted) {
        toast(context, 'Removed here, but it is still in your WhatsApp catalog${data['catalogError'] != null ? ': ${data['catalogError']}' : '.'} The next sync brings it back.');
      }
      _picked.remove(product['id']);
      await _load(_page, silent: true);
    } catch (e) {
      if (mounted) toast(context, plain(e));
    }
  }

  void _togglePick(Map<String, dynamic> product) {
    setState(() {
      if (_picked.containsKey(product['id'])) {
        _picked.remove(product['id']);
      } else if (_picked.length >= _maxCollection) {
        toast(context, 'WhatsApp shows at most $_maxCollection products in one message.');
      } else {
        _picked['${product['id']}'] = product;
      }
    });
  }

  Future<void> _share(ShareTarget target) async {
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => ShareScreen(target: target, catalogLinked: _catalogLinked),
      ),
    );
    if (sent == true && target.kind == 'collection' && mounted) setState(_picked.clear);
  }

  void _productSheet(Map<String, dynamic> product) {
    final app = AppScope.read(context);
    final sync = catalogSync(product);
    final issues = [...(sync?['errors'] as List? ?? const []), ...(sync?['warnings'] as List? ?? const [])];
    final state = catalogState(product);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  ProductImage(product['image_url'], size: 64, faded: !inStock(product)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${product['title']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                        Text(formatMoney(product['price'], product['currency']), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                        Text('SKU ${product['retailer_id']}${'${product['category'] ?? ''}'.isNotEmpty ? ' · ${product['category']}' : ''}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (!inStock(product)) Pill(product['is_available'] == false ? 'Unavailable' : 'Out of stock'),
                  if (_catalogLinked || state != 'not_sent')
                    Pill(catalogStateLabel(product), tone: state == 'rejected' || state == 'error' ? PillTone.red : (state == 'in_catalog' ? PillTone.blue : PillTone.grey)),
                ],
              ),
              if (issues.isNotEmpty) ...[const SizedBox(height: 10), NoteBox(attention: true, icon: Icons.error_outline, text: 'Your WhatsApp catalog said:\n${issues.map((i) => '• $i').join('\n')}')],
              if (state == 'rejected')
                const NoteBox(
                  attention: true,
                  icon: Icons.error_outline,
                  text: 'WhatsApp reviewed this item and did not approve it. Check it against the WhatsApp Commerce Policy in Commerce Manager.',
                ),
              if ('${product['description'] ?? ''}'.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('${product['description']}', style: const TextStyle(color: Brand.textSoft)),
                ),
              const SizedBox(height: 14),
              if (app.can('write'))
                FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _share(ShareTarget.product(product));
                  },
                  icon: const Icon(Icons.send),
                  label: const Text('Send to a customer'),
                ),
              if (app.can('manage')) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(sheet);
                    _edit(product);
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                  onPressed: () {
                    Navigator.pop(sheet);
                    _remove(product);
                  },
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Remove'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final app = AppScope.of(context);
    final manage = app.can('manage');
    final canEdit = app.can('write');
    final products = _products;
    final notSent = (_counts['notSent'] as num?)?.toInt() ?? 0;
    final filtered = _search.isNotEmpty || _availability != 'all' || _catalog != 'all';
    return Scaffold(
      backgroundColor: Brand.page,
      bottomNavigationBar: _picked.isEmpty
          ? null
          : SafeArea(
              child: Container(
                color: Brand.navy,
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_picked.length} selected to send together',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                      ),
                    ),
                    TextButton(
                      onPressed: () => setState(_picked.clear),
                      child: const Text('Clear', style: TextStyle(color: Colors.white70)),
                    ),
                    FilledButton.icon(onPressed: () => _share(ShareTarget.collection(_picked.values.toList())), icon: const Icon(Icons.send, size: 18), label: const Text('Send')),
                  ],
                ),
              ),
            ),
      body: RefreshIndicator(
        onRefresh: () => _load(_page),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 32),
          children: [
            SearchField(
              hint: 'Search by name or SKU',
              padding: const EdgeInsets.fromLTRB(0, 8, 0, 4),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), () {
                  _search = v.trim();
                  _load(1);
                });
              },
            ),
            FilterChips(
              padding: const EdgeInsets.symmetric(vertical: 6),
              children: [
                for (final (id, label) in [('all', 'All'), ('available', 'Available'), ('unavailable', 'Unavailable')])
                  ChoiceChip(
                    label: Text(label),
                    selected: _availability == id,
                    onSelected: (_) {
                      setState(() => _availability = id);
                      _load(1);
                    },
                  ),
                if (_catalogLinked) ...[
                  ChoiceChip(
                    label: Text('Needs attention${(_counts['attention'] ?? 0) > 0 ? ' ${_counts['attention']}' : ''}'),
                    selected: _catalog == 'attention',
                    onSelected: (on) {
                      setState(() => _catalog = on ? 'attention' : 'all');
                      _load(1);
                    },
                  ),
                  ChoiceChip(
                    label: Text('Not in catalog${notSent > 0 ? ' $notSent' : ''}'),
                    selected: _catalog == 'not_sent',
                    onSelected: (on) {
                      setState(() => _catalog = on ? 'not_sent' : 'all');
                      _load(1);
                    },
                  ),
                ],
              ],
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (manage) FilledButton.icon(onPressed: () => _edit(), icon: const Icon(Icons.add, size: 18), label: const Text('Add product')),
                if (canEdit && _catalogLinked)
                  OutlinedButton.icon(onPressed: () => _share(const ShareTarget.catalog()), icon: const Icon(Icons.menu_book_outlined, size: 18), label: const Text('Send catalog')),
                if (manage && _catalogLinked && notSent > 0)
                  OutlinedButton.icon(
                    onPressed: _pushing ? null : _pushToCatalog,
                    icon: _pushing ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.cloud_upload_outlined, size: 18),
                    label: Text(_pushing ? 'Sending…' : 'Add $notSent to catalog'),
                  ),
                if (manage)
                  OutlinedButton.icon(
                    onPressed: _syncing || !_catalogLinked ? null : () => _sync(),
                    icon: _syncing ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.sync, size: 18),
                    label: Text(_syncing ? 'Syncing…' : 'Sync catalog'),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            if (_error.isNotEmpty)
              NoteBox(
                attention: true,
                icon: Icons.error_outline,
                text: 'Products could not be loaded: $_error',
                action: TextButton(onPressed: () => _load(_page), child: const Text('Try again')),
              ),
            if (products == null)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (products.isEmpty)
              EmptyState(
                icon: Icons.shopping_bag_outlined,
                title: filtered ? 'No products match' : 'No products yet',
                text: filtered
                    ? 'Try a different name, SKU or filter.'
                    : _catalogLinked
                    ? 'Add a product here, or tap “Sync catalog” to list what is already in your WhatsApp catalog.'
                    : 'Link your Meta catalog in the Store tab to sell in WhatsApp, or add a product to share as a website link.',
              )
            else
              Card(
                child: Column(
                  children: [
                    for (var i = 0; i < products.length; i++) ...[if (i > 0) const Divider(height: 1, indent: 76), _row(products[i], canEdit)],
                  ],
                ),
              ),
            if (_pages > 1)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text('Page $_page of $_pages · $_total products', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                    ),
                    IconButton(onPressed: _page > 1 && !_loading ? () => _load(_page - 1) : null, icon: const Icon(Icons.chevron_left)),
                    IconButton(onPressed: _page < _pages && !_loading ? () => _load(_page + 1) : null, icon: const Icon(Icons.chevron_right)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(Map<String, dynamic> product, bool canEdit) {
    final state = catalogState(product);
    final available = inStock(product);
    final canPick = canEdit && _catalogLinked && available;
    final picked = _picked.containsKey(product['id']);
    return InkWell(
      onTap: () => _productSheet(product),
      onLongPress: canPick ? () => _togglePick(product) : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
        child: Row(
          children: [
            ProductImage(product['image_url'], size: 52, faded: !available),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${product['title']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                  ),
                  Text(
                    '${formatMoney(product['price'], product['currency'])} · SKU ${product['retailer_id']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Brand.textSoft, fontSize: 13),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      if (!available) Pill(product['is_available'] == false ? 'Unavailable' : 'Out of stock'),
                      if (_catalogLinked || state != 'not_sent')
                        Pill(catalogStateLabel(product), tone: state == 'rejected' || state == 'error' ? PillTone.red : (state == 'in_catalog' ? PillTone.blue : PillTone.grey)),
                    ],
                  ),
                ],
              ),
            ),
            if (canPick) Checkbox(value: picked, onChanged: (_) => _togglePick(product)),
          ],
        ),
      ),
    );
  }
}

// ── Add or edit a product ──

class ProductFormScreen extends StatefulWidget {
  const ProductFormScreen({super.key, this.product, required this.currency, required this.catalogLinked});
  final Map<String, dynamic>? product;
  final String currency;
  final bool catalogLinked;
  @override
  State<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends State<ProductFormScreen> {
  late final Map<String, dynamic> _p = widget.product ?? const {};
  late final Map _attr = productAttributes(_p);
  late final _title = TextEditingController(text: '${_p['title'] ?? ''}');
  late final _sku = TextEditingController(text: '${_p['retailer_id'] ?? ''}');
  late final _price = TextEditingController(text: _p['price'] == null ? '' : '${_p['price']}');
  late String _currency = '${_p['currency'] ?? widget.currency}'.toUpperCase();
  late final _category = TextEditingController(text: '${_p['category'] ?? ''}');
  late final _stock = TextEditingController(text: _p['inventory_count'] == null ? '' : '${_p['inventory_count']}');
  late final _description = TextEditingController(text: '${_p['description'] ?? ''}');
  late final _image = TextEditingController(text: '${_p['image_url'] ?? ''}');
  late final _website = TextEditingController(text: '${_p['website_url'] ?? ''}');
  late final _brand = TextEditingController(text: '${_attr['brand'] ?? ''}');
  late String _condition = '${_attr['condition'] ?? 'new'}';
  late String _origin = '${_attr['origin_country'] ?? ''}';
  late bool _service = _attr['is_service'] == true;
  late final _importer = TextEditingController(text: '${_attr['importer_name'] ?? ''}');
  late final _street = TextEditingController(text: '${(_attr['importer_address'] as Map?)?['street1'] ?? ''}');
  late final _city = TextEditingController(text: '${(_attr['importer_address'] as Map?)?['city'] ?? ''}');
  late final _pin = TextEditingController(text: '${(_attr['importer_address'] as Map?)?['postal_code'] ?? ''}');
  late bool _available = _p['is_available'] != false;
  bool _saving = false;
  String _error = '';

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = '';
    });
    final fields = {
      'title': _title.text.trim(),
      'retailer_id': _sku.text.trim(),
      'price': _price.text.trim(),
      'currency': _currency,
      'description': _description.text.trim(),
      'image_url': _image.text.trim(),
      'website_url': _website.text.trim(),
      'category': _category.text.trim(),
      'inventory_count': _stock.text.trim(),
      'is_available': _available,
      'brand': _brand.text.trim(),
      'condition': _condition,
      'origin_country': _origin,
      'is_service': _service,
      'importer_name': _importer.text.trim(),
      'importer_street': _street.text.trim(),
      'importer_city': _city.text.trim(),
      'importer_postal_code': _pin.text.trim(),
    };
    try {
      final data = await AppScope.read(context).ask('/api/commerce/products', {
        'product': {if (_p['id'] != null) 'id': _p['id'], ...fields},
      });
      if (!mounted) return;
      final saved = Map<String, dynamic>.from(data['product'] as Map? ?? const {});
      final name = '“${saved['title'] ?? 'Product'}”';
      final catalog = (data['catalog'] as Map?) ?? const {};
      if (catalog['state'] == 'error') {
        await showMessage(
          context,
          'Saved, but not in your WhatsApp catalog',
          '$name was saved here. Your WhatsApp catalog did not take the change:\n\n${(catalog['errors'] as List? ?? const []).map((l) => '• $l').join('\n')}',
        );
      } else if (mounted) {
        toast(context, catalog['state'] == 'pending' ? '$name was saved and sent to your WhatsApp catalog.' : '$name was saved.');
      }
      if (mounted) Navigator.pop(context, saved);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sync = catalogSync(_p);
    final issues = [...(sync?['errors'] as List? ?? const []), ...(sync?['warnings'] as List? ?? const [])];
    final currencies = {_currency, widget.currency.toUpperCase(), 'INR', 'USD', 'EUR', 'GBP'}.toList();
    Widget gap() => const SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(_p['id'] == null ? 'Add product' : 'Edit product')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Text(
            widget.catalogLinked
                ? 'Saving sends this product to your WhatsApp catalog, where customers can add it to a cart. WhatsApp reviews new items before it shows them.'
                : 'This product is saved here. Link your Meta catalog in the Store tab to sell it from the WhatsApp cart.',
            style: const TextStyle(color: Brand.muted, fontSize: 13.5),
          ),
          gap(),
          if (issues.isNotEmpty) NoteBox(attention: true, icon: Icons.error_outline, text: 'Your WhatsApp catalog said this about the product:\n${issues.map((i) => '• $i').join('\n')}'),
          TextField(
            controller: _title,
            maxLength: 150,
            decoration: const InputDecoration(labelText: 'Name', hintText: 'Classic white linen shirt', counterText: ''),
          ),
          gap(),
          TextField(
            controller: _sku,
            maxLength: 100,
            decoration: const InputDecoration(labelText: 'SKU (your product code)', hintText: 'SHIRT-001', counterText: ''),
          ),
          gap(),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _price,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Price', hintText: '1499'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _currency,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Currency'),
                  items: [for (final c in currencies) DropdownMenuItem(value: c, child: Text(c))],
                  onChanged: (v) => setState(() => _currency = v ?? _currency),
                ),
              ),
            ],
          ),
          gap(),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _category,
                  maxLength: 60,
                  decoration: const InputDecoration(labelText: 'Category (optional)', hintText: 'Shirts', counterText: ''),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _stock,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'In stock (optional)', hintText: 'Not tracked'),
                ),
              ),
            ],
          ),
          gap(),
          TextField(
            controller: _description,
            maxLength: 2000,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Description (optional)', counterText: ''),
          ),
          gap(),
          TextField(
            controller: _image,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Photo link${widget.catalogLinked ? '' : ' (optional)'}',
              hintText: 'https://…',
              helperText: 'A JPEG or PNG of at least 500 × 500 pixels. WhatsApp needs one for every catalog item.',
              helperMaxLines: 3,
            ),
          ),
          gap(),
          TextField(
            controller: _website,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Product page on your website (optional)',
              hintText: 'https://yourstore.com/products/…',
              helperText: 'Needed to share this product as a website link.',
              helperMaxLines: 2,
            ),
          ),
          const SizedBox(height: 20),
          const Text('WhatsApp catalog details', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          gap(),
          TextField(
            controller: _brand,
            maxLength: 100,
            decoration: const InputDecoration(labelText: 'Brand (optional)', hintText: 'Your store name', counterText: ''),
          ),
          gap(),
          DropdownButtonFormField<String>(
            initialValue: _condition,
            decoration: const InputDecoration(labelText: 'Condition'),
            items: const [
              DropdownMenuItem(value: 'new', child: Text('New')),
              DropdownMenuItem(value: 'refurbished', child: Text('Refurbished')),
              DropdownMenuItem(value: 'used', child: Text('Used')),
            ],
            onChanged: (v) => setState(() => _condition = v ?? 'new'),
          ),
          gap(),
          DropdownButtonFormField<String>(
            initialValue: _origin,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Made in'),
            items: [
              const DropdownMenuItem(value: '', child: Text('Not specified')),
              for (final (code, name) in originCountries) DropdownMenuItem(value: code, child: Text(name)),
              if (_origin.isNotEmpty && !originCountries.any((c) => c.$1 == _origin)) DropdownMenuItem(value: _origin, child: Text(_origin)),
            ],
            onChanged: _service ? null : (v) => setState(() => _origin = v ?? ''),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _service,
            onChanged: (v) => setState(() => _service = v),
            title: const Text('This is a service or a digital item'),
            subtitle: const Text('No country of origin is needed for it.'),
          ),
          if (!_service && _currency == 'INR')
            const Text('For goods sold in India, WhatsApp asks where each item was made, and who imported it when that is another country.', style: TextStyle(color: Brand.muted, fontSize: 13)),
          if (!_service && _currency == 'INR' && _origin.isNotEmpty && _origin != 'IN') ...[
            gap(),
            TextField(
              controller: _importer,
              decoration: const InputDecoration(labelText: 'Importer’s legal name'),
            ),
            gap(),
            TextField(
              controller: _street,
              decoration: const InputDecoration(labelText: 'Importer’s street address'),
            ),
            gap(),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _city,
                    decoration: const InputDecoration(labelText: 'City'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _pin,
                    decoration: const InputDecoration(labelText: 'PIN code (optional)'),
                  ),
                ),
              ],
            ),
          ],
          SwitchListTile(contentPadding: EdgeInsets.zero, value: _available, onChanged: (v) => setState(() => _available = v), title: const Text('Available to sell')),
          if (_error.isNotEmpty) NoteBox(attention: true, icon: Icons.error_outline, text: _error),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save product'),
          ),
        ],
      ),
    );
  }
}

// ── Send a product, a few, or the whole catalog to a customer ──

class ShareTarget {
  const ShareTarget.product(Map<String, dynamic> this.product) : kind = 'product', products = const [];
  const ShareTarget.collection(this.products) : kind = 'collection', product = null;
  const ShareTarget.catalog() : kind = 'catalog', product = null, products = const [];
  final String kind;
  final Map<String, dynamic>? product;
  final List<Map<String, dynamic>> products;
}

class ShareScreen extends StatefulWidget {
  const ShareScreen({super.key, required this.target, required this.catalogLinked});
  final ShareTarget target;
  final bool catalogLinked;
  @override
  State<ShareScreen> createState() => _ShareScreenState();
}

class _ShareScreenState extends State<ShareScreen> {
  late String _mode = widget.catalogLinked ? 'single_product' : 'website_redirect';
  final _query = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _matches = const [];
  bool _searching = false;
  ({String? contactId, String? phone, String label})? _to;
  late final _message = TextEditingController(
    text: switch (widget.target.kind) {
      'product' => 'Check out ${widget.target.product!['title']} for ${formatMoney(widget.target.product!['price'], widget.target.product!['currency'])}:',
      'collection' => 'Here are a few things we picked for you. Tap one to see it and add it to your cart.',
      _ => 'Tap below to browse our catalog and place your order.',
    },
  );
  bool _sending = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    _message.dispose();
    super.dispose();
  }

  void _lookUp(String text) {
    _debounce?.cancel();
    final term = text.trim();
    if (term.length < 2) {
      setState(() => _matches = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      final app = AppScope.read(context);
      setState(() => _searching = true);
      try {
        final data = await app.backend.get('/api/contacts', {'organizationId': app.orgId, 'fields': 'basic', 'limit': '6', 'search': term});
        if (mounted) setState(() => _matches = [for (final c in (data['contacts'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)]);
      } catch (_) {
        if (mounted) setState(() => _matches = const []);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _send() async {
    final to = _to;
    if (to == null) return;
    final t = widget.target;
    setState(() => _sending = true);
    try {
      await AppScope.read(context).ask('/api/commerce/send', {
        'type': t.kind == 'product' ? _mode : (t.kind == 'collection' ? 'multi_product' : 'catalog'),
        if (to.contactId != null) 'contactId': to.contactId else 'phone': to.phone,
        'payload': switch (t.kind) {
          'product' => {'productRetailerId': t.product!['retailer_id'], 'productTitle': t.product!['title'], 'bodyText': _message.text, 'websiteUrl': ?t.product!['website_url']},
          'collection' => {
            'productRetailerIds': [for (final p in t.products) p['retailer_id']],
            'bodyText': _message.text,
          },
          _ => {'bodyText': _message.text},
        },
      });
      if (!mounted) return;
      final what = t.kind == 'product' ? '“${t.product!['title']}”' : (t.kind == 'collection' ? '${t.products.length} products' : 'Your catalog');
      toast(context, '$what ${t.kind == 'collection' ? 'were' : 'was'} sent to ${to.label}.');
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) await showMessage(context, 'Message not sent', plain(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.target;
    final product = t.product;
    final canCard = widget.catalogLinked;
    final canLink = '${product?['website_url'] ?? ''}'.isNotEmpty;
    final notReady = t.kind == 'collection' ? t.products.where((p) => catalogState(p) != 'in_catalog').length : 0;
    final caution = !widget.catalogLinked
        ? ''
        : product != null && _mode == 'single_product'
        ? catalogCaution(catalogState(product))
        : notReady > 0
        ? '$notReady of these products ${notReady == 1 ? 'is' : 'are'} not approved in your WhatsApp catalog yet, so WhatsApp may refuse the message or leave ${notReady == 1 ? 'it' : 'them'} out.'
        : '';
    final blocked = t.kind == 'product' ? (_mode == 'single_product' ? !canCard : !canLink) : !widget.catalogLinked;
    final digits = phoneDigits(_query.text);
    return Scaffold(
      appBar: AppBar(title: Text(t.kind == 'product' ? 'Send product' : (t.kind == 'collection' ? 'Send ${t.products.length} products' : 'Send your catalog'))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          if (product != null)
            Panel(
              child: Row(
                children: [
                  ProductImage(product['image_url']),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${product['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('${formatMoney(product['price'], product['currency'])} · SKU ${product['retailer_id']}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (t.kind == 'collection') NoteBox(text: 'In this message: ${t.products.map((p) => p['title']).join(' · ')}'),
          if (t.kind == 'catalog') const NoteBox(text: 'The customer gets a button that opens your whole catalog inside WhatsApp, where they can add items to a cart and send it to you.'),
          const SizedBox(height: 12),
          const Text('Send to', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          if (_to != null)
            Container(
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
              decoration: BoxDecoration(color: Brand.bubble, borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  const Icon(Icons.person, size: 18, color: Brand.blue),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_to!.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  IconButton(
                    onPressed: () => setState(() {
                      _to = null;
                      _query.clear();
                      _matches = const [];
                    }),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            )
          else ...[
            TextField(
              controller: _query,
              autofocus: true,
              onChanged: (v) {
                setState(() {});
                _lookUp(v);
              },
              decoration: const InputDecoration(hintText: 'Name or WhatsApp number', prefixIcon: Icon(Icons.search)),
            ),
            if (_query.text.trim().length >= 2)
              Card(
                margin: const EdgeInsets.only(top: 6),
                child: Column(
                  children: [
                    for (final c in _matches)
                      ListTile(
                        title: Text([c['first_name'], c['last_name']].where((x) => '${x ?? ''}'.isNotEmpty).join(' ').ifEmpty('${c['phone_number'] ?? 'Contact'}')),
                        subtitle: Text('${c['phone_number'] ?? 'No phone number'}'),
                        onTap: () => setState(
                          () => _to = (contactId: '${c['id']}', phone: null, label: [c['first_name'], c['last_name']].where((x) => '${x ?? ''}'.isNotEmpty).join(' ').ifEmpty('${c['phone_number']}')),
                        ),
                      ),
                    if (digits.isNotEmpty && !_matches.any((c) => phoneDigits(c['phone_number']) == digits))
                      ListTile(
                        title: Text('Send to +$digits'),
                        subtitle: const Text('A number that is not in your contacts'),
                        onTap: () => setState(() => _to = (contactId: null, phone: '+$digits', label: '+$digits')),
                      ),
                    if (_matches.isEmpty && digits.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(_searching ? 'Searching…' : 'No contact found. Type the full number with its country code to send to it.', style: const TextStyle(color: Brand.muted)),
                      ),
                  ],
                ),
              ),
          ],
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('WhatsApp only delivers this if the customer has messaged you in the last 24 hours.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          ),
          if (t.kind == 'product') ...[
            const SizedBox(height: 16),
            const Text('Send as', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            RadioGroup<String>(
              groupValue: _mode,
              onChanged: (v) => setState(() => _mode = v ?? _mode),
              child: Column(
                children: [
                  for (final (id, title, detail, reason) in [
                    ('single_product', 'Catalog card', 'The customer can add it to a cart in WhatsApp', canCard ? '' : 'Link a Meta catalog in the Store tab'),
                    ('website_redirect', 'Website link', 'Opens the product page on your site', canLink ? '' : 'This product has no website link'),
                  ])
                    RadioListTile<String>(contentPadding: EdgeInsets.zero, value: id, enabled: reason.isEmpty, title: Text(title), subtitle: Text(reason.isNotEmpty ? reason : detail)),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _message,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Message', counterText: ''),
          ),
          if (caution.isNotEmpty) ...[const SizedBox(height: 10), NoteBox(attention: true, icon: Icons.warning_amber_rounded, text: caution)],
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _sending || _to == null || blocked || _message.text.trim().isEmpty ? null : _send,
            icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
            label: Text(_sending ? 'Sending…' : 'Send'),
          ),
        ],
      ),
    );
  }
}

extension on String {
  String ifEmpty(String other) => trim().isEmpty ? other : this;
}
